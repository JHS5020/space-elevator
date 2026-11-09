import { useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import Character from "./Character.jsx";
import { LOOKS } from "../looks.js";

function Preview({ look }) {
  const group = useRef();
  const state = useMemo(() => ({ mode: "stand", emote: "none", emoteT: 0 }), []);
  useFrame(({ clock }) => {
    group.current.rotation.y = 0.3 + Math.sin(clock.elapsedTime * 0.6) * 0.6; // 천천히 좌우로 돈다
  });
  return (
    <group ref={group}>
      <Character look={look} state={state} />
    </group>
  );
}

export default function StartScreen({ onStart, joining, busy }) {
  const [i, setI] = useState(0);
  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem("name") || "";
    } catch {
      return "";
    }
  });
  const n = LOOKS.length;

  return (
    <div className="start">
      <h1>우주 엘리베이터</h1>
      <p className="tag">No words, Just company.</p>
      <p className="sub">{joining ? "초대받은 엘리베이터에 탑승해요. 캐릭터를 골라주세요" : "함께 우주까지 올라가는 조용한 엘리베이터"}</p>

      <div className="stage">
        <button className="arrow" onClick={() => setI((i + n - 1) % n)} aria-label="이전 캐릭터">
          ‹
        </button>
        <div className="preview">
          <Canvas camera={{ position: [0, 1.0, 4], fov: 30 }} onCreated={({ camera }) => camera.lookAt(0, 0.95, 0)}>
            <ambientLight intensity={1.2} />
            <directionalLight position={[2, 3, 4]} intensity={2.2} />
            <Preview look={LOOKS[i]} />
          </Canvas>
        </div>
        <button className="arrow" onClick={() => setI((i + 1) % n)} aria-label="다음 캐릭터">
          ›
        </button>
      </div>

      <div className="name">{LOOKS[i].name}</div>
      <input
        className="name-input"
        value={name}
        maxLength={8}
        placeholder="이름 (최대 8글자)"
        onChange={(e) => setName(e.target.value)}
      />
      <div className="dots">
        {LOOKS.map((_, k) => (
          <button key={k} className={k === i ? "dot on" : "dot"} onClick={() => setI(k)} aria-label={`캐릭터 ${k + 1}`} />
        ))}
      </div>

      <button className="go" disabled={busy} onClick={() => onStart(i, name.trim())}>
        {busy ? "연결하는 중..." : joining ? "탑승하기" : "엘리베이터에 오르기"}
      </button>
    </div>
  );
}
