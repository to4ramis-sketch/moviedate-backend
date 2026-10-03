import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.get("/", (_req,res)=>res.json({ok:true,service:"MovieDate realtime server"}));
app.get("/health", (_req,res)=>res.json({ok:true}));

const server=http.createServer(app);
const io=new Server(server,{
  cors:{origin:true,methods:["GET","POST"],credentials:true},
  transports:["websocket","polling"]
});

const rooms=new Map();

function getRoom(id){
  if(!rooms.has(id)) rooms.set(id,{hostSocketId:null,users:new Set(),movie:null});
  return rooms.get(id);
}

io.on("connection",socket=>{
  socket.on("join-room",({roomId})=>{
    if(!roomId)return;
    const room=getRoom(roomId);
    socket.join(roomId);
    room.users.add(socket.id);
    if(!room.hostSocketId) room.hostSocketId=socket.id;
    socket.data.roomId=roomId;
    socket.emit("room-state",{
      roomId,
      hostSocketId:room.hostSocketId,
      participants:room.users.size,
      movie:room.movie
    });
    socket.to(roomId).emit("peer-joined",{socketId:socket.id,hostSocketId:room.hostSocketId});
    if(room.movie)socket.emit("movie-meta",room.movie);
  });

  socket.on("movie-meta",data=>{
    const room=rooms.get(data.roomId); if(!room)return;
    room.movie={name:data.name};
    socket.to(data.roomId).emit("movie-meta",room.movie);
  });

  socket.on("playback",data=>{
    socket.to(data.roomId).emit("playback",data);
  });

  socket.on("chat",data=>{
    io.to(data.roomId).emit("chat",{text:data.text,from:socket.id});
  });

  socket.on("reaction",data=>{
    socket.to(data.roomId).emit("reaction",{emoji:data.emoji,from:socket.id});
  });

  socket.on("webrtc",data=>{
    socket.to(data.roomId).emit("webrtc",data);
  });

  socket.on("disconnect",()=>{
    const roomId=socket.data.roomId;
    if(!roomId)return;
    const room=rooms.get(roomId);
    if(!room)return;
    room.users.delete(socket.id);
    socket.to(roomId).emit("peer-left");
    if(room.hostSocketId===socket.id)room.hostSocketId=room.users.values().next().value||null;
    if(room.users.size===0)rooms.delete(roomId);
  });
});

const PORT=process.env.PORT||3000;
server.listen(PORT,"0.0.0.0",()=>console.log(`MovieDate server listening on ${PORT}`));
