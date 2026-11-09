// ===== 방 하나의 엘리베이터 시뮬레이션 (서버가 계산, 화면은 결과만 그림) =====
import {
  CRUISE, FLOOR_KM, ACCEL_TIME, DOOR_TIME, BRAKE_DIST,
  WALK_SPEED, OUT_Z, STAND_X, SEAT_X, SEATS, BOARD_INTERVAL,
} from "./config.js";

const EMOTES = ["wave", "yawn", "stretch", "nod", "look"];
const EMOTE_DUR = { wave: 2.6, yawn: 3, stretch: 3, nod: 2, look: 3.5 };
const angleDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const seatYaw = (seat) => (-SEATS[seat].side * Math.PI) / 2;
const face = (p, target, dt, rate = 10) => {
  p.yaw += angleDiff(p.yaw, target) * (1 - Math.exp(-rate * dt));
};

let idCounter = 1;

export function createRoom(id, creator) {
  const room = {
    id,
    emptySince: null,
    sockets: new Map(), // clientId -> socket id
    phase: "opening",
    t: 0,
    altitude: 0,
    speed: 0,
    doorOpen: 0,
    stopRequested: false,
    stopPending: false,
    targetAlt: 0,
    brakeA: 0,
    landingAlt: 0,
    openTimer: 0,
    waiting: [], // { owner, look }
    boardQueue: [],
    people: [],
    boardClock: 0,
    events: [],
  };
  room.boardQueue.push({ owner: creator.clientId, look: creator.look });
  spawnQueued(room);
  return room;
}

export const seatsTaken = (room) => room.people.length + room.boardQueue.length + room.waiting.length;

function makePerson(owner, look, seat) {
  return {
    id: idCounter++, owner, connected: true, look, seat,
    status: "waiting", stage: "", x: 0, z: OUT_Z, yaw: 0, mode: "stand",
    emote: "none", emoteT: 0, nextEmote: 0, path: [], pi: 0, delay: 0, wantLeave: false,
  };
}

function freeSeat(room) {
  const used = new Set(room.people.map((p) => p.seat));
  for (let i = 0; i < SEATS.length; i++) if (!used.has(i)) return i;
  return -1;
}

function spawnQueued(room) {
  while (room.boardQueue.length) {
    const seat = freeSeat(room);
    if (seat < 0) { room.boardQueue.length = 0; break; }
    const q = room.boardQueue.shift();
    const p = makePerson(q.owner, q.look, seat);
    room.people.push(p);
    room.events.push({ type: "boarded", owner: q.owner, personId: p.id });
  }
}

function pullWaiting(room) {
  for (const w of room.waiting) room.boardQueue.push({ owner: w.owner, look: w.look });
  room.waiting = [];
}

function walkPath(p, dt) {
  const w = p.path[p.pi];
  const dx = w.x - p.x, dz = w.z - p.z;
  const d = Math.hypot(dx, dz);
  const step = WALK_SPEED * dt;
  if (d <= step) { p.x = w.x; p.z = w.z; p.pi++; return p.pi >= p.path.length; }
  p.x += (dx / d) * step;
  p.z += (dz / d) * step;
  face(p, Math.atan2(dx, dz), dt);
  return false;
}

function moveX(p, target, speed, dt) {
  const diff = target - p.x;
  p.x += Math.sign(diff) * Math.min(Math.abs(diff), speed * dt);
  return Math.abs(target - p.x) < 0.001;
}

function updatePerson(p, dt) {
  if (p.delay > 0) { p.delay -= dt; return; }
  const seat = SEATS[p.seat];
  const sitX = seat.side * SEAT_X;
  const standX = seat.side * STAND_X;

  if (p.status === "entering") {
    if (p.stage === "walk") {
      p.mode = "walk";
      if (walkPath(p, dt)) p.stage = "turn";
    } else if (p.stage === "turn") {
      p.mode = "stand";
      const target = seatYaw(p.seat);
      face(p, target, dt, 8);
      if (Math.abs(angleDiff(p.yaw, target)) < 0.06) p.stage = "sit";
    } else if (p.stage === "sit") {
      p.mode = "sit";
      if (moveX(p, sitX, 1.0, dt)) {
        p.status = "seated";
        p.emote = "none";
        p.nextEmote = 2 + Math.random() * 3;
      }
    }
  } else if (p.status === "seated") {
    p.mode = "sit";
    if (p.emote === "none") {
      p.nextEmote -= dt;
      if (p.nextEmote <= 0) {
        p.emote = EMOTES[Math.floor(Math.random() * EMOTES.length)];
        p.emoteT = 0;
      }
    } else {
      p.emoteT += dt;
      if (p.emoteT > EMOTE_DUR[p.emote]) { p.emote = "none"; p.nextEmote = 4 + Math.random() * 6; }
    }
  } else if (p.status === "leaving") {
    if (p.stage === "stand") {
      p.mode = "stand";
      p.emote = "none";
      if (moveX(p, standX, 1.0, dt)) {
        p.path = [{ x: 0, z: seat.z }, { x: 0, z: OUT_Z }];
        p.pi = 0;
        p.stage = "walk";
      }
    } else if (p.stage === "walk") {
      p.mode = "walk";
      if (walkPath(p, dt)) p.status = "gone";
    }
  }
}

