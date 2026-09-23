import { useState } from "react";
import { FiCheck, FiCopy, FiEdit3, FiInfo, FiKey, FiLoader, FiSave, FiShield, FiXCircle } from "react-icons/fi";
import { api } from "./api";
import { useModalAccessibility } from "./use-modal-accessibility";
import { SAVED_BUILD_DECISION_NOTE_MAX_LENGTH, SAVED_BUILD_NAME_MAX_LENGTH } from "../shared/saved-build-decision-note";

export type SavedBuildExpiryDays = "never" | 7 | 30;
export type SavedBuildDialogTargetKind = "repair_plan" | "candidate" | "generated";

export function savedBuildIdFromOwnershipInput(input: string) {
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  const shareMatch = trimmed.match(/\/share\/([^/?#]+)/);
  if (shareMatch) {
    try {
      return decodeURIComponent(shareMatch[1]);
    } catch {
      return undefined;
    }
  }
  if (/^https?:\/\//.test(trimmed)) {
    try {
      const segments = new URL(trimmed).pathname.split("/").filter(Boolean);
      return segments.at(-1);
    } catch {
      return undefined;
    }
  }
  return trimmed;
}

export function SaveBuildDialog({ name, decisionNote, targetLabel, targetKind, saving, expiryDays, onChange, onDecisionNoteChange, onExpiryChange, onClose, onSubmit }: { name: string; decisionNote: string; targetLabel?: string; targetKind?: SavedBuildDialogTargetKind; saving: boolean; expiryDays: SavedBuildExpiryDays; onChange: (value: string) => void; onDecisionNoteChange: (value: string) => void; onExpiryChange: (value: SavedBuildExpiryDays) => void; onClose: () => void; onSubmit: () => void }) {
  useModalAccessibility({ onClose, closeOnEscape: !saving, selector: '[aria-labelledby="save-build-dialog-title"]' });
  const targetTitle = targetKind === "candidate" ? "비교 구성 새 견적으로 저장" : targetKind === "generated" ? "자동 구성 새 견적 저장" : "수리 플랜 새 견적 저장";
  const targetInfo = targetKind === "candidate" ? "현재 견적은 그대로 두고, 비교한 구성이 따로 저장돼요." : targetKind === "generated" ? "현재 견적은 유지되고, 자동 구성 결과가 별도 저장됩니다." : "현재 견적은 유지되고, 비교한 수리 플랜 구성이 별도 저장됩니다.";
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}><section className="save-build-dialog" role="dialog" aria-modal="true" aria-labelledby="save-build-dialog-title"><div className="modal-header"><div><h2 id="save-build-dialog-title">{targetLabel ? targetTitle : "견적 저장·공유"}</h2><p>{targetLabel ? `${targetLabel}을 현재 견적과 별도의 새 견적으로 저장합니다.` : "이름과 선택 이유를 남기고 공유 링크 유효기간을 정합니다."}</p></div><button className="icon-button" type="button" onClick={onClose} disabled={saving} aria-label="견적 저장 창 닫기"><FiXCircle /></button></div><form className="save-build-form" onSubmit={(event) => { event.preventDefault(); if (name.trim()) onSubmit(); }}><label htmlFor="save-build-name">견적 이름</label><input id="save-build-name" data-modal-autofocus maxLength={SAVED_BUILD_NAME_MAX_LENGTH} value={name} onChange={(event) => onChange(event.target.value)} placeholder="예: 4K 게이밍 PC" disabled={saving} /><label htmlFor="save-build-decision-note">선택 이유 <span>(선택)</span></label><textarea id="save-build-decision-note" maxLength={SAVED_BUILD_DECISION_NOTE_MAX_LENGTH} rows={3} value={decisionNote} onChange={(event) => onDecisionNoteChange(event.target.value)} placeholder="예: QHD 게이밍, 그래픽카드 교체 여유, 예산 우선" disabled={saving} /><small className="save-build-note-counter">{decisionNote.length}/{SAVED_BUILD_DECISION_NOTE_MAX_LENGTH} · 공유 링크에도 함께 표시됩니다.</small><label htmlFor="save-build-expiry">공유 링크 유효기간</label><select id="save-build-expiry" aria-label="견적 공유 링크 유효기간" value={expiryDays} onChange={(event) => onExpiryChange(event.target.value === "7" ? 7 : event.target.value === "30" ? 30 : "never")} disabled={saving}><option value="never">무기한</option><option value="7">7일</option><option value="30">30일</option></select><p><FiInfo /> {targetLabel ? targetInfo : "현재 부품, 주변 부품, 추천 기준과 저장 순간의 검사 요약이 함께 보존됩니다."} {decisionNote.trim() ? "선택 이유는 공유 견적과 이력에서 다시 확인할 수 있습니다." : "선택 이유를 남기면 나중에 견적을 고른 기준을 다시 확인할 수 있습니다."} 만료된 링크는 다시 열 수 없습니다.</p><div className="save-build-actions"><button className="button button-light" type="button" onClick={onClose} disabled={saving}>취소</button><button className="button button-primary" type="submit" disabled={saving || !name.trim()}>{saving ? <><FiLoader className="spin" /> 저장 중...</> : <><FiSave /> 저장하고 링크 복사</>}</button></div></form></section></div>;
}

export function EditSavedBuildMetadataDialog({ name, decisionNote, saving, onChange, onDecisionNoteChange, onClose, onSubmit }: { name: string; decisionNote: string; saving: boolean; onChange: (value: string) => void; onDecisionNoteChange: (value: string) => void; onClose: () => void; onSubmit: () => void }) {
  useModalAccessibility({ onClose, closeOnEscape: !saving, selector: '[aria-labelledby="edit-saved-build-dialog-title"]' });
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}><section className="save-build-dialog edit-saved-build-dialog" role="dialog" aria-modal="true" aria-labelledby="edit-saved-build-dialog-title" data-testid="edit-saved-build-dialog"><div className="modal-header"><div><h2 id="edit-saved-build-dialog-title">저장 견적 설명 수정</h2><p>부품 구성과 저장 당시 검사 기록은 유지하고, 이름과 선택 이유만 수정합니다.</p></div><button className="icon-button" type="button" onClick={onClose} disabled={saving} aria-label="저장 견적 설명 수정 창 닫기"><FiXCircle /></button></div><form className="save-build-form" onSubmit={(event) => { event.preventDefault(); if (name.trim()) onSubmit(); }}><label htmlFor="edit-saved-build-name">견적 이름</label><input id="edit-saved-build-name" data-modal-autofocus maxLength={SAVED_BUILD_NAME_MAX_LENGTH} value={name} onChange={(event) => onChange(event.target.value)} placeholder="예: QHD 게이밍 PC" disabled={saving} /><label htmlFor="edit-saved-build-decision-note">선택 이유 <span>(선택)</span></label><textarea id="edit-saved-build-decision-note" maxLength={SAVED_BUILD_DECISION_NOTE_MAX_LENGTH} rows={4} value={decisionNote} onChange={(event) => onDecisionNoteChange(event.target.value)} placeholder="예: 소음과 업그레이드 여유를 우선" disabled={saving} /><small className="save-build-note-counter">{decisionNote.length}/{SAVED_BUILD_DECISION_NOTE_MAX_LENGTH} · 공유 결과에도 함께 표시됩니다.</small><p><FiInfo /> 선택 이유를 비우면 기존 메모를 삭제합니다. 저장된 부품 구성·검사 기록·구매 기록은 변경하지 않습니다.</p><div className="save-build-actions"><button className="button button-light" type="button" onClick={onClose} disabled={saving}>취소</button><button className="button button-primary" type="submit" disabled={saving || !name.trim()}>{saving ? <><FiLoader className="spin" /> 저장 중...</> : <><FiEdit3 /> 변경사항 저장</>}</button></div></form></section></div>;
}

export function RecoveryCodeDialog({ code, buildName, onClose }: { code: string; buildName: string; onClose: () => void }) {
  useModalAccessibility({ onClose, selector: '[aria-labelledby="recovery-code-dialog-title"]' });
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="save-build-dialog recovery-code-dialog" role="dialog" aria-modal="true" aria-labelledby="recovery-code-dialog-title" data-testid="recovery-code-dialog"><div className="modal-header"><div><h2 id="recovery-code-dialog-title">견적 소유권 복구 코드</h2><p>{buildName} · 이 코드는 지금만 표시됩니다.</p></div><button className="icon-button" type="button" onClick={onClose} aria-label="복구 코드 창 닫기"><FiXCircle /></button></div><div className="recovery-code-body"><code className="recovery-code-value" data-testid="recovery-code-value">{code}</code><button className="button button-light" type="button" onClick={() => { void navigator.clipboard.writeText(code).then(() => setCopyState("copied")).catch(() => setCopyState("failed")); }}>{copyState === "copied" ? <><FiCheck /> 복사됨</> : <><FiCopy /> 코드 복사</>}</button>{copyState === "failed" && <p className="recovery-code-copy-failed" role="alert">복사에 실패했습니다. 코드를 직접 선택해 복사해 주세요.</p>}<p><FiShield /> 다른 기기나 브라우저에서 이 견적을 관리하려면 이 코드로 소유권을 확인하세요. 코드는 다시 볼 수 없으니 지금 안전한 곳에 보관해 주세요. 새 코드를 발급하면 이전 코드는 사용할 수 없습니다.</p></div><div className="save-build-actions"><button className="button button-primary" type="button" onClick={onClose}>확인했습니다</button></div></section></div>;
}

export function RecoverOwnershipDialog({ target, onClose, onToast, onRecovered }: { target: { id: string; name?: string } | null; onClose: () => void; onToast: (message: string) => void; onRecovered: (id: string, ownerToken: string, recoveryCode?: string) => void }) {
  const [input, setInput] = useState(target?.id ?? "");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  useModalAccessibility({ onClose, closeOnEscape: !busy, selector: '[aria-labelledby="recover-ownership-dialog-title"]' });
  async function submit() {
    const id = savedBuildIdFromOwnershipInput(input);
    if (!id) {
      onToast("견적 링크나 견적 ID를 확인해 주세요.");
      return;
    }
    if (!code.trim()) {
      onToast("복구 코드를 입력해 주세요.");
      return;
    }
    setBusy(true);
    try {
      const result = await api<{ ownerToken: string; recoveryCode?: string }>(`/api/builds/${encodeURIComponent(id)}/recover`, { method: "POST", body: JSON.stringify({ recoveryCode: code }), retry: 0 });
      onRecovered(id, result.ownerToken, result.recoveryCode);
      onClose();
    } catch (error: unknown) {
      onToast(error instanceof Error ? error.message : "복구 코드로 소유권을 되찾지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}><section className="save-build-dialog recover-ownership-dialog" role="dialog" aria-modal="true" aria-labelledby="recover-ownership-dialog-title" data-testid="recover-ownership-dialog"><div className="modal-header"><div><h2 id="recover-ownership-dialog-title">견적 소유권 되찾기</h2><p>{target?.name ? `${target.name} · ` : ""}저장할 때 받은 복구 코드로 이 브라우저에서 견적을 관리할 수 있습니다.</p></div><button className="icon-button" type="button" onClick={onClose} disabled={busy} aria-label="소유권 되찾기 창 닫기"><FiXCircle /></button></div><form className="save-build-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}><label htmlFor="recover-ownership-input">견적 링크 또는 견적 ID</label><input id="recover-ownership-input" data-modal-autofocus value={input} onChange={(event) => setInput(event.target.value)} placeholder="예: /share/build-… 또는 견적 ID" disabled={busy || Boolean(target?.id)} /><label htmlFor="recover-ownership-code">복구 코드</label><input id="recover-ownership-code" value={code} onChange={(event) => setCode(event.target.value)} placeholder="예: XXXX-XXXX-XXXX" autoCapitalize="characters" autoComplete="off" disabled={busy} /><p><FiInfo /> 코드가 맞으면 이 브라우저에서 견적을 관리할 수 있고, 다른 기기의 접근은 종료됩니다. 사용한 코드는 폐기되고 새 복구 코드가 표시됩니다.</p><div className="save-build-actions"><button className="button button-light" type="button" onClick={onClose} disabled={busy}>취소</button><button className="button button-primary" type="submit" disabled={busy || !input.trim() || !code.trim()}>{busy ? <><FiLoader className="spin" /> 확인 중...</> : <><FiKey /> 소유권 되찾기</>}</button></div></form></section></div>;
}
