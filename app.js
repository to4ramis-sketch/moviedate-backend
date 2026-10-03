const BACKEND_URL = "https://moviedate-backend-production.up.railway.app";

const socket = io(BACKEND_URL, { transports: ["websocket", "polling"] });
const params = new URLSearchParams(location.search);
let roomId = params.get("room");
let isHost = false;
let localStream = null;
let peer = null;
let partnerSocketId = null;
let ignorePlayback = false;

const $ = id => document.getElementById(id);
const movie = $("movie");
const movieFile = $("movieFile");
const localVideo = $("localVideo");
const remoteVideo = $("remoteVideo");

function toast(msg){$("toast").textContent=msg;$("toast").classList.add("show");setTimeout(()=>$("toast").classList.remove("show"),2200)}
function formatTime(sec){if(!Number.isFinite(sec)) return "00:00";sec=Math.max(0,Math.floor(sec));return `${String(Math.floor(sec/60)).padStart(2,"0")}:${String(sec%60).padStart(2,"0")}`}
function randomRoom(){return Math.random().toString(36).slice(2,7).toUpperCase()}

async function createRoom(){
  const id=randomRoom(); roomId=id; isHost=true;
  history.replaceState({}, "", `?room=${id}`);
  $("roomCode").textContent=id; $("hostBtn").textContent="Host";
  $("hostNote").textContent="You are the host. Choose a local movie.";
  socket.emit("join-room",{roomId:id});
  toast("Room created — share the link");
  await startCamera();
}
function joinExisting(){
  if(!roomId) return;
  $("roomCode").textContent=roomId;
  $("hostBtn").textContent="Joined";
  socket.emit("join-room",{roomId});
  startCamera();
}
async function startCamera(){
  try{
    localStream=await navigator.mediaDevices.getUserMedia({video:true,audio:true});
    localVideo.srcObject=localStream;
    $("localPlaceholder").style.display="none";
    $("youStatus").textContent="● live";
  }catch(e){$("youStatus").textContent="○ camera off";toast("Camera/mic permission not granted")}
}
function setConnected(on){
  $("roomStatus").classList.toggle("on",on);
  $("connectionText").textContent=on?"Connected":"Offline";
  $("syncBadge").textContent=on?"Synced room":"Not connected";
}
function addMessage(text,me=false){
  const el=document.createElement("div");el.className="bubble"+(me?" me":"");el.textContent=text;
  $("messages").appendChild(el);$("messages").scrollTop=$("messages").scrollHeight;
}
function reactionEmoji(emoji){
  const el=document.createElement("div");el.className="float-reaction";el.textContent=emoji;
  el.style.left=(25+Math.random()*60)+"vw";el.style.top=(55+Math.random()*25)+"vh";document.body.appendChild(el);
  setTimeout(()=>el.remove(),1500);
}

socket.on("connect",()=>{setConnected(true); if(roomId) joinExisting()});
socket.on("disconnect",()=>setConnected(false));
socket.on("room-state",data=>{
  if(data.hostSocketId===socket.id) isHost=true;
  if(data.hostSocketId!==socket.id && data.participants>1){partnerSocketId=data.hostSocketId;$("partnerStatus").textContent="● connected";createPeer(true)}
});
socket.on("peer-joined",async ({socketId,hostSocketId})=>{
  partnerSocketId=socketId;
  $("partnerStatus").textContent="● connected";
  if(socket.id===hostSocketId){isHost=true;createPeer(false)}
});
socket.on("peer-left",()=>{$("partnerStatus").textContent="○ waiting";if(peer){peer.close();peer=null}remoteVideo.srcObject=null});

async function createPeer(offerer){
  if(peer) peer.close();
  peer=new RTCPeerConnection({iceServers:[
    {urls:"stun:stun.l.google.com:19302"},
    {urls:"stun:stun.cloudflare.com:3478"}
  ]});
  if(localStream)localStream.getTracks().forEach(t=>peer.addTrack(t,localStream));
  peer.ontrack=e=>{remoteVideo.srcObject=e.streams[0];$("remotePlaceholder").style.display="none"};
  peer.onicecandidate=e=>{if(e.candidate)socket.emit("webrtc",{roomId,type:"ice",candidate:e.candidate})};
  peer.onconnectionstatechange=()=>{$("partnerStatus").textContent=peer.connectionState==="connected"?"● live":"○ "+peer.connectionState};
  if(offerer){
    const offer=await peer.createOffer();await peer.setLocalDescription(offer);
    socket.emit("webrtc",{roomId,type:"offer",sdp:offer});
  }
}
socket.on("webrtc",async msg=>{
  if(!peer) await createPeer(false);
  if(msg.type==="offer"){await peer.setRemoteDescription(msg.sdp);const answer=await peer.createAnswer();await peer.setLocalDescription(answer);socket.emit("webrtc",{roomId,type:"answer",sdp:answer})}
  if(msg.type==="answer")await peer.setRemoteDescription(msg.sdp);
  if(msg.type==="ice"){try{await peer.addIceCandidate(msg.candidate)}catch(e){}}
});

