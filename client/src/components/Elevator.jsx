import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { sim } from "../sim.js";
import { SEATS, FLOOR_KM } from "../config.js";
import { view } from "../view.js";

const WALL = "#d9d2c5";
const METAL = "#b9bcc2";

function Box({ position, args, color = WALL, metal = false }) {
  return (
    <mesh position={position}>
      <boxGeometry args={args} />
      <meshStandardMaterial color={color} metalness={metal ? 0.6 : 0} roughness={metal ? 0.35 : 0.9} />
    </mesh>
  );
}

// 문짝 하나 (가로 1.4 x 세로 2.5): 아래판 + 위판 + 양옆 기둥으로 큰 창문 구멍(1.1 x 1.8)을 만든다
function DoorPanel() {
  return (
    <>
      <Box position={[0, 0.25, 0]} args={[1.4, 0.5, 0.06]} color={METAL} metal />
      <Box position={[0, 2.4, 0]} args={[1.4, 0.2, 0.06]} color={METAL} metal />
      <Box position={[-0.625, 1.4, 0]} args={[0.15, 1.8, 0.06]} color={METAL} metal />
      <Box position={[0.625, 1.4, 0]} args={[0.15, 1.8, 0.06]} color={METAL} metal />
    </>
  );
}

// 가운데에서 양옆으로 열리는 문
function Doors() {
  const left = useRef();
  const right = useRef();
  useFrame(() => {
    const d = sim.doorOpen;
    const e = d * d * (3 - 2 * d); // 부드럽게 시작하고 부드럽게 끝나게
    const x = 0.7 + e * 1.4; // 닫힘 0.7 → 활짝 2.1 (벽 속으로 쏙 들어감)
    left.current.position.x = -x;
    right.current.position.x = x;
  });
  return (
    <>
      <group ref={left} position={[-0.7, 0, -2.0]}>
        <DoorPanel />
      </group>
      <group ref={right} position={[0.7, 0, -2.0]}>
        <DoorPanel />
      </group>
    </>
  );
}

// 문 위의 층 표시기
function FloorDisplay() {
  const board = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 128;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return { canvas, tex, key: "" };
  }, []);

  useFrame(() => {
    const floor = Math.floor(sim.altitude / FLOOR_KM + 1e-6);
    const moving = sim.speed > 0.01;
    const key = `${floor}-${moving}`;
    if (key === board.key) return; // 바뀔 때만 다시 그린다
    board.key = key;
    const g = board.canvas.getContext("2d");
    g.fillStyle = "#14110f";
    g.fillRect(0, 0, 256, 128);
    g.fillStyle = "#ff8a3d";
    g.font = "bold 84px sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(String(floor), 160, 70);
    if (moving) {
      g.beginPath();
      g.moveTo(56, 38);
      g.lineTo(86, 96);
      g.lineTo(26, 96);
      g.closePath();
      g.fill();
    }
    board.tex.needsUpdate = true;
  });

  return (
    <group position={[0, 2.75, -1.935]}>
      <mesh position={[0, 0, -0.005]}>
        <boxGeometry args={[0.78, 0.43, 0.02]} />
        <meshStandardMaterial color="#2a2623" />
      </mesh>
      <mesh position={[0, 0, 0.012]}>
        <planeGeometry args={[0.7, 0.35]} />
        <meshBasicMaterial map={board.tex} toneMapped={false} />
      </mesh>
    </group>
  );
}

function Seat({ seat }) {
  const s = seat.side;
  return (
    <group position={[0, 0, seat.z]}>
      <Box position={[s * 1.75, 0.23, 0]} args={[0.46, 0.46, 0.58]} color="#26262c" />
      <Box position={[s * 1.75, 0.5, 0]} args={[0.5, 0.08, 0.62]} color="#1b2f6b" />
      <Box position={[s * 1.96, 0.85, 0]} args={[0.08, 0.6, 0.62]} color="#1b2f6b" />
    </group>
  );
}

function BackWall() {
  const ref = useRef();
  useFrame(() => {
    ref.current.visible = !view.overview;
  });
  return (
    <group ref={ref}>
      <Box position={[0, 1.5, 2.05]} args={[4.2, 3, 0.1]} />
    </group>
  );
}

export default function Elevator() {
  return (
    <group>
      {/* 바닥, 천장 */}
      <Box position={[0, -0.05, 0]} args={[4.2, 0.1, 4.2]} color="#4a4a52" />
      <Box position={[0, 3.05, 0]} args={[4.2, 0.1, 4.2]} color="#c9c2b5" />
      <Box position={[0, 3.0, 0]} args={[1.8, 0.03, 1.8]} color="#fffbe8" />

      {/* 뒤쪽(카메라 뒤) 벽: 전체 보기에서는 숨긴다 */}
      <BackWall />

      {/* 왼쪽, 오른쪽 벽: 의자 위에 큰 창문(가로 2.8, 세로 1.3)을 낸다 */}
      {[-2.05, 2.05].map((x) => (
        <group key={x}>
          <Box position={[x, 0.575, 0]} args={[0.1, 1.15, 4.2]} />
          <Box position={[x, 2.725, 0]} args={[0.1, 0.55, 4.2]} />
          <Box position={[x, 1.8, -1.75]} args={[0.1, 1.3, 0.7]} />
          <Box position={[x, 1.8, 1.75]} args={[0.1, 1.3, 0.7]} />
        </group>
      ))}

      {/* 정면 벽: 문이 들어갈 큰 구멍(가로 2.8, 세로 2.5)을 남기고 막는다 */}
      <Box position={[-1.75, 1.5, -2]} args={[0.7, 3, 0.1]} />
      <Box position={[1.75, 1.5, -2]} args={[0.7, 3, 0.1]} />
      <Box position={[0, 2.75, -2]} args={[2.8, 0.5, 0.1]} />

      <Doors />
      <FloorDisplay />

      {/* 의자 6개 */}
      {SEATS.map((seat, i) => (
        <Seat key={i} seat={seat} />
      ))}

      {/* 천장 쪽 손잡이 봉 */}
      {[-1.93, 1.93].map((x) => (
        <mesh key={x} position={[x, 2.75, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.025, 0.025, 3.6, 12]} />
          <meshStandardMaterial color="#b8b8c0" metalness={0.7} roughness={0.3} />
        </mesh>
      ))}
    </group>
  );
}
