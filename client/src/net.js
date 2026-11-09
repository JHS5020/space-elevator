// ===== 서버와 통신하는 파일 =====
import { io } from "socket.io-client";
import { sim, applySnapshot, resetSim } from "./sim.js";
import { setMode } from "./controls.js";

// 서버 주소: 개발 중엔 같은 컴퓨터의 3001번 포트, 배포(빌드)하면 화면을 준 서버 자신
const SERVER_URL =
  import.meta.env.VITE_SERVER_URL ||
  (import.meta.env.DEV ? `http://${window.location.hostname}:3001` : window.location.origin);

// screen: select 캐릭터 고르기 / connecting 연결 중 / waiting 탑승 준비중 / riding 탑승
//         expired 만료 / full 가득 참 / error 서버 연결 실패
export const net = {
  screen: "select",
  roomId: null,
  youId: null,
  look: 0,
  name: "",
  connected: false,
  wait: 0,
  next: 0,
  chat: [],
  bubbles: {},
  rps: null, // 내가 고른 가위바위보 손 (scissors / rock / paper), 없으면 null
  autoEmote: true, // 가만히 앉아 있을 때 저절로 하는 이모트
  stance: "idle", // 기본 자세: idle(기본) / phone(핸드폰 보기) / book(책 읽기)
};

export const HAND = { scissors: "✌️", rock: "✊", paper: "🖐️" };
export const HAND_NAME = { scissors: "가위", rock: "바위", paper: "보" };

const listeners = new Set();
let rev = 0;
export function subscribeNet(l) {
  listeners.add(l);
  return () => listeners.delete(l);
}
export const getNetRev = () => rev;
function notify() {
  rev++;
  listeners.forEach((l) => l());
}

function makeId() {
  const rand = () => Math.random().toString(36).slice(2, 10);
  return `c-${Date.now().toString(36)}-${rand()}${rand()}`;
}
// 탭마다 하나의 이름표. 새로고침해도 같은 자리로 돌아올 수 있어요.
function getClientId() {
  try {
    let id = sessionStorage.getItem("clientId");
    if (!id) {
      id = makeId();
      sessionStorage.setItem("clientId", id);
    }
    return id;
  } catch {
    return makeId();
  }
}
const clientId = getClientId();

let socket = null;
function getSocket() {
  if (socket) return socket;
  socket = io(SERVER_URL);

  socket.on("connect", () => {
    net.connected = true;
    if (net.roomId && ["waiting", "riding", "connecting"].includes(net.screen)) rejoin();
    notify();
  });
  socket.on("disconnect", () => {
    net.connected = false;
    notify();
  });
  socket.on("connect_error", () => {
    if (net.screen === "connecting") {
      net.screen = "error";
      notify();
    }
  });
  socket.on("state", (s) => {
    applySnapshot(s);
    net.wait = s.wait;
    net.next = s.next;
  });
  socket.on("you", (y) => {
    net.youId = sim.youId = y.personId;
    net.screen = "riding";
    notify();
  });
  socket.on("chat", (m) => {
    net.chat = [...net.chat, m].slice(-30);
    showBubble(m.id, m.text, 6000);
    notify();
  });
  // 가위바위보 결과: 참가자 머리 위에 손을 보여주고, 채팅 줄에도 한 줄 남긴다
  socket.on("rps", (r) => {
    if (r.entries.some((e) => e.id === net.youId)) net.rps = null; // 한 판이 끝나면 내 선택은 해제돼요
    for (const e of r.entries) showBubble(e.id, `${HAND[e.hand]}${e.win ? " 승리!" : ""}`, 5000);
    const names = (list) => list.map((e) => e.nm || "손님").join(", ");
    const text = r.hand
      ? `${r.floor}층 가위바위보 · ${HAND_NAME[r.hand]} 승리! (${names(r.entries.filter((e) => e.win))})`
      : `${r.floor}층 가위바위보 · 비겼어요`;
    net.chat = [...net.chat, { id: 0, nm: "✌️✊🖐️", text, ts: Date.now() }].slice(-30);
    notify();
  });
  return socket;
}

// 사람 머리 위 말풍선을 ms 동안 보여준다
function showBubble(id, text, ms) {
  const until = Date.now() + ms;
  net.bubbles = { ...net.bubbles, [id]: { text, until } };
  notify();
  setTimeout(() => {
    const b = net.bubbles[id];
    if (b && Date.now() >= b.until) {
      const rest = { ...net.bubbles };
      delete rest[id];
      net.bubbles = rest;
      notify();
    }
  }, ms + 100);
}

