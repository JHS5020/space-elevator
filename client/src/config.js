// ===== 엘리베이터 설정값 모음 (숫자만 바꾸면 느낌이 바뀌어요) =====

export const CRUISE = 0.8; // 순항 속도 (km/초)
export const FLOOR_KM = 4; // 한 층의 높이 (km)
export const ACCEL_TIME = 4; // 출발해서 순항 속도가 되기까지 (초)
export const BRAKE_TIME = 4; // 감속을 시작해서 멈추기까지 (초)
export const DOOR_TIME = 1.6; // 문이 완전히 열리거나 닫히는 데 걸리는 시간 (초)
export const BRAKE_DIST = 0.5 * CRUISE * BRAKE_TIME; // 감속하는 동안 이동하는 거리 (km)

export const UNITS_PER_KM = 3; // 3D 화면에서 1km를 얼마나 움직여 보이게 할지

// 사람 이동 관련
export const WALK_SPEED = 1.3; // 걷는 속도
export const OUT_Z = -3.4; // 문 밖(층)에서 기다리는 위치
export const STAND_X = 1.1; // 의자 앞에 서는 위치 (벽에서 떨어진 거리)
export const SEAT_X = 1.78; // 앉았을 때 위치
export const STAND_Y_HIPS = 0.95; // 서 있을 때 엉덩이 높이
export const SEAT_Y_HIPS = 0.58; // 앉았을 때 엉덩이 높이

// 자리 10개: 양쪽 벽에 5개씩 (side -1 = 왼쪽 벽, 1 = 오른쪽 벽, z = 문 쪽(-)에서 안쪽(+)으로)
// 서버(server/config.js)와 같아야 해요.
const Z = [-1.35, -0.7, -0.05, 0.6, 1.25];
export const SEATS = Z.flatMap((z) => [
  { side: -1, z },
  { side: 1, z },
]);
