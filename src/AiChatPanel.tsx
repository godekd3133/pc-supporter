// AI 견적 상담 — 견적 화면 오른쪽 아래의 대화 창. 현재 견적을 함께 보내 질문과 수정 상담을 받는다.
import { useEffect, useRef, useState } from "react";
import { FiMessageCircle, FiSend, FiX, FiLoader } from "react-icons/fi";
import "./ai-chat.css";
import { api } from "./api";
import type { BuildSelection } from "../shared/types";

type ChatTurn = { role: "user" | "assistant"; content: string };
const MAX_TURNS = 20;
const SUGGESTIONS = ["이 견적으로 배그 잘 돌아가나요?", "20만원 더 쓰면 뭘 바꾸는 게 좋을까요?", "SSD 용량을 늘리고 싶어요"];

// 답변의 **굵게** 표기만 강조로 바꾼다(그 밖의 마크다운은 그대로 텍스트).
function renderEmphasis(text: string) {
  return text.split(/(\*\*[^*\n]+\*\*)/g).map((chunk, index) => chunk.startsWith("**") && chunk.endsWith("**") && chunk.length > 4 ? <strong key={index}>{chunk.slice(2, -2)}</strong> : chunk);
}

let statusPromise: Promise<boolean> | null = null;
function chatEnabled() {
  statusPromise ??= api<{ enabled: boolean }>("/api/chat/status").then((status) => status.enabled).catch(() => false);
  return statusPromise;
}

export function AiChatPanel({ build }: { build: BuildSelection }) {
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { void chatEnabled().then(setEnabled); }, []);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [turns, sending]);

  if (!enabled) return null;

  async function send(text: string) {
    const content = text.trim().slice(0, 2_000);
    if (!content || sending) return;
    const next = [...turns, { role: "user" as const, content }].slice(-MAX_TURNS);
    // 대화는 사용자 질문으로 시작해야 한다.
    while (next.length > 0 && next[0].role !== "user") next.shift();
    setTurns(next);
    setInput("");
    setSending(true);
    setError(null);
    try {
      const response = await api<{ reply: string }>("/api/chat", { method: "POST", body: JSON.stringify({ messages: next, build }) });
      setTurns((current) => [...current, { role: "assistant", content: response.reply }]);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "답변을 받지 못했어요.");
    } finally {
      setSending(false);
    }
  }

  if (!open) return <button className="ai-chat-launcher" type="button" data-testid="ai-chat-open" onClick={() => setOpen(true)}><FiMessageCircle aria-hidden="true" /> AI 견적 상담</button>;

  return <section className="ai-chat-panel" aria-label="AI 견적 상담" data-testid="ai-chat-panel">
    <header><strong><FiMessageCircle aria-hidden="true" /> AI 견적 상담</strong><button type="button" className="icon-button" aria-label="상담 창 닫기" onClick={() => setOpen(false)}><FiX /></button></header>
    <div className="ai-chat-messages" ref={listRef} aria-live="polite">
      {turns.length === 0 && <div className="ai-chat-empty"><p>지금 견적을 보고 궁금한 점에 답하거나, 원하는 대로 견적을 바꾸는 방법을 알려드려요.</p><div>{SUGGESTIONS.map((suggestion) => <button type="button" key={suggestion} onClick={() => void send(suggestion)}>{suggestion}</button>)}</div></div>}
      {turns.map((turn, index) => <p key={index} className={`ai-chat-bubble ${turn.role}`}>{turn.role === "assistant" ? renderEmphasis(turn.content) : turn.content}</p>)}
      {sending && <p className="ai-chat-bubble assistant pending"><FiLoader className="spin" /> 답변을 쓰는 중...</p>}
      {error && <p className="ai-chat-error" role="alert">{error}</p>}
    </div>
    <form onSubmit={(event) => { event.preventDefault(); void send(input); }}>
      <textarea rows={2} value={input} maxLength={2000} placeholder="견적에 대해 물어보세요" onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(input); } }} aria-label="질문 입력" />
      <button type="submit" className="button button-primary" disabled={sending || !input.trim()} aria-label="보내기"><FiSend /></button>
    </form>
    <small className="ai-chat-note">AI 답변은 틀릴 수 있어요. 가격과 호환은 견적 화면에서 다시 확인해 주세요.</small>
  </section>;
}
