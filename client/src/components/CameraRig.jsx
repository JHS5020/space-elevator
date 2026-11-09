import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { MathUtils } from "three";
import { sim, local } from "../sim.js";
import { net, sendMove } from "../net.js";
import { view } from "../view.js";
import { ctl, axes, moveVec, updateViewCam, installInput, setMode } from "../controls.js";
import { EYE_STAND, EYE_SIT } from "../config.js";

const r2 = (n) => Math.round(n * 100) / 100;

// 매 프레임 카메라를 정한다.
//  - 평소 시점: 키보드/버튼으로 엘리베이터 안을 날아다니는 카메라
//  - 1인칭: 내 캐릭터의 눈. 서 있으면 걷고, 앉아 있으면 고개만 돌린다
//  - 전체 보기(overview)는 ViewRig 가 정한 자리 그대로 둔다
export default function CameraRig({ overview }) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const last = useRef({ mx: 0, mz: 0, yaw: 0, t: 0 });

  useEffect(() => {
    camera.rotation.order = "YXZ";
    camera.near = 0.05;
    camera.updateProjectionMatrix();
    return installInput(gl.domElement, () => view.overview);
  }, [camera, gl]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    local.fp = false;
    local.mx = 0;
    local.mz = 0;

    if (overview) {
      if (ctl.mode === "fp") setMode("view");
      return;
    }

    const L = last.current;
    const me = sim.people.find((p) => p.id === net.youId);
    const fov = ctl.mode === "fp" ? 75 : 70;
    if (camera.fov !== fov) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }

    if (ctl.mode === "fp" && me) {
      const { F, S } = axes();
      const free = me.status === "free";
      local.fp = true;
      if (free) {
        const m = moveVec(F, S, ctl.yaw);
        local.mx = m.x;
        local.mz = m.z;
      }
      ctl.eyeY = MathUtils.damp(ctl.eyeY, me.mode === "sit" ? EYE_SIT : EYE_STAND, 6, dt);
      camera.position.set(me.x - Math.sin(ctl.yaw) * 0.1, ctl.eyeY, me.z - Math.cos(ctl.yaw) * 0.1);
      camera.rotation.set(ctl.pitch, ctl.yaw, 0);

      // 서버에 걷는 방향과 바라보는 방향 알리기 (바뀔 때, 그리고 걷는 동안 0.3초마다)
      if (free) {
        const m = Math.hypot(local.mx, local.mz) > 1 ? 1 / Math.hypot(local.mx, local.mz) : 1;
        const mx = r2(local.mx * m);
        const mz = r2(local.mz * m);
        const yaw = r2(Math.atan2(Math.sin(ctl.yaw + Math.PI), Math.cos(ctl.yaw + Math.PI)));
        const now = performance.now();
        const moving = mx !== 0 || mz !== 0;
        const changed = mx !== L.mx || mz !== L.mz || Math.abs(yaw - L.yaw) > 0.04;
        if ((changed && now - L.t > 50) || (moving && now - L.t > 300)) {
          sendMove(mx, mz, yaw);
          L.mx = mx;
          L.mz = mz;
          L.yaw = yaw;
          L.t = now;
        }
        return;
      }
    } else {
      updateViewCam(dt);
      camera.position.set(ctl.cam.x, ctl.cam.y, ctl.cam.z);
      camera.rotation.set(ctl.pitch, ctl.yaw, 0);
    }

    // 걷지 않게 됐다면(시점 변경, 앉음 등) 멈췄다고 한 번 알려준다
    if (L.mx !== 0 || L.mz !== 0) {
      sendMove(0, 0, L.yaw);
      L.mx = 0;
      L.mz = 0;
    }
  });

  return null;
}
