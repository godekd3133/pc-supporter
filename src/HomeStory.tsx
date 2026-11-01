import { useEffect, useRef, useState } from "react";
import { FiArrowRight, FiCheck } from "react-icons/fi";
import type { PartCategory } from "../shared/types";
import { CATEGORY_ICONS } from "./category-icons";
import { prefersReducedMotion } from "./motion";
import "./home-story.css";

const STORY_PARTS: Array<{ category: PartCategory; label: string; name: string; priceWon: number }> = [
  { category: "cpu", label: "CPU", name: "라이젠5 9600X", priceWon: 289_000 },
  { category: "motherboard", label: "메인보드", name: "B650M 메인보드", priceWon: 159_000 },
  { category: "memory", label: "메모리", name: "DDR5 32GB (16GB x 2)", priceWon: 119_000 },
  { category: "gpu", label: "그래픽카드", name: "지포스 RTX 5070", priceWon: 829_000 },
  { category: "psu", label: "파워", name: "750W 80+ 골드", priceWon: 109_000 }
];

const STORY_CONDITIONS = ["게임", "QHD 144Hz", "예산 150만원"];

const STORY_STEPS = [
  { title: "용도와 예산을 정해요", description: "게임, 작업, 사무용 중에서 고르고 예산을 입력해요." },
  { title: "부품이 채워져요", description: "조건에 맞는 부품을 고르고 가격을 바로 더해요." },
  { title: "호환을 확인해요", description: "소켓, 전력, 크기까지 서로 맞는지 확인해요." }
];

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

function storyStateFor(progress: number) {
  const step = progress < 0.26 ? 0 : progress < 0.66 ? 1 : 2;
  const conditions = clamp(Math.floor((progress - 0.04) / 0.06) + 1, 0, STORY_CONDITIONS.length);
  const parts = clamp(Math.floor((progress - 0.28) / 0.07) + 1, 0, STORY_PARTS.length);
  const checked = clamp(Math.floor((progress - 0.66) / 0.035) + 1, 0, STORY_PARTS.length);
  return { step, conditions, parts, checked };
}

/** Eases the shown total toward the target so the sum counts up as parts land. */
function useCountUp(target: number) {
  const [value, setValue] = useState(target);
  const valueRef = useRef(target);
  useEffect(() => {
    if (prefersReducedMotion()) {
      valueRef.current = target;
      setValue(target);
      return;
    }
    const from = valueRef.current;
    const started = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = clamp((now - started) / 520);
      const eased = 1 - Math.pow(1 - t, 3);
      valueRef.current = Math.round(from + (target - from) * eased);
      setValue(valueRef.current);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return value;
}

export function HomeStory({ onStart }: { onStart: () => void }) {
  const sectionRef = useRef<HTMLElement>(null);
  const [reduced] = useState(prefersReducedMotion);
  const [progress, setProgress] = useState(reduced ? 1 : 0);

  useEffect(() => {
    if (reduced) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const section = sectionRef.current;
      if (!section) return;
      const rect = section.getBoundingClientRect();
      const travel = Math.max(1, section.offsetHeight - window.innerHeight);
      const next = clamp(-rect.top / travel);
      setProgress((current) => Math.abs(current - next) < 0.002 ? current : next);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(measure); };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [reduced]);

  const state = storyStateFor(progress);
  const total = useCountUp(STORY_PARTS.slice(0, state.parts).reduce((sum, part) => sum + part.priceWon, 0));
  const allChecked = state.checked === STORY_PARTS.length;

  return <section className={reduced ? "home-story static" : "home-story"} ref={sectionRef} aria-label="견적 만드는 과정" data-step={state.step} style={{ ["--story-progress" as string]: progress }}>
    <div className="home-story-stage">
      <div className="home-story-copy">
        <p className="home-story-kicker">이용 방법</p>
        <h2>세 단계로 견적을 완성해요</h2>
        <ol className="home-story-steps">
          {STORY_STEPS.map((item, index) => <li className={index === state.step ? "active" : index < state.step ? "done" : ""} key={item.title}><span className="home-story-step-number">{index + 1}</span><div><strong>{item.title}</strong><p>{item.description}</p></div></li>)}
        </ol>
        <button className={allChecked ? "button button-primary home-story-cta visible" : "button button-primary home-story-cta"} type="button" onClick={onStart} tabIndex={allChecked ? 0 : -1}>용도와 예산 정하기 <FiArrowRight aria-hidden="true" /></button>
      </div>
      <div className="home-story-quote" aria-hidden="true">
        <div className="home-story-quote-head"><strong>내 견적</strong><span>예시</span></div>
        <div className="home-story-conditions">{STORY_CONDITIONS.map((condition, index) => <span className={index < state.conditions ? "shown" : ""} key={condition}>{condition}</span>)}</div>
        <ul className="home-story-parts">
          {STORY_PARTS.map((part, index) => {
            const Icon = CATEGORY_ICONS[part.category];
            const shown = index < state.parts;
            const checked = index < state.checked;
            return <li className={`${shown ? "shown" : ""}${checked ? " checked" : ""}`} style={{ ["--i" as string]: index }} key={part.category}>
              <span className="home-story-part-icon"><Icon /></span>
              <span className="home-story-part-copy"><small>{part.label}</small><strong>{part.name}</strong></span>
              <span className="home-story-part-price">{part.priceWon.toLocaleString("ko-KR")}원</span>
              <span className="home-story-part-check"><FiCheck /></span>
            </li>;
          })}
        </ul>
        <div className="home-story-total"><span>합계</span><strong>{total.toLocaleString("ko-KR")}원</strong></div>
        <p className={allChecked ? "home-story-status shown" : "home-story-status"}><FiCheck /> 모든 부품이 호환돼요</p>
      </div>
    </div>
  </section>;
}
