export type ApiRequestInit = RequestInit & {
  retry?: number;
  retryDelayMs?: number;
};

export class ApiError extends Error {
  readonly status: number;
  readonly details: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

function isRetryableStatus(status: number) {
  return status === 502 || status === 503 || status === 504;
}

export async function api<T>(path: string, init?: ApiRequestInit): Promise<T> {
  const { retry: requestedRetries, retryDelayMs = 250, ...requestInit } = init ?? {};
  const method = (requestInit.method ?? "GET").toUpperCase();
  const retries = Math.max(0, Math.min(3, requestedRetries ?? (method === "GET" || method === "HEAD" ? 2 : 0)));
  let lastNetworkError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(path, {
        ...requestInit,
        headers: {
          "Content-Type": "application/json",
          ...(requestInit.headers ?? {})
        }
      });
    } catch (error) {
      lastNetworkError = error;
      if (!(error instanceof TypeError && /fetch|network|connect/i.test(error.message)) || attempt >= retries) {
        if (error instanceof TypeError && /fetch|network|connect/i.test(error.message)) {
          throw new Error("API 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.");
        }
        throw error;
      }
      await wait(retryDelayMs * (attempt + 1));
      continue;
    }

    const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
    if (response.ok) return payload;
    if (isRetryableStatus(response.status) && attempt < retries) {
      await wait(retryDelayMs * (attempt + 1));
      continue;
    }
    throw new ApiError(payload.error ?? `요청에 실패했습니다. (${response.status})`, response.status, payload);
  }

  throw new Error(lastNetworkError instanceof Error ? lastNetworkError.message : "요청에 실패했습니다.");
}
