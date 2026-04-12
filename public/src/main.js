(function () {
  const configBanner = document.querySelector("#configBanner");
  const serverUrl =
    (window.PanicRuntime && typeof window.PanicRuntime.serverUrl === "string" && window.PanicRuntime.serverUrl.trim()) ||
    "";
  const isLocalOrigin = ["localhost", "127.0.0.1"].includes(window.location.hostname);
  const socket = serverUrl
    ? io(serverUrl, { transports: ["websocket", "polling"] })
    : isLocalOrigin
      ? io()
      : createMissingServerSocket();
  let game = null;
  const uiHelpers = window.PanicUI;
  const state = {
    playerId: null,
    room: null,
    pendingSnapshot: null,
    input: { up: false, down: false, left: false, right: false },
    openRooms: [],
    winnerPlayed: false,
    copyFeedbackTimeout: null,
    copyButtonTimeout: null
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
    lobbyPlayerCount: el("lobbyPlayerCount"),
    lobbyHostStatus: el("lobbyHostStatus"),
    lobbyStatus: el("lobbyStatus"),
    lobbyStartHint: el("lobbyStartHint"),
    rosterCount: el("rosterCountBadge"),
    rosterStatus: el("rosterStatusText"),
    personalStatus: el("personalStatusText"),
    hostControlsPanel: el("hostControlsPanel"),
    hostControlsHint: el("hostControlsHint"),
    hostControlsMeta: el("hostControlsMeta"),
    copyFeedback: el("copyRoomFeedback"),
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
    returnLobby: el("returnLobbyButton"),
    leaveEndRoom: el("leaveEndRoomButton")
  };

  setStatus("Connecting to local server...", "info");

  if (!serverUrl && !isLocalOrigin) {
    showConfigBanner("PANIC_SERVER_URL is missing. Set the Railway backend URL in Vercel project settings.", "error");
  }

  socket.on("connect", () => {
    hideConfigBanner();
    socket.emit("room:list:request");
  });
  socket.on("connect_error", (error) => {
    setStatus(`Connection failed: ${error.message}`, "error");
  });
  socket.on("disconnect", () => {
    if (window.PanicAudio) {
      window.PanicAudio.play("music-stop");
      window.PanicAudio.play("lobby-music-stop");
    }
    setStatus("Disconnected from server.", "error");
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
    show("lobby");
  });
  socket.on("match:start", (snapshot) => {
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
  ui.openRooms.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-action='create-room']");
    if (trigger) ui.create.click();
  });
  ui.copyCode.addEventListener("click", async () => {
    if (!state.room) return;
    if (navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(state.room.code);
        showCopyFeedback("Room code copied.", true);
        return;
      } catch {
        // Fall through to inline fallback text below.
      }
    }
    showCopyFeedback("Copy failed. Select the code manually.", false);
  });
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
    const isHost = state.room && state.room.hostId === state.playerId;
    if (isHost) {
      action("room:returnToLobby", {});
      return;
    }
    leaveCurrentRoom();
  });
  ui.leaveEndRoom.addEventListener("click", () => {
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
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve({ ok: false, message: "Server did not respond. Check the local server connection." });
      }, 4000);
      socket.emit(eventName, payload, (reply) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(reply || { ok: false });
      });
    });
  }

  function renderLobby() {
    if (!state.room) return;
    const isHost = state.room.hostId === state.playerId;
    const self = state.room.players.find((player) => player.id === state.playerId);
    const hostPlayer = state.room.players.find((player) => player.id === state.room.hostId);
    const humans = state.room.players.filter((player) => !player.isBot && player.connected !== false);
    const roomReadyToStart = state.room.players.length >= state.room.minPlayers && humans.every((player) => player.ready);
    const startReason = getStartReason(state.room, humans);
    const participantLabel = `${state.room.players.length}/${state.room.maxPlayers}`;
    const missingParticipants = Math.max(0, state.room.minPlayers - state.room.players.length);
    ui.lobbyCode.textContent = state.room.code;
    ui.lobbyPlayerCount.textContent = participantLabel;
    ui.rosterCount.textContent = `${participantLabel} players`;
    ui.lobbyHostStatus.textContent = hostPlayer ? (isHost ? "You" : formatPlayerName(hostPlayer.nickname)) : "-";
    ui.ready.textContent = self && self.ready ? "Unready" : "Ready";
    ui.start.disabled = !isHost || !roomReadyToStart;
    ui.addBot.disabled = !isHost || state.room.players.length >= state.room.maxPlayers;
    ui.removeBot.disabled = !isHost || !state.room.players.some((player) => player.isBot);
    ui.fillBots.disabled = !isHost || state.room.players.length >= state.room.maxPlayers;
    ui.start.title = isHost ? startReason : "Only the host can start the match.";
    ui.addBot.title = !isHost ? "Only the host can add bots." : state.room.players.length >= state.room.maxPlayers ? "Room is full." : "Add a bot to the room.";
    ui.removeBot.title = !isHost ? "Only the host can remove bots." : !state.room.players.some((player) => player.isBot) ? "No bots to remove." : "Remove one bot from the room.";
    ui.fillBots.title = !isHost ? "Only the host can fill bots." : state.room.players.length >= state.room.maxPlayers ? "Room is already full." : "Fill all open slots with bots.";
    ui.hostControlsPanel.hidden = !isHost;
    ui.lobbyStartHint.textContent = startReason;
    ui.hostControlsHint.textContent = getHostStartLabel(isHost, roomReadyToStart, startReason);
    ui.hostControlsMeta.textContent = getHostControlsMeta(isHost, state.room);
    ui.personalStatus.textContent = self && self.ready
      ? "You are ready."
      : "Mark ready when set.";
    if (isHost) {
      ui.lobbyStatus.textContent = roomReadyToStart
        ? "Room ready. Launch when you want."
        : "Waiting on ready checks and open slots.";
    } else {
      ui.lobbyStatus.textContent = self && self.ready
        ? "Waiting for host launch."
        : "Ready up so the host can start.";
    }
    const rosterLead = roomReadyToStart
      ? "Ready to launch"
      : missingParticipants > 0
        ? "Waiting for players"
        : "Ready check";
    const rosterTail = missingParticipants > 0
      ? `Need ${missingParticipants} more to start`
      : humans.every((player) => player.ready)
        ? "All humans ready"
        : "Waiting on human ready";
    ui.rosterStatus.innerHTML = `
      <span class="status-chip status-chip-live">${rosterLead}</span>
      <span class="status-chip status-chip-neutral">${participantLabel} joined</span>
      <span class="status-chip ${roomReadyToStart ? "status-chip-success" : "status-chip-warning"}">${rosterTail}</span>
    `;
    ui.players.innerHTML = "";
    for (const player of state.room.players) {
      const item = document.createElement("li");
      item.className = `player-slot-card${player.isBot ? " player-slot-bot" : " player-slot-human"}${player.ready ? " player-slot-ready" : " player-slot-waiting"}`;
      const tags = [];
      if (player.id === state.room.hostId) tags.push(`<span class="player-tag player-tag-host"><span class="tag-icon tag-icon-host" aria-hidden="true"></span>Host</span>`);
      if (player.isBot) tags.push(`<span class="player-tag player-tag-bot"><span class="tag-icon tag-icon-bot" aria-hidden="true"></span>Bot</span>`);
      if (player.id === state.playerId) tags.push(`<span class="player-tag player-tag-you"><span class="tag-icon tag-icon-you" aria-hidden="true"></span>You</span>`);
      const avatarClass = player.isBot ? "player-avatar-shell player-avatar-shell-bot" : "player-avatar-shell";
      const avatarGlyphClass = player.isBot ? "slot-glyph slot-glyph-bot" : "slot-glyph slot-glyph-player";
      const displayName = formatPlayerName(player.nickname);
      item.innerHTML = `
        <div class="player-slot-main">
          <div class="${avatarClass}" style="--player-accent:${uiHelpers.colorToCss(player.color)}">
            <div class="player-avatar-dot"></div>
            <span class="${avatarGlyphClass}" aria-hidden="true"></span>
          </div>
          <div class="player-name-stack">
            <strong style="color:${uiHelpers.colorToCss(player.color)}">${escapeHtml(displayName)}</strong>
            <div class="player-tags">${tags.join("")}</div>
          </div>
          <span class="ready-pill ${player.ready ? "ready" : "not-ready"}${player.isBot ? " ready-pill-bot" : ""}"><span class="ready-pill-dot" aria-hidden="true"></span>${player.ready ? "Ready" : "Not Ready"}</span>
        </div>
      `;
      ui.players.append(item);
    }
    const emptySlots = Math.max(0, state.room.maxPlayers - state.room.players.length);
    for (let index = 0; index < emptySlots; index += 1) {
      const slot = document.createElement("li");
      slot.className = "player-slot-card empty-slot-card";
      slot.innerHTML = `
        <div class="player-slot-main">
          <div class="player-avatar-shell player-avatar-shell-empty">
            <div class="player-avatar-dot player-avatar-empty"></div>
            <span class="slot-glyph slot-glyph-empty" aria-hidden="true"></span>
          </div>
          <div class="player-name-stack">
            <strong>Open Slot ${state.room.players.length + index + 1}</strong>
            <p class="empty-slot-copy">Invite a friend or add a bot to fill this spot.</p>
          </div>
          <span class="ready-pill waiting"><span class="ready-pill-dot" aria-hidden="true"></span>Open</span>
        </div>
      `;
      ui.players.append(slot);
    }
  }

  function renderOpenRooms() {
    ui.openRooms.innerHTML = "";
    if (!state.openRooms.length) {
      ui.openRooms.innerHTML = `
        <article class="room-list-empty">
          <div class="empty-rooms-visual">
            <img class="empty-rooms-art" src="/assets/ui/icons/lobby-empty-beacon-v1.png" alt="" aria-hidden="true">
          </div>
          <div class="empty-state-copy">
            <strong class="empty-state-title">No public rooms yet</strong>
            <p>Create the first room or check back in a moment.</p>
          </div>
          <div class="empty-state-actions">
            <button type="button" data-action="create-room">Create First Room</button>
            <span class="empty-state-hint">New rooms appear here automatically.</span>
          </div>
        </article>
      `;
      return;
    }
    for (const room of state.openRooms) {
      const card = document.createElement("article");
      card.className = "open-room-card";
      card.innerHTML = `
        <div class="room-card-main">
          <div class="room-card-top">
            <strong>${escapeHtml(room.host)}'s room</strong>
            <span class="room-code-badge">${room.code}</span>
          </div>
          <p class="room-card-meta">Ready to join.</p>
          <div class="room-chip-row">
            <span class="room-chip">${room.players}/${room.maxPlayers} players</span>
            <span class="room-chip">${room.bots} bots</span>
          </div>
        </div>
      `;
      const button = document.createElement("button");
      button.className = "button-secondary";
      button.textContent = "Join Room";
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
    else if (snapshot.suddenDeathActive) ui.status.textContent = "Sudden Death";
    else if (!snapshot.roundLive && snapshot.countdownValue > 0) ui.status.textContent = `Start ${snapshot.countdownValue}`;
    else if (snapshot.overtimeActive) ui.status.textContent = "Final Shrink";
    else if (snapshot.arena.hazardActive) ui.status.textContent = "Shrink";
    else ui.status.textContent = "Live";
  }

  function renderEnd(snapshot) {
    const winner = snapshot.players.find((player) => player.id === snapshot.winnerId);
    const self = snapshot.players.find((player) => player.id === state.playerId);
    const isHost = state.room && state.room.hostId === state.playerId;
    if (self && snapshot.winnerId === self.id) ui.winner.textContent = "You Win";
    else if (self) ui.winner.textContent = "You Lose";
    else ui.winner.textContent = winner ? `${winner.nickname} wins!` : "No winner";
    ui.returnLobby.disabled = !isHost;
    ui.returnLobby.textContent = "Return to Lobby";
    ui.returnLobby.title = isHost ? "Bring everyone in this room back to the lobby." : "Only the host can return the room to the lobby.";
    ui.leaveEndRoom.disabled = false;
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
    if (screen === "menu") socket.emit("room:list:request");
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
    if (state.copyFeedbackTimeout) clearTimeout(state.copyFeedbackTimeout);
    if (state.copyButtonTimeout) clearTimeout(state.copyButtonTimeout);
    if (ui.copyFeedback) ui.copyFeedback.hidden = true;
    if (ui.copyCode) {
      ui.copyCode.textContent = "Copy Code";
      ui.copyCode.classList.remove("copied");
    }
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
    hideConfigBanner();
  }

  function setStatus(message, tone = "info") {
    const status = document.querySelector("#statusText");
    if (status) status.textContent = message;
    showConfigBanner(message, tone);
  }

  function showConfigBanner(message, tone = "info") {
    if (!configBanner) return;
    configBanner.textContent = message;
    configBanner.className = `config-banner status-${tone}`;
    configBanner.hidden = false;
  }

  function hideConfigBanner() {
    if (!configBanner) return;
    configBanner.hidden = true;
  }

  function showCopyFeedback(message, success) {
    if (!ui.copyFeedback) return;
    ui.copyFeedback.textContent = message;
    ui.copyFeedback.hidden = false;
    if (ui.copyCode) {
      ui.copyCode.textContent = success ? "Copied" : "Copy Code";
      ui.copyCode.classList.toggle("copied", Boolean(success));
    }
    if (state.copyFeedbackTimeout) clearTimeout(state.copyFeedbackTimeout);
    if (state.copyButtonTimeout) clearTimeout(state.copyButtonTimeout);
    state.copyFeedbackTimeout = setTimeout(() => {
      ui.copyFeedback.hidden = true;
      state.copyFeedbackTimeout = null;
    }, 1800);
    state.copyButtonTimeout = setTimeout(() => {
      if (ui.copyCode) {
        ui.copyCode.textContent = "Copy Code";
        ui.copyCode.classList.remove("copied");
      }
      state.copyButtonTimeout = null;
    }, 1600);
  }

  function getStartReason(room, humans) {
    if (room.players.length < room.minPlayers) {
      return `Need at least ${room.minPlayers} participants to start.`;
    }
    if (!humans.every((player) => player.ready)) {
      return "Waiting for all human players to ready up.";
    }
    return "All human players are ready.";
  }

  function getHostControlsMeta(isHost, room) {
    if (!isHost) return "";
    if (room.players.length >= room.maxPlayers) return "Room full. Bot controls locked.";
    if (!room.players.some((player) => player.isBot)) return "No bots yet. Add one or fill all slots.";
    return "Manage bots while slots remain open.";
  }

  function formatPlayerName(name) {
    const trimmed = String(name || "").trim();
    if (!trimmed) return "Pilot";
    if (/^\d+$/.test(trimmed)) return `Pilot ${trimmed}`;
    return trimmed;
  }

  function getHostStartLabel(isHost, roomReadyToStart, startReason) {
    if (!isHost) return "Only the host can start the match.";
    if (roomReadyToStart) return "Start Match is ready.";
    return `Start locked. ${startReason}`;
  }


  function createMissingServerSocket() {
    return {
      on() {},
      emit(...args) {
        const reply = args[args.length - 1];
        if (typeof reply === "function") {
          reply({ ok: false, message: "Multiplayer server is not configured yet." });
        }
      }
    };
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

  renderOpenRooms();
  show("menu");
})();
