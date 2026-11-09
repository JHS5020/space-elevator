import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { sim } from "../sim.js";
import { FLOOR_KM, UNITS_PER_KM } from "../config.js";

function Box({ position, args, color, emissive }) {
  return (
    <mesh position={position}>
      <boxGeometry args={args} />
      <meshStandardMaterial color={color} emissive={emissive || "#000000"} roughness={0.9} />
    </mesh>
  );
}

// 문 밖의 "층"(로비). 엘리베이터가 멈출 층이 가까워지면 위에서 내려오고,
// 출발하면 아래로 멀어진다. (실제로는 엘리베이터가 올라가는 것)
export default function Landing() {
  const group = useRef();
  const light = useRef();
  const sign = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 256;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return { canvas, tex, key: -1 };
  }, []);

  useFrame(() => {
    const off = sim.altitude - sim.landingAlt; // 층보다 얼마나 올라왔나 (km)
    const show = Math.abs(off) < 3.6;
    group.current.visible = show;
    group.current.position.y = -off * UNITS_PER_KM;
    light.current.intensity = show ? 14 : 0; // 조명 개수는 그대로 두고 밝기만 0으로
    if (!show) return;

    const floor = Math.round(sim.landingAlt / FLOOR_KM);
    if (floor !== sign.key) {
      sign.key = floor;
      const g = sign.canvas.getContext("2d");
      g.fillStyle = "#1c1a18";
      g.fillRect(0, 0, 512, 256);
      g.fillStyle = "#f2b266";
      g.font = "bold 150px sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(`${floor}F`, 256, 135);
      sign.tex.needsUpdate = true;
    }
  });

  return (
    <group ref={group}>
      <pointLight ref={light} position={[0, 3, -6.5]} intensity={14} />
      {/* 바닥, 천장, 벽 */}
      <Box position={[0, -0.26, -6.5]} args={[11, 0.5, 9]} color="#5b554d" />
      <Box position={[0, 3.6, -6.5]} args={[11, 0.3, 9]} color="#2b2723" />
      <Box position={[0, 2.1, -11.2]} args={[11, 4.2, 0.4]} color="#3a342e" />
      <Box position={[-5.5, 2.1, -6.5]} args={[0.4, 4.2, 9]} color="#3a342e" />
      <Box position={[5.5, 2.1, -6.5]} args={[0.4, 4.2, 9]} color="#3a342e" />
      {/* 기둥, 천장 조명 */}
      <Box position={[-2.6, 1.8, -8]} args={[0.5, 3.6, 0.5]} color="#4a433b" />
      <Box position={[2.6, 1.8, -8]} args={[0.5, 3.6, 0.5]} color="#4a433b" />
      <Box position={[0, 3.42, -6.5]} args={[3, 0.05, 1]} color="#fff3d6" emissive="#fff3d6" />
      {/* 층 표지판 */}
      <mesh position={[0, 2.2, -10.95]}>
        <planeGeometry args={[2.4, 1.2]} />
        <meshBasicMaterial map={sign.tex} toneMapped={false} />
      </mesh>
    </group>
  );
}