function enter(res) {
  if (res && res.ok) {
    net.roomId = res.roomId;
    net.youId = sim.youId = res.youId ?? null;
    net.rps = res.rps ?? null;
    net.autoEmote = res.auto ?? true;
    net.stance = res.stance ?? "idle";
    net.screen = res.status === "waiting" ? "waiting" : "riding";
    history.replaceState(null, "", `?room=${res.roomId}`); // 주소창이 곧 초대 링크
  } else if (res && res.reason === "not-found") net.screen = "expired";
  else if (res && res.reason === "full") net.screen = "full";
  else net.screen = "error";
  notify();
}

function request(event, data) {
  net.screen = "connecting";
  notify();
  getSocket()
    .timeout(5000)
    .emit(event, data, (err, res) => enter(err ? null : res));
}

function rejoin() {
  getSocket().emit("join-room", { roomId: net.roomId, clientId, look: net.look, name: net.name }, (res) => {
    if (res && res.ok) {
      net.youId = sim.youId = res.youId ?? net.youId;
      if ("rps" in res) net.rps = res.rps ?? null;
      if ("auto" in res) net.autoEmote = res.auto ?? true;
      if ("stance" in res) net.stance = res.stance ?? "idle";
      net.screen = res.status === "waiting" ? "waiting" : "riding";
    } else if (res && res.reason === "not-found") net.screen = "expired";
    else if (res && res.reason === "full") net.screen = "full";
    else net.screen = "error";
    notify();
  });
}

export function createRoom(look, name) {
  net.look = look;
  net.name = name || "";
  request("create-room", { clientId, look, name: net.name });
}
export function joinRoom(roomId, look, name) {
  net.look = look;
  net.name = name || "";
  request("join-room", { roomId, clientId, look, name: net.name });
}
export function sendChat(text) {
  if (getSocket().connected) getSocket().emit("chat", { text });
}
export function sendEmote(name) {
  if (getSocket().connected) getSocket().emit("emote", { name });
}
// 가위바위보 손 고르기 (hand 가 null 이면 해제)
export function sendRps(hand) {
  const prev = net.rps;
  net.rps = hand;
  notify();
  if (!getSocket().connected) return;
  getSocket().timeout(3000).emit("rps-set", { hand }, (err, res) => {
    if (err || !res || !res.ok) {
      net.rps = prev;
      notify();
    }
  });
}
export function sendAutoEmote(on) {
  const prev = net.autoEmote;
  net.autoEmote = on;
  notify();
  if (!getSocket().connected) return;
  getSocket().timeout(3000).emit("auto-emote", { on }, (err, res) => {
    if (err || !res || !res.ok) {
      net.autoEmote = prev;
      notify();
    }
  });
}
// 기본 자세 고르기 (idle / phone / book)
export function sendStance(stance) {
  const prev = net.stance;
  net.stance = stance;
  notify();
  if (!getSocket().connected) return;
  getSocket().timeout(3000).emit("stance-set", { stance }, (err, res) => {
    if (err || !res || !res.ok) {
      net.stance = prev;
      notify();
    }
  });
}
export function sendStand() {
  if (getSocket().connected) getSocket().emit("stand");
}
export function sendSit() {
  if (getSocket().connected) getSocket().emit("sit");
}
export function sendMove(mx, mz, yaw) {
  if (getSocket().connected) getSocket().volatile.emit("move", { mx, mz, yaw });
}
export function backToStart() {
  history.replaceState(null, "", window.location.pathname);
  net.screen = "select";
  net.roomId = null;
  net.youId = sim.youId = null;
  setMode("view");
  net.chat = [];
  net.bubbles = {};
  net.rps = null;
  net.autoEmote = true;
  net.stance = "idle";
  resetSim();
  notify();
}

// ---- 핸드폰에서 앱을 뒤로 보내 두면: 일정 시간 뒤 스스로 연결을 끊어서 서버 부담을 줄인다 ----
const AWAY_MS = 30000;
let hideTimer = null;
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if ((net.screen === "waiting" || net.screen === "riding") && socket) {
        net.screen = "away";
        socket.disconnect(); // 직접 끊으면 자동 재접속도 멈춘다
        notify();
      }
    }, AWAY_MS);
  } else {
    clearTimeout(hideTimer);
  }
});

// "다시 들어가기" 버튼
export function comeBack() {
  net.screen = "connecting";
  notify();
  const s = getSocket();
  if (s.connected) rejoin();
  else s.connect(); // 연결되면 위의 connect 처리에서 rejoin 이 실행된다
}
