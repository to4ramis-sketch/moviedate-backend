import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";

const app=express();
app.use(cors({origin:true,methods:["GET","POST"],credentials:true}));
app.get("/",(_req,res)=>res.json({ok:true,service:"MovieDate realtime server"}));
app.get("/health",(_req,res)=>res.json({ok:true}));

const httpServer=http.createServer(app);
const io=new Server(httpServer,{cors:{origin:true,methods:["GET","POST"],credentials:true},transports:["websocket","polling"]});
const rooms=new Map();

function normalize(id){return String(id||"").trim().toUpperCase()}
function roomFor(id){let r=rooms.get(id);if(!r){r={hostSocketId:null,users:new Set(),movie:null,playback:{state:"idle",time:0,updatedAt:Date.now()}};rooms.set(id,r)}return r}
function leave(socket,notify=true){const id=socket.data.roomId;if(!id)return;const r=rooms.get(id);if(!r){socket.data.roomId=null;return}r.users.delete(socket.id);if(notify)socket.to(id).emit("peer-left",{socketId:socket.id});if(r.hostSocketId===socket.id)r.hostSocketId=r.users.values().next().value||null;socket.leave(id);socket.data.roomId=null;if(r.users.size===0)rooms.delete(id)}

io.on("connection",socket=>{
  console.log("connected",socket.id);
  socket.on("join-room",({roomId})=>{
    const id=normalize(roomId);
    if(!id){socket.emit("room-error",{message:"Invalid room"});return}
    if(socket.data.roomId===id){const r=rooms.get(id);if(r)socket.emit("room-state",{roomId:id,hostSocketId:r.hostSocketId,participants:r.users.size,movie:r.movie,playback:r.playback});return}
    if(socket.data.roomId)leave(socket);
    const r=roomFor(id);
    if(r.users.size>=2){socket.emit("room-full");return}
    const existing=r.users.values().next().value||null;
    if(!r.hostSocketId)r.hostSocketId=socket.id;
    r.users.add(socket.id);socket.join(id);socket.data.roomId=id;
    socket.emit("room-state",{roomId:id,hostSocketId:r.hostSocketId,participants:r.users.size,movie:r.movie,playback:r.playback});
    if(existing){socket.emit("peer-available",{socketId:existing,hostSocketId:r.hostSocketId});io.to(existing).emit("peer-joined",{socketId:socket.id,hostSocketId:r.hostSocketId})}
    if(r.movie)socket.emit("movie-meta",r.movie);
    console.log("room",id,r.users.size);
  });
  socket.on("leave-room",()=>leave(socket));
  socket.on("chat",({roomId,text})=>{const id=normalize(roomId),r=rooms.get(id);if(!r||!r.users.has(socket.id)||!text)return;socket.to(id).emit("chat",{text:String(text).slice(0,240),from:socket.id})});
  socket.on("reaction",({roomId,emoji})=>{const id=normalize(roomId),r=rooms.get(id);if(!r||!r.users.has(socket.id)||!emoji)return;socket.to(id).emit("reaction",{emoji,from:socket.id})});
  socket.on("movie-meta",data=>{const id=normalize(data?.roomId),r=rooms.get(id);if(!r||!r.users.has(socket.id)||!data?.name)return;r.movie={name:String(data.name).slice(0,240),duration:Number(data.duration)||0};socket.to(id).emit("movie-meta",r.movie)});
  socket.on("playback-state",data=>{const id=normalize(data?.roomId),r=rooms.get(id);if(!r||!r.users.has(socket.id)||r.hostSocketId!==socket.id)return;r.playback={state:data.state||"paused",time:Number(data.time)||0,updatedAt:Date.now()};socket.to(id).emit("playback-state",r.playback)});
  socket.on("webrtc",data=>{const id=normalize(data?.roomId),r=rooms.get(id);if(!r||!r.users.has(socket.id)||!data?.type)return;socket.to(id).emit("webrtc",{type:data.type,sdp:data.sdp||null,candidate:data.candidate||null,movieStreamId:data.movieStreamId||null,from:socket.id})});
  socket.on("disconnect",()=>{console.log("disconnected",socket.id);leave(socket)});
});

const PORT=process.env.PORT||3000;
httpServer.listen(PORT,"0.0.0.0",()=>console.log(`MovieDate server listening on ${PORT}`));
