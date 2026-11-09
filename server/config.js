// ===== 서버 설정값 =====
// 엘리베이터 움직임 값은 client/src/config.js 와 같아야 해요.
export const CRUISE = 0.8; // 순항 속도 (km/초)
export const FLOOR_KM = 4; // 한 층의 높이 (km)
export const ACCEL_TIME = 4;
export const BRAKE_TIME = 4;
export const DOOR_TIME = 1.6;
export const BRAKE_DIST = 0.5 * CRUISE * BRAKE_TIME;

export const WALK_SPEED = 1.3;
export const OUT_Z = -3.4;
export const STAND_X = 1.1;
export const SEAT_X = 1.78;

// 자리 10개: 양쪽 벽에 5개씩 (side -1 왼쪽, 1 오른쪽)
const Z = [-1.35, -0.7, -0.05, 0.6, 1.25];
export const SEATS = Z.flatMap((z) => [
  { side: -1, z },
  { side: 1, z },
]);

export const LOOK_COUNT = 8; // client/src/looks.js 개수와 같게
export const BOARD_INTERVAL = Number(process.env.BOARD_INTERVAL) || 30; // 기다리는 사람을 태우러 가는 주기(초)
export const ROOM_TTL = Number(process.env.ROOM_TTL) || 300; // 빈 방 삭제까지(초)
export const MAX_ROOMS = 200;
export const CHAT_MAX = 120;
