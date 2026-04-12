const C = require("./constants");

const rooms = new Map();
const socketToRoom = new Map();

function createRoom(socketId, nickname) {
  ensureSocketIsFree(socketId);
  const room = {
    code: createRoomCode(),
    hostId: socketId,
    status: "lobby",
    players: new Map(),
    effects: [],
    match: null,
    createdAt: Date.now()
  };
  addPlayer(room, socketId, nickname, false);
  rooms.set(room.code, room);
  socketToRoom.set(socketId, room.code);
  return room;
}

function joinRoom(socketId, code, nickname) {
  ensureSocketIsFree(socketId);
  const room = rooms.get(String(code || "").trim().toUpperCase());
  if (!room) throw new Error("Room not found.");
  if (room.status !== "lobby") throw new Error("Match already started.");
  if (room.players.size >= C.MAX_PLAYERS) throw new Error("Room is full.");
  addPlayer(room, socketId, nickname, false);
  socketToRoom.set(socketId, room.code);
  return room;
}

function leaveRoom(socketId) {
  const room = getRoomBySocket(socketId);
  if (!room) return null;
  const player = room.players.get(socketId);
  if (!player) return null;

  if (room.status === "playing") {
    player.connected = false;
    if (player && player.alive) {
      player.alive = false;
      player.eliminatedAt = Date.now();
      room.effects.push(createEffect("elimination", player.x, player.y, 520, { color: player.color }));
    }
  } else {
    room.players.delete(socketId);
  }
  socketToRoom.delete(socketId);
  if (room.hostId === socketId) {
    const nextHost = Array.from(room.players.values()).find((candidate) => !candidate.isBot && candidate.connected !== false);
    room.hostId = nextHost ? nextHost.id : null;
  }
  if (!room.hostId || connectedHumanPlayers(room).length === 0) rooms.delete(room.code);
  else if (room.status === "playing") maybeEndRound(room);
  return room;
}

function setReady(socketId, ready) {
  const room = getRoomBySocket(socketId);
  if (!room || room.status !== "lobby") return null;
  const player = room.players.get(socketId);
  if (!player || player.isBot) return null;
  player.ready = Boolean(ready);
  return room;
}

function addBot(socketId) {
  const room = getRoomBySocket(socketId);
  if (!room) throw new Error("Create or join a room first.");
  if (room.hostId !== socketId) throw new Error("Only the host can add bots.");
  if (room.status !== "lobby") throw new Error("Bots can only be added in the lobby.");
  if (room.players.size >= C.MAX_PLAYERS) throw new Error("Room is full.");
  addPlayer(room, `bot-${room.code}-${room.players.size + 1}`, `Bot ${botCount(room) + 1}`, true);
  return room;
}

function removeBot(socketId) {
  const room = getRoomBySocket(socketId);
  if (!room) throw new Error("Create or join a room first.");
  if (room.hostId !== socketId) throw new Error("Only the host can remove bots.");
  if (room.status !== "lobby") throw new Error("Bots can only be removed in the lobby.");
  const bot = Array.from(room.players.values()).reverse().find((player) => player.isBot);
  if (!bot) throw new Error("No bots to remove.");
  room.players.delete(bot.id);
  return room;
}

function fillBots(socketId) {
  const room = getRoomBySocket(socketId);
  if (!room) throw new Error("Create or join a room first.");
  if (room.hostId !== socketId) throw new Error("Only the host can fill bots.");
  if (room.status !== "lobby") throw new Error("Bots can only be added in the lobby.");
  while (room.players.size < C.MAX_PLAYERS) addPlayer(room, `bot-${room.code}-${room.players.size + 1}`, `Bot ${botCount(room) + 1}`, true);
  return room;
}

function startMatch(socketId) {
  const room = getRoomBySocket(socketId);
  if (!room) throw new Error("Create or join a room first.");
  if (room.hostId !== socketId) throw new Error("Only the host can start.");
  if (room.players.size < C.MIN_PLAYERS) throw new Error("Need at least 2 players.");
  if (!isRoomReadyToStart(room)) {
    throw new Error("All human players must be ready before the match can start.");
  }
  room.status = "playing";
  room.effects = [];
  room.match = {
    startedAt: Date.now(),
    winnerId: null,
    endedAt: null,
    endSent: false,
    tick: 0,
    safeRadius: C.ARENA_RADIUS,
    suddenDeath: false
  };
  const players = Array.from(room.players.values());
  players.forEach((player, index) => {
    player.connected = true;
    const angle = (Math.PI * 2 * index) / players.length;
    player.alive = true;
    player.ready = false;
    player.x = C.WORLD_WIDTH / 2 + Math.cos(angle) * C.ARENA_RADIUS * 0.4;
    player.y = C.WORLD_HEIGHT / 2 + Math.sin(angle) * C.ARENA_RADIUS * 0.4;
    player.vx = 0;
    player.vy = 0;
    player.knockbackX = 0;
    player.knockbackY = 0;
    player.facingX = Math.cos(angle + Math.PI);
    player.facingY = Math.sin(angle + Math.PI);
    player.dashUntil = 0;
    player.pushCooldownUntil = Date.now() + 500;
    player.dashCooldownUntil = Date.now() + 500;
    player.hitImmuneUntil = 0;
    player.hitFlashUntil = 0;
    player.outsideSince = null;
    player.eliminatedAt = null;
    player.botThinkAt = 0;
    player.input = { x: 0, y: 0 };
  });
  return room;
}