movieFile.addEventListener("change",e=>{
  const file=e.target.files[0];if(!file)return;
  movie.src=URL.createObjectURL(file);movie.load();movie.play().catch(()=>{});
  $("emptyState").classList.add("hidden");$("movieName").textContent=file.name;
  $("movieTitle").textContent=file.name;
  socket.emit("movie-meta",{roomId,name:file.name});
});
$("changeMovie").onclick=()=>movieFile.click();
$("playBtn").onclick=()=>togglePlay(true);
movie.onclick=()=>togglePlay(true);
async function togglePlay(send){
  if(movie.paused) await movie.play().catch(()=>{}); else movie.pause();
  $("playBtn").textContent=movie.paused?"▶":"Ⅱ";
  if(send)socket.emit("playback",{roomId,action:movie.paused?"pause":"play",time:movie.currentTime});
}
movie.addEventListener("play",()=>{$("playBtn").textContent="Ⅱ"});
movie.addEventListener("pause",()=>{$("playBtn").textContent="▶"});
movie.addEventListener("timeupdate",()=>{
  $("currentTime").textContent=formatTime(movie.currentTime);
  $("seek").value=movie.duration?(movie.currentTime/movie.duration)*100:0;
});
movie.addEventListener("loadedmetadata",()=>{$("duration").textContent=formatTime(movie.duration)});
$("seek").oninput=e=>{movie.currentTime=(+e.target.value/100)*movie.duration};
$("seek").onchange=()=>socket.emit("playback",{roomId,action:"seek",time:movie.currentTime});
socket.on("playback",async data=>{
  if(ignorePlayback)return;
  if(Math.abs(movie.currentTime-data.time)>0.8)movie.currentTime=data.time;
  if(data.action==="play")await movie.play().catch(()=>{});
  if(data.action==="pause")movie.pause();
});
socket.on("movie-meta",data=>{$("movieName").textContent=data.name;$("movieTitle").textContent=data.name});

$("chatForm").onsubmit=e=>{
  e.preventDefault();const input=$("chatInput");const text=input.value.trim();if(!text)return;
  addMessage(text,true);socket.emit("chat",{roomId,text});input.value="";
};
socket.on("chat",data=>addMessage(data.text,false));

$("reactionRow").onclick=e=>{
  const b=e.target.closest("button");if(!b)return;
  const emoji=b.dataset.reaction;reactionEmoji(emoji);socket.emit("reaction",{roomId,emoji});
};
socket.on("reaction",d=>reactionEmoji(d.emoji));

$("micBtn").onclick=()=>{
  const t=localStream?.getAudioTracks()[0];if(!t)return;
  t.enabled=!t.enabled;$("micBtn").firstChild.textContent=t.enabled?"🎙 ":"🔇 ";toast(t.enabled?"Mic on":"Mic off");
};
$("cameraBtn").onclick=()=>{
  const t=localStream?.getVideoTracks()[0];if(!t)return;
  t.enabled=!t.enabled;$("localPlaceholder").style.display=t.enabled?"none":"grid";toast(t.enabled?"Camera on":"Camera off");
};
$("muteBtn").onclick=()=>{movie.muted=!movie.muted;$("muteBtn").textContent=movie.muted?"🔇":"🔊"};
$("fullscreenBtn").onclick=()=>$("videoWrap").requestFullscreen?.();
$("shareBtn").onclick=async()=>{
  const url=location.href;
  try{await navigator.clipboard.writeText(url);toast("Room link copied")}
  catch{prompt("Copy this room link:",url)}
};
$("copyRoom").onclick=()=>navigator.clipboard.writeText(location.href).then(()=>toast("Room link copied"));
$("newRoom").onclick=createRoom;
$("hostBtn").onclick=()=>{if(!roomId)createRoom();else navigator.clipboard.writeText(location.href).then(()=>toast("Room link copied"))};
$("moreBtn").onclick=()=>toast("Room: "+(roomId||"not created"));

if(roomId) joinExisting();
else $("roomCode").textContent="—";
