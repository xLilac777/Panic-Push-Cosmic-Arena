const C = require("./constants");
const store = require("./roomStore");
const { rooms } = store;

function updateAuthoritativeState(deltaMs) {
  const delta = deltaMs / 1000;
  for (const room of rooms.values()) {
    if (room.status !== "playing") continue;
    room.match.tick += 1;
    const roundLive = isRoundLive(room);
    if (roundLive) resolveRoundTimeout(room);
    updateArena(room);
    updateBots(room, roundLive);
    for (const player of room.players.values()) updatePlayer(player, delta, roundLive);
    if (roundLive) {
      resolvePlayerCollisions(room);
      updateEliminations(room);
    }
    room.effects = room.effects.filter((effect) => effect.expiresAt > Date.now());
    store.maybeEndRound(room);
  }
}

function resolveRoundTimeout(room) {
  const activeElapsed = Date.now() - room.match.startedAt - C.ROUND_START_DELAY_MS;
  if (activeElapsed < C.ROUND_MS + C.OVERTIME_MS) return;
  const now = Date.now();
  const cx = C.WORLD_WIDTH / 2;
  const cy = C.WORLD_HEIGHT / 2;
  const alive = Array.from(room.players.values()).filter((player) => player.alive);
  const winner = alive.sort((a, b) => {
    const aScore = distance(a.x, a.y, cx, cy) + Math.hypot(a.vx + a.knockbackX, a.vy + a.knockbackY) * 0.08;
    const bScore = distance(b.x, b.y, cx, cy) + Math.hypot(b.vx + b.knockbackX, b.vy + b.knockbackY) * 0.08;
    return aScore - bScore;
  })[0] || null;
  for (const player of room.players.values()) {
    if (!player.alive || (winner && player.id === winner.id)) continue;
    player.alive = false;
    player.eliminatedAt = now;
    player.input = { x: 0, y: 0 };
    room.effects.push({
      id: `timeout-elimination-${now}-${player.id}`,
      type: "elimination",
      x: player.x,
      y: player.y,
      color: player.color,
      durationMs: 520,
      expiresAt: now + 520
    });
  }
  store.endRound(room, winner);
}

function createSnapshot(room) {
  const now = Date.now();
  const roundLive = isRoundLive(room, now);
  const countdownMs = room.match ? Math.max(0, C.ROUND_START_DELAY_MS - (now - room.match.startedAt)) : 0;
  const activeElapsed = room.match ? Math.max(0, now - room.match.startedAt - C.ROUND_START_DELAY_MS) : 0;
  const overtimeActive = room.match ? activeElapsed >= C.ROUND_MS : false;
  const phaseElapsed = room.match ? Math.max(0, activeElapsed - C.ROUND_MS) : 0;
  const phaseTimeLeftMs = room.match
    ? Math.max(0, overtimeActive ? C.OVERTIME_MS - phaseElapsed : C.ROUND_MS - activeElapsed)
    : 0;
  return {
    code: room.code,
    status: room.status,
    roundLive,
    countdownMs,
    countdownValue: countdownMs > 0 ? Math.min(3, Math.max(1, Math.ceil(countdownMs / 1000))) : 0,
    overtimeActive,
    arena: {
      width: C.WORLD_WIDTH,
      height: C.WORLD_HEIGHT,
      centerX: C.WORLD_WIDTH / 2,
      centerY: C.WORLD_HEIGHT / 2,
      radius: room.match ? room.match.safeRadius : C.ARENA_RADIUS,
      startRadius: C.ARENA_RADIUS,
      endRadius: C.ARENA_END_RADIUS,
      hazardActive: room.match ? overtimeActive : false
    },
    timeLeftMs: phaseTimeLeftMs,
    winnerId: room.match ? room.match.winnerId : null,
    standings: Array.from(room.players.values()).map((player) => ({
      id: player.id,
      nickname: player.nickname,
      isBot: player.isBot,
      alive: player.alive,
      score: player.score,
      eliminatedAt: player.eliminatedAt
    })).sort((a, b) => (a.alive === b.alive ? b.score - a.score : a.alive ? -1 : 1)),
    players: Array.from(room.players.values()).map((player) => ({
      id: player.id,
      nickname: player.nickname,
      color: player.color,
      isBot: player.isBot,
      alive: player.alive,
      x: player.x,
      y: player.y,
      vx: player.vx,
      vy: player.vy,
      score: player.score,
      facingX: player.facingX,
      facingY: player.facingY,
      pushCooldownLeftMs: Math.max(0, player.pushCooldownUntil - now),
      dashCooldownLeftMs: Math.max(0, player.dashCooldownUntil - now),
      hitFlashLeftMs: Math.max(0, player.hitFlashUntil - now),
      dashing: Math.max(0, (player.dashUntil || 0) - now) > 0
    })),
    effects: room.effects.map((effect) => ({
      ...effect,
      life: Math.max(0, (effect.expiresAt - now) / effect.durationMs)
    }))
  };
}

