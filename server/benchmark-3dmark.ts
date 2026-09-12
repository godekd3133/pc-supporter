import type { Benchmark3DMarkImportPreview, BenchmarkScoreKey } from "../shared/types";

const ALLOWED_HOSTS = new Set(["3dmark.com", "www.3dmark.com"]);
const MAX_HTML_BYTES = 1_000_000;
const DEFAULT_TIMEOUT_MS = 8_000;

type Benchmark3DMarkResultKind = "time_spy" | "port_royal";

export type Benchmark3DMarkImportDependencies = {
  fetcher?: (input: string, init?: RequestInit) => Promise<Response>;
  now?: () => string;
  timeoutMs?: number;
};

export class Benchmark3DMarkImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Benchmark3DMarkImportError";
  }
}

function normalizedText(value: string) {
  return value.replace(/&nbsp;|&#160;|&#xA0;|&#8239;|&#x202F;/gi, " ").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function resultKindForPath(pathname: string): Benchmark3DMarkResultKind | undefined {
  if (/^\/spy\/\d+\/?$/i.test(pathname)) return "time_spy";
  if (/^\/prt\/\d+\/?$/i.test(pathname)) return "port_royal";
  return undefined;
}

function scoreKeyFor(kind: Benchmark3DMarkResultKind): Extract<BenchmarkScoreKey, "gpu3dmarkTimeSpyScore" | "gpu3dmarkPortRoyalScore"> {
  return kind === "time_spy" ? "gpu3dmarkTimeSpyScore" : "gpu3dmarkPortRoyalScore";
}

function benchmarkLabelFor(kind: Benchmark3DMarkResultKind) {
  return kind === "time_spy" ? "3DMark Time Spy" : "3DMark Port Royal";
}

function safeResultUrl(rawUrl: string) {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Benchmark3DMarkImportError("3DMark 결과 URL 형식이 올바르지 않습니다.");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || (parsed.port && parsed.port !== "443")) {
    throw new Benchmark3DMarkImportError("3DMark 결과는 기본 HTTPS 주소만 가져올 수 있습니다.");
  }
  const hostname = parsed.hostname.toLocaleLowerCase("en-US");
  if (!ALLOWED_HOSTS.has(hostname)) throw new Benchmark3DMarkImportError("3DMark 공식 결과 주소(www.3dmark.com)만 가져올 수 있습니다.");
  if (!resultKindForPath(parsed.pathname)) throw new Benchmark3DMarkImportError("Time Spy는 /spy/결과ID, Port Royal은 /prt/결과ID URL을 사용해야 합니다.");
  parsed.pathname = parsed.pathname.replace(/\/$/, "");
  parsed.hash = "";
  return parsed;
}

function scoreFromText(text: string) {
  const match = text.match(/Graphics\s+Score\s*([0-9][0-9\s,]{0,20})(?=\s|$)/i);
  if (!match) throw new Benchmark3DMarkImportError("페이지에서 Graphics Score를 찾지 못했습니다. 결과 URL인지 확인해 주세요.");
  const score = Number(match[1].replace(/[^0-9]/g, ""));
  if (!Number.isInteger(score) || score <= 0 || score > 1_000_000) throw new Benchmark3DMarkImportError("페이지의 Graphics Score 형식을 해석하지 못했습니다.");
  return score;
}

function gpuNameFromDocument(title: string, text: string) {
  const titleMatch = normalizedText(title).match(/^(.+?)\s+video\s+card\s+benchmark\s+result\b/i);
  if (titleMatch?.[1]) return normalizedText(titleMatch[1]);
  const bodyMatch = normalizedText(text).match(/Score\s+[0-9][0-9\s,]{0,20}\s+with\s+(.+?)\s+Graphics\s+Score/i);
  return bodyMatch?.[1] ? normalizedText(bodyMatch[1]) : undefined;
}

function skuFor(value: string | undefined) {
  if (!value) return undefined;
  const normalized = normalizedText(value).toLocaleUpperCase("en-US");
  const match = normalized.match(/\b((?:RTX|GTX|GT|RX)\s*\d{3,4}(?:\s*(?:TI|SUPER|XT|XTX|GRE))?|ARC(?:\s+PRO)?\s*[AB]\s*\d{2,4}|(?:R|W|P)\s*\d{3,5})\b/i);
  return match?.[1].replace(/\s+/g, "").toLocaleUpperCase("en-US");
}

