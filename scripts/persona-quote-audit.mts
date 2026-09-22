/**
 * Persona quote audit harness.
 *
 * Generates the same draft a real onboarding user would receive for a set of
 * distinct personas, then prints a markdown report that persona reviewer agents
 * can critique. Run with: npx tsx scripts/persona-quote-audit.mts [--json]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { BuildGenerationError, evaluateBuild, generateBuildDraft } from "../server/engine";
import { loadCatalog } from "../server/catalog";
import type { BuildGenerationRequest, Part } from "../shared/types";
import type { GamingPerformanceEvidenceRecord } from "../shared/gaming-performance-evidence";
import { CATEGORY_LABELS, GAMING_RESOLUTION_LABELS, GAMING_REFRESH_RATE_LABELS, GAMING_GRAPHICS_PRESET_LABELS, GAMING_UPSCALING_LABELS, RECOMMENDATION_PRIORITY_LABELS, RECOMMENDATION_PROFILE_LABELS, RECOMMENDATION_PERFORMANCE_TIER_LABELS } from "../shared/types";

interface PersonaCase {
  id: string;
  /** Who this user is and what they actually need. */
  persona: string;
  /** What a trustworthy quote must deliver for this persona. */
  expectation: string;
  request: BuildGenerationRequest;
}

const PERSONAS: PersonaCase[] = [
  {
    id: "entry-gamer",
    persona: "김민수, 22세 대학생. 첫 게이밍 PC. 롤·피파·발로란트 위주, 가끔 배그. 용돈을 아껴 쓰며 졸업 전까지 쓸 PC.",
    expectation: "150만원 안팎, FHD 144Hz 모니터에서 경쟁 게임이 쾌적하게 돌아가는 구성. 나중에 GPU만 올려도 되는 업그레이드 여지.",
    request: {
      profile: "gaming", priority: "balanced", budgetWon: 1_500_000, includeGpu: true,
      gamingResolution: "1080p", gamingRefreshRate: 144,
      gamingGameIds: ["league", "valorant", "pubg"], gamingGraphicsPreset: "competitive",
      memoryCapacityGb: 32, storageCapacityGb: 1000
    }
  },
  {
    id: "aaa-gamer",
    persona: "이서준, 31세 직장인. 하드코어 AAA 게이머. 사이버펑크 2077 레이트레이싱, 검은 신화: 오공을 4K에서 즐기고 싶음.",
    expectation: "350만원 예산, 4K 고주사율에서 최신 AAA가 무리 없이 돌아가는 구성. CPU보다 GPU에 예산을 쏟는 게 맞는지 확인 필요.",
    request: {
      profile: "gaming", priority: "performance", budgetWon: 3_500_000, includeGpu: true,
      gamingResolution: "4k", gamingRefreshRate: 144,
      gamingGameIds: ["cyberpunk", "blackmyth", "rdr2"], gamingGraphicsPreset: "high",
      gamingRayTracing: true, gamingUpscaling: "quality",
      memoryCapacityGb: 32, storageCapacityGb: 2000
    }
  },
  {
    id: "video-creator",
    persona: "박지현, 29세 영상 편집 프리랜서. 프리미어·다빈치로 4K 편집과 이펙트 작업을 매일 함.",
    expectation: "300만원, 4K 편집이 버벅이지 않는 구성. RAM 64GB, 빠른 SSD 2TB, GPU 가속이 실제 작업에 도움이 되는 수준.",
    request: {
      profile: "creator", priority: "performance", budgetWon: 3_000_000, includeGpu: true,
      memoryCapacityGb: 64, storageCapacityGb: 2000
    }
  },
  {
    id: "backend-dev",
    persona: "최동혁, 35세 백엔드 개발자. IDE·도커 컨테이너 여러 개·빌드가 일상. 게임은 거의 안 함.",
    expectation: "180만원, 멀티코어 CPU와 넉넉한 RAM. 외장 GPU는 필요 없고 내장그래픽이면 충분한지 검증 필요.",
    request: {
      profile: "development", priority: "balanced", budgetWon: 1_800_000, includeGpu: false,
      memoryCapacityGb: 32, storageCapacityGb: 1000
    }
  },
  {
    id: "office-parent",
    persona: "정수진, 58세. 은행 업무·문서·유튜브·화상통화용 부모님 PC. 조용하고 오래가면 됨.",
    expectation: "80만원대, 과한 부품 없이 문서·영상 재생이 부드러운 구성. 외장 GPU는 사치.",
    request: {
      profile: "office", priority: "budget", budgetWon: 800_000, includeGpu: false,
      memoryCapacityGb: 16, storageCapacityGb: 500
    }
  },
  {
    id: "streamer",
    persona: "한도현, 26세 트위치 스트리머. 배그·오버워치·로아를 QHD로 방송 송출하면서 플레이.",
    expectation: "280만원, 게임+송출 동시에 가능한 CPU/GPU 밸런스. QHD 144Hz가 목표.",
    request: {
      profile: "gaming", priority: "performance", budgetWon: 2_800_000, includeGpu: true,
      gamingResolution: "1440p", gamingRefreshRate: 144,
      gamingGameIds: ["pubg", "overwatch2", "lostark"], gamingGraphicsPreset: "balanced",
      memoryCapacityGb: 32, storageCapacityGb: 1000
    }
  },
  {
    id: "ai-local",
    persona: "오태양, 33세 스타트업 엔지니어. 로컬 LLM 추론과 이미지 생성을 실험하는 AI 입문자.",
    expectation: "400만원, VRAM이 넉넉한 GPU가 핵심. RAM 64GB, NVMe 2TB. CUDA가 사실상 필수라는 점을 견적이 반영하는지 확인.",
    request: {
      profile: "development", priority: "performance", budgetWon: 4_000_000, includeGpu: true,
      memoryCapacityGb: 64, storageCapacityGb: 2000
    }
  }
];

