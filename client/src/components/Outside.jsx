import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Stars } from "@react-three/drei";
import * as THREE from "three";
import { sim } from "../sim.js";

const SKY = new THREE.Color("#8fd0ff");
const SPACE = new THREE.Color("#02030a");
const GROUND = new THREE.Color("#4a8f3a");
const OCEAN = new THREE.Color("#2f6fb0");
const tmp = new THREE.Color();

// 창밖 풍경: 고도(sim.altitude)에 따라 하늘색, 구름, 별, 지구가 바뀐다
export default function Outside() {
  const { scene } = useThree();
  const cloudsRef = useRef();
  const starsRef = useRef();
  const earthRef = useRef();

  const clouds = useMemo(
    () =>
      Array.from({ length: 24 }, () => ({
        x: (Math.random() - 0.5) * 60,
        y: Math.random() * 24,
        z: -13 - Math.random() * 40, // 로비 벽(-11)보다 멀리
        s: 1.5 + Math.random() * 3,
      })),
    []
  );

  useFrame(() => {
    const alt = sim.altitude;

    if (!scene.background) scene.background = new THREE.Color();
    tmp.copy(SKY).lerp(SPACE, Math.min(alt / 80, 1));
    scene.background.copy(tmp);

    cloudsRef.current.visible = alt < 70;
    cloudsRef.current.children.forEach((mesh, i) => {
      const y = clouds[i].y - alt * 3;
      mesh.position.y = ((((y + 12) % 24) + 24) % 24) - 12;
    });

    starsRef.current.visible = alt > 50;

    earthRef.current.position.y = -152.8 - alt * 0.03;
    earthRef.current.material.color.copy(GROUND).lerp(OCEAN, Math.min(alt / 60, 1));
  });

  return (
    <>
      <group ref={cloudsRef}>
        {clouds.map((c, i) => (
          <mesh key={i} position={[c.x, c.y, c.z]} scale={[c.s * 1.6, c.s * 0.6, c.s]}>
            <sphereGeometry args={[1, 12, 12]} />
            <meshBasicMaterial color="white" transparent opacity={0.9} />
          </mesh>
        ))}
      </group>

      <group ref={starsRef}>
        <Stars radius={100} depth={50} count={3000} factor={4} fade speed={1} />
      </group>

      <mesh ref={earthRef} position={[0, -152.8, -80]}>
        <sphereGeometry args={[150, 48, 48]} />
        <meshBasicMaterial color="#4a8f3a" />
      </mesh>
    </>
  );
}
