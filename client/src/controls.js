// ===== 시점과 조작 상태 =====
// mode: "view" = 평소 시점(엘리베이터 안을 날아다니듯 둘러보는 카메라, 내 캐릭터는 그대로)
//       "fp"   = 1인칭(내 캐릭터의 눈. 일어서면 걸어 다닐 수 있음)
// yaw 0 은 문(-z) 쪽을 보는 방향이고, 왼쪽으로 돌리면 늘어나요.
import { FREE_X } from "./config.js";

export const ctl = {
  mode: "view",
  yaw: 0,
  pitch: 0,
  cam: { x: 0, y: 1.45, z: 1.8 }, // 평소 시점 카메라 위치
  eyeY: 1.38, // 1인칭 눈 높이 (앉고 설 때 부드럽게 변함)
  keys: {}, // 키보드로 누르고 있는 키
  pad: {}, // 핸드폰 화면 버튼으로 누르고 있는 버튼
};

if (typeof window !== "undefined" && window.location.search.includes("debug")) window.__ctl = ctl; // 개발 확인용

const listeners = new Set();
let rev = 0;
export const subscribeCtl = (l) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export const getCtlRev = () => rev;
function notify() {
  rev++;
  listeners.forEach((l) => l());
}

export function setMode(mode, me) {
  if (ctl.mode === mode) return;
  ctl.mode = mode;
  if (mode === "fp" && me) {
    ctl.yaw = me.yaw + Math.PI; // 내 캐릭터가 바라보는 쪽
    ctl.pitch = 0;
    ctl.eyeY = me.mode === "sit" ? 1.38 : 1.72;
  }
  notify();
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// 지금 눌린 키/버튼을 숫자로: F 앞(+)/뒤(-), S 오른쪽(+)/왼쪽(-) (시선은 그대로, 옆으로 이동), V 위(+)/아래(-)
// 화살표 키와 핸드폰 십자 버튼은 WASD 와 똑같이 움직여요. 시선(방향)은 화면 드래그로 돌려요.
export function axes() {
  const k = ctl.keys;
  const p = ctl.pad;
  const b = (v) => (v ? 1 : 0);
  return {
    F: b(k.KeyW || k.ArrowUp || p.up) - b(k.KeyS || k.ArrowDown || p.down),
    S: b(k.KeyD || k.ArrowRight || p.right) - b(k.KeyA || k.ArrowLeft || p.left),
    V: b(k.Space || p.rise) - b(k.ControlLeft || k.ControlRight || k.ShiftLeft || k.ShiftRight || k.KeyC || p.fall),
  };
}

// 바라보는 방향(yaw)을 기준으로 한 이동을 엘리베이터 좌표(x, z)로 바꾼다
export function moveVec(F, S, yaw) {
  return {
    x: -Math.sin(yaw) * F + Math.cos(yaw) * S,
    z: -Math.cos(yaw) * F - Math.sin(yaw) * S,
  };
}

const CAM_SPEED = 2.2;
const CAM_RISE = 1.5;

// 평소 시점 카메라를 한 칸 움직인다 (엘리베이터 안쪽을 벗어나지 못함)
export function updateViewCam(dt) {
  const { F, S, V } = axes();
  const m = moveVec(F, S, ctl.yaw);
  const c = ctl.cam;
  c.x = clamp(c.x + m.x * CAM_SPEED * dt, -(FREE_X + 0.35), FREE_X + 0.35);
  c.z = clamp(c.z + m.z * CAM_SPEED * dt, -1.8, 1.9);
  c.y = clamp(c.y + V * CAM_RISE * dt, 0.35, 2.8);
}

export function look(dx, dy) {
  ctl.yaw -= dx * 0.005;
  ctl.pitch = clamp(ctl.pitch - dy * 0.005, -1.3, 1.3);
}

const typing = (e) => {
  const t = e.target;
  return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
};
const GAME_KEYS = new Set([
  "KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  "Space", "ControlLeft", "ControlRight", "ShiftLeft", "ShiftRight", "KeyC",
]);

// 키보드와 화면 드래그(마우스/손가락)를 듣기 시작한다. 돌려주는 함수를 부르면 멈춘다.
export function installInput(canvas, isOverview) {
  const down = (e) => {
    if (!GAME_KEYS.has(e.code) || typing(e) || isOverview()) return;
    ctl.keys[e.code] = true;
    if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
  };
  const up = (e) => {
    if (GAME_KEYS.has(e.code)) ctl.keys[e.code] = false;
  };
  const clear = () => {
    ctl.keys = {};
    ctl.pad = {};
  };

  let dragId = null;
  let lx = 0;
  let ly = 0;
  const pdown = (e) => {
    if (isOverview() || dragId !== null) return;
    dragId = e.pointerId;
    lx = e.clientX;
    ly = e.clientY;
    canvas.setPointerCapture?.(e.pointerId);
  };
  const pmove = (e) => {
    if (e.pointerId !== dragId) return;
    look(e.clientX - lx, e.clientY - ly);
    lx = e.clientX;
    ly = e.clientY;
  };
  const pup = (e) => {
    if (e.pointerId === dragId) dragId = null;
  };

  canvas.style.touchAction = "none";
  window.addEventListener("keydown", down);
  window.addEventListener("keyup", up);
  window.addEventListener("blur", clear);
  canvas.addEventListener("pointerdown", pdown);
  canvas.addEventListener("pointermove", pmove);
  canvas.addEventListener("pointerup", pup);
  canvas.addEventListener("pointercancel", pup);
  return () => {
    window.removeEventListener("keydown", down);
    window.removeEventListener("keyup", up);
    window.removeEventListener("blur", clear);
    canvas.removeEventListener("pointerdown", pdown);
    canvas.removeEventListener("pointermove", pmove);
    canvas.removeEventListener("pointerup", pup);
    canvas.removeEventListener("pointercancel", pup);
  };
}
