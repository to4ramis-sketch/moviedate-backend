const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
app.use(cors());

app.get("/", (_, res) => res.json({
  ok: true,
  service: "MovieDate realtime server",
  version: "2.0"
}));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  transports: ["websocket", "polling"]
});

const rooms = new Map();

function cleanRoomId(value) {
  return String(value || "").trim().toUpperCase()
    .replace(/[^A-Z0-9]/g, "").slice(0, 12);
}

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      hostSocketId: null,
      participants: new Set(),
      movie: null,
      playback: { action: "pause", time: 0 }
    });
  }
  return rooms.get(roomId);
}

function sendRoomState(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  io.to(roomId).emit("room-state", {
    roomId,
    hostSocketId: room.hostSocketId,
    participants: room.participants.size,
    movie: room.movie,
    playback: room.playback
  });
}

function leaveRoom(socket) {
  const roomId = socket.data.roomId;
  if (!roomId) return;
  const room = rooms.get(roomId);

  if (!room) {
    socket.data.roomId = null;
    return;
  }

  room.participants.delete(socket.id);
  socket.leave(roomId);

  if (room.hostSocketId === socket.id) {
    room.hostSocketId = [...room.participants][0] || null;
  }

  socket.to(roomId).emit("peer-left");

  if (room.participants.size === 0) {
    rooms.delete(roomId);
    console.log("ROOM DELETED:", roomId);
  } else {
    sendRoomState(roomId);
  }

  socket.data.roomId = null;
}

io.on("connection", socket => {
  console.log("CONNECTED:", socket.id);

  socket.on("join-room", rawRoomId => {
    const roomId = cleanRoomId(
      typeof rawRoomId === "object" ? rawRoomId.roomId : rawRoomId
    );

    if (!roomId) {
      socket.emit("room-error", { message: "No room code provided." });
      return;
    }

    if (socket.data.roomId === roomId) {
      sendRoomState(roomId);
      return;
    }

    if (socket.data.roomId) leaveRoom(socket);

    const room = getRoom(roomId);

    if (room.participants.size >= 2) {
      socket.emit("room-full");
      return;
    }

    socket.join(roomId);
    room.participants.add(socket.id);
    socket.data.roomId = roomId;

    if (!room.hostSocketId) room.hostSocketId = socket.id;

    socket.emit("room-joined", {
      roomId,
      isHost: room.hostSocketId === socket.id,
      participants: room.participants.size
    });

    socket.emit("room-state", {
      roomId,
      hostSocketId: room.hostSocketId,
      participants: room.participants.size,
      movie: room.movie,
      playback: room.playback
    });

    if (room.participants.size === 2) {
      const ids = [...room.participants];
      const otherSocketId = ids.find(id => id !== socket.id);

      if (otherSocketId) {
        io.to(otherSocketId).emit("peer-joined", {
          socketId: socket.id,
          hostSocketId: room.hostSocketId
        });
      }

      socket.emit("peer-joined", {
        socketId: otherSocketId,
        hostSocketId: room.hostSocketId
      });

      io.to(room.hostSocketId).emit("peer-ready", {
        socketId: socket.id
      });

      console.log(`PAIR READY ${roomId}`);
    }

    sendRoomState(roomId);
  });

  socket.on("peer-ready", () => {
    const roomId = socket.data.roomId;
    const room = roomId && rooms.get(roomId);
    if (!room || room.participants.size !== 2) return;

    socket.to(roomId).emit("peer-ready", { socketId: socket.id });
  });

  socket.on("webrtc", data => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms.has(roomId)) return;
    socket.to(roomId).emit("webrtc", { ...data, from: socket.id });
  });

  socket.on("playback", data => {
    const roomId = socket.data.roomId;
    const room = roomId && rooms.get(roomId);
    if (!room) return;

    room.playback = {
      action: data.action,
      time: Number(data.time) || 0
    };

    socket.to(roomId).emit("playback", room.playback);
  });

  socket.on("movie-meta", data => {
    const roomId = socket.data.roomId;
    const room = roomId && rooms.get(roomId);
    if (!room) return;

    room.movie = data.name || "";
    socket.to(roomId).emit("movie-meta", { name: room.movie });
  });

  socket.on("chat", data => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    socket.to(roomId).emit("chat", { text: String(data.text || "") });
  });

  socket.on("reaction", data => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    socket.to(roomId).emit("reaction", { emoji: data.emoji });
  });

  socket.on("leave-room", () => leaveRoom(socket));
  socket.on("disconnect", () => {
    console.log("DISCONNECTED:", socket.id);
    leaveRoom(socket);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`MovieDate backend running on ${PORT}`);
});