function won(value: number | undefined) {
  return value === undefined ? "가격 미확인" : `${value.toLocaleString("ko-KR")}원`;
}

const catalog: Part[] = await loadCatalog();
const gamingEvidence: GamingPerformanceEvidenceRecord[] = JSON.parse(readFileSync(new URL("../data/gaming-performance-evidence.json", import.meta.url), "utf8"));

const asJson = process.argv.includes("--json");
const outPath = process.argv.find((arg) => arg.startsWith("--out="))?.slice("--out=".length);

const sections: string[] = [];
const raw: unknown[] = [];

for (const persona of PERSONAS) {
  let draft;
  try {
    draft = generateBuildDraft(catalog, persona.request, gamingEvidence);
  } catch (error) {
    const diagnostics = error instanceof BuildGenerationError ? error.diagnostics : [];
    const lines = [
      `## ${persona.id}`,
      `**페르소나**: ${persona.persona}`,
      `**기대**: ${persona.expectation}`,
      "",
      `**생성 실패**: ${error instanceof Error ? error.message : String(error)}`,
      ...diagnostics.flatMap((d) => [`- ${d.title} ${d.summary}${d.recommendation ? ` (제안: ${d.recommendation})` : ""}`]),
      ""
    ];
    sections.push(lines.join("\n"));
    raw.push({ persona: persona.id, request: persona.request, error: error instanceof Error ? error.message : String(error), diagnostics });
    continue;
  }
  const evaluation = evaluateBuild(draft.selection, catalog, {
    recommendationPreferences: { profile: persona.request.profile, priority: persona.request.priority ?? "balanced" }
  });
  const lines: string[] = [];
  lines.push(`## ${persona.id}`);
  lines.push(`**페르소나**: ${persona.persona}`);
  lines.push(`**기대**: ${persona.expectation}`);
  const req = persona.request;
  lines.push(`**요청**: ${RECOMMENDATION_PROFILE_LABELS[req.profile]} · ${RECOMMENDATION_PRIORITY_LABELS[req.priority ?? "balanced"]}${req.performanceTier ? ` · ${RECOMMENDATION_PERFORMANCE_TIER_LABELS[req.performanceTier]}` : ""}${req.profile === "gaming" ? ` · ${GAMING_RESOLUTION_LABELS[req.gamingResolution ?? "1440p"]} · ${GAMING_REFRESH_RATE_LABELS[req.gamingRefreshRate ?? 144]} · 게임 ${(req.gamingGameIds ?? []).join(",") || "미지정"} · 프리셋 ${req.gamingGraphicsPreset ? GAMING_GRAPHICS_PRESET_LABELS[req.gamingGraphicsPreset] : "기본"}${req.gamingRayTracing ? " · RT" : ""}${req.gamingUpscaling ? ` · 업스케일링 ${GAMING_UPSCALING_LABELS[req.gamingUpscaling]}` : ""}` : ""} · RAM ${req.memoryCapacityGb ?? 32}GB · SSD ${req.storageCapacityGb ?? 1000}GB · GPU ${req.includeGpu ? "포함" : "미포함"} · 예산 ${won(req.budgetWon)}`);
  lines.push("");
  lines.push(`**결과**: ${draft.status} · 합계 ${won(draft.totalPriceWon)} · 예산 ${draft.withinBudget ? "내" : "초과"} (${won(Math.abs(draft.budgetDeltaWon))} ${draft.withinBudget ? "여유" : "초과"}) · 차단 ${draft.blockerCount} · 경고 ${draft.warningCount} · 확인 필요 ${draft.unknownCount}`);
  lines.push("");
  lines.push("| 범주 | 부품 | 수량 | 가격 | 사양 |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const line of draft.lines) {
    lines.push(`| ${CATEGORY_LABELS[line.category]} | ${line.name} | ${line.quantity} | ${won(line.priceWon)} | ${line.specSummary ?? "-"} |`);
  }
  lines.push("");
  if (draft.analysis) {
    lines.push(`**분석**: ${draft.analysis.scoreLabel} · 전체 지수 ${draft.analysis.overallScore ?? "계산 불가"} · 신뢰도 ${draft.analysis.confidence} · 모델 ${draft.analysis.scoreModelVersion}`);
    lines.push(`부품 지수: ${draft.analysis.factors.map((f) => `${f.label} ${f.score ?? "-"}${f.basis.includes("벤치마크") ? "(벤치마크)" : ""}`).join(" · ")}`);
    if (draft.analysis.balance) lines.push(`균형: ${draft.analysis.balance.summary}`);
    if (draft.analysis.focusAreas.length > 0) lines.push(`보완 영역: ${draft.analysis.focusAreas.map((f) => `${f.title}(${f.score}점)`).join(", ")}`);
    if (draft.analysis.strengths.length > 0) lines.push(`강점: ${draft.analysis.strengths.map((f) => `${f.title}(${f.score}점)`).join(", ")}`);
  }
  if (draft.gamingPerformanceAssessment) {
    const a = draft.gamingPerformanceAssessment;
    lines.push(`**게임 FPS 근거**: ${a.status} · 연결된 자료 ${a.measurements?.length ?? 0}개${a.measurements?.length ? ` — ${a.measurements.map((m) => `${m.gameId} ${m.averageFps}FPS`).join(", ")}` : ""}`);
  }
  if (draft.warnings.length > 0) {
    lines.push(`**경고**: ${draft.warnings.join(" / ")}`);
  }
  const blocking = evaluation.findings.filter((f) => f.severity === "blocker" || f.severity === "warning").map((f) => `[${f.severity}] ${f.title}`);
  if (blocking.length > 0) lines.push(`**호환성 이슈**: ${blocking.join(" / ")}`);
  lines.push("");
  sections.push(lines.join("\n"));
  raw.push({ persona: persona.id, request: persona.request, draft, evaluation: { status: evaluation.status, findings: evaluation.findings } });
}

const report = `# 페르소나 견적 감사 리포트\n생성: ${new Date().toISOString()}\n엔진: objective-index 모델 적용 상태\n\n${sections.join("\n---\n\n")}`;

if (outPath) writeFileSync(outPath, report);
if (asJson) console.log(JSON.stringify(raw, null, 2));
else console.log(report);
