import { useEffect, useState } from "react";
import { net } from "../net.js";

// 초대 링크로 들어온 사람이 엘리베이터가 멈추기를 기다리는 동안 보이는 안내
export default function WaitingOverlay() {
  const [next, setNext] = useState(net.next);
  useEffect(() => {
    const id = setInterval(() => setNext(net.next), 250);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="waiting">
      <div className="waiting-card">
        <div className="waiting-title">
          탑승 준비중입니다<span className="dots-anim">...</span>
        </div>
        <div className="waiting-sub">
          엘리베이터가 다음 층에 멈추면 탈 수 있어요
          {next > 0 && <> (약 {next}초 안에 출발해요)</>}
        </div>
      </div>
    </div>
  );
}
