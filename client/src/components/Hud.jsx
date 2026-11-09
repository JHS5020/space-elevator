import { useEffect, useState, useSyncExternalStore } from "react";
import { sim } from "../sim.js";
import { net, subscribeNet, getNetRev, sendChat, sendEmote, sendRps, sendAutoEmote, sendStance, HAND, HAND_NAME } from "../net.js";
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

// 이모션 목록 (name 은 서버/Character 와 같은 이름)
const EMOTES = [
  { name: "wave", icon: "👋", label: "손 흔들기" },
  { name: "nod", icon: "👍", label: "끄덕이기" },
  { name: "look", icon: "👀", label: "힐끔" },
  { name: "yawn", icon: "🥱", label: "하품" },
  { name: "stretch", icon: "🙆", label: "기지개" },
  { name: "punch", icon: "🥊", label: "주먹" },
];

// 기본 자세 (서버와 같은 이름)
const STANCES = [
  { name: "idle", icon: "🧍", label: "기본" },
  { name: "phone", icon: "📱", label: "핸드폰" },
  { name: "book", icon: "📖", label: "책" },
];

// 가위바위보 손 (서버와 같은 이름)
const HANDS = ["scissors", "rock", "paper"];

const read = () => ({
  alt: sim.altitude,
  floor: Math.floor(sim.altitude / FLOOR_KM + 1e-6),
  phase: sim.phase,
  pending: sim.stopPending,
  count: sim.people.length,
  seated: sim.people.some((p) => p.id === net.youId && (p.status === "seated" || p.status === "free")),
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
  const [emoteOpen, setEmoteOpen] = useState(false);

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

  const pickHand = (hand) => {
    sendRps(net.rps === hand ? null : hand); // 같은 걸 다시 누르면 해제
    setEmoteOpen(false);
  };
  const pickEmote = (name) => {
    sendEmote(name);
    setEmoteOpen(false);
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
            {emoteOpen && (
              <div className="emote-panel">
                <div className="emote-row">
                  {EMOTES.map((e) => (
                    <button key={e.name} className="emote-item" disabled={!s.seated} onClick={() => pickEmote(e.name)}>
                      <span className="emote-icon">{e.icon}</span>
                      <span>{e.label}</span>
                    </button>
                  ))}
                </div>
                {!s.seated && <div className="emote-hint">자리에 앉거나 서 있을 때 쓸 수 있어요</div>}
                <div className="emote-sep">자세 · 계속 유지돼요</div>
                <div className="emote-row">
                  {STANCES.map((st) => (
                    <button
                      key={st.name}
                      className={net.stance === st.name ? "emote-item picked" : "emote-item"}
                      onClick={() => {
                        sendStance(st.name);
                        setEmoteOpen(false);
                      }}
                    >
                      <span className="emote-icon">{st.icon}</span>
                      <span>{st.label}</span>
                    </button>
                  ))}
                </div>
                <div className="emote-sep">가위바위보 · 다음 층(약 10초)에 한 판, 끝나면 해제</div>
                <div className="emote-row">
                  {HANDS.map((h) => (
                    <button
                      key={h}
                      className={net.rps === h ? "emote-item picked" : "emote-item"}
                      onClick={() => pickHand(h)}
                    >
                      <span className="emote-icon">{HAND[h]}</span>
                      <span>{HAND_NAME[h]}</span>
                    </button>
                  ))}
                  <button className="emote-item" disabled={!net.rps} onClick={() => pickHand(net.rps)}>
                    <span className="emote-icon">🚫</span>
                    <span>해제</span>
                  </button>
                </div>
                <button
                  className={net.autoEmote ? "auto-toggle on" : "auto-toggle"}
                  onClick={() => sendAutoEmote(!net.autoEmote)}
                >
                  자동 이모트 · {net.autoEmote ? "켜짐" : "꺼짐"}
                </button>
              </div>
            )}
            <button
              className={`emote-btn${emoteOpen ? " on" : ""}${net.autoEmote ? "" : " off"}`}
              aria-label="이모션"
              onClick={() => setEmoteOpen((v) => !v)}
            >
              😊
              {net.rps && <span className="rps-badge">{HAND[net.rps]}</span>}
            </button>
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
