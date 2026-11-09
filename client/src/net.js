// ===== 서버와 통신하는 파일 =====
import { io } from "socket.io-client";
import { applySnapshot, resetSim } from "./sim.js";

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
  connected: false,
  wait: 0,
  next: 0,
  chat: [],
  bubbles: {},
};

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
    if (net.roomId && (net.screen === "waiting" || net.screen === "riding")) rejoin();
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
    net.youId = y.personId;
    net.screen = "riding";
    notify();
  });
  socket.on("chat", (m) => {
    net.chat = [...net.chat, m].slice(-30);
    net.bubbles = { ...net.bubbles, [m.id]: { text: m.text, until: Date.now() + 6000 } };
    notify();
    setTimeout(() => {
      const b = net.bubbles[m.id];
      if (b && Date.now() >= b.until) {
        const rest = { ...net.bubbles };
        delete rest[m.id];
        net.bubbles = rest;
        notify();
      }
    }, 6100);
  });
  return socket;
}

function enter(res) {
  if (res && res.ok) {
    net.roomId = res.roomId;
    net.youId = res.youId ?? null;
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
  getSocket().emit("join-room", { roomId: net.roomId, clientId, look: net.look }, (res) => {
    if (res && res.ok) {
      net.youId = res.youId ?? net.youId;
      net.screen = res.status === "waiting" ? "waiting" : "riding";
    } else if (res && res.reason === "not-found") net.screen = "expired";
    notify();
  });
}

export function createRoom(look) {
  net.look = look;
  request("create-room", { clientId, look });
}
export function joinRoom(roomId, look) {
  net.look = look;
  request("join-room", { roomId, clientId, look });
}
export function sendChat(text) {
  if (getSocket().connected) getSocket().emit("chat", { text });
}
export function backToStart() {
  history.replaceState(null, "", window.location.pathname);
  net.screen = "select";
  net.roomId = null;
  net.youId = null;
  net.chat = [];
  net.bubbles = {};
  resetSim();
  notify();
}
