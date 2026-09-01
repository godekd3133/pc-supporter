import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { spawn } from "node:child_process";
import type { PhysicalSourceCheck, PhysicalSourceIdentityStatus, PhysicalSourceCheckStatus } from "../shared/types";

const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 3;
const MAX_TEXT_BODY_BYTES = 512 * 1024;
const MAX_PDF_BODY_BYTES = 8 * 1024 * 1024;
const MAX_PDF_TEXT_BYTES = 1_000_000;

type LookupAddress = { address: string; family: number };

export type PhysicalSourceCheckDependencies = {
  fetcher?: (input: string, init?: RequestInit) => Promise<Response>;
  lookup?: (hostname: string, options: { all: true }) => Promise<LookupAddress[]>;
  pdfTextExtractor?: (body: Uint8Array) => Promise<string | undefined>;
  now?: () => string;
  timeoutMs?: number;
  maxRedirects?: number;
};

class BlockedSourceError extends Error {}
class UnreachableSourceError extends Error {}

function normalizedHostname(value: string) {
  return value.replace(/^\[|\]$/g, "").toLocaleLowerCase("en-US");
}

function ipv4IsPublic(address: string) {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;
  const [first, second] = octets;
  if (first === 0 || first === 10 || first === 127 || first >= 224) return false;
  if (first === 169 && second === 254) return false;
  if (first === 172 && second >= 16 && second <= 31) return false;
  if (first === 192 && (second === 168 || second === 0)) return false;
  if (first === 198 && (second === 18 || second === 19 || second === 51)) return false;
  if (first === 203 && second === 0) return false;
  if (first === 100 && second >= 64 && second <= 127) return false;
  return true;
}

function ipv6IsPublic(address: string) {
  const normalized = normalizedHostname(address);
  if (normalized === "::" || normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || /^fe[89ab]/.test(normalized) || normalized.startsWith("ff")) return false;
  const mappedIpv4 = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return !mappedIpv4 || ipv4IsPublic(mappedIpv4[1]);
}

function addressIsPublic(address: string) {
  const normalized = normalizedHostname(address);
  const family = isIP(normalized);
  return family === 4 ? ipv4IsPublic(normalized) : family === 6 ? ipv6IsPublic(normalized) : false;
}

async function publicHttpsUrlFor(rawUrl: string, lookup: (hostname: string, options: { all: true }) => Promise<LookupAddress[]>) {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new BlockedSourceError("근거 URL 형식이 올바르지 않습니다.");
  }
  if (parsed.protocol !== "https:") throw new BlockedSourceError("HTTPS 근거 URL만 점검할 수 있습니다.");
  if (parsed.username || parsed.password) throw new BlockedSourceError("사용자명·비밀번호가 포함된 URL은 점검할 수 없습니다.");
  if (parsed.port && parsed.port !== "443") throw new BlockedSourceError("기본 HTTPS 포트(443) 외의 URL은 점검할 수 없습니다.");
  const hostname = normalizedHostname(parsed.hostname);
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw new BlockedSourceError("로컬·내부 호스트는 점검할 수 없습니다.");
  }
  const family = isIP(hostname);
  const addresses = family > 0 ? [{ address: hostname, family }] : await lookup(hostname, { all: true }).catch(() => {
    throw new UnreachableSourceError("근거 호스트의 DNS를 확인하지 못했습니다.");
  });
  if (addresses.length === 0 || addresses.some((address) => !addressIsPublic(address.address))) throw new BlockedSourceError("공개 인터넷 주소로 확인되지 않는 호스트입니다.");
  return parsed;
}

async function cancelBody(response: Response) {
  try {
    await response.body?.cancel();
  } catch {
    // A response body may already be closed; the status result is still usable.
  }
}

async function boundedBodyFor(response: Response, maxBytes: number) {
  if (!response.body) return { bytes: new Uint8Array(), truncated: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    const chunk = result.value;
    const remaining = maxBytes - total;
    if (remaining <= 0) {
      await reader.cancel();
      return { bytes: combineChunks(chunks, maxBytes), truncated: true };
    }
    if (chunk.byteLength > remaining) {
      chunks.push(chunk.slice(0, remaining));
      await reader.cancel();
      return { bytes: combineChunks(chunks, maxBytes), truncated: true };
    }
    chunks.push(chunk);
    total += chunk.byteLength;
  }
  return { bytes: combineChunks(chunks, total), truncated: false };
}

