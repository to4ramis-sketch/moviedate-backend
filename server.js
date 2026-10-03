import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";

const app = express();

app.use(
  cors({
    origin: true,
    methods: ["GET", "POST"],
    credentials: true,
  })
);

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "MovieDate realtime server",
  });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: true,
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ["websocket", "polling"],
});

const rooms = new Map();

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      hostSocketId: null,
      users: new Set(),
      movie: null,
    });
  }

  return rooms.get(roomId);
}

function removeSocketFromRoom(socket) {
  const roomId = socket.data.roomId;

  if (!roomId) return;

  const room = rooms.get(roomId);

  if (!room) return;

  room.users.delete(socket.id);

  socket.to(roomId).emit("peer-left", {
    socketId: socket.id,
  });

  if (room.hostSocketId === socket.id) {
    room.hostSocketId =
      room.users.values().next().value || null;
  }

  if (room.users.size === 0) {
    rooms.delete(roomId);
  }
}

io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);

  socket.on("join-room", ({ roomId }) => {
    if (!roomId || typeof roomId !== "string") {
      socket.emit("room-error", {
        message: "Invalid room code.",
      });
      return;
    }

    const normalizedRoomId =
      roomId.trim().toUpperCase();

    const room = getRoom(normalizedRoomId);

    /*
      A socket should only exist once in a room.
    */
    if (socket.data.roomId === normalizedRoomId) {
      socket.emit("room-state", {
        roomId: normalizedRoomId,
        hostSocketId: room.hostSocketId,
        participants: room.users.size,
        movie: room.movie,
      });

      return;
    }

    /*
      If the same socket was previously in another room,
      remove it first.
    */
    if (socket.data.roomId) {
      removeSocketFromRoom(socket);
    }

    socket.join(normalizedRoomId);
    socket.data.roomId = normalizedRoomId;

    if (!room.hostSocketId) {
      room.hostSocketId = socket.id;
    }

    room.users.add(socket.id);

    socket.emit("room-state", {
      roomId: normalizedRoomId,
      hostSocketId: room.hostSocketId,
      participants: room.users.size,
      movie: room.movie,
    });

    /*
      Tell the other phone that this phone joined.
    */
    socket.to(normalizedRoomId).emit("peer-joined", {
      socketId: socket.id,
      hostSocketId: room.hostSocketId,
    });

    if (room.movie) {
      socket.emit("movie-meta", room.movie);
    }

    console.log(
      `Room ${normalizedRoomId}: ${room.users.size} participant(s)`
    );
  });

  socket.on("chat", ({ roomId, text }) => {
    if (!roomId || !text) return;

    const room = rooms.get(roomId);

    if (!room || !room.users.has(socket.id)) return;

    /*
      The sender displays their own message locally.
      Therefore only send chat to the other phone.
    */
    socket.to(roomId).emit("chat", {
      text: String(text).slice(0, 240),
      from: socket.id,
    });
  });

  socket.on("reaction", ({ roomId, emoji }) => {
    if (!roomId || !emoji) return;

    const room = rooms.get(roomId);

    if (!room || !room.users.has(socket.id)) return;

    socket.to(roomId).emit("reaction", {
      emoji,
      from: socket.id,
    });
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

  socket.on("movie-meta", (data) => {
    if (!data?.roomId || !data.name) return;

    const room = rooms.get(data.roomId);

    if (!room || !room.users.has(socket.id)) return;

    room.movie = {
      name: String(data.name).slice(0, 240),
      duration: Number(data.duration) || 0,
    };

    socket.to(data.roomId).emit(
      "movie-meta",
      room.movie
    );
  });

  /*
    Generic WebRTC signaling relay.

    IMPORTANT:
    movieStreamId is deliberately forwarded so the guest
    can distinguish the movie tracks from the camera tracks.
  */
  socket.on("webrtc", (data) => {
    if (!data?.roomId || !data?.type) return;

    const room = rooms.get(data.roomId);

    if (!room || !room.users.has(socket.id)) return;

    socket.to(data.roomId).emit("webrtc", {
      type: data.type,
      sdp: data.sdp || null,
      candidate: data.candidate || null,
      movieStreamId: data.movieStreamId || null,
      from: socket.id,
    });
  });

  socket.on("disconnect", () => {
    console.log(
      "Socket disconnected:",
      socket.id
    );

    removeSocketFromRoom(socket);
  });
});

const PORT = process.env.PORT || 3000;

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(
    `MovieDate server running on port ${PORT}`
  );
});
