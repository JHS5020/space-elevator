// 도착할 때 나는 "딩동" 소리 (브라우저 정책상 버튼을 누른 뒤부터 소리가 나요)
let ctx = null;

export function unlockAudio() {
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
  } catch {
    ctx = null;
  }
}

function tone(freq, start, dur, volume) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + dur + 0.05);
}

export function chime() {
  if (!ctx) return;
  const t = ctx.currentTime;
  tone(880, t, 0.9, 0.12);
  tone(659.25, t + 0.4, 1.3, 0.12);
}
