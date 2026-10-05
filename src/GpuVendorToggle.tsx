import { useId, useState } from "react";
import type { GpuVendorPreference } from "../shared/types";
import "./gpu-vendor-toggle.css";

export const AMD_VENDOR_HELP = "AMD는 가성비가 좋지만, 드라이버 안정성과 레이 트레이싱, AI 범용성이 떨어집니다. 콘솔게임 위주로 플레이하는 경우 선택해주세요.";

export function GpuVendorToggle({ value, onChange, disabled = false }: { value: GpuVendorPreference; onChange: (value: GpuVendorPreference) => void; disabled?: boolean }) {
  const id = useId();
  const [helpOpen, setHelpOpen] = useState(false);
  return <section className="gpu-vendor-choice" aria-label="그래픽카드 제조사 선택">
    <div className="gpu-vendor-heading"><strong>그래픽카드</strong><span className="gpu-vendor-help" onMouseEnter={() => setHelpOpen(true)} onMouseLeave={() => setHelpOpen(false)}>
      <button type="button" className="gpu-vendor-help-button" aria-label="NVIDIA와 AMD 선택 설명" aria-expanded={helpOpen} aria-describedby={helpOpen ? id : undefined} onFocus={(event) => { if (event.currentTarget.matches(":focus-visible")) setHelpOpen(true); }} onBlur={() => setHelpOpen(false)} onClick={() => setHelpOpen(true)} onKeyDown={(event) => { if (event.key === "Escape") setHelpOpen(false); }}>?</button>
      <span id={id} className="gpu-vendor-tooltip" role="tooltip" hidden={!helpOpen}>{AMD_VENDOR_HELP}</span>
    </span></div>
    <div className="gpu-vendor-toggle" role="radiogroup" aria-label="그래픽카드 제조사">
      {(["nvidia", "amd"] as const).map((vendor) => <button key={vendor} type="button" role="radio" aria-checked={value === vendor} tabIndex={value === vendor ? 0 : -1} onKeyDown={(event) => { if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) { event.preventDefault(); const next = vendor === "nvidia" ? "amd" : "nvidia"; onChange(next); event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-testid="gpu-vendor-${next}"]`)?.focus(); } }} disabled={disabled} className={value === vendor ? "selected" : ""} data-testid={`gpu-vendor-${vendor}`} onClick={() => onChange(vendor)}>{vendor === "nvidia" ? "NVIDIA" : "AMD"}</button>)}
    </div>
  </section>;
}
