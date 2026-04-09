const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const C = require("./constants");
const rooms = require("./roomStore");
const loop = require("./gameLoop");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});

app.use(express.static(path.join(__dirname, "..", "public")));
app.use("/vendor/phaser", express.static(path.join(__dirname, "..", "node_modules", "phaser", "dist")));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

io.on("connection", (socket) => {
  socket.emit("room:list", rooms.listOpenRooms());

  socket.on("room:create", ({ nickname } = {}, reply) => replyWith(reply, () => {
    const room = rooms.createRoom(socket.id, nickname);
    socket.join(room.code);
    broadcastRoom(room);
    broadcastRoomList();
    return { playerId: socket.id, room: rooms.serializeRoom(room) };
  }));

  socket.on("room:join", ({ code, nickname } = {}, reply) => replyWith(reply, () => {
    const room = rooms.joinRoom(socket.id, code, nickname);
    socket.join(room.code);
    broadcastRoom(room);
    broadcastRoomList();
    return { playerId: socket.id, room: rooms.serializeRoom(room) };
  }));

  socket.on("room:leave", () => {
    const room = rooms.getRoomBySocket(socket.id);
    if (room) socket.leave(room.code);
    const updated = rooms.leaveRoom(socket.id);
    if (updated && updated.players.size) broadcastRoom(updated);
    broadcastRoomList();
  });

  socket.on("room:list:request", () => socket.emit("room:list", rooms.listOpenRooms()));

  socket.on("player:ready", ({ ready } = {}) => {
    const room = rooms.setReady(socket.id, ready);
    if (room) broadcastRoom(room);
  });

  socket.on("bot:add", (_payload, reply) => replyWith(reply, () => {
    const room = rooms.addBot(socket.id);
    broadcastRoom(room);
    broadcastRoomList();
    return { room: rooms.serializeRoom(room) };
  }));

  socket.on("bot:remove", (_payload, reply) => replyWith(reply, () => {
    const room = rooms.removeBot(socket.id);
    broadcastRoom(room);
    broadcastRoomList();
    return { room: rooms.serializeRoom(room) };
  }));

  socket.on("bot:fill", (_payload, reply) => replyWith(reply, () => {
    const room = rooms.fillBots(socket.id);
    broadcastRoom(room);
    broadcastRoomList();
    return { room: rooms.serializeRoom(room) };
  }));

  socket.on("match:start", (_payload, reply) => replyWith(reply, () => {
    const room = rooms.startMatch(socket.id);
    broadcastRoom(room);
    io.to(room.code).emit("match:start", loop.createSnapshot(room));
    broadcastRoomList();
    return { room: rooms.serializeRoom(room) };
  }));

  socket.on("input:update", (input) => rooms.updateInput(socket.id, input));
  socket.on("action:push", () => rooms.requestAction(socket.id, "push"));
  socket.on("action:dash", () => rooms.requestAction(socket.id, "dash"));

  socket.on("disconnect", () => {
    const room = rooms.leaveRoom(socket.id);
    if (room && room.players.size) broadcastRoom(room);
    broadcastRoomList();
  });
});

function replyWith(reply, fn) {
  try {
    const payload = fn();
    if (typeof reply === "function") reply({ ok: true, ...payload });
  } catch (error) {
    if (typeof reply === "function") reply({ ok: false, message: error.message });
  }
}

function broadcastRoom(room) {
  io.to(room.code).emit("room:update", rooms.serializeRoom(room));
}

function broadcastRoomList() {
  io.emit("room:list", rooms.listOpenRooms());
}

let previous = Date.now();
setInterval(() => {
  const now = Date.now();
  loop.updateAuthoritativeState(Math.min(50, now - previous));
  previous = now;
}, 1000 / C.TICK_RATE);

setInterval(() => {
  const sent = new Set();
  for (const socket of io.sockets.sockets.values()) {
    const room = rooms.getRoomBySocket(socket.id);
    if (!room || sent.has(room.code) || (room.status !== "playing" && room.status !== "ended")) continue;
    const snapshot = loop.createSnapshot(room);
    io.to(room.code).emit("match:snapshot", snapshot);
    if (room.status === "ended" && room.match && !room.match.endSent) {
      room.match.endSent = true;
      broadcastRoom(room);
      broadcastRoomList();
      io.to(room.code).emit("match:end", snapshot);
    }
    sent.add(room.code);
  }
}, 1000 / C.SNAPSHOT_RATE);

server.listen(C.PORT, () => {
  console.log(`Panic Push: Cosmic Arena running at http://localhost:${C.PORT}`);
});
