import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Part, PartCategory } from "../shared/types";
import { parseQuoteLine, quoteLineMappingCandidatesFor } from "../shared/quote-audit";

// Phase 0 오프라인 측정: 견적서 텍스트 라인 → 카탈로그 부품 매칭 정밀도.
// 실행: npx tsx scripts/quote-match-precision.ts [--verbose]
// 판정 분해: 파싱 성공 / 카탈로그 커버리지 / 매칭 정확도를 분리해 보고한다.
// 매칭은 shared/quote-audit.ts의 견적용 근사 매칭 어댑터를 사용한다.

interface ExpectedLine {
  category?: PartCategory;
  model?: string;
  ambiguous?: boolean;
  unresolvable?: boolean;
  skip?: boolean;
  note?: string;
}

interface FixtureLine {
  raw: string;
  expect: ExpectedLine;
}

interface FixtureSample {
  id: string;
  source: "real" | "synthetic";
  format: string;
  lines: FixtureLine[];
}

function normalizedCompact(value: string | undefined) {
  return (value ?? "").normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/[^0-9a-z가-힣]/g, "");
}

function starterPartFor(parsed: ReturnType<typeof parseQuoteLine>, index: number): Part {
  return {
    id: `quote-line-${index}`,
    category: parsed.category ?? "cpu",
    name: parsed.name ?? "",
    ...(parsed.model ? { model: parsed.model } : {}),
    ...(parsed.priceWon !== undefined ? { priceWon: parsed.priceWon } : {}),
    source: "manual",
    specs: {},
    dataQuality: "manual",
    missingFields: [],
    updatedAt: new Date().toISOString()
  };
}

type Verdict =
  | "skip-ok" | "skip-miss"
  | "no-candidate"
  | "no-category"
  | "correct-high" | "correct-review"
  | "wrong-high" | "wrong-review"
  | "coverage-source"   // 제품은 카탈로그에 있으나 danawa 소스 행만 없음 → 수집 확대로 해결
  | "coverage-gap"      // 제품이 카탈로그 어디에도 없음 → 데이터 부재
  | "match-miss"        // 제품이 카탈로그에 있는데 어느 소스로도 매칭 실패 → 매칭 품질 문제
  | "unresolvable-ok" | "unresolvable-false-high";

const args = process.argv.slice(2);
const verbose = args.includes("--verbose");
const catalogPath = resolve(process.env.PC_SUPPORTER_DATA_DIR ?? "data", "catalog.json");
const catalog = JSON.parse(await readFile(catalogPath, "utf8")) as Part[];
const fixturePath = resolve("scripts/fixtures/quote-samples.json");
const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as { samples: FixtureSample[] };

// 커버리지와 매칭 품질 분리: anySource 모드는 seed/manual 행도 후보로 평가해
// "다나와 라이브 카탈로그에 없어서 못 찾은 것"과 "매칭 자체가 틀린 것"을 구분한다.
const anySourceCatalog = catalog.map((part) =>
  part.source === "danawa" ? part : { ...part, source: "danawa" as const, sourceProductCode: part.sourceProductCode ?? `probe-${part.id}` }
);

function catalogHasModel(model: string | undefined, pool: Part[]) {
  if (!model) return false;
  const needle = normalizedCompact(model);
  return pool.some((part) => normalizedCompact(`${part.name} ${part.model ?? ""}`).includes(needle));
}

interface LineResult {
  sampleId: string;
  source: string;
  raw: string;
  parsed: ReturnType<typeof parseQuoteLine>;
  expect: ExpectedLine;
  verdict: Verdict;
  topCandidate?: string;
  topScore?: number;
  coverageAny: boolean;
}