function releasePeople(room) {
  let k = 0;
  for (const p of room.people) {
    const seat = SEATS[p.seat];
    if (p.status === "waiting") {
      p.status = "entering"; p.stage = "walk";
      p.path = [{ x: 0, z: seat.z }, { x: seat.side * STAND_X, z: seat.z }];
      p.pi = 0; p.delay = k++ * 0.9; room.openTimer = 0;
    } else if (p.status === "seated" && p.wantLeave) {
      p.status = "leaving"; p.stage = "stand"; p.emote = "none";
      p.delay = k++ * 0.9; room.openTimer = 0;
    }
  }
}

const busy = (room) =>
  room.boardQueue.length > 0 ||
  room.people.some((p) => ["waiting", "entering", "leaving"].includes(p.status) || (p.status === "seated" && p.wantLeave));

function wantStop(room) {
  if (room.phase !== "opening" && room.phase !== "open") room.stopRequested = true;
}

// ---------- 입장/퇴장 ----------
export function addWaiting(room, owner, look) {
  const ex = room.waiting.find((w) => w.owner === owner);
  if (ex) { ex.look = look; return; }
  room.waiting.push({ owner, look });
  if (room.phase === "opening" || room.phase === "open") pullWaiting(room);
}

export function reattach(room, owner) {
  const p = room.people.find((x) => x.owner === owner && x.status !== "leaving" && x.status !== "gone");
  if (!p) return null;
  p.connected = true;
  p.wantLeave = false;
  return p;
}

export function leaveRoom(room, owner) {
  room.waiting = room.waiting.filter((w) => w.owner !== owner);
  room.boardQueue = room.boardQueue.filter((q) => q.owner !== owner);
  let flagged = false;
  for (const p of room.people) {
    if (p.owner !== owner) continue;
    p.connected = false;
    if (p.status === "waiting") p.status = "gone";
    else { p.wantLeave = true; flagged = true; }
  }
  if (flagged) wantStop(room);
  room.people = room.people.filter((p) => p.status !== "gone");
}

export const findPerson = (room, owner) =>
  room.people.find((p) => p.owner === owner && p.status !== "gone") || null;

// ---------- 매 틱 ----------
export function stepRoom(room, rawDt) {
  const dt = Math.min(rawDt, 0.1);
  room.t += dt;

  room.boardClock += dt;
  if (room.boardClock >= BOARD_INTERVAL) {
    room.boardClock = 0;
    if (room.waiting.length) {
      if (room.phase === "opening" || room.phase === "open") pullWaiting(room);
      else room.stopRequested = true;
    }
  }

  switch (room.phase) {
    case "opening":
      room.doorOpen = Math.min(1, room.doorOpen + dt / DOOR_TIME);
      if (room.doorOpen > 0.75) releasePeople(room);
      if (room.doorOpen >= 1) { room.phase = "open"; room.openTimer = 0; }
      break;
    case "open":
      if (room.boardQueue.length) spawnQueued(room);
      releasePeople(room);
      if (!busy(room)) {
        room.openTimer += dt;
        if (room.openTimer > 2) room.phase = "closing";
      }
      break;
    case "closing":
      room.doorOpen = Math.max(0, room.doorOpen - dt / DOOR_TIME);
      if (room.doorOpen <= 0) { room.phase = "accelerating"; room.speed = 0; }
      break;
    case "accelerating":
      room.speed = Math.min(CRUISE, room.speed + (CRUISE / ACCEL_TIME) * dt);
      room.altitude += room.speed * dt;
      if (room.speed >= CRUISE) room.phase = "cruise";
      break;
    case "cruise":
      room.altitude += room.speed * dt;
      if (room.stopRequested && !room.stopPending) {
        room.targetAlt = Math.ceil((room.altitude + BRAKE_DIST) / FLOOR_KM) * FLOOR_KM;
        room.stopPending = true;
        room.landingAlt = room.targetAlt;
      }
      if (room.stopPending && room.targetAlt - room.altitude <= BRAKE_DIST) {
        const remain = Math.max(0.05, room.targetAlt - room.altitude);
        room.brakeA = (room.speed * room.speed) / (2 * remain);
        room.phase = "braking";
      }
      break;
    case "braking": {
      const v0 = room.speed;
      room.speed = Math.max(0, v0 - room.brakeA * dt);
      room.altitude += ((v0 + room.speed) / 2) * dt;
      if (room.speed <= 0.004 || room.altitude >= room.targetAlt - 0.002) {
        room.altitude = room.targetAlt;
        room.speed = 0;
        room.stopPending = false;
        room.stopRequested = false;
        room.phase = "opening";
        room.openTimer = 0;
        pullWaiting(room);
        spawnQueued(room);
      }
      break;
    }
    default:
      break;
  }

  for (const p of room.people) updatePerson(p, dt);
  if (room.people.some((p) => p.status === "gone")) room.people = room.people.filter((p) => p.status !== "gone");
}

const r3 = (n) => Math.round(n * 1000) / 1000;

export function snapshot(room) {
  return {
    t: Date.now(),
    phase: room.phase,
    alt: r3(room.altitude),
    spd: r3(room.speed),
    door: r3(room.doorOpen),
    land: room.landingAlt,
    pend: room.stopRequested || room.stopPending,
    wait: room.waiting.length,
    next: Math.max(0, Math.ceil(BOARD_INTERVAL - room.boardClock)),
    people: room.people.map((p) => ({
      id: p.id, look: p.look, seat: p.seat, st: p.status,
      x: r3(p.x), z: r3(p.z), yaw: r3(p.yaw), mode: p.mode,
      emote: p.emote, et: Math.round(p.emoteT * 100) / 100,
    })),
  };
}
