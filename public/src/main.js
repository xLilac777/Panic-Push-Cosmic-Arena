(function () {
  const socket = io();
  let game = null;
  const uiHelpers = window.PanicUI;
  const state = {
    playerId: null,
    room: null,
    pendingSnapshot: null,
    input: { up: false, down: false, left: false, right: false },
    openRooms: [],
    winnerPlayed: false
  };

  const el = (id) => document.querySelector(`#${id}`);
  const ui = {
    menu: el("menuScreen"),
    lobby: el("lobbyScreen"),
    game: el("gameScreen"),
    end: el("endScreen"),
    nickname: el("nicknameInput"),
    roomCode: el("roomCodeInput"),
    create: el("createRoomButton"),
    join: el("joinRoomButton"),
    openRooms: el("openRoomList"),
    refresh: el("refreshRoomListButton"),
    lobbyCode: el("lobbyRoomCode"),
    copyCode: el("copyRoomCodeButton"),
    players: el("playerList"),
    ready: el("readyButton"),
    start: el("startMatchButton"),
    addBot: el("addBotButton"),
    removeBot: el("removeBotButton"),
    fillBots: el("fillBotsButton"),
    leave: el("leaveRoomButton"),
    timer: el("matchTimerText"),
    alive: el("aliveCountText"),
    dash: el("dashCooldownText"),
    push: el("pushCooldownText"),
    status: el("statusHintText"),
    winner: el("winnerText"),
    standings: el("standingsList"),
    returnLobby: el("returnLobbyButton")
  };

  socket.on("connect", () => setStatus("Connected."));
  socket.on("disconnect", () => {
    if (window.PanicAudio) {
      window.PanicAudio.play("music-stop");
      window.PanicAudio.play("lobby-music-stop");
    }
    setStatus("Disconnected.");
    resetClientState();
    show("menu");
  });
  socket.on("room:list", (rooms) => {
    state.openRooms = Array.isArray(rooms) ? rooms : [];
    renderOpenRooms();
  });
  socket.on("room:update", (room) => {
    state.room = room;
    if (room.status === "playing") return;
    if (room.status === "ended" && state.pendingSnapshot) {
      renderEnd(state.pendingSnapshot);
      show("end");
      return;
    }
    renderLobby();
  });
  socket.on("match:start", (snapshot) => {
    setStatus("Round starts now.");
    queueSnapshot(snapshot);
    state.winnerPlayed = false;
    prepareGameScreen();
    applySnapshotToScene(snapshot);
    updateHud(snapshot);
  });
  socket.on("match:snapshot", (snapshot) => {
    queueSnapshot(snapshot);
    if (snapshot.status === "playing" && ui.game.hidden) prepareGameScreen();
    applySnapshotToScene(snapshot);
    updateHud(snapshot);
  });
  socket.on("match:end", (snapshot) => {
    queueSnapshot(snapshot);
    applySnapshotToScene(snapshot);
    updateHud(snapshot);
    renderEnd(snapshot);
    if (!state.winnerPlayed && window.PanicAudio) {
      window.PanicAudio.play("music-stop");
      const self = snapshot.players.find((player) => player.id === state.playerId);
      window.PanicAudio.play(self && snapshot.winnerId === self.id ? "victory" : "loser");
      state.winnerPlayed = true;
    }
    show("end");
  });

  ui.create.addEventListener("click", () => join("room:create", { nickname: nickname() }));
  ui.join.addEventListener("click", () => join("room:join", { nickname: nickname(), code: ui.roomCode.value }));
  ui.refresh.addEventListener("click", () => socket.emit("room:list:request"));
  ui.copyCode.addEventListener("click", () => navigator.clipboard && state.room && navigator.clipboard.writeText(state.room.code));
  ui.ready.addEventListener("click", () => {
    const self = state.room && state.room.players.find((player) => player.id === state.playerId);
    socket.emit("player:ready", { ready: !(self && self.ready) });
  });
  ui.start.addEventListener("click", () => action("match:start", {}));
  ui.addBot.addEventListener("click", () => action("bot:add", {}));
  ui.removeBot.addEventListener("click", () => action("bot:remove", {}));
  ui.fillBots.addEventListener("click", () => action("bot:fill", {}));
  ui.leave.addEventListener("click", () => {
    leaveCurrentRoom();
  });
  ui.returnLobby.addEventListener("click", () => {
    leaveCurrentRoom();
  });
  ui.roomCode.addEventListener("input", () => {
    ui.roomCode.value = ui.roomCode.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  });

  document.addEventListener("keydown", (event) => {
    if (ui.game.hidden) return;
    if (isMoveKey(event.key) || isDashKey(event) || isPushKey(event)) {
      event.preventDefault();
    }
    if (!event.repeat && isDashKey(event)) socket.emit("action:dash");
    if (!event.repeat && isPushKey(event)) socket.emit("action:push");
    if (applyKey(event.key, true)) socket.emit("input:update", state.input);
  });
  document.addEventListener("keyup", (event) => {
    if (ui.game.hidden) return;
    if (isMoveKey(event.key)) {
      event.preventDefault();
      if (applyKey(event.key, false)) socket.emit("input:update", state.input);
    }
  });
  document.addEventListener("pointerdown", (event) => {
    if (ui.game.hidden || event.button !== 0) return;
    socket.emit("action:push");
  });

  function join(eventName, payload) {
    emitWithReply(eventName, payload).then((reply) => {
      if (!reply.ok) return setStatus(reply.message || "Could not join.");
      state.playerId = reply.playerId;
      state.room = reply.room;
      renderLobby();
      show("lobby");
    });
  }

  function action(eventName, payload) {
    emitWithReply(eventName, payload).then((reply) => {
      if (!reply.ok) {
        if (window.PanicAudio) window.PanicAudio.play("ui-error");
        return setStatus(reply.message || "Action failed.");
      }
      if (reply.room) {
        state.room = reply.room;
        renderLobby();
        if (reply.room.status === "lobby") show("lobby");
      }
    });
  }

  function emitWithReply(eventName, payload) {
    return new Promise((resolve) => socket.emit(eventName, payload, (reply) => resolve(reply || { ok: false })));
  }

  function renderLobby() {
    if (!state.room) return;
    const isHost = state.room.hostId === state.playerId;
    const humans = state.room.players.filter((player) => !player.isBot && player.connected !== false);
    const roomReadyToStart = state.room.players.length >= state.room.minPlayers && humans.every((player) => player.ready);
    ui.lobbyCode.textContent = state.room.code;
    ui.start.disabled = !isHost || !roomReadyToStart;
    ui.addBot.disabled = !isHost || state.room.players.length >= state.room.maxPlayers;
    ui.removeBot.disabled = !isHost || !state.room.players.some((player) => player.isBot);
    ui.fillBots.disabled = !isHost || state.room.players.length >= state.room.maxPlayers;
    ui.players.innerHTML = "";
    for (const player of state.room.players) {
      const item = document.createElement("li");
      item.innerHTML = `<strong style="color:${uiHelpers.colorToCss(player.color)}">${escapeHtml(player.nickname)}${player.isBot ? " (bot)" : ""}${player.id === state.playerId ? " (you)" : ""}</strong><span class="ready-pill ${player.ready ? "ready" : ""}">${player.ready ? "Ready" : "Not Ready"}</span>`;
      ui.players.append(item);
    }
  }

  function renderOpenRooms() {
    ui.openRooms.innerHTML = "";
    if (!state.openRooms.length) {
      ui.openRooms.textContent = "No open rooms yet. Create a room, add bots, and start a quick test match.";
      return;
    }
    for (const room of state.openRooms) {
      const card = document.createElement("article");
      card.className = "open-room-card";
      card.innerHTML = `<div><strong>${escapeHtml(room.host)}'s room</strong><span>${room.players}/${room.maxPlayers} players - ${room.bots} bots - ${room.code}</span></div>`;
      const button = document.createElement("button");
      button.textContent = "Join";
      button.addEventListener("click", () => join("room:join", { nickname: nickname(), code: room.code }));
      card.append(button);
      ui.openRooms.append(card);
    }
  }

  function updateHud(snapshot) {
    ui.timer.textContent = formatTime(snapshot.timeLeftMs);
    ui.alive.textContent = snapshot.players.filter((player) => player.alive).length;
    const self = snapshot.players.find((player) => player.id === state.playerId);
    ui.dash.textContent = self && self.dashCooldownLeftMs > 0 ? `${(self.dashCooldownLeftMs / 1000).toFixed(1)}s` : "Ready";
    ui.push.textContent = self && self.pushCooldownLeftMs > 0 ? `${(self.pushCooldownLeftMs / 1000).toFixed(1)}s` : "Ready";
    if (self && !self.alive) ui.status.textContent = "Out";
    else if (!snapshot.roundLive && snapshot.countdownValue > 0) ui.status.textContent = `Start ${snapshot.countdownValue}`;
    else if (snapshot.overtimeActive) ui.status.textContent = "Final Shrink";
    else if (snapshot.arena.hazardActive) ui.status.textContent = "Shrink";
    else ui.status.textContent = "Live";
  }

  function renderEnd(snapshot) {
    const winner = snapshot.players.find((player) => player.id === snapshot.winnerId);
    const self = snapshot.players.find((player) => player.id === state.playerId);
    if (self && snapshot.winnerId === self.id) ui.winner.textContent = "You Win";
    else if (self) ui.winner.textContent = "You Lose";
    else ui.winner.textContent = winner ? `${winner.nickname} wins!` : "No winner";
    ui.returnLobby.disabled = false;
    ui.standings.innerHTML = "";
    for (const entry of snapshot.standings || []) {
      const item = document.createElement("li");
      item.textContent = `${entry.nickname}${entry.isBot ? " (bot)" : ""} - ${entry.score}`;
      ui.standings.append(item);
    }
  }

  function show(screen) {
    document.body.dataset.screen = screen;
    ui.menu.hidden = screen !== "menu";
    ui.lobby.hidden = screen !== "lobby";
    ui.game.hidden = screen !== "game";
    ui.end.hidden = screen !== "end";
    if (window.PanicAudio) {
      if (screen === "menu" || screen === "lobby" || screen === "end") {
        window.PanicAudio.play("lobby-music-start");
      }
      if (screen === "game") {
        window.PanicAudio.play("lobby-music-stop");
      }
    }
    if (screen !== "game") ui.game.classList.remove("preparing");
  }

  function prepareGameScreen() {
    show("game");
    ui.game.classList.add("preparing");
  }

  function ensureGame() {
    if (game) {
      return;
    }
    if (!window.Phaser || !window.PanicGame) {
      setStatus("Game engine failed to load. Refresh the page.");
      throw new Error("Phaser game engine is not available.");
    }
    game = window.PanicGame.create("phaserGame");
    const scene = getScene();
    scene.events.once("scene-ready", () => {
      if (!state.pendingSnapshot) return;
      const snapshot = state.pendingSnapshot;
      state.pendingSnapshot = null;
      applySnapshotToScene(snapshot);
    });
  }

  function getScene() {
    if (!game) ensureGame();
    return game.scene.getScene("MatchScene");
  }

  function applySnapshotToScene(snapshot) {
    ensureGame();
    const scene = getScene();
    if (!scene.isReady) {
      state.pendingSnapshot = snapshot;
      return;
    }
    scene.setSelf(state.playerId);
    scene.applySnapshot(snapshot);
    requestAnimationFrame(() => {
      ui.game.classList.remove("preparing");
    });
  }

  function nickname() {
    return ui.nickname.value.trim();
  }

  function resetClientState() {
    state.playerId = null;
    state.room = null;
    state.pendingSnapshot = null;
    state.input = { up: false, down: false, left: false, right: false };
    state.winnerPlayed = false;
  }

  function queueSnapshot(snapshot) {
    if (!state.pendingSnapshot) {
      state.pendingSnapshot = snapshot;
      return;
    }
    const preserveCountdown =
      !state.pendingSnapshot.roundLive &&
      state.pendingSnapshot.countdownValue > 0 &&
      !snapshot.roundLive &&
      snapshot.countdownValue > 0;
    if (!preserveCountdown) state.pendingSnapshot = snapshot;
  }

  function leaveCurrentRoom() {
    if (window.PanicAudio) {
      window.PanicAudio.play("music-stop");
      window.PanicAudio.play("lobby-music-start");
    }
    socket.emit("room:leave");
    resetClientState();
    show("menu");
    setStatus("Returned to lobby.");
  }

  function setStatus(message) {
    const status = document.querySelector("#statusText");
    if (status) status.textContent = message;
  }

  function isMoveKey(key) {
    return ["w", "W", "a", "A", "s", "S", "d", "D", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(key);
  }

  function isDashKey(event) {
    return event.code === "Space" || event.key === " ";
  }

  function isPushKey(event) {
    return event.key === "j" || event.key === "J" || event.key === "k" || event.key === "K";
  }

  function applyKey(key, pressed) {
    const before = { ...state.input };
    if (key === "w" || key === "W" || key === "ArrowUp") state.input.up = pressed;
    if (key === "s" || key === "S" || key === "ArrowDown") state.input.down = pressed;
    if (key === "a" || key === "A" || key === "ArrowLeft") state.input.left = pressed;
    if (key === "d" || key === "D" || key === "ArrowRight") state.input.right = pressed;
    if (game) getScene().setLocalInput(state.input);
    return before.up !== state.input.up || before.down !== state.input.down || before.left !== state.input.left || before.right !== state.input.right;
  }

  function formatTime(ms) {
    const seconds = Math.max(0, Math.ceil((ms || 0) / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
  }

  show("menu");
})();
