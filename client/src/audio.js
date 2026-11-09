// 소리: 도착 "딩동" + 분위기 소리(엘리베이터 웅웅, 바람, 우주의 저음, 유성).
// 브라우저 정책상 버튼을 누른 뒤(unlockAudio)부터 소리가 나요. 모든 소리는 master 를 거쳐서 음소거 버튼 하나로 꺼져요.
let ctx = null;
let master = null;
let nodes = null;
let muted = false;
try {
  muted = localStorage.getItem("elevMuted") === "1";
} catch {
  muted = false;
}

export const isMuted = () => muted;
export function setMuted(m) {
  muted = m;
  try {
    localStorage.setItem("elevMuted", m ? "1" : "0");
  } catch {
    /* 저장 못 해도 괜찮아요 */
  }
  if (ctx && master) master.gain.setTargetAtTime(m ? 0 : 1, ctx.currentTime, 0.05);
}

function noiseBuffer(kind) {
  const len = ctx.sampleRate * 3;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (kind === "brown") {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    } else {
      d[i] = w;
    }
  }
  return buf;
}

function loopSource(buf) {
  const s = ctx.createBufferSource();
  s.buffer = buf;
  s.loop = true;
  s.start();
  return s;
}

function buildAmbient() {
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 1;
  master.connect(ctx.destination);

  const brown = noiseBuffer("brown");
  const white = noiseBuffer("white");

  // 엘리베이터 웅웅 소리
  const humLP = ctx.createBiquadFilter();
  humLP.type = "lowpass";
  humLP.frequency.value = 180;
  const humG = ctx.createGain();
  humG.gain.value = 0;
  loopSource(brown).connect(humLP).connect(humG).connect(master);
  const humOsc = ctx.createOscillator();
  humOsc.type = "sine";
  humOsc.frequency.value = 52;
  const humOscG = ctx.createGain();
  humOscG.gain.value = 0;
  humOsc.connect(humOscG).connect(master);
  humOsc.start();

  // 바람 (공기가 있는 낮은 하늘에서만)
  const windBP = ctx.createBiquadFilter();
  windBP.type = "bandpass";
  windBP.frequency.value = 500;
  windBP.Q.value = 0.6;
  const windG = ctx.createGain();
  windG.gain.value = 0;
  loopSource(white).connect(windBP).connect(windG).connect(master);

  // 우주의 낮고 먹먹한 울림 (두 소리가 살짝 어긋나 천천히 울렁거림)
  const spaceG = ctx.createGain();
  spaceG.gain.value = 0;
  spaceG.connect(master);
  [38, 38.7, 76.3].forEach((f, i) => {
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.value = i === 2 ? 0.35 : 1;
    o.connect(g).connect(spaceG);
    o.start();
  });

  nodes = { humG, humOscG, humOsc, windG, windBP, spaceG, white };
}

export function unlockAudio() {
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
    if (!master) buildAmbient();
  } catch {
    ctx = null;
    master = null;
    nodes = null;
  }
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// 매 프레임 불러도 돼요 (0.1초에 한 번만 바꿔요). speed: km/초, alt: km, space: 0(하늘)~1(우주)
let lastUpdate = 0;
export function updateAmbient(speed, alt, space) {
  if (!ctx || !nodes) return;
  const now = ctx.currentTime;
  if (now - lastUpdate < 0.1) return;
  lastUpdate = now;
  const v = Math.min(1, Math.max(0, speed / 0.4));
  const air = 1 - smooth(10, 60, alt);
  nodes.humG.gain.setTargetAtTime((0.05 + 0.15 * v) * (1 - 0.5 * space), now, 0.4);
  nodes.humOscG.gain.setTargetAtTime((0.008 + 0.03 * v) * (1 - 0.6 * space), now, 0.4);
  nodes.humOsc.frequency.setTargetAtTime(52 + 10 * v, now, 0.6);
  nodes.windG.gain.setTargetAtTime(0.06 * v * air, now, 0.5);
  nodes.windBP.frequency.setTargetAtTime(400 + 900 * v, now, 0.5);
  nodes.spaceG.gain.setTargetAtTime(0.035 * space, now, 1.0);
}

// 유성이 지나갈 때 아주 작게 "쉬익"
export function meteorSound() {
  if (!ctx || !nodes) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = nodes.white;
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.setValueAtTime(2500, t);
  hp.frequency.exponentialRampToValueAtTime(7000, t + 0.7);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.03, t + 0.08);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
  src.connect(hp).connect(g).connect(master);
  src.start(t);
  src.stop(t + 0.8);
}

function tone(freq, start, dur, volume) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(gain).connect(master || ctx.destination);
  osc.start(start);
  osc.stop(start + dur + 0.05);
}

export function chime() {
  if (!ctx) return;
  const t = ctx.currentTime;
  tone(880, t, 0.9, 0.12);
  tone(659.25, t + 0.4, 1.3, 0.12);
}