const results: LineResult[] = [];
let lineIndex = 0;
for (const sample of fixture.samples) {
  for (const line of sample.lines) {
    lineIndex += 1;
    const parsed = parseQuoteLine(line.raw);
    const expect = line.expect;
    const base = { sampleId: sample.id, source: sample.source, raw: line.raw, parsed, expect };

    if (expect.skip) {
      results.push({ ...base, verdict: parsed.skipped ? "skip-ok" : "skip-miss", coverageAny: false });
      continue;
    }
    if (parsed.skipped) {
      results.push({ ...base, verdict: expect.unresolvable ? "unresolvable-ok" : "no-candidate", coverageAny: false });
      continue;
    }
    if (!parsed.category) {
      results.push({ ...base, verdict: "no-category", coverageAny: catalogHasModel(expect.model, catalog) });
      continue;
    }

    const starter = starterPartFor(parsed, lineIndex);
    const candidates = quoteLineMappingCandidatesFor(starter, catalog, { limit: 5 });
    const anySourceCandidates = quoteLineMappingCandidatesFor(starter, anySourceCatalog, { limit: 5 });
    const top = candidates[0];
    const topAny = anySourceCandidates[0];
    const coverageAny = catalogHasModel(expect.model, catalog);

    if (expect.unresolvable) {
      // 모델 정보가 없는 라인: high-confidence 매칭이 나오면 위험(오판정), review/없음이면 정상
      const dangerous = top?.confidence === "high";
      results.push({
        ...base,
        verdict: dangerous ? "unresolvable-false-high" : "unresolvable-ok",
        topCandidate: top?.activeName,
        topScore: top?.score,
        coverageAny
      });
      continue;
    }

    const needle = normalizedCompact(expect.model);
    const topMatches = top ? normalizedCompact(`${top.activeName} ${top.activeModel ?? ""}`).includes(needle) : false;
    const topAnyMatches = topAny ? normalizedCompact(`${topAny.activeName} ${topAny.activeModel ?? ""}`).includes(needle) : false;

    let verdict: Verdict;
    if (topMatches) {
      verdict = top.confidence === "high" ? "correct-high" : "correct-review";
    } else if (!coverageAny) {
      verdict = "coverage-gap";
    } else if (topAnyMatches) {
      verdict = "coverage-source";
    } else if (top) {
      verdict = top.confidence === "high" ? "wrong-high" : "wrong-review";
    } else {
      verdict = "match-miss";
    }
    results.push({ ...base, verdict, topCandidate: top?.activeName ?? topAny?.activeName, topScore: top?.score ?? topAny?.score, coverageAny });
  }
}

const counts = new Map<Verdict, number>();
for (const result of results) counts.set(result.verdict, (counts.get(result.verdict) ?? 0) + 1);
const partLines = results.filter((result) => !result.expect.skip && !result.expect.unresolvable);
const skipLines = results.filter((result) => result.expect.skip);
const unresolvableLines = results.filter((result) => result.expect.unresolvable);
const correct = partLines.filter((result) => result.verdict === "correct-high" || result.verdict === "correct-review").length;
const wrongHigh = partLines.filter((result) => result.verdict === "wrong-high").length;
const wrongReview = partLines.filter((result) => result.verdict === "wrong-review").length;
const coverageGap = partLines.filter((result) => result.verdict === "coverage-gap").length;
const coverageSource = partLines.filter((result) => result.verdict === "coverage-source").length;
const matchMiss = partLines.filter((result) => result.verdict === "match-miss").length;
const noCandidate = partLines.filter((result) => result.verdict === "no-candidate").length;
const noCategory = partLines.filter((result) => result.verdict === "no-category").length;
const realPartLines = partLines.filter((result) => result.source === "real");
const realCorrect = realPartLines.filter((result) => result.verdict === "correct-high" || result.verdict === "correct-review").length;

const summary = {
  catalogCount: catalog.length,
  danawaCatalogCount: catalog.filter((part) => part.source === "danawa").length,
  samples: fixture.samples.length,
  totalLines: results.length,
  partLines: partLines.length,
  skipLines: { total: skipLines.length, ok: skipLines.filter((r) => r.verdict === "skip-ok").length, miss: skipLines.filter((r) => r.verdict === "skip-miss").length },
  unresolvableLines: { total: unresolvableLines.length, handledOk: unresolvableLines.filter((r) => r.verdict === "unresolvable-ok").length, falseHigh: unresolvableLines.filter((r) => r.verdict === "unresolvable-false-high").length },
  resolution: {
    correct,
    correctRate: partLines.length ? Math.round((correct / partLines.length) * 1000) / 10 : 0,
    coverageSource,
    coverageGap,
    matchMiss,
    noCandidate,
    wrongReview,
    wrongHigh,
    noCategory
  },
  realOnly: { partLines: realPartLines.length, correct: realCorrect, correctRate: realPartLines.length ? Math.round((realCorrect / realPartLines.length) * 1000) / 10 : 0 },
  verdicts: Object.fromEntries(counts)
};

console.log(JSON.stringify(summary, null, 2));
if (verbose) {
  for (const result of results) {
    console.log(`[${result.verdict}] ${result.raw}  → parsed{cat=${result.parsed.category ?? "-"}, name="${result.parsed.name ?? ""}", model=${result.parsed.model ?? "-"}, price=${result.parsed.priceWon ?? "-"}}  top=${result.topCandidate ?? "-"} score=${result.topScore ?? "-"}`);
  }
}
