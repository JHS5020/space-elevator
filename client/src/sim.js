// ===== 화면용 엘리베이터 상태 =====
// 엘리베이터 움직임은 "서버"가 계산하고, 이 파일은 서버가 보낸 상태(snapshot)를
// 3D 화면이 부드럽게 보이도록 다듬어서 sim 에 넣어줍니다.
import { CRUISE } from "./config.js";
import { chime } from "./audio.js";

export const sim = {
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
    if (Math.hypot(sp.x - p.x, sp.z - p.z) > 1.5) {
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
