import { useSyncExternalStore } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import Rig from "./components/Rig.jsx";
import Elevator from "./components/Elevator.jsx";
import People from "./components/People.jsx";
import Landing from "./components/Landing.jsx";
import Outside from "./components/Outside.jsx";
import Hud from "./components/Hud.jsx";
import StartScreen from "./components/StartScreen.jsx";
import WaitingOverlay from "./components/WaitingOverlay.jsx";
import Notice from "./components/Notice.jsx";
import { net, subscribeNet, getNetRev, createRoom, joinRoom } from "./net.js";
import { unlockAudio } from "./audio.js";

export default function App() {
  useSyncExternalStore(subscribeNet, getNetRev);
  const screen = net.screen;
  const roomId = new URLSearchParams(window.location.search).get("room"); // 초대 링크로 온 사람

  const handleStart = (lookIndex) => {
    unlockAudio();
    if (roomId) joinRoom(roomId, lookIndex);
    else createRoom(lookIndex);
  };

  return (
    <div className="app">
      <Canvas camera={{ position: [0, 1.45, 1.8], fov: 70 }}>
        <ambientLight intensity={0.7} />
        <pointLight position={[0, 2.8, 0]} intensity={12} />
        <Outside />
        <Landing />
        <Rig>
          <Elevator />
          <People />
        </Rig>
        <OrbitControls
          target={[0, 1.45, 1.7]}
          enableZoom={false}
          enablePan={false}
          enableDamping
          rotateSpeed={-0.3}
          minPolarAngle={Math.PI / 3}
          maxPolarAngle={Math.PI / 1.7}
        />
      </Canvas>

      {(screen === "select" || screen === "connecting") && (
        <StartScreen joining={!!roomId} busy={screen === "connecting"} onStart={handleStart} />
      )}
      {(screen === "waiting" || screen === "riding") && <Hud />}
      {screen === "waiting" && <WaitingOverlay />}
      {(screen === "expired" || screen === "full" || screen === "error") && <Notice kind={screen} />}
    </div>
  );
}
