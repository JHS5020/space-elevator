import { useState, useSyncExternalStore } from "react";
import { Canvas } from "@react-three/fiber";
import Rig from "./components/Rig.jsx";
import Elevator from "./components/Elevator.jsx";
import People from "./components/People.jsx";
import Landing from "./components/Landing.jsx";
import Outside from "./components/Outside.jsx";
import Hud from "./components/Hud.jsx";
import StartScreen from "./components/StartScreen.jsx";
import WaitingOverlay from "./components/WaitingOverlay.jsx";
import Notice from "./components/Notice.jsx";
import ViewRig from "./components/ViewRig.jsx";
import CameraRig from "./components/CameraRig.jsx";
import Controls from "./components/Controls.jsx";
import { setMode } from "./controls.js";
import { net, subscribeNet, getNetRev, createRoom, joinRoom } from "./net.js";
import { unlockAudio } from "./audio.js";

export default function App() {
  useSyncExternalStore(subscribeNet, getNetRev);
  const screen = net.screen;
  // 핸드폰처럼 세로로 긴 화면에서는 처음에만 전체 보기 (그 뒤에 폰을 돌려도 보기 방식은 그대로 유지)
  const [overview, setOverview] = useState(() => window.innerHeight > window.innerWidth);
  const roomId = new URLSearchParams(window.location.search).get("room"); // 초대 링크로 온 사람

  const handleStart = (lookIndex, name) => {
    unlockAudio();
    if (roomId) joinRoom(roomId, lookIndex, name);
    else createRoom(lookIndex, name);
  };

  return (
    <div className="app">
      <Canvas camera={{ position: [0, 1.45, 1.8], fov: 70, near: 0.05, far: 6000 }}>
        <ambientLight intensity={0.7} />
        <pointLight position={[0, 2.8, 0]} intensity={12} />
        <Outside />
        <Landing />
        <Rig>
          <Elevator />
          <People />
        </Rig>
        <ViewRig overview={overview} />
        <CameraRig overview={overview} />
      </Canvas>

      {(screen === "select" || screen === "connecting") && (
        <StartScreen joining={!!roomId} busy={screen === "connecting"} onStart={handleStart} />
      )}
      {(screen === "waiting" || screen === "riding") && (
        <Hud
          overview={overview}
          onToggleView={() => {
            if (!overview) setMode("view"); // 전체 보기로 갈 때는 1인칭을 끈다
            setOverview((v) => !v);
          }}
        />
      )}
      {screen === "riding" && <Controls overview={overview} setOverview={setOverview} />}
      {screen === "waiting" && <WaitingOverlay />}
      {(screen === "expired" || screen === "full" || screen === "error" || screen === "away") && <Notice kind={screen} />}
    </div>
  );
}