function updateBots(room, roundLive) {
  if (!roundLive) {
    for (const bot of room.players.values()) {
      if (!bot.isBot) continue;
      bot.input = { x: 0, y: 0 };
    }
    return;
  }
  const aliveTargets = Array.from(room.players.values()).filter((player) => player.alive);
  for (const bot of room.players.values()) {
    if (!bot.isBot || !bot.alive) continue;
    if (Date.now() < bot.botThinkAt) continue;
    const now = Date.now();
    bot.botThinkAt = now + C.BOT_THINK_MS;
    const target = chooseBotTarget(room, bot, aliveTargets);
    const center = normalize(C.WORLD_WIDTH / 2 - bot.x, C.WORLD_HEIGHT / 2 - bot.y);
    const edgePressure = Math.max(0, distance(bot.x, bot.y, C.WORLD_WIDTH / 2, C.WORLD_HEIGHT / 2) - (room.match.safeRadius - C.BOT_EDGE_DISTANCE));
    let dx = center.x * edgePressure;
    let dy = center.y * edgePressure;
    if (target && edgePressure < 120) {
      const chase = normalize(target.x - bot.x, target.y - bot.y);
      dx += chase.x * C.BOT_AGGRESSION * (targetDistanceBias(bot, target, room));
      dy += chase.y * C.BOT_AGGRESSION * (targetDistanceBias(bot, target, room));
      const targetDistance = distance(bot.x, bot.y, target.x, target.y);
      if (targetDistance < C.PUSH_RANGE * C.BOT_PUSH_RANGE_FACTOR && Math.random() < C.BOT_PUSH_CHANCE) {
        bot.facingX = chase.x;
        bot.facingY = chase.y;
        store.requestBotAction(room, bot, "push", now);
      }
    }
    dx += bot.botNoiseX * C.BOT_RANDOMNESS;
    dy += bot.botNoiseY * C.BOT_RANDOMNESS;
    bot.input = normalize(dx, dy);
    if (bot.input.x || bot.input.y) {
      bot.facingX = bot.input.x;
      bot.facingY = bot.input.y;
    }
    if (edgePressure > C.BOT_DASH_EDGE_THRESHOLD) {
      bot.facingX = center.x;
      bot.facingY = center.y;
      store.requestBotAction(room, bot, "dash", now);
    }
  }
}

function chooseBotTarget(room, bot, candidates) {
  let best = null;
  let bestScore = Infinity;
  for (const player of candidates) {
    if (player.id === bot.id) continue;
    const d = distance(bot.x, bot.y, player.x, player.y);
    const edgeVulnerability = distance(player.x, player.y, C.WORLD_WIDTH / 2, C.WORLD_HEIGHT / 2) / room.match.safeRadius;
    const score = d - edgeVulnerability * C.BOT_TARGET_EDGE_WEIGHT + Math.random() * 20;
    if (score < bestScore) {
      best = player;
      bestScore = score;
    }
  }
  return best;
}

function targetDistanceBias(bot, target, room) {
  const dist = distance(bot.x, bot.y, target.x, target.y);
  const safe = Math.max(1, room.match.safeRadius);
  return PhaserLikeClamp(0.72 + (1 - Math.min(1, dist / safe)) * 0.48, 0.72, 1.2);
}

