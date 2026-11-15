// AI 견적 상담 — 현재 견적(부품·가격)과 견본견적 목록을 맥락으로 Claude에게 묻는다.
// ANTHROPIC_API_KEY(또는 SDK가 읽는 다른 자격 증명)가 없으면 503으로 기능 비활성 상태를 알린다.
import Anthropic from "@anthropic-ai/sdk";
import { type Express } from "express";
import { CATEGORY_LABELS, PART_CATEGORIES, isKnownPrice, type BuildSelection, type Part, type PartSelection } from "../../shared/types";
import { parseBuild } from "../../shared/domain/build-input";
import { loadCatalogSnapshot } from "../catalog-snapshot";
import { resolveAllSampleBuilds } from "./sample-builds";
import { createRateLimitMiddleware } from "./route-support";

const chatRateLimit = createRateLimitMiddleware("ai-chat", { limit: 12, windowMs: 60_000 });
const CHAT_MODEL = process.env.AI_CHAT_MODEL || "claude-sonnet-5-5";
const MAX_TURNS = 20;
const MAX_MESSAGE_CHARS = 2_000;

export function aiChatEnabled() {
  return process.env.AI_CHAT_ENABLED !== "false" && Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

let client: Anthropic | null = null;
function chatClient() {
  client ??= new Anthropic();
  return client;
}

type ChatTurn = { role: "user" | "assistant"; content: string };

export function parseChatTurns(raw: unknown): ChatTurn[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_TURNS) return null;
  const turns: ChatTurn[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") return null;
    const { role, content } = entry as { role?: unknown; content?: unknown };
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") return null;
    const text = content.trim();
    if (!text || text.length > MAX_MESSAGE_CHARS) return null;
    turns.push({ role, content: text });
  }
  if (turns[0].role !== "user" || turns[turns.length - 1].role !== "user") return null;
  return turns;
}

function selectionsOf(build: BuildSelection) {
  return PART_CATEGORIES.flatMap((category) => {
    const value = category === "memory" ? build.memory : category === "ssd" ? build.ssd : category === "hdd" ? build.hdd : build[category] ? [build[category] as PartSelection] : [];
    return value.map((selection) => ({ category, selection }));
  });
}

function buildContext(build: BuildSelection | undefined, partsById: ReadonlyMap<string, Part>) {
  if (!build) return "사용자가 아직 견적을 담지 않았습니다.";
  const lines = selectionsOf(build).map(({ category, selection }) => {
    const part = partsById.get(selection.partId);
    const price = part && isKnownPrice(part.priceWon) ? `${(part.priceWon * selection.quantity).toLocaleString("ko-KR")}원` : "가격 정보 없음";
    return `- ${CATEGORY_LABELS[category]}: ${part?.name ?? selection.partId}${selection.quantity > 1 ? ` ×${selection.quantity}` : ""} (${price})${part?.rawSpecText ? ` / 스펙: ${part.rawSpecText.slice(0, 220)}` : ""}`;
  });
  if (build.useIntegratedGraphics) lines.push("- 그래픽: CPU 내장 그래픽 사용");
  const total = selectionsOf(build).reduce((sum, { selection }) => {
    const price = partsById.get(selection.partId)?.priceWon;
    return isKnownPrice(price) ? sum + price * selection.quantity : sum;
  }, 0);
  return lines.length > 0 ? `${lines.join("\n")}\n합계: ${total.toLocaleString("ko-KR")}원` : "사용자가 아직 부품을 고르지 않았습니다.";
}

const SYSTEM_PROMPT = `당신은 한국 PC 견적 사이트 "PC Supporter"의 견적 상담원입니다. PC를 잘 모르는 사용자도 이해할 수 있게 쉬운 한국어로 짧고 분명하게 답하세요.

할 일:
- 사용자의 현재 견적과 질문을 보고 궁금한 점에 답합니다(부품 역할, 게임 성능, 호환, 업그레이드 우선순위 등).
- 사용자가 견적 수정을 원하면, 어떤 부품을 무엇으로 바꾸면 좋은지와 대략적인 가격 변화를 구체적으로 제안합니다. 가능하면 아래 "추천 견적 목록"의 등급이나 부품을 기준으로 제안하세요. 사이트 화면의 "한 등급 위/아래" 버튼이나 부품별 "다른 부품으로 변경"으로 직접 바꿀 수 있다고 안내하세요.
- 가격은 제공된 데이터의 현재가 기준이며 실제 판매가와 재고는 바뀔 수 있다고 필요할 때만 짧게 덧붙입니다.
- 모르는 사실(정확한 FPS, 출시 예정 제품 등)은 추측해 단정하지 말고 모른다고 말하세요.
- PC 견적과 무관한 요청에는 견적 상담만 도울 수 있다고 정중히 답합니다.
- 답변은 핵심만 3~6문장으로 짧게 씁니다. 꼭 필요할 때만 3~4줄짜리 짧은 목록을 쓰고, 마크다운 제목(#)이나 표는 쓰지 마세요. 강조는 **굵게**만 가끔 씁니다.`;

