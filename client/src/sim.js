// ===== 화면용 엘리베이터 상태 =====
// 엘리베이터 움직임은 "서버"가 계산하고, 이 파일은 서버가 보낸 상태(snapshot)를
// 3D 화면이 부드럽게 보이도록 다듬어서 sim 에 넣어줍니다.
import { CRUISE, WALK_SPEED, FREE_X, FREE_Z_MIN, FREE_Z_MAX } from "./config.js";
import { chime } from "./audio.js";

// 내가 1인칭으로 걷는 중일 때의 입력. 서버 답을 기다리지 않고 바로 움직여 보이게(예측) 하는 데 써요.
export const local = { fp: false, mx: 0, mz: 0 };
const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export const sim = {
  youId: null, // 내 사람 번호 (net.js 가 넣어줘요)
  started: false,
  phase: "lobby",
  t: 0,
  altitude: 0,
  speed: 0,
  doorOpen: 0,
  stopPending: false,
  landingAlt: 0,
  bump: 0,
  shakeX: 0,
  shakeY: 0,
  people: [],
};

const listeners = new Set();
let rev = 0;
export function subscribe(l) {
  listeners.add(l);
  return () => listeners.delete(l);
}
export const getRev = () => rev;
function bump() {
  rev++;
  listeners.forEach((l) => l());
}

let snap = null;
let snapAt = 0;

export function applySnapshot(s) {
  snap = s;
  snapAt = performance.now();
}

export function resetSim() {
  snap = null;
  sim.started = false;
  sim.phase = "lobby";
  sim.altitude = 0;
  sim.speed = 0;
  sim.doorOpen = 0;
  sim.people = [];
  bump();
}

const damp = (a, b, lambda, dt) => b + (a - b) * Math.exp(-lambda * dt);
const angleDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

export function step(rawDt) {
  const dt = Math.min(rawDt, 0.1);
  if (!snap) return;
  sim.t += dt;
  const ago = (performance.now() - snapAt) / 1000;

  if (snap.phase !== sim.phase) {
    if (sim.started) {
      if (snap.phase === "opening") {
        sim.bump = 1;
        chime();
      } else if (snap.phase === "accelerating") {
        sim.bump = Math.max(sim.bump, 0.25);
      }
    }
    sim.phase = snap.phase;
  }

  const targetAlt = snap.alt + snap.spd * ago;
  if (!sim.started || Math.abs(targetAlt - sim.altitude) > 1.5) {
    sim.altitude = targetAlt;
    sim.speed = snap.spd;
    sim.doorOpen = snap.door;
  } else {
    sim.altitude += sim.speed * dt;
    sim.altitude += (targetAlt - sim.altitude) * (1 - Math.exp(-8 * dt));
    sim.speed = damp(sim.speed, snap.spd, 10, dt);
    sim.doorOpen = damp(sim.doorOpen, snap.door, 16, dt);
  }
  sim.landingAlt = snap.land;
  sim.stopPending = snap.pend;

  let changed = false;
  const byId = new Map(sim.people.map((p) => [p.id, p]));
  const seen = new Set();
  for (const sp of snap.people) {
    seen.add(sp.id);
    let p = byId.get(sp.id);
    if (!p) {
      p = { id: sp.id, x: sp.x, z: sp.z, yaw: sp.yaw, emote: sp.emote, emoteT: sp.et };
      sim.people.push(p);
      changed = true;
    }
    p.look = sp.look;
    p.name = sp.nm;
    p.seat = sp.seat;
    p.status = sp.st;
    p.mode = sp.mode;
    p.ly = sp.ly; // 힐끔 쳐다볼 때 고개 돌릴 각도
    p.stance = sp.sn; // 기본 자세 (idle / phone / book)
    if (sp.id === sim.youId && sp.st === "free" && local.fp) {
      // 내가 1인칭으로 걷는 중: 키 입력대로 바로 움직이고(서버와 같은 규칙),
      // 서버 위치와 많이 어긋났을 때만 서버 위치로 맞춘다
      const m = Math.hypot(local.mx, local.mz);
      const k = m > 1 ? 1 / m : 1;
      p.x = clampN(p.x + local.mx * k * WALK_SPEED * dt, -FREE_X, FREE_X);
      p.z = clampN(p.z + local.mz * k * WALK_SPEED * dt, FREE_Z_MIN, FREE_Z_MAX);
      if (Math.hypot(sp.x - p.x, sp.z - p.z) > 0.9) {
        p.x = sp.x;
        p.z = sp.z;
      } else if (m < 0.05) {
        p.x = damp(p.x, sp.x, 6, dt);
        p.z = damp(p.z, sp.z, 6, dt);
      }
      p.mode = m > 0.05 ? "walk" : "stand";
    } else if (Math.hypot(sp.x - p.x, sp.z - p.z) > 1.5) {
      p.x = sp.x;
      p.z = sp.z;
    } else {
      p.x = damp(p.x, sp.x, 14, dt);
      p.z = damp(p.z, sp.z, 14, dt);
    }
    p.yaw += angleDiff(p.yaw, sp.yaw) * (1 - Math.exp(-14 * dt));
    if (p.emote !== sp.emote) {
      p.emote = sp.emote;
      p.emoteT = sp.et;
    } else {
      p.emoteT += dt;
      if (Math.abs(p.emoteT - sp.et) > 0.4) p.emoteT = sp.et;
    }
  }
  if (sim.people.some((p) => !seen.has(p.id))) {
    sim.people = sim.people.filter((p) => seen.has(p.id));
    changed = true;
  }
  if (changed) bump();
  sim.started = true;

  const moving = sim.speed / CRUISE;
  sim.bump *= Math.exp(-2.5 * dt);
  sim.shakeX = (Math.sin(sim.t * 23) * 0.0015 + Math.sin(sim.t * 37) * 0.001) * moving;
  sim.shakeY =
    (Math.sin(sim.t * 29) * 0.0015 + Math.sin(sim.t * 41) * 0.001) * moving +
    Math.sin(sim.t * 13) * 0.03 * sim.bump;
}