function updateArena(room) {
  const elapsed = Math.max(0, Date.now() - room.match.startedAt - C.ROUND_START_DELAY_MS);
  const totalShrink = C.ARENA_RADIUS - C.ARENA_END_RADIUS;
  const slowShrink = totalShrink * C.ROUND_SHRINK_PORTION;
  const fastShrink = totalShrink - slowShrink;
  if (elapsed <= C.ROUND_MS) {
    const progress = Math.min(1, elapsed / Math.max(1, C.ROUND_MS));
    room.match.safeRadius = C.ARENA_RADIUS - slowShrink * progress;
    return;
  }
  const overtimeElapsed = Math.min(C.OVERTIME_MS, Math.max(0, elapsed - C.ROUND_MS));
  const progress = Math.min(1, overtimeElapsed / Math.max(1, C.OVERTIME_MS));
  room.match.safeRadius = C.ARENA_RADIUS - slowShrink - fastShrink * progress;
}

function updatePlayer(player, delta, roundLive) {
  if (!player.alive) return;
  if (roundLive) {
    player.vx += player.input.x * C.PLAYER_ACCEL * delta;
    player.vy += player.input.y * C.PLAYER_ACCEL * delta;
  }
  const speed = Math.hypot(player.vx, player.vy);
  if (speed > C.PLAYER_MAX_SPEED) {
    player.vx = (player.vx / speed) * C.PLAYER_MAX_SPEED;
    player.vy = (player.vy / speed) * C.PLAYER_MAX_SPEED;
  }
  const friction = Math.max(0, 1 - C.PLAYER_FRICTION * delta);
  const knockbackFriction = Math.max(0, 1 - C.KNOCKBACK_FRICTION * delta);
  player.vx *= friction;
  player.vy *= friction;
  player.knockbackX *= knockbackFriction;
  player.knockbackY *= knockbackFriction;
  player.x += (player.vx + player.knockbackX) * delta;
  player.y += (player.vy + player.knockbackY) * delta;
  player.x = Math.max(-80, Math.min(C.WORLD_WIDTH + 80, player.x));
  player.y = Math.max(-80, Math.min(C.WORLD_HEIGHT + 80, player.y));
}

function isRoundLive(room, now = Date.now()) {
  return room.status === "playing" && room.match && now - room.match.startedAt >= C.ROUND_START_DELAY_MS;
}

function resolvePlayerCollisions(room) {
  const alive = Array.from(room.players.values()).filter((player) => player.alive);
  for (let i = 0; i < alive.length; i += 1) {
    for (let j = i + 1; j < alive.length; j += 1) {
      const a = alive[i];
      const b = alive[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 0.001;
      const min = C.PLAYER_RADIUS * 2;
      if (d >= min) continue;
      const overlap = (min - d) / 2;
      const nx = dx / d;
      const ny = dy / d;
      a.x -= nx * overlap;
      a.y -= ny * overlap;
      b.x += nx * overlap;
      b.y += ny * overlap;
    }
  }
}

function updateEliminations(room) {
  const now = Date.now();
  const alive = Array.from(room.players.values()).filter((player) => player.alive);
  if (alive.length <= 1) return;
  const toEliminate = [];
  const cx = C.WORLD_WIDTH / 2;
  const cy = C.WORLD_HEIGHT / 2;
  for (const player of alive) {
    const d = distance(player.x, player.y, cx, cy);
    if (d >= room.match.safeRadius + C.PLAYER_RADIUS) {
      toEliminate.push(player);
      continue;
    }
    if (d > room.match.safeRadius) {
      player.outsideSince = player.outsideSince || now;
      if (now - player.outsideSince >= C.ELIMINATION_GRACE_MS) toEliminate.push(player);
    } else {
      player.outsideSince = null;
    }
  }
  if (toEliminate.length >= alive.length) {
    const survivor = [...alive].sort((a, b) => distance(a.x, a.y, cx, cy) - distance(b.x, b.y, cx, cy))[0];
    const survivorIndex = toEliminate.indexOf(survivor);
    if (survivorIndex >= 0) toEliminate.splice(survivorIndex, 1);
    else toEliminate.pop();
  }
  for (const player of toEliminate) {
    player.alive = false;
    player.eliminatedAt = now;
    player.input = { x: 0, y: 0 };
    room.effects.push({
      id: `elimination-${now}-${player.id}`,
      type: "elimination",
      x: player.x,
      y: player.y,
      color: player.color,
      durationMs: 520,
      expiresAt: now + 520
    });
  }
}

function normalize(x, y) {
  const d = Math.hypot(x, y);
  return d ? { x: x / d, y: y / d } : { x: 0, y: 0 };
}

function distance(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

function PhaserLikeClamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

module.exports = {
  updateAuthoritativeState,
  createSnapshot
};
