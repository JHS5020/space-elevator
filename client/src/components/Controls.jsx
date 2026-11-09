import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { sim } from "../sim.js";
import { net, sendStand, sendSit } from "../net.js";
import { ctl, subscribeCtl, getCtlRev, setMode } from "../controls.js";

// 방향 화살표 (위쪽 모양을 CSS로 돌려서 네 방향 모두 똑같은 모양으로 쓴다)
const Arrow = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
    <path d="M12 5 L21 18 H3 Z" fill="currentColor" />
  </svg>
);

// 누르고 있는 동안만 켜지는 버튼 (핸드폰 십자키용)
function HoldButton({ name, className, label, children }) {
  const set = (v) => () => {
    ctl.pad[name] = v;
  };
  return (
    <button
      className={`hold ${className || ""}`}
      aria-label={label}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture?.(e.pointerId);
        ctl.pad[name] = true;
      }}
      onPointerUp={set(false)}
      onPointerCancel={set(false)}
      onLostPointerCapture={set(false)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </button>
  );
}

// 1인칭 전환, 일어서기/앉기 버튼, 핸드폰용 십자키
export default function Controls({ overview, setOverview }) {
  useSyncExternalStore(subscribeCtl, getCtlRev);
  const [status, setStatus] = useState("");
  const statusRef = useRef("");

  useEffect(() => {
    const id = setInterval(() => {
      const me = sim.people.find((p) => p.id === net.youId);
      const st = me ? me.status : "";
      statusRef.current = st;
      setStatus(st);
    }, 100);
    return () => clearInterval(id);
  }, []);

  const toggleSeat = () => {
    if (statusRef.current === "seated") sendStand();
    else if (statusRef.current === "free") sendSit();
  };
  const toggleFp = () => {
    if (ctl.mode === "fp") return setMode("view");
    const me = sim.people.find((p) => p.id === net.youId);
    if (!me) return;
    setOverview(false);
    setMode("fp", me);
  };

  // 키보드: E = 일어서기/앉기, V = 1인칭/평소 시점
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === "KeyE") toggleSeat();
      else if (e.code === "KeyV") toggleFp();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [fs, setFs] = useState(false);
  const [fsHelp, setFsHelp] = useState(false);
  const canFs = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
  // 홈 화면에서 앱처럼 열었다면 이미 전체화면이라 버튼이 필요 없다
  const standalone =
    window.navigator.standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches;
  useEffect(() => {
    const on = () => setFs(!!(document.fullscreenElement || document.webkitFullscreenElement));
    document.addEventListener("fullscreenchange", on);
    document.addEventListener("webkitfullscreenchange", on);
    return () => {
      document.removeEventListener("fullscreenchange", on);
      document.removeEventListener("webkitfullscreenchange", on);
    };
  }, []);
  // 전체화면으로 바꾸고 가로 화면으로 고정해 본다 (안 되는 기기에서는 전체화면만)
  const toggleFs = async () => {
    if (!canFs) return setFsHelp(true); // 아이폰 사파리처럼 전체화면 기능이 없는 경우: 방법 안내
    try {
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        await (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      } else {
        const el = document.documentElement;
        await (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
        try {
          await screen.orientation.lock("landscape");
        } catch {
          /* 가로 고정을 지원하지 않는 기기 */
        }
      }
    } catch {
      /* 전체화면을 막는 브라우저 */
    }
  };

  const fp = ctl.mode === "fp";
  const canSeat = status === "seated" || status === "free";

  return (
    <>
      <button className="fpbtn" onClick={toggleFp} disabled={!status}>
        {fp ? "평소 시점 (V)" : "1인칭 (V)"}
      </button>
      {!standalone && (
        <button className="fsbtn" onClick={toggleFs}>
          {fs ? "전체화면 끄기" : "전체화면"}
        </button>
      )}
      {fsHelp && (
        <div className="fs-help" onClick={() => setFsHelp(false)}>
          <div className="fs-card" onClick={(e) => e.stopPropagation()}>
            <h3>전체화면으로 보는 방법</h3>
            이 브라우저는 버튼으로 전체화면을 켤 수 없어요. 대신 이렇게 하면 주소창 없이 꽉 찬 화면으로 열려요.
            <ol>
              <li>사파리(Safari)에서 이 주소를 열고, 아래쪽 <b>공유 버튼(네모 위에 화살표)</b>을 누르세요.</li>
              <li><b>홈 화면에 추가</b>를 누르고 <b>추가</b>를 누르세요.</li>
              <li>홈 화면에 생긴 <b>우주 엘리베이터</b> 아이콘으로 접속하세요.</li>
            </ol>
            <small>카카오톡·인스타그램 등 앱 안에서 연 링크라면 사파리(또는 크롬)로 먼저 열어야 해요.</small>
            <button onClick={() => setFsHelp(false)}>알겠어요</button>
          </div>
        </div>
      )}
      <button className="seatbtn" onClick={toggleSeat} disabled={!canSeat}>
        {status === "free" ? "자리에 앉기 (E)" : "일어서기 (E)"}
      </button>

      {!overview && (
        <>
          <div className="pad">
            <HoldButton name="up" className="p-up" label="앞으로"><Arrow /></HoldButton>
            <HoldButton name="left" className="p-left" label="왼쪽으로 이동"><Arrow /></HoldButton>
            <HoldButton name="right" className="p-right" label="오른쪽으로 이동"><Arrow /></HoldButton>
            <HoldButton name="down" className="p-down" label="뒤로"><Arrow /></HoldButton>
          </div>
          {!fp && (
            <div className="fly">
              <HoldButton name="rise" label="위로">위로</HoldButton>
              <HoldButton name="fall" label="아래로">아래로</HoldButton>
            </div>
          )}
          <div className="keyhint">
            {fp
              ? "WASD/화살표 걷기 · 화면 드래그로 시선 돌리기 · E 앉기/일어서기"
              : "WASD/화살표 이동 · Space 위 · Shift 아래 · 화면 드래그로 시선 돌리기"}
          </div>
        </>
      )}
    </>
  );
}
