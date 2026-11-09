import { useEffect, useState, useSyncExternalStore } from "react";
import { sim } from "../sim.js";
import { net, subscribeNet, getNetRev, sendChat } from "../net.js";
import { FLOOR_KM, SEATS } from "../config.js";
import { LOOKS } from "../looks.js";

const PHASE_TEXT = {
  opening: "문이 열리는 중",
  open: "탑승 · 하차 중",
  closing: "문이 닫히는 중",
  accelerating: "출발",
  cruise: "상승 중",
  braking: "감속 중",
};

const read = () => ({
  alt: sim.altitude,
  floor: Math.floor(sim.altitude / FLOOR_KM + 1e-6),
  phase: sim.phase,
  pending: sim.stopPending,
  count: sim.people.length,
});

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  }
}

function senderName(m) {
  const name = m.nm || LOOKS[m.look]?.name.split(" · ")[1] || "손님";
  return m.id === net.youId ? `${name} (나)` : name;
}

export default function Hud({ overview, onToggleView }) {
  useSyncExternalStore(subscribeNet, getNetRev);
  const [s, setS] = useState(read);
  const [toast, setToast] = useState("");
  const [text, setText] = useState("");

  useEffect(() => {
    const id = setInterval(() => setS(read()), 100);
    return () => clearInterval(id);
  }, []);

  const say = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2500);
  };
  const invite = async () => {
    const link = `${window.location.origin}/?room=${net.roomId}`;
    say((await copyText(link)) ? "초대 링크를 복사했어요" : link);
  };
  const submit = () => {
    if (!text.trim()) return;
    sendChat(text);
    setText("");
  };

  const status = s.phase === "cruise" && s.pending ? "다음 층에 정차해요" : PHASE_TEXT[s.phase] || "";

  return (
    <>
      <div className="hud">
        <div className="pill">현재 <b>{s.floor}층</b></div>
        <div className="pill">고도 <b>{s.alt.toFixed(1)} km</b></div>
        <div className="pill"><b>{status}</b></div>
        <div className="pill">탑승 <b>{s.count}/{SEATS.length}</b></div>
      </div>

      <button className="invite" onClick={invite}>초대 링크 복사</button>
      <button className="viewbtn" onClick={onToggleView}>
        {overview ? "안에서 보기" : "전체 보기"}
      </button>
      {!net.connected && <div className="banner">연결이 끊겼어요. 다시 연결하는 중...</div>}

      {net.screen === "riding" && (
        <div className="chat">
          <div className="chat-log">
            {net.chat.slice(-5).map((m, i) => (
              <div key={`${m.ts}-${i}`} className="chat-line">
                <b>{senderName(m)}</b> {m.text}
              </div>
            ))}
          </div>
          <div className="chat-row">
            <input
              value={text}
              maxLength={120}
              placeholder="한마디 남기기"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && submit()}
            />
            <button onClick={submit}>보내기</button>
          </div>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