export function registerChatRoutes(app: Express) {
  app.get("/api/chat/status", (_request, response) => {
    response.json({ enabled: aiChatEnabled() });
  });

  app.post("/api/chat", chatRateLimit, async (request, response) => {
    if (!aiChatEnabled()) {
      response.status(503).json({ error: "AI 상담이 아직 설정되지 않았어요.", code: "AI_CHAT_DISABLED" });
      return;
    }
    const turns = parseChatTurns(request.body?.messages);
    if (!turns) {
      response.status(400).json({ error: "대화 내용 형식이 올바르지 않습니다.", code: "INVALID_CHAT_INPUT" });
      return;
    }
    let build: BuildSelection | undefined;
    if (request.body?.build && typeof request.body.build === "object") {
      const parsed = parseBuild(request.body.build);
      if (parsed.errors.length === 0) build = parsed.build;
    }
    const snapshot = await loadCatalogSnapshot();
    const partsById = new Map(snapshot.catalog.map((part) => [part.id, part]));
    const samples = resolveAllSampleBuilds(snapshot.catalog).samples;
    const sampleSummary = samples.map((sample) => `- ${sample.order}등급 ${sample.title}: ${sample.totalPriceWon.toLocaleString("ko-KR")}원 / ${sample.lines.map((line) => `${CATEGORY_LABELS[line.category]} ${line.partId ? partsById.get(line.partId)?.name ?? line.label : line.label}${line.quantity > 1 ? ` ×${line.quantity}` : ""}`).join(", ")}`).join("\n");
    // 시스템 프롬프트(고정) → 추천 견적 목록(카탈로그가 바뀔 때만 변함) → 현재 견적(요청마다 변함) 순으로 둬 앞부분이 캐시되게 한다.
    const system: Anthropic.Beta.BetaTextBlockParam[] = [
      { type: "text", text: SYSTEM_PROMPT },
      { type: "text", text: `추천 견적 목록(사이트의 견본견적, 현재가 기준):\n${sampleSummary}`, cache_control: { type: "ephemeral" } },
      { type: "text", text: `사용자의 현재 견적:\n${buildContext(build, partsById)}` }
    ];
    try {
      const message = await chatClient().beta.messages.create({
        model: CHAT_MODEL,
        max_tokens: 4_000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "low" },
        system,
        messages: turns
      });
      if (message.stop_reason === "refusal") {
        response.json({ reply: "이 질문에는 답하기 어려워요. PC 견적과 관련된 질문을 해 주세요." });
        return;
      }
      const reply = message.content.flatMap((block) => block.type === "text" ? [block.text] : []).join("\n").trim();
      response.json({ reply: reply || "답변을 만들지 못했어요. 다시 질문해 주세요." });
    } catch (error) {
      if (error instanceof Anthropic.RateLimitError) {
        response.status(429).json({ error: "지금 상담 요청이 많아요. 잠시 후 다시 시도해 주세요.", code: "AI_CHAT_RATE_LIMITED" });
      } else if (error instanceof Anthropic.AuthenticationError) {
        response.status(503).json({ error: "AI 상담 설정에 문제가 있어요.", code: "AI_CHAT_AUTH" });
      } else if (error instanceof Anthropic.APIError) {
        console.error(`AI 상담 API 오류 ${error.status}: ${error.message}`);
        response.status(502).json({ error: "AI 상담 응답을 받지 못했어요. 잠시 후 다시 시도해 주세요.", code: "AI_CHAT_UPSTREAM" });
      } else {
        throw error;
      }
    }
  });
}
