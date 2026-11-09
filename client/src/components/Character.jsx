import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { MathUtils } from "three";
import { STAND_Y_HIPS, SEAT_Y_HIPS } from "../config.js";

const damp = MathUtils.damp;

function Cap({ r, len, color, position = [0, 0, 0], scale = [1, 1, 1] }) {
  return (
    <mesh position={position} scale={scale}>
      <capsuleGeometry args={[r, len, 6, 12]} />
      <meshStandardMaterial color={color} roughness={0.9} />
    </mesh>
  );
}

function Ball({ r, color, position = [0, 0, 0], scale = [1, 1, 1] }) {
  return (
    <mesh position={position} scale={scale}>
      <sphereGeometry args={[r, 18, 18]} />
      <meshStandardMaterial color={color} roughness={0.9} />
    </mesh>
  );
}

function Hair({ style, color }) {
  return (
    <group>
      <Ball r={0.185} color={color} position={[0, 0.035, -0.03]} />
      {style === "bun" && <Ball r={0.08} color={color} position={[0, 0.21, -0.05]} />}
      {style === "long" && (
        <mesh position={[0, -0.2, -0.1]}>
          <boxGeometry args={[0.36, 0.5, 0.14]} />
          <meshStandardMaterial color={color} roughness={0.9} />
        </mesh>
      )}
      {style === "bob" && (
        <mesh position={[0, -0.07, -0.09]}>
          <boxGeometry args={[0.37, 0.22, 0.15]} />
          <meshStandardMaterial color={color} roughness={0.9} />
        </mesh>
      )}
    </group>
  );
}

