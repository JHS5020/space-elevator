import { useRef, useSyncExternalStore } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import Character from "./Character.jsx";
import { LOOKS } from "../looks.js";
import { sim, subscribe, getRev } from "../sim.js";
import { net, subscribeNet, getNetRev } from "../net.js";
import { ctl, subscribeCtl, getCtlRev } from "../controls.js";

function Passenger({ person, bubble, fp }) {
  person.mine = person.id === net.youId;
  const ref = useRef();
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    g.position.set(person.x, 0, person.z);
    g.rotation.y = person.yaw;
  });
  return (
    <group ref={ref}>
      <Character look={LOOKS[person.look]} state={person} hideHead={fp} />
      {!fp && (
        <Html position={[0, 1.95, 0]} center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
          <div className="tag">
            {bubble && <div className="bubble">{bubble.text}</div>}
            {person.mine && <div className="me-badge">me</div>}
            <div className={person.mine ? "nm me" : "nm"}>{person.name}</div>
          </div>
        </Html>
      )}
    </group>
  );
}

export default function People() {
  useSyncExternalStore(subscribe, getRev);
  useSyncExternalStore(subscribeNet, getNetRev);
  useSyncExternalStore(subscribeCtl, getCtlRev);
  return (
    <>
      {sim.people.map((p) => (
        <Passenger key={p.id} person={p} bubble={net.bubbles[p.id]} fp={ctl.mode === "fp" && p.id === net.youId} />
      ))}
    </>
  );
}
