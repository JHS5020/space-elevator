import { useRef, useSyncExternalStore } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import Character from "./Character.jsx";
import { LOOKS } from "../looks.js";
import { sim, subscribe, getRev } from "../sim.js";
import { net, subscribeNet, getNetRev } from "../net.js";

function Passenger({ person, bubble }) {
  const ref = useRef();
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    g.position.set(person.x, 0, person.z);
    g.rotation.y = person.yaw;
  });
  return (
    <group ref={ref}>
      <Character look={LOOKS[person.look]} state={person} />
      {bubble && (
        <Html position={[0, 2.05, 0]} center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
          <div className="bubble">{bubble.text}</div>
        </Html>
      )}
    </group>
  );
}

export default function People() {
  useSyncExternalStore(subscribe, getRev);
  useSyncExternalStore(subscribeNet, getNetRev);
  return (
    <>
      {sim.people.map((p) => (
        <Passenger key={p.id} person={p} bubble={net.bubbles[p.id]} />
      ))}
    </>
  );
}
