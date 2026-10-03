import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";

const app = express();
app.use(cors({ origin: true, methods: ["GET", "POST"], credentials: true }));
app.get("/", (_req, res) => res.json({ ok: true, service: "MovieDate realtime server" }));
app.get("/health", (_req, res) => res.json({ ok: true }));

const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: true, methods: ["GET", "POST"], credentials: true },
  transports: ["websocket", "polling"],
});

const rooms = new Map();

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, { hostSocketId: null, users: new Set(), movie: null });
  }
  return rooms.get(roomId);
}

function removeSocketFromRoom(socket) {
  const roomId = socket.data.roomId;
  if (!roomId) return;
  const room = rooms.get(roomId);
  if (!room) return;

  room.users.delete(socket.id);
  socket.to(roomId).emit("peer-left", { socketId: socket.id });

  if (room.hostSocketId === socket.id) {
    room.hostSocketId = room.users.values().next().value || null;
    if (room.hostSocketId) {
      io.to(room.hostSocketId).emit("host-changed", { hostSocketId: room.hostSocketId });
    }
  }

  if (room.users.size === 0) rooms.delete(roomId);
}

io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);

  socket.on("join-room", ({ roomId }) => {
    if (!roomId || typeof roomId !== "string") {
      socket.emit("room-error", { message: "Invalid room code." });
      return;
    }

    const id = roomId.trim().toUpperCase();
    const room = getRoom(id);

    if (socket.data.roomId === id) {
      socket.emit("room-state", {
        roomId: id,
        hostSocketId: room.hostSocketId,
        participants: room.users.size,
        movie: room.movie,
      });
      return;
    }

    if (socket.data.roomId) removeSocketFromRoom(socket);

    socket.join(id);
    socket.data.roomId = id;

    if (!room.hostSocketId || room.users.size === 0) {
      room.hostSocketId = socket.id;
    }

    room.users.add(socket.id);

    socket.emit("room-state", {
      roomId: id,
      hostSocketId: room.hostSocketId,
      participants: room.users.size,
      movie: room.movie,
    });

    socket.to(id).emit("peer-joined", {
      socketId: socket.id,
      hostSocketId: room.hostSocketId,
    });

    if (room.movie) socket.emit("movie-meta", room.movie);

    console.log(`Room ${id}: ${room.users.size} participant(s)`);
  });

  socket.on("chat", ({ roomId, text }) => {
    if (!roomId || !text) return;
    const room = rooms.get(roomId);
    if (!room || !room.users.has(socket.id)) return;
    socket.to(roomId).emit("chat", { text: String(text).slice(0, 240), from: socket.id });
  });

  socket.on("reaction", ({ roomId, emoji }) => {
    if (!roomId || !emoji) return;
    const room = rooms.get(roomId);
    if (!room || !room.users.has(socket.id)) return;
    socket.to(roomId).emit("reaction", { emoji, from: socket.id });
  });

  socket.on("playback", (data) => {
    if (!data?.roomId) return;
    const room = rooms.get(data.roomId);
    if (!room || !room.users.has(socket.id)) return;
    socket.to(data.roomId).emit("playback", {
      action: data.action,
      time: Number(data.time) || 0,
    });
  });

  socket.on("movie-meta", ({ roomId, name }) => {
    if (!roomId || !name) return;
    const room = rooms.get(roomId);
    if (!room || !room.users.has(socket.id)) return;
    room.movie = { name: String(name).slice(0, 240) };
    socket.to(roomId).emit("movie-meta", room.movie);
  });

  socket.on("webrtc", (data) => {
    if (!data?.roomId || !data?.type) return;
    const room = rooms.get(data.roomId);
    if (!room || !room.users.has(socket.id)) return;
    socket.to(data.roomId).emit("webrtc", {
      type: data.type,
      sdp: data.sdp || null,
      candidate: data.candidate || null,
      from: socket.id,
    });
  });

  socket.on("disconnect", () => {
    console.log("Socket disconnected:", socket.id);
    removeSocketFromRoom(socket);
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`MovieDate server running on port ${PORT}`);
});
