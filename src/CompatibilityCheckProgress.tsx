import { useEffect, useState } from "react";
import { FiLoader } from "react-icons/fi";

export function CompatibilityCheckProgress() {
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    const startedAt = Date.now();
    const update = () => setElapsedMs(Date.now() - startedAt);
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, []);
  const phase = elapsedMs < 700 ? 0 : elapsedMs < 1800 ? 1 : elapsedMs < 3200 ? 2 : 3;
  const phases = [
    { title: "부품 정보 불러오는 중", detail: "선택한 부품의 가격과 사양을 모으고 있어요." },
    { title: "호환 여부 계산 중", detail: "소켓·메모리·슬롯·전력·크기를 비교해요." },
    { title: "대체 부품 살펴보는 중", detail: "함께 쓸 수 있는 부품의 성능과 가격을 비교해요." },
    { title: "추천 조합 준비 중", detail: "호환 문제와 바꿔 볼 부품을 정리하고 있어요." }
  ] as const;
  const current = phases[phase];
  return <div className="compatibility-check-progress" data-testid="compatibility-check-progress" role="status" aria-live="polite">
    <span className="compatibility-check-progress-icon"><FiLoader className="spin" /></span>
    <div><strong>{current.title}</strong><span>{current.detail}</span></div>
    <small>{Math.max(1, Math.ceil(elapsedMs / 1000))}초</small>
  </div>;
}