export function benchmark3DMarkIdentityFor(partName: string, partModel: string | undefined, resultGpuName: string | undefined): Pick<Benchmark3DMarkImportPreview, "identityStatus" | "identityDetail"> {
  const partSku = skuFor(`${partModel ?? ""} ${partName}`);
  const resultSku = skuFor(resultGpuName);
  if (!resultSku) return { identityStatus: "manual_required", identityDetail: "결과 페이지에서 GPU 모델 식별자를 찾지 못했습니다. 원문과 선택 부품을 수동 대조해야 합니다." };
  if (!partSku) return { identityStatus: "manual_required", identityDetail: "선택 부품의 GPU 모델 식별자를 정규화하지 못했습니다. 원문과 부품을 수동 대조해야 합니다." };
  if (partSku === resultSku) return { identityStatus: "matched", identityDetail: `선택 부품과 결과 페이지의 GPU 식별자(${resultSku})가 일치합니다.` };
  return { identityStatus: "not_found", identityDetail: `선택 부품(${partSku})과 결과 페이지(${resultSku})의 GPU 식별자가 다릅니다.` };
}

export function parse3DMarkResultHtml(html: string, sourceUrl: string, now = new Date().toISOString()): Benchmark3DMarkImportPreview {
  if (Buffer.byteLength(html, "utf8") > MAX_HTML_BYTES) throw new Benchmark3DMarkImportError("3DMark 결과 페이지가 허용된 크기를 초과했습니다.");
  const resultUrl = safeResultUrl(sourceUrl);
  const kind = resultKindForPath(resultUrl.pathname);
  if (!kind) throw new Benchmark3DMarkImportError("지원하지 않는 3DMark 결과 유형입니다.");
  const bodyText = normalizedText(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "));
  const score = scoreFromText(bodyText);
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  const resultId = resultUrl.pathname.match(/\/(?:spy|prt)\/(\d+)/i)?.[1];
  if (!resultId) throw new Benchmark3DMarkImportError("3DMark 결과 ID를 찾지 못했습니다.");
  const gpuName = gpuNameFromDocument(title, bodyText);
  return {
    sourceUrl: resultUrl.toString(),
    resultId,
    benchmark: kind,
    benchmarkLabel: benchmarkLabelFor(kind),
    scoreKey: scoreKeyFor(kind),
    score,
    ...(gpuName ? { gpuName } : {}),
    identityStatus: "manual_required",
    identityDetail: "선택 부품과 결과 페이지의 GPU 식별자를 대조해야 합니다.",
    fetchedAt: now
  };
}

export async function import3DMarkResult(
  rawUrl: string,
  partName: string,
  partModel: string | undefined,
  dependencies: Benchmark3DMarkImportDependencies = {}
): Promise<Benchmark3DMarkImportPreview> {
  const sourceUrl = safeResultUrl(rawUrl).toString();
  const fetcher = dependencies.fetcher ?? ((input, init) => fetch(input, init));
  const timeoutMs = Math.max(1_000, dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetcher(sourceUrl, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
      headers: {
        "user-agent": "PC-Supporter-3DMark-Preview/1.0",
        accept: "text/html,application/xhtml+xml"
      }
    });
  } catch (error) {
    throw new Benchmark3DMarkImportError(error instanceof Error && error.name === "AbortError" ? "3DMark 결과 페이지 응답 시간이 초과되었습니다." : "3DMark 결과 페이지에 연결하지 못했습니다.");
  }
  if (!response.ok) {
    clearTimeout(timer);
    throw new Benchmark3DMarkImportError(`3DMark 결과 페이지가 HTTP ${response.status}를 반환했습니다.`);
  }
  const contentType = response.headers.get("content-type")?.toLocaleLowerCase("en-US") ?? "";
  if (contentType && !contentType.includes("html") && !contentType.includes("text/")) {
    clearTimeout(timer);
    throw new Benchmark3DMarkImportError("3DMark 결과 페이지가 HTML 문서가 아닙니다.");
  }
  let html: string;
  try {
    html = await response.text();
  } catch (error) {
    throw new Benchmark3DMarkImportError(error instanceof Error && error.name === "AbortError" ? "3DMark 결과 페이지 응답 시간이 초과되었습니다." : "3DMark 결과 페이지 본문을 읽지 못했습니다.");
  } finally {
    clearTimeout(timer);
  }
  const preview = parse3DMarkResultHtml(html, sourceUrl, dependencies.now?.() ?? new Date().toISOString());
  const identity = benchmark3DMarkIdentityFor(partName, partModel, preview.gpuName);
  return { ...preview, ...identity };
}