function returnRoomToLobby(socketId) {
  const room = getRoomBySocket(socketId);
  if (!room) throw new Error("Create or join a room first.");
  if (room.hostId !== socketId) throw new Error("Only the host can return the room to the lobby.");
  if (room.status !== "ended") throw new Error("The room can only return to the lobby after a match ends.");

  room.status = "lobby";
  room.effects = [];
  room.match = null;

  for (const [playerId, player] of room.players) {
    if (!player.isBot && player.connected === false) {
      room.players.delete(playerId);
      continue;
    }
    player.ready = player.isBot;
    player.alive = false;
    player.x = C.WORLD_WIDTH / 2;
    player.y = C.WORLD_HEIGHT / 2;
    player.vx = 0;
    player.vy = 0;
    player.knockbackX = 0;
    player.knockbackY = 0;
    player.outsideSince = null;
    player.eliminatedAt = null;
    player.dashUntil = 0;
    player.pushCooldownUntil = 0;
    player.dashCooldownUntil = 0;
    player.hitImmuneUntil = 0;
    player.hitFlashUntil = 0;
    player.input = { x: 0, y: 0 };
  }

  if (!room.players.has(room.hostId) || room.players.get(room.hostId)?.connected === false) {
    const nextHost = Array.from(room.players.values()).find((player) => !player.isBot && player.connected !== false);
    room.hostId = nextHost ? nextHost.id : null;
  }

  if (!room.hostId || connectedHumanPlayers(room).length === 0) {
    rooms.delete(room.code);
    return null;
  }

  return room;
}

function updateInput(socketId, input) {
  const room = getRoomBySocket(socketId);
  if (!room || room.status !== "playing") return;
  const player = room.players.get(socketId);
  if (!player || !player.alive || player.isBot) return;
  const x = (input && input.right ? 1 : 0) - (input && input.left ? 1 : 0);
  const y = (input && input.down ? 1 : 0) - (input && input.up ? 1 : 0);
  const length = Math.hypot(x, y);
  player.input = length ? { x: x / length, y: y / length } : { x: 0, y: 0 };
  if (player.input.x || player.input.y) {
    player.facingX = player.input.x;
    player.facingY = player.input.y;
  }
}

function requestAction(socketId, action) {
  const room = getRoomBySocket(socketId);
  if (!room || room.status !== "playing") return null;
  if (Date.now() - room.match.startedAt < C.ROUND_START_DELAY_MS) return room;
  const player = room.players.get(socketId);
  if (!player || !player.alive || player.isBot) return null;
  const now = Date.now();
  if (action === "dash") {
    tryDash(room, player, now);
  }
  if (action === "push") {
    tryPush(room, player, now);
  }
  return room;
}

function requestBotAction(room, bot, action, now = Date.now()) {
  if (!room || !bot || !bot.isBot || !bot.alive) return false;
  if (action === "dash") return tryDash(room, bot, now);
  if (action === "push") return tryPush(room, bot, now);
  return false;
}

function getRoomBySocket(socketId) {
  const code = socketToRoom.get(socketId);
  return code ? rooms.get(code) : null;
}

function endRound(room, winner) {
  if (room.status !== "playing") return room;
  room.status = "ended";
  room.match.winnerId = winner ? winner.id : null;
  room.match.endedAt = Date.now();
  room.match.endSent = false;
  if (winner && !room.match.scoreAwarded) {
    winner.score += 1;
    room.match.scoreAwarded = true;
  }
  return room;
}

function maybeEndRound(room) {
  if (room.status !== "playing") return room;
  const alive = Array.from(room.players.values()).filter((player) => player.alive);
  if (alive.length <= 1) endRound(room, alive[0] || null);
  return room;
}

function listOpenRooms() {
  return Array.from(rooms.values())
    .filter((room) => room.status === "lobby" && room.players.size < C.MAX_PLAYERS)
    .map((room) => ({
      code: room.code,
      host: room.players.get(room.hostId)?.nickname || "Unknown",
      players: room.players.size,
      maxPlayers: C.MAX_PLAYERS,
      bots: botCount(room),
      ready: Array.from(room.players.values()).filter((player) => player.ready).length,
      status: "Waiting"
    }));
}

function serializeRoom(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    status: room.status,
    minPlayers: C.MIN_PLAYERS,
    maxPlayers: C.MAX_PLAYERS,
    players: Array.from(room.players.values()).map((player) => ({
      id: player.id,
      nickname: player.nickname,
      color: player.color,
      isBot: player.isBot,
      ready: player.ready,
      alive: player.alive,
      score: player.score,
      connected: player.connected !== false
    }))
  };
}