function combineChunks(chunks: Uint8Array[], total: number) {
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function normalizedIdentity(value: string) {
  return value.toLocaleLowerCase("en-US").replace(/[^a-z0-9가-힣]+/g, "");
}

function identityMatchFor(text: string, manufacturerModel: string): { status: PhysicalSourceIdentityStatus; detail: string } {
  const identity = normalizedIdentity(manufacturerModel);
  if (!identity) return { status: "not_checked", detail: "제조사 모델/SKU가 없어 본문 식별을 실행하지 않았습니다." };
  const normalizedText = text.toLocaleLowerCase("en-US").replace(/[^a-z0-9가-힣]+/g, "");
  return normalizedText.includes(identity)
    ? { status: "matched", detail: "응답 본문에서 등록한 제조사 모델/SKU를 확인했습니다." }
    : { status: "not_found", detail: "응답 본문에서 등록한 제조사 모델/SKU를 찾지 못했습니다. URL과 변형을 수동 확인해야 합니다." };
}

async function identityFor(contentType: string | undefined, finalUrl: string, body: Uint8Array, manufacturerModel: string, truncated: boolean, pdfTextExtractor: (body: Uint8Array) => Promise<string | undefined>): Promise<{ status: PhysicalSourceIdentityStatus; detail: string }> {
  const isPdf = contentType?.includes("pdf") || /\.pdf(?:[?#]|$)/i.test(finalUrl);
  if (isPdf) {
    if (truncated) return { status: "manual_required", detail: "PDF 응답이 제한 용량을 넘어 URL 접근만 확인했습니다. 모델/SKU는 문서에서 수동 확인해야 합니다." };
    const extractedText = await pdfTextExtractor(body);
    if (!extractedText) return { status: "manual_required", detail: "PDF 텍스트를 추출하지 못해 URL 접근만 확인했습니다. 모델/SKU는 문서에서 수동 확인해야 합니다." };
    const identity = identityMatchFor(extractedText, manufacturerModel);
    return identity.status === "matched"
      ? { status: "matched", detail: "PDF 본문에서 등록한 제조사 모델/SKU를 확인했습니다." }
      : identity.status === "not_found"
        ? { status: "not_found", detail: "PDF 본문에서 등록한 제조사 모델/SKU를 찾지 못했습니다. URL과 변형을 수동 확인해야 합니다." }
        : identity;
  }
  const isText = !contentType || contentType.startsWith("text/") || contentType.includes("json") || contentType.includes("xml");
  if (!isText || truncated) return { status: "manual_required", detail: "문서가 비텍스트이거나 응답이 커서 URL 접근만 확인했습니다. 모델/SKU는 문서에서 수동 확인해야 합니다." };
  return identityMatchFor(new TextDecoder().decode(body), manufacturerModel);
}

async function pdftotextExtractor(body: Uint8Array) {
  return new Promise<string | undefined>((resolve) => {
    const child = spawn("pdftotext", ["-layout", "-", "-"], { stdio: ["pipe", "pipe", "ignore"] });
    const chunks: Buffer[] = [];
    let total = 0;
    let exceeded = false;
    let settled = false;
    const timer = setTimeout(() => {
      exceeded = true;
      child.kill();
    }, 4_000);
    const finish = (value: string | undefined) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    child.stdout.on("data", (chunk: Buffer) => {
      if (exceeded) return;
      total += chunk.byteLength;
      if (total > MAX_PDF_TEXT_BYTES) {
        exceeded = true;
        child.kill();
        return;
      }
      chunks.push(chunk);
    });
    child.once("error", () => finish(undefined));
    child.once("close", (code) => finish(code === 0 && !exceeded ? Buffer.concat(chunks, total).toString("utf8") : undefined));
    child.stdin.once("error", () => finish(undefined));
    child.stdin.end(Buffer.from(body));
  });
}

function checkedResult(base: Pick<PhysicalSourceCheck, "requestedUrl" | "checkedAt" | "redirectCount">, status: PhysicalSourceCheckStatus, identityStatus: PhysicalSourceIdentityStatus, detail: string, extra: Partial<PhysicalSourceCheck> = {}): PhysicalSourceCheck {
  return { ...base, status, identityStatus, detail, ...extra };
}

export async function checkPhysicalSourceUrl(rawUrl: string, manufacturerModel: string, dependencies: PhysicalSourceCheckDependencies = {}): Promise<PhysicalSourceCheck> {
  const requestedUrl = rawUrl.trim();
  const checkedAt = dependencies.now?.() ?? new Date().toISOString();
  const fetcher = dependencies.fetcher ?? ((input, init) => fetch(input, init));
  const lookup = dependencies.lookup ?? ((hostname, options) => dnsLookup(hostname, options));
  const pdfTextExtractor = dependencies.pdfTextExtractor ?? pdftotextExtractor;
  const timeoutMs = Math.max(1000, dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const maxRedirects = Math.max(0, dependencies.maxRedirects ?? MAX_REDIRECTS);
  const base = { requestedUrl, checkedAt, redirectCount: 0 } as const;
  let currentUrl = requestedUrl;
  let redirectCount = 0;

  while (true) {
    try {
      await publicHttpsUrlFor(currentUrl, lookup);
    } catch (error) {
      const status = error instanceof BlockedSourceError ? "blocked" : "unreachable";
      return checkedResult({ ...base, redirectCount }, status, "not_checked", error instanceof Error ? error.message : "근거 URL을 점검하지 못했습니다.", { finalUrl: currentUrl });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetcher(currentUrl, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "user-agent": "PC-Supporter-Physical-Evidence-Checker/1.0",
          accept: "text/html,application/xhtml+xml,application/pdf,text/plain,application/json"
        }
      });
    } catch (error) {
      clearTimeout(timer);
      return checkedResult({ ...base, redirectCount }, "unreachable", "not_checked", error instanceof Error && error.name === "AbortError" ? "근거 URL 응답 시간이 초과되었습니다." : "근거 URL에 연결하지 못했습니다.", { finalUrl: currentUrl });
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await cancelBody(response);
      if (!location) return checkedResult({ ...base, redirectCount }, "http_error", "not_checked", "리다이렉트 응답에 Location이 없습니다.", { finalUrl: currentUrl, httpStatus: response.status });
      if (redirectCount >= maxRedirects) return checkedResult({ ...base, redirectCount }, "http_error", "not_checked", `리다이렉트가 ${maxRedirects}회 한도를 초과했습니다.`, { finalUrl: currentUrl, httpStatus: response.status });
      try {
        currentUrl = new URL(location, currentUrl).toString();
      } catch {
        return checkedResult({ ...base, redirectCount }, "blocked", "not_checked", "리다이렉트 Location이 유효한 URL이 아닙니다.", { finalUrl: currentUrl, httpStatus: response.status });
      }
      redirectCount += 1;
      continue;
    }

    const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim() || undefined;
    if (!response.ok) {
      await cancelBody(response);
      return checkedResult({ ...base, redirectCount }, "http_error", "not_checked", `근거 URL이 HTTP ${response.status}를 반환했습니다.`, { finalUrl: currentUrl, httpStatus: response.status, ...(contentType ? { contentType } : {}) });
    }
    let body: { bytes: Uint8Array; truncated: boolean };
    try {
      const maxBodyBytes = contentType?.includes("pdf") || /\.pdf(?:[?#]|$)/i.test(currentUrl) ? MAX_PDF_BODY_BYTES : MAX_TEXT_BODY_BYTES;
      body = await boundedBodyFor(response, maxBodyBytes);
    } catch {
      return checkedResult({ ...base, redirectCount }, "unreachable", "not_checked", "근거 URL 응답 본문을 읽지 못했습니다.", { finalUrl: currentUrl, httpStatus: response.status, ...(contentType ? { contentType } : {}) });
    }
    const identity = await identityFor(contentType, currentUrl, body.bytes, manufacturerModel, body.truncated, pdfTextExtractor);
    const status: PhysicalSourceCheckStatus = identity.status === "not_found" ? "identity_mismatch" : redirectCount > 0 ? "redirected" : "reachable";
    return checkedResult({ ...base, redirectCount }, status, identity.status, identity.detail, { finalUrl: currentUrl, httpStatus: response.status, ...(contentType ? { contentType } : {}) });
  }
}
