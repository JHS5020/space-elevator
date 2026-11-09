import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { sim, step } from "../sim.js";

// 매 프레임 시뮬레이션을 한 칸 진행시키고,
// 엘리베이터 안쪽 전체를 아주 살짝 흔들어서 달리는 느낌을 준다.
export default function Rig({ children }) {
  const ref = useRef();
  useFrame((_, dt) => {
    step(dt);
    ref.current.position.set(sim.shakeX, sim.shakeY, 0);
  });
  return <group ref={ref}>{children}</group>;
}
