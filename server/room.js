// ===== 방 하나의 엘리베이터 시뮬레이션 (서버가 계산, 화면은 결과만 그림) =====
import {
  CRUISE, FLOOR_KM, ACCEL_TIME, DOOR_TIME, BRAKE_DIST,
  WALK_SPEED, OUT_Z, STAND_X, SEAT_X, SEATS, BOARD_INTERVAL,
  FREE_X, FREE_Z_MIN, FREE_Z_MAX,
} from "./config.js";

const AUTO_EMOTES = ["wave", "yawn", "stretch", "nod", "look"]; // 가만히 있을 때 저절로 하는 것
const EMOTES = [...AUTO_EMOTES, "punch"]; // 버튼으로 고를 수 있는 것
const EMOTE_DUR = { wave: 2.6, yawn: 3, stretch: 3, nod: 2, look: 3.5, punch: 1.7 };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const angleDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const seatYaw = (seat) => (-SEATS[seat].side * Math.PI) / 2;
const face = (p, target, dt, rate = 10) => {
  p.yaw += angleDiff(p.yaw, target) * (1 - Math.exp(-rate * dt));
};

// 힐끔 쳐다보기: 다른 앉은 사람 중 한 명 쪽으로 고개를 돌릴 각도를 정한다
function pickLookYaw(room, p) {
  const diffs = room.people
    .filter((o) => o !== p && (o.status === "seated" || o.status === "free"))
    .map((o) => angleDiff(p.yaw, Math.atan2(o.x - p.x, o.z - p.z)))
    .filter((d) => Math.abs(d) >= 0.35)
    .map((d) => Math.max(-1.2, Math.min(1.2, d)));
  if (diffs.length) return diffs[Math.floor(Math.random() * diffs.length)];
  return (Math.random() < 0.5 ? -1 : 1) * 0.6;
}

function startEmote(room, p, name) {
  p.emote = name;
  p.emoteT = 0;
  p.lookYaw = name === "look" ? pickLookYaw(room, p) : 0;
}

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
    lastFloor: 0,
    events: [],
  };
  room.boardQueue.push({ owner: creator.clientId, look: creator.look, name: creator.name });
  spawnQueued(room);
  return room;
}

export const seatsTaken = (room) => room.people.length + room.boardQueue.length + room.waiting.length;

function makePerson(owner, look, seat, name) {
  return {
    id: idCounter++, owner, name, connected: true, look, seat,
    status: "waiting", stage: "", x: 0, z: OUT_Z, yaw: 0, mode: "stand",
    emote: "none", emoteT: 0, lookYaw: 0, nextEmote: 0, autoEmote: true, rps: null, stance: "idle", path: [], pi: 0, delay: 0, wantLeave: false,
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
    const p = makePerson(q.owner, q.look, seat, q.name);
    room.people.push(p);
    room.events.push({ type: "boarded", owner: q.owner, personId: p.id });
  }
}

function pullWaiting(room) {
  for (const w of room.waiting) room.boardQueue.push({ owner: w.owner, look: w.look, name: w.name });
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

function updatePerson(room, p, dt) {
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
      // 폰/책을 보는 자세일 때는 저절로 이모트를 하지 않는다
      const auto = p.autoEmote && p.stance === "idle";
      if (auto) p.nextEmote -= dt;
      if (auto && p.nextEmote <= 0) startEmote(room, p, AUTO_EMOTES[Math.floor(Math.random() * AUTO_EMOTES.length)]);
    } else {
      p.emoteT += dt;
      if (p.emoteT > EMOTE_DUR[p.emote]) { p.emote = "none"; p.nextEmote = 4 + Math.random() * 6; }
    }
  } else if (p.status === "rising") {
    // 일어서는 중: 의자에서 통로 쪽으로 나온다
    p.mode = "stand";
    p.emote = "none";
    if (moveX(p, standX, 1.0, dt)) { p.status = "free"; p.input = null; }
  } else if (p.status === "free") {
    // 서서 돌아다니는 중: 화면이 보낸 방향(input)대로 걷되, 엘리베이터 안쪽을 못 벗어난다
    let mx = 0, mz = 0;
    if (p.input && room.t - p.inputT < 0.5) { mx = p.input.mx; mz = p.input.mz; }
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }
    p.x = clamp(p.x + mx * WALK_SPEED * dt, -FREE_X, FREE_X);
    p.z = clamp(p.z + mz * WALK_SPEED * dt, FREE_Z_MIN, FREE_Z_MAX);
    const moving = len > 0.05;
    p.mode = moving ? "walk" : "stand";
    if (p.emote !== "none") {
      if (moving) p.emote = "none";
      else {
        p.emoteT += dt;
        if (p.emoteT > EMOTE_DUR[p.emote]) p.emote = "none";
      }
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
    } else if (p.status === "free" && p.wantLeave) {
      // 서 있던 사람은 통로 가운데로 해서 문으로 나간다
      p.status = "leaving"; p.stage = "walk"; p.emote = "none";
      p.path = [{ x: 0, z: p.z }, { x: 0, z: OUT_Z }]; p.pi = 0;
      p.delay = k++ * 0.9; room.openTimer = 0;
    }
  }
}

const busy = (room) =>
  room.boardQueue.length > 0 ||
  room.people.some((p) => ["waiting", "entering", "leaving"].includes(p.status) || ((p.status === "seated" || p.status === "free") && p.wantLeave));

