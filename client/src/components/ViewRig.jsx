import { useLayoutEffect } from "react";
import { useThree } from "@react-three/fiber";
import { MathUtils } from "three";
import { view } from "../view.js";

// 화면 비율(세로로 긴 핸드폰 등)에 맞춰 "전체 보기" 카메라를 정한다.
//  - 전체 보기: 엘리베이터 뒤쪽으로 물러나서 양쪽 의자 10개가 한 번에 보이게 한다
//  - 안에서 보기/1인칭: CameraRig 가 매 프레임 카메라를 움직인다 (여기서는 손대지 않음)
export default function ViewRig({ overview }) {
  const camera = useThree((s) => s.camera);
  const aspect = useThree((s) => s.size.width / s.size.height);

  useLayoutEffect(() => {
    view.overview = overview;
    if (!overview) return;
    const tanHalfH = Math.tan(MathUtils.degToRad(30)) * aspect; // 가로 시야의 절반 각도
    const z = MathUtils.clamp(1.4 + 2.3 / tanHalfH, 3.4, 11); // 양쪽 벽이 다 들어오는 거리
    camera.fov = 60;
    camera.position.set(0, 2.3, z);
    camera.lookAt(0, 1.0, 0);
    camera.updateProjectionMatrix();
  }, [overview, aspect, camera]);

  return null;
}
