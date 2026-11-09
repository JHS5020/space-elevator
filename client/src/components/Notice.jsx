import { backToStart } from "../net.js";

const TEXT = {
  expired: ["만료되었거나 없는 엘리베이터예요", "모두 내리고 5분이 지나면 엘리베이터는 사라져요."],
  full: ["엘리베이터가 가득 찼어요", "정원 10명이 모두 탔어요."],
  error: ["서버에 연결할 수 없어요", "서버가 켜져 있는지 확인하고 다시 시도해주세요."],
};

export default function Notice({ kind }) {
  const [title, sub] = TEXT[kind] || TEXT.error;
  return (
    <div className="notice">
      <h2>{title}</h2>
      <p>{sub}</p>
      <button className="go" onClick={backToStart}>새 엘리베이터 만들기</button>
    </div>
  );
}