function wantStop(room) {
  if (room.phase !== "opening" && room.phase !== "open") room.stopRequested = true;
}

// ---------- 입장/퇴장 ----------
export function addWaiting(room, owner, look, name) {
  const ex = room.waiting.find((w) => w.owner === owner);
  if (ex) { ex.look = look; ex.name = name; return; }
  room.waiting.push({ owner, look, name });
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

// 사용자가 직접 고른 이모션. 앉아 있는 사람만 할 수 있고, 하던 이모션은 바로 바뀐다.
export function requestEmote(room, owner, name) {
  if (!EMOTES.includes(name)) return false;
  const p = findPerson(room, owner);
  if (!p || (p.status !== "seated" && p.status !== "free") || p.wantLeave) return false;
  startEmote(room, p, name);
  return true;
}

// 자동 이모트(가만히 앉아 있을 때 저절로 하는 동작) 켜기/끄기
export function setAutoEmote(room, owner, on) {
  const p = findPerson(room, owner);
  if (!p) return false;
  p.autoEmote = !!on;
  if (p.autoEmote) p.nextEmote = 2 + Math.random() * 3;
  return true;
}

// 가위바위보: 손을 고르면 다음 층(약 10초 뒤)에 한 판 진행하고, 판이 끝나면 선택이 해제된다.
// 고른 사람이 혼자뿐이라 판이 열리지 않으면 선택은 그대로 유지된다.
const HANDS = ["scissors", "rock", "paper"];
const BEATS = { scissors: "paper", rock: "scissors", paper: "rock" }; // 키가 이기는 상대
export function setRps(room, owner, hand) {
  const p = findPerson(room, owner);
  if (!p) return false;
  if (hand !== null && !HANDS.includes(hand)) return false;
  p.rps = hand;
  return true;
}

// 층이 하나 바뀌었을 때: 손을 고른 사람이 2명 이상이면 한 판 진행
function runRps(room, floor) {
  const inside = ["seated", "free", "rising", "entering"];
  const players = room.people.filter((p) => p.rps && inside.includes(p.status) && !p.wantLeave);
  if (players.length < 2) return;
  const kinds = [...new Set(players.map((p) => p.rps))];
  let winHand = null;
  if (kinds.length === 2) winHand = BEATS[kinds[0]] === kinds[1] ? kinds[0] : kinds[1];
  const winners = winHand ? players.filter((p) => p.rps === winHand) : [];
  room.events.push({
    type: "rps",
    floor,
    hand: winHand, // 이긴 손 (비겼으면 null)
    entries: players.map((p) => ({ id: p.id, nm: p.name, hand: p.rps, win: winHand ? p.rps === winHand : false })),
  });
  for (const w of winners) if (w.status === "seated" && w.emote === "none") startEmote(room, w, "wave");
  for (const pl of players) pl.rps = null; // 한 판이 끝났으니 선택은 해제 (혼자만 골랐다면 판이 없어서 그대로 유지)
}

// 기본 자세(스탠스): 평소 모습(idle) / 핸드폰 보기(phone) / 책 읽기(book). 이모트와 달리 계속 유지된다.
const STANCES = ["idle", "phone", "book"];
export function setStance(room, owner, stance) {
  const p = findPerson(room, owner);
  if (!p || !STANCES.includes(stance)) return false;
  p.stance = stance;
  if (stance === "idle") p.nextEmote = 2 + Math.random() * 3;
  return true;
}

// 일어서기: 앉아 있는 사람만. 통로로 나온 뒤 "free"(자유롭게 걷기) 상태가 된다.
export function standUp(room, owner) {
  const p = findPerson(room, owner);
  if (!p || p.status !== "seated" || p.wantLeave) return false;
  p.status = "rising";
  p.emote = "none";
  p.input = null;
  return true;
}

// 다시 앉기: 서 있는 사람이 자기 의자 앞까지 걸어가서 돌아 앉는다 (들어올 때와 같은 동작)
export function sitDown(room, owner) {
  const p = findPerson(room, owner);
  if (!p || p.status !== "free" || p.wantLeave) return false;
  const seat = SEATS[p.seat];
  p.status = "entering"; p.stage = "walk"; p.emote = "none"; p.input = null;
  p.path = [{ x: seat.side * STAND_X, z: seat.z }];
  p.pi = 0; p.delay = 0;
  return true;
}

// 걷는 방향(mx, mz는 엘리베이터 좌표 기준, 길이 1 이하)과 바라보는 방향(yaw)
export function setMove(room, owner, mx, mz, yaw) {
  const p = findPerson(room, owner);
  if (!p || p.status !== "free") return;
  p.input = { mx, mz };
  p.inputT = room.t;
  p.yaw = yaw;
}

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

  const floorNow = Math.floor(room.altitude / FLOOR_KM + 1e-6);
  if (floorNow > room.lastFloor) {
    room.lastFloor = floorNow;
    runRps(room, floorNow);
  }

  for (const p of room.people) updatePerson(room, p, dt);
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
      id: p.id, nm: p.name, look: p.look, seat: p.seat, st: p.status,
      x: r3(p.x), z: r3(p.z), yaw: r3(p.yaw), mode: p.mode,
      emote: p.emote, et: Math.round(p.emoteT * 100) / 100, ly: r3(p.lookYaw), sn: p.stance,
    })),
  };
}
