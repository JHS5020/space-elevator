// ===== 우주 엘리베이터 서버 =====
// 방 만들기 / 초대 링크 입장 / 엘리베이터 진행 / 채팅 / 빈 방 정리 / 화면 파일 제공
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createRoom, addWaiting, reattach, leaveRoom, findPerson, seatsTaken, stepRoom, snapshot } from "./room.js";
import { SEATS, LOOK_COUNT, ROOM_TTL, MAX_ROOMS, CHAT_MAX, BOARD_INTERVAL, NAME_MAX, DISCONNECT_GRACE } from "./config.js";

const PORT = process.env.PORT || 3001;
const origin = process.env.CLIENT_ORIGIN ? process.env.CLIENT_ORIGIN.split(",") : true;

const app = express();
app.use(cors({ origin }));
const rooms = new Map();
app.get("/health", (_req, res) => res.json({ ok: true, rooms: rooms.size }));

// 배포용: 화면을 빌드(client/dist)해 두면 같은 서버가 화면까지 보여준다
const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), "../client/dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!socket\.io).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin } });

const CODE_CHARS = "abcdefghjkmnpqrstuvwxyz23456789";
function newRoomCode() {
  for (;;) {
    let code = "";
    for (const b of crypto.randomBytes(6)) code += CODE_CHARS[b % CODE_CHARS.length];
    if (!rooms.has(code)) return code;
  }
}
const validLook = (v) => Number.isInteger(v) && v >= 0 && v < LOOK_COUNT;
const validClientId = (v) => typeof v === "string" && /^[\w-]{8,64}$/.test(v);
// 이름: 제어문자와 < > 를 빼고 NAME_MAX 글자까지만. 비어 있으면 "손님"
const cleanName = (v) =>
  String(v ?? "").replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, NAME_MAX) || "손님";
const validRoomId = (v) => typeof v === "string" && /^[a-z0-9]{4,12}$/.test(v);

function bind(room, socket, clientId) {
  room.sockets.set(clientId, socket.id);
  room.emptySince = null;
  socket.data.roomId = room.id;
  socket.data.clientId = clientId;
  socket.join(room.id);
}

io.on("connection", (socket) => {
  socket.on("create-room", (data, ack) => {
    const reply = typeof ack === "function" ? ack : () => {};
    if (socket.data.roomId) return reply({ ok: false, reason: "already" });
    if (!data || !validClientId(data.clientId) || !validLook(data.look)) return reply({ ok: false, reason: "bad-request" });
    if (rooms.size >= MAX_ROOMS) return reply({ ok: false, reason: "busy" });
    const room = createRoom(newRoomCode(), { clientId: data.clientId, look: data.look, name: cleanName(data.name) });
    rooms.set(room.id, room);
    bind(room, socket, data.clientId);
    console.log(`[방 생성] ${room.id} (방 ${rooms.size}개)`);
    reply({ ok: true, roomId: room.id, status: "riding" });
  });

  socket.on("join-room", (data, ack) => {
    const reply = typeof ack === "function" ? ack : () => {};
    if (!data || !validRoomId(data.roomId) || !validClientId(data.clientId) || !validLook(data.look)) {
      return reply({ ok: false, reason: "bad-request" });
    }
    const room = rooms.get(data.roomId);
    if (!room) return reply({ ok: false, reason: "not-found" });

    const back = reattach(room, data.clientId);
    if (back) {
      bind(room, socket, data.clientId);
      return reply({ ok: true, roomId: room.id, status: "riding", youId: back.id });
    }
    if (room.waiting.some((w) => w.owner === data.clientId)) {
      bind(room, socket, data.clientId);
      return reply({ ok: true, roomId: room.id, status: "waiting" });
    }
    if (seatsTaken(room) >= SEATS.length) return reply({ ok: false, reason: "full" });
    bind(room, socket, data.clientId);
    addWaiting(room, data.clientId, data.look, cleanName(data.name));
    console.log(`[입장 대기] ${room.id} (기다리는 사람 ${room.waiting.length}명)`);
    reply({ ok: true, roomId: room.id, status: "waiting" });
  });

  socket.on("chat", (data) => {
    const { roomId, clientId } = socket.data;
    const room = rooms.get(roomId);
    if (!room || !data) return;
    const person = findPerson(room, clientId);
    if (!person) return; // 아직 못 탄 사람은 채팅 불가
    const now = Date.now();
    socket.data.chatTimes = (socket.data.chatTimes || []).filter((t) => now - t < 3000);
    if (socket.data.chatTimes.length >= 5) return; // 도배 방지
    socket.data.chatTimes.push(now);
    const text = String(data.text ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, CHAT_MAX);
    if (!text) return;
    io.to(room.id).emit("chat", { id: person.id, nm: person.name, look: person.look, text, ts: now });
  });

  socket.on("disconnect", () => {
    const { roomId, clientId } = socket.data;
    const room = rooms.get(roomId);
    if (!room) return;
    if (room.sockets.get(clientId) !== socket.id) return; // 새로고침으로 이미 바뀐 접속
    room.sockets.delete(clientId);
    if ((io.sockets.adapter.rooms.get(room.id)?.size || 0) === 0) {
      room.emptySince = Date.now();
      console.log(`[방 비었음] ${room.id} → ${ROOM_TTL}초 뒤 삭제 예정`);
    }
    // 바로 내보내지 않고 잠깐 기다려요. 그 사이 다시 접속하면 자리를 그대로 유지해요.
    setTimeout(() => {
      const r = rooms.get(roomId);
      if (!r || r.sockets.has(clientId)) return;
      leaveRoom(r, clientId);
    }, DISCONNECT_GRACE * 1000);
  });
});

// 서버 시계: 1초에 20번
let last = Date.now();
let tick = 0;
setInterval(() => {
  tick++;
  const now = Date.now();
  const dt = (now - last) / 1000;
  last = now;
  for (const room of rooms.values()) {
    stepRoom(room, dt);
    for (const ev of room.events.splice(0)) {
      const sid = room.sockets.get(ev.owner);
      if (ev.type === "boarded" && sid) io.to(sid).emit("you", { status: "riding", personId: ev.personId });
    }
    // 계산은 1초에 20번, 화면으로 보내는 건 10번 (데이터 사용량 절약)
    if (tick % 2 === 0) io.to(room.id).volatile.emit("state", snapshot(room));
  }
}, 50);

// 빈 방 정리: 10초마다 검사
setInterval(() => {
  const now = Date.now();
  for (const [id, room] of rooms) {
    if (room.emptySince && now - room.emptySince > ROOM_TTL * 1000) {
      rooms.delete(id);
      console.log(`[방 삭제] ${id} (방 ${rooms.size}개 남음)`);
    }
  }
}, 10000);

httpServer.listen(PORT, () => {
  console.log(`서버 실행: http://localhost:${PORT}`);
  console.log(`정원 ${SEATS.length}명 / 탑승 주기 ${BOARD_INTERVAL}초 / 빈 방 삭제 ${ROOM_TTL}초`);
});
