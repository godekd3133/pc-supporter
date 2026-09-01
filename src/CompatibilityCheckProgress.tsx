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
    { title: "검사 준비 중", detail: "선택한 부품과 현재 카탈로그 기준을 확인합니다." },
    { title: "호환 규칙 계산 중", detail: "소켓·메모리·슬롯·전력·장착 공간을 함께 대조합니다." },
    { title: "대체 부품 비교 중", detail: "호환 가능한 후보의 성능 유사도와 가격 변화를 비교합니다." },
    { title: "추천 플랜 정리 중", detail: "후보 조합을 다시 검사해 남는 문제와 확인 필요 항목을 표시합니다." }
  ] as const;
  const current = phases[phase];
  return <div className="compatibility-check-progress" data-testid="compatibility-check-progress" role="status" aria-live="polite">
    <span className="compatibility-check-progress-icon"><FiLoader className="spin" /></span>
    <div><strong>{current.title}</strong><span>{current.detail}</span></div>
    <small>{Math.max(1, Math.ceil(elapsedMs / 1000))}초</small>
  </div>;
}