function addPlayer(room, id, nickname, isBot) {
  room.players.set(id, {
    id,
    nickname: isBot ? nickname : sanitizeNickname(nickname),
    color: C.PLAYER_COLORS[room.players.size % C.PLAYER_COLORS.length],
    isBot,
    connected: true,
    ready: isBot,
    alive: false,
    x: C.WORLD_WIDTH / 2,
    y: C.WORLD_HEIGHT / 2,
    vx: 0,
    vy: 0,
    knockbackX: 0,
    knockbackY: 0,
    outsideSince: null,
    eliminatedAt: null,
    score: 0,
    botThinkAt: 0,
    facingX: 1,
    facingY: 0,
    dashUntil: 0,
    pushCooldownUntil: 0,
    dashCooldownUntil: 0,
    hitImmuneUntil: 0,
    hitFlashUntil: 0,
    botNoiseX: Math.random() * 2 - 1,
    botNoiseY: Math.random() * 2 - 1,
    input: { x: 0, y: 0 }
  });
}

function tryDash(room, player, now) {
  if (now < player.dashCooldownUntil) return false;
  const dashDir = normalizeVector(player.facingX || player.input.x || 1, player.facingY || player.input.y || 0);
  player.vx *= 0.35;
  player.vy *= 0.35;
  player.knockbackX += dashDir.x * C.DASH_FORCE;
  player.knockbackY += dashDir.y * C.DASH_FORCE;
  player.facingX = dashDir.x;
  player.facingY = dashDir.y;
  player.dashUntil = now + 180;
  player.dashCooldownUntil = now + C.DASH_COOLDOWN_MS;
  room.effects.push(createEffect("dash", player.x, player.y, 240, { color: player.color }));
  return true;
}

function tryPush(room, attacker, now) {
  if (now < attacker.pushCooldownUntil) return false;
  attacker.pushCooldownUntil = now + C.PUSH_COOLDOWN_MS;
  const pushDir = normalizeVector(attacker.facingX || attacker.input.x || 1, attacker.facingY || attacker.input.y || 0);
  let hit = false;
  room.effects.push(createEffect("push", attacker.x + pushDir.x * 30, attacker.y + pushDir.y * 30, 180, { color: attacker.color }));
  for (const target of room.players.values()) {
    if (!target.alive || target.id === attacker.id || now < target.hitImmuneUntil) continue;
    const dx = target.x - attacker.x;
    const dy = target.y - attacker.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= 0 || distance > C.PUSH_RANGE) continue;
    const nx = dx / distance;
    const ny = dy / distance;
    const dot = nx * pushDir.x + ny * pushDir.y;
    if (dot < C.PUSH_CONE_DOT) continue;
    const distanceRatio = 1 - distance / C.PUSH_RANGE;
    const forceScale = Math.max(C.PUSH_MIN_FORCE_RATIO, dot) * (0.72 + distanceRatio * 0.28);
    target.knockbackX += nx * C.PUSH_FORCE * forceScale;
    target.knockbackY += ny * C.PUSH_FORCE * forceScale;
    target.hitImmuneUntil = now + C.HIT_IMMUNITY_MS;
    target.hitFlashUntil = now + 220;
    room.effects.push(createEffect("impact", target.x, target.y, 320, { color: target.color }));
    hit = true;
  }
  return hit;
}

function createEffect(type, x, y, durationMs, data = {}) {
  return {
    id: `${type}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type,
    x,
    y,
    durationMs,
    expiresAt: Date.now() + durationMs,
    ...data
  };
}

function botCount(room) {
  return Array.from(room.players.values()).filter((player) => player.isBot).length;
}

function connectedHumanPlayers(room) {
  return Array.from(room.players.values()).filter((player) => !player.isBot && player.connected !== false);
}

function isRoomReadyToStart(room) {
  if (room.players.size < C.MIN_PLAYERS) return false;
  const humans = connectedHumanPlayers(room);
  return humans.every((player) => player.ready);
}

function sanitizeNickname(nickname) {
  const value = String(nickname || "").trim().replace(/\s+/g, " ").slice(0, 18);
  if (!value) throw new Error("Enter a nickname first.");
  return value;
}

function ensureSocketIsFree(socketId) {
  if (socketToRoom.has(socketId)) throw new Error("You are already in a room.");
}

function createRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = "";
    for (let i = 0; i < C.ROOM_CODE_LENGTH; i += 1) code += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms.has(code));
  return code;
}

function normalizeVector(x, y) {
  const length = Math.hypot(x, y);
  return length ? { x: x / length, y: y / length } : { x: 1, y: 0 };
}

module.exports = {
  rooms,
  createRoom,
  joinRoom,
  leaveRoom,
  setReady,
  addBot,
  removeBot,
  fillBots,
  startMatch,
  returnRoomToLobby,
  endRound,
  maybeEndRound,
  updateInput,
  requestAction,
  requestBotAction,
  getRoomBySocket,
  isRoomReadyToStart,
  listOpenRooms,
  serializeRoom
};