// state = { mode: "stand" | "walk" | "sit", emote: "none" | "wave" | "yawn" | "stretch" | "nod" | "look", emoteT }
// 이 값은 sim.js의 사람 데이터가 계속 바꿔주고, 여기서는 읽어서 관절만 움직여요.
export default function Character({ look, state }) {
  const joints = useRef({});
  const clock = useRef(Math.random() * 100);
  const ref = (name) => (el) => {
    if (el) joints.current[name] = el;
  };

  useFrame((_, dt) => {
    const J = joints.current;
    if (!J.hips) return;
    clock.current += dt;
    const t = clock.current;
    const et = state.emoteT || 0;

    // 기본 자세(서 있기)
    let hipsY = STAND_Y_HIPS, bob = 0;
    let thL = 0, thR = 0, knL = 0, knR = 0;
    let shLx = 0, shRx = 0, shLz = 0.06, shRz = -0.06, elL = -0.1, elR = -0.1;
    let torsoX = Math.sin(t * 1.6) * 0.012, headX = 0, headY = 0, mouth = 0.3;

    if (state.mode === "walk") {
      const p = t * 8;
      thL = Math.sin(p) * 0.6;
      thR = -thL;
      knL = Math.max(0, Math.cos(p)) * 0.6;
      knR = Math.max(0, -Math.cos(p)) * 0.6;
      shLx = -thL * 0.8;
      shRx = -thR * 0.8;
      elL = elR = -0.25;
      bob = Math.abs(Math.sin(p)) * 0.03;
    } else if (state.mode === "sit") {
      hipsY = SEAT_Y_HIPS;
      thL = thR = -1.5;
      knL = knR = 1.5;
      shLx = shRx = -0.35;
      shLz = 0.1;
      shRz = -0.1;
      elL = elR = -1.1;

      switch (state.emote) {
        case "wave": // 손 흔들기
          shRx = 0;
          shRz = -2.5 + Math.sin(et * 9) * 0.25;
          elR = -0.3;
          break;
        case "yawn": // 하품
          shRx = -1.4;
          shRz = -0.15;
          elR = -1.8;
          mouth = 1.4;
          headX = -0.3;
          break;
        case "stretch": // 기지개
          shLx = shRx = 0;
          shLz = 2.9;
          shRz = -2.9;
          elL = elR = -0.1;
          torsoX = -0.1;
          headX = -0.25;
          break;
        case "nod": // 끄덕끄덕
          headX = 0.05 + Math.sin(et * 6) * 0.22;
          break;
        case "look": // 두리번
          headY = Math.sin(et * 1.6) * 0.8;
          break;
        default:
          break;
      }
    }

    const ap = (o, k, v, lam = 9) => {
      o.rotation[k] = damp(o.rotation[k], v, lam, dt);
    };
    J.hips.position.y = damp(J.hips.position.y, hipsY + bob, 8, dt);
    ap(J.thL, "x", thL);
    ap(J.thR, "x", thR);
    ap(J.knL, "x", knL);
    ap(J.knR, "x", knR);
    ap(J.shL, "x", shLx);
    ap(J.shL, "z", shLz);
    ap(J.shR, "x", shRx);
    ap(J.shR, "z", shRz);
    ap(J.elL, "x", elL);
    ap(J.elR, "x", elR);
    ap(J.torso, "x", torsoX);
    ap(J.head, "x", headX);
    ap(J.head, "y", headY);
    J.mouth.scale.y = damp(J.mouth.scale.y, mouth, 12, dt);
  });

  return (
    <group>
      <group ref={ref("hips")} position={[0, STAND_Y_HIPS, 0]}>
        {/* 다리 */}
        {[["thL", "knL", 0.1], ["thR", "knR", -0.1]].map(([th, kn, x]) => (
          <group key={th} ref={ref(th)} position={[x, 0, 0]}>
            <Cap r={0.085} len={0.3} color={look.bottom} position={[0, -0.23, 0]} />
            <group ref={ref(kn)} position={[0, -0.46, 0]}>
              <Cap r={0.075} len={0.3} color={look.bottom} position={[0, -0.23, 0]} />
              <mesh position={[0, -0.47, 0.06]}>
                <boxGeometry args={[0.13, 0.07, 0.26]} />
                <meshStandardMaterial color="#1c1614" roughness={0.9} />
              </mesh>
            </group>
          </group>
        ))}

        {/* 몸통 + 팔 + 머리 */}
        <group ref={ref("torso")}>
          <Cap r={0.18} len={0.2} color={look.top} position={[0, 0.26, 0]} scale={[1, 1, 0.75]} />
          <mesh position={[0, 0.56, 0]}>
            <cylinderGeometry args={[0.05, 0.06, 0.1, 10]} />
            <meshStandardMaterial color={look.skin} roughness={0.9} />
          </mesh>

          {[["shL", "elL", 1], ["shR", "elR", -1]].map(([sh, el, s]) => (
            <group key={sh} ref={ref(sh)} position={[0.24 * s, 0.46, 0]}>
              <Cap r={0.065} len={0.2} color={look.top} position={[0, -0.17, 0]} />
              <group ref={ref(el)} position={[0, -0.33, 0]}>
                <Cap r={0.058} len={0.18} color={look.top} position={[0, -0.16, 0]} />
                <Ball r={0.065} color={look.skin} position={[0, -0.33, 0]} />
              </group>
            </group>
          ))}

          <group ref={ref("head")} position={[0, 0.78, 0]}>
            <Ball r={0.17} color={look.skin} />
            <Ball r={0.035} color={look.skin} position={[0.168, 0, 0]} />
            <Ball r={0.035} color={look.skin} position={[-0.168, 0, 0]} />
            <Ball r={0.018} color="#120d0b" position={[0.06, 0.02, 0.155]} />
            <Ball r={0.018} color="#120d0b" position={[-0.06, 0.02, 0.155]} />
            <Ball r={0.025} color={look.skin} position={[0, -0.025, 0.168]} />
            <mesh ref={ref("mouth")} position={[0, -0.08, 0.15]} scale={[1.2, 0.3, 0.5]}>
              <sphereGeometry args={[0.03, 12, 12]} />
              <meshStandardMaterial color="#5a2a2a" roughness={0.9} />
            </mesh>
            <Hair style={look.style} color={look.hair} />
          </group>
        </group>
      </group>
    </group>
  );
}
