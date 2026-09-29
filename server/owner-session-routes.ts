import { createHash } from "node:crypto";
import express, { type Request, type RequestHandler, type Response } from "express";
import { isOwnerSessionResourceType } from "../shared/owner-session-contract";
import type { OwnerSessionResourceType } from "../shared/owner-session-contract";
import { hashShareOwnerToken, shareOwnerOrEnabledAdminCanManage, shareOwnerTokenMatches } from "./build-share";
import { corsOriginIsAllowed } from "./origin-policy";
import {
  clearOwnerSessionCookie,
  createOwnerSessionToken,
  OWNER_SESSION_COOKIE_MAX_AGE_SECONDS,
  OWNER_SESSION_COOKIE_NAME,
  ownerSessionCookieModeFor,
  ownerSessionCookieTokenForRequest,
  ownerSessionHashFromRequest,
  setOwnerSessionCookie
} from "./owner-session-cookie";

export { OWNER_SESSION_RESOURCE_TYPES } from "../shared/owner-session-contract";
export type { OwnerSessionResourceType } from "../shared/owner-session-contract";

export const OWNER_SESSION_MODE_HEADER = "X-PC-Owner-Mode";
export const OWNER_SESSION_MODE_VALUE = "session-v1";
export const OWNER_SESSION_MIGRATION_MAX_ITEMS = 200;
export const OWNER_SESSION_MIGRATION_MAX_BODY_BYTES = 64 * 1024;

export interface OwnerSessionResource {
  id: string;
  ownerTokenHash?: string;
  expiresAt?: string;
}

export interface OwnerSessionGrant {
  sessionHash: string;
  resourceType: OwnerSessionResourceType;
  resourceId: string;
  ownerTokenHash: string;
  createdAt: string;
  expiresAt?: string;
}

export interface OwnerSessionGrantReference {
  resourceType: OwnerSessionResourceType;
  resourceId: string;
  ownerTokenHash: string;
}

export interface OwnerSessionStoreApi {
  createOwnerShareSession(session: { sessionHash: string; createdAt: string; expiresAt: string }): Promise<void>;
  ownerShareSessionIsActive(sessionHash: string, now?: Date | string): Promise<boolean>;
  deleteOwnerShareSession(sessionHash: string): Promise<boolean>;
  pruneExpiredOwnerShareSessions(limit?: number, now?: Date | string): Promise<number>;
  pruneExpiredOwnerShareSessionGrants?(limit?: number, now?: Date | string): Promise<number>;
  upsertOwnerShareSessionGrant(grant: OwnerSessionGrant, now?: Date | string): Promise<boolean>;
  ownerShareSessionGrantMatches(query: {
    sessionHash: string;
    resourceType: OwnerSessionResourceType;
    resourceId: string;
    ownerTokenHash: string;
    now?: Date | string;
  }): Promise<boolean>;
  listOwnerShareSessionGrants(sessionHash: string, now?: Date | string): Promise<OwnerSessionGrantReference[]>;
}

export interface OwnerSessionRouteDependencies extends OwnerSessionStoreApi {
  readResources(resourceType: OwnerSessionResourceType): Promise<OwnerSessionResource[]>;
  migrationRateLimit: RequestHandler;
}

type OwnerSessionCookieState = {
  present: boolean;
  count: number;
  token?: string;
};

function ownerSessionCookieState(request: Pick<Request, "headers">): OwnerSessionCookieState {
  const header = request.headers.cookie;
  if (!header) return { present: false, count: 0 };
  const entries = header.split(";").map((entry) => entry.trim());
  const matches = entries.filter((entry) => {
    const separator = entry.indexOf("=");
    return (separator < 0 ? entry : entry.slice(0, separator)).trim() === OWNER_SESSION_COOKIE_NAME;
  });
  if (matches.length !== 1) return { present: matches.length > 0, count: matches.length };
  return {
    present: true,
    count: 1,
    ...(ownerSessionCookieTokenForRequest(request as Request) ? { token: ownerSessionCookieTokenForRequest(request as Request) } : {})
  };
}

export function ownerSessionModeRequested(request: Pick<Request, "header">) {
  return request.header(OWNER_SESSION_MODE_HEADER)?.trim() === OWNER_SESSION_MODE_VALUE;
}

function requestOrigin(request: Pick<Request, "protocol" | "get">) {
  try {
    const host = request.get("host");
    if (!host) return undefined;
    return new URL(`${request.protocol}://${host}`).origin;
  } catch {
    return undefined;
  }
}

export function ownerSessionOriginIsAllowed(request: Pick<Request, "protocol" | "header" | "get">) {
  const origin = request.header("Origin");
  if (!origin) return false;
  if (corsOriginIsAllowed(origin)) return true;
  return origin === requestOrigin(request);
}

type OwnerSessionContextIssue = "duplicate-cookie" | "origin-invalid" | "cookie-policy-unsupported";

function ownerSessionContextIssue(request: Request, requireOrigin: boolean): OwnerSessionContextIssue | undefined {
  const cookie = ownerSessionCookieState(request);
  if (cookie.count > 1) return "duplicate-cookie";
  const origin = request.header("Origin");
  if (requireOrigin || origin !== undefined) {
    if (!ownerSessionOriginIsAllowed(request)) return "origin-invalid";
    if (!ownerSessionCookieModeFor(request).supported) return "cookie-policy-unsupported";
  }
  return undefined;
}

function contextIssueResponse(response: Response, issue: OwnerSessionContextIssue) {
  if (issue === "duplicate-cookie") {
    response.status(400).json({ error: "세션 쿠키가 중복되었습니다.", code: "OWNER_SESSION_COOKIE_DUPLICATE" });
    return;
  }
  if (issue === "origin-invalid") {
    response.status(403).json({ error: "세션 요청의 출처를 확인할 수 없습니다.", code: "OWNER_SESSION_ORIGIN_INVALID" });
    return;
  }
  response.status(403).json({ error: "현재 연결에서는 보안 세션 쿠키를 사용할 수 없습니다.", code: "OWNER_SESSION_COOKIE_POLICY_UNSUPPORTED" });
}

/**
 * For unsafe owner operations, an attached session cookie or explicit session
 * mode opts the request into strict Origin validation. Legacy bearer requests
 * without either marker retain their existing header contract.
 */
export function ownerSessionUnsafeOriginAllowed(request: Request) {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;
  const cookie = ownerSessionCookieState(request);
  if (!cookie.present && !ownerSessionModeRequested(request)) return true;
  if (cookie.count > 1) return false;
  return ownerSessionContextIssue(request, true) === undefined;
}

export const requireOwnerSessionUnsafeOrigin: RequestHandler = (request, response, next) => {
  if (ownerSessionUnsafeOriginAllowed(request)) {
    next();
    return;
  }
  const issue = ownerSessionContextIssue(request, true);
  contextIssueResponse(response, issue ?? "origin-invalid");
};

export const requireOwnerSessionCreationContext: RequestHandler = (request, response, next) => {
  if (!ownerSessionModeRequested(request)) {
    next();
    return;
  }
  const issue = ownerSessionContextIssue(request, true);
  if (!issue) {
    next();
    return;
  }
  contextIssueResponse(response, issue);
};

function validResourceType(value: unknown): value is OwnerSessionResourceType {
  return isOwnerSessionResourceType(value);
}

function validResourceId(value: unknown): value is string {
  return typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= 512 && !value.includes("\u0000");
}

function validOwnerToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

function activeResource(resource: OwnerSessionResource | undefined, now: number) {
  if (!resource || !validResourceId(resource.id)) return false;
  if (resource.expiresAt === undefined) return true;
  const expiry = Date.parse(resource.expiresAt);
  return Number.isFinite(expiry) && expiry > now;
}

function grantExpiryFor(resourceType: OwnerSessionResourceType, resource: OwnerSessionResource) {
  // Watchlists can have their expiry edited in place. Their current record is
  // checked on every request, so pinning the old expiry into a session grant
  // would revoke a still-valid resource when its owner extends the link.
  return resourceType === "watchlist" ? undefined : resource.expiresAt;
}

function validOwnerTokenHash(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function ownerSessionRouteContext(request: Request, response: Response, requireOrigin = true) {
  const issue = ownerSessionContextIssue(request, requireOrigin);
  if (issue) {
    contextIssueResponse(response, issue);
    return undefined;
  }
  const sessionHash = ownerSessionHashFromRequest(request);
  if (!sessionHash) {
    response.status(401).json({ error: "소유자 세션이 필요합니다.", code: "OWNER_SESSION_REQUIRED" });
    return undefined;
  }
  return sessionHash;
}

/**
 * Returns undefined only for a legacy request with no session marker. A
 * session-marked request never falls back to its legacy owner-token header.
 */
export async function ownerSessionGrantAllowsRequest(
  request: Request,
  resourceType: OwnerSessionResourceType,
  resource: OwnerSessionResource,
  store: OwnerSessionStoreApi
): Promise<boolean | undefined> {
  const cookie = ownerSessionCookieState(request);
  const sessionRequested = ownerSessionModeRequested(request) || cookie.present;
  if (!sessionRequested) return undefined;
  if (cookie.count !== 1 || !cookie.token || !validOwnerTokenHash(resource.ownerTokenHash)) return false;
  const sessionHash = createHash("sha256").update(cookie.token).digest("hex");
  if (!await store.ownerShareSessionIsActive(sessionHash)) return false;
  return store.ownerShareSessionGrantMatches({
    sessionHash,
    resourceType,
    resourceId: resource.id,
    ownerTokenHash: resource.ownerTokenHash
  });
}

export async function ownerSessionOrLegacyTokenOrAdminCanManage(
  request: Request,
  resourceType: OwnerSessionResourceType,
  resource: OwnerSessionResource,
  ownerToken: string | undefined,
  adminEnabled: boolean,
  adminAuthenticated: boolean,
  store: OwnerSessionStoreApi,
  allowAdmin = true
) {
  if (allowAdmin && adminEnabled && adminAuthenticated) return true;
  const sessionPermission = await ownerSessionGrantAllowsRequest(request, resourceType, resource, store);
  if (sessionPermission === true) return true;
  // An explicit session-v1 request is cookie-only and must never fall back to
  // a bearer header. Unversioned clients retain their legacy token contract;
  // a duplicated cookie stays fail-closed at the owner boundary.
  if (ownerSessionModeRequested(request) || ownerSessionCookieState(request).count > 1) return false;
  return allowAdmin
    ? shareOwnerOrEnabledAdminCanManage(resource, ownerToken, adminEnabled, adminAuthenticated)
    : shareOwnerTokenMatches(resource, ownerToken);
}

/**
 * Attaches a persisted share resource to the requesting browser's owner
 * session. If this fails, the caller's rollback is awaited before a failure
 * response is sent, so no bearer token has to be exposed as a fallback.
 */
export async function attachOwnerSessionGrant(
  request: Request,
  response: Response,
  resourceType: OwnerSessionResourceType,
  resource: OwnerSessionResource,
  store: OwnerSessionStoreApi,
  rollback?: () => Promise<unknown>
): Promise<boolean | undefined> {
  if (!ownerSessionModeRequested(request)) return false;
  const issue = ownerSessionContextIssue(request, true);
  if (issue) {
    try { await rollback?.(); } catch { /* Keep the credential failure response non-sensitive. */ }
    contextIssueResponse(response, issue);
    return undefined;
  }
  if (!activeResource(resource, Date.now()) || !validOwnerTokenHash(resource.ownerTokenHash)) {
    try { await rollback?.(); } catch { /* Keep the credential failure response non-sensitive. */ }
    response.status(503).json({ error: "공유 항목의 소유권 연결을 완료하지 못했습니다.", code: "OWNER_SESSION_GRANT_FAILED" });
    return undefined;
  }

  const now = new Date();
  const createdAt = now.toISOString();
  try {
    await store.pruneExpiredOwnerShareSessions(100, now);
    await store.pruneExpiredOwnerShareSessionGrants?.(100, now);
  } catch { /* Pruning is bounded housekeeping; authorization remains fail-closed. */ }
  let sessionHash = ownerSessionHashFromRequest(request);
  let sessionToken: string | undefined;
  let createdSession = false;
  try {
    if (!sessionHash || !await store.ownerShareSessionIsActive(sessionHash, now)) {
      const generated = createOwnerSessionToken();
      sessionHash = generated.hash;
      sessionToken = generated.token;
      await store.createOwnerShareSession({
        sessionHash,
        createdAt,
        expiresAt: new Date(now.getTime() + OWNER_SESSION_COOKIE_MAX_AGE_SECONDS * 1_000).toISOString()
      });
      createdSession = true;
    }

    const grantSaved = await store.upsertOwnerShareSessionGrant({
      sessionHash,
      resourceType,
      resourceId: resource.id,
      ownerTokenHash: resource.ownerTokenHash,
      createdAt,
      ...(grantExpiryFor(resourceType, resource) ? { expiresAt: grantExpiryFor(resourceType, resource) } : {})
    }, now);
    if (!grantSaved) throw new Error("session no longer active");
    if (sessionToken && !setOwnerSessionCookie(response, request, sessionToken)) throw new Error("cookie policy rejected issuance");
    return true;
  } catch {
    if (createdSession && sessionHash) {
      try { await store.deleteOwnerShareSession(sessionHash); } catch { /* Bounded session pruning removes expired residue. */ }
    }
    try { await rollback?.(); } catch { /* Keep the credential failure response non-sensitive. */ }
    response.status(503).json({ error: "공유 항목의 소유권 연결을 완료하지 못했습니다.", code: "OWNER_SESSION_GRANT_FAILED" });
    return undefined;
  }
}

export function ownerManagedShareResponse<T extends object>(
  publicPayload: T,
  ownerToken: string,
  ownerManaged: boolean
): T & ({ ownerManaged: true } | { ownerToken: string }) {
  return ownerManaged ? { ...publicPayload, ownerManaged: true } : { ...publicPayload, ownerToken } as T & { ownerToken: string };
}

function migrationItemResult(index: number, status: "migrated" | "rejected", code?: string) {
  return { index, status, ...(code ? { code } : {}) };
}

export function createOwnerSessionRouter(dependencies: OwnerSessionRouteDependencies) {
  const router = express.Router();

  router.use((_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    next();
  });

  router.post("/migrate", dependencies.migrationRateLimit, async (request, response) => {
    const issue = ownerSessionContextIssue(request, true);
    if (issue) {
      contextIssueResponse(response, issue);
      return;
    }

    const body = request.body && typeof request.body === "object" && !Array.isArray(request.body)
      ? request.body as Record<string, unknown>
      : undefined;
    const rawItems = body?.items;
    if (!Array.isArray(rawItems)) {
      response.status(400).json({ error: "items 배열이 필요합니다.", code: "OWNER_SESSION_MIGRATION_ITEMS_INVALID" });
      return;
    }
    if (rawItems.length > OWNER_SESSION_MIGRATION_MAX_ITEMS) {
      response.status(400).json({ error: `한 번에 최대 ${OWNER_SESSION_MIGRATION_MAX_ITEMS}개까지 옮길 수 있습니다.`, code: "OWNER_SESSION_MIGRATION_TOO_LARGE" });
      return;
    }
    const bodyBytes = Buffer.byteLength(JSON.stringify(body), "utf8");
    const contentLength = Number(request.header("content-length"));
    if (bodyBytes > OWNER_SESSION_MIGRATION_MAX_BODY_BYTES || Number.isFinite(contentLength) && contentLength > OWNER_SESSION_MIGRATION_MAX_BODY_BYTES) {
      response.status(413).json({ error: "세션 이전 요청 본문이 너무 큽니다.", code: "OWNER_SESSION_MIGRATION_BODY_TOO_LARGE" });
      return;
    }
    if (rawItems.length === 0) {
      response.json({ migratedCount: 0, rejectedCount: 0, items: [] });
      return;
    }

    const now = new Date();
    const existingSessionHash = ownerSessionHashFromRequest(request);
    let sessionHash: string | undefined;
    try {
      await dependencies.pruneExpiredOwnerShareSessions(100, now);
      await dependencies.pruneExpiredOwnerShareSessionGrants?.(100, now);
      if (existingSessionHash && await dependencies.ownerShareSessionIsActive(existingSessionHash, now)) sessionHash = existingSessionHash;
    } catch {
      response.status(503).json({ error: "소유자 세션을 확인할 수 없습니다.", code: "OWNER_SESSION_UNAVAILABLE" });
      return;
    }

    let newSessionToken: string | undefined;
    let createdSession = false;
    if (!sessionHash) {
      const generated = createOwnerSessionToken();
      sessionHash = generated.hash;
      newSessionToken = generated.token;
      try {
        await dependencies.createOwnerShareSession({
          sessionHash,
          createdAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + OWNER_SESSION_COOKIE_MAX_AGE_SECONDS * 1_000).toISOString()
        });
        createdSession = true;
      } catch {
        response.status(503).json({ error: "소유자 세션을 시작할 수 없습니다.", code: "OWNER_SESSION_UNAVAILABLE" });
        return;
      }
    }

    const results: Array<ReturnType<typeof migrationItemResult>> = [];
    const resourceMaps = new Map<OwnerSessionResourceType, Map<string, OwnerSessionResource>>();
    for (const [index, rawItem] of rawItems.entries()) {
      if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
        results.push(migrationItemResult(index, "rejected", "ITEM_INVALID"));
        continue;
      }
      const item = rawItem as Record<string, unknown>;
      if (!validResourceType(item.resourceType) || !validResourceId(item.resourceId) || !validOwnerToken(item.ownerToken)) {
        results.push(migrationItemResult(index, "rejected", "CREDENTIAL_INVALID"));
        continue;
      }

      let resourcesById = resourceMaps.get(item.resourceType);
      if (!resourcesById) {
        try {
          resourcesById = new Map((await dependencies.readResources(item.resourceType)).map((resource) => [resource.id, resource]));
          resourceMaps.set(item.resourceType, resourcesById);
        } catch {
          results.push(migrationItemResult(index, "rejected", "RESOURCE_LOOKUP_FAILED"));
          continue;
        }
      }
      const resource = resourcesById.get(item.resourceId);
      if (!resource) {
        results.push(migrationItemResult(index, "rejected", "RESOURCE_UNAVAILABLE"));
        continue;
      }
      if (!activeResource(resource, now.getTime()) || resource?.id !== item.resourceId || !validOwnerTokenHash(resource.ownerTokenHash)) {
        results.push(migrationItemResult(index, "rejected", "RESOURCE_UNAVAILABLE"));
        continue;
      }
      if (!shareOwnerTokenMatches(resource, item.ownerToken)) {
        results.push(migrationItemResult(index, "rejected", "OWNER_TOKEN_MISMATCH"));
        continue;
      }
      try {
        const saved = await dependencies.upsertOwnerShareSessionGrant({
          sessionHash,
          resourceType: item.resourceType,
          resourceId: resource.id,
          ownerTokenHash: hashShareOwnerToken(item.ownerToken),
          createdAt: now.toISOString(),
          ...(grantExpiryFor(item.resourceType, resource) ? { expiresAt: grantExpiryFor(item.resourceType, resource) } : {})
        }, now);
        results.push(saved
          ? migrationItemResult(index, "migrated")
          : migrationItemResult(index, "rejected", "OWNER_SESSION_EXPIRED"));
      } catch {
        results.push(migrationItemResult(index, "rejected", "GRANT_SAVE_FAILED"));
      }
    }

    const migratedCount = results.filter((result) => result.status === "migrated").length;
    if (createdSession && newSessionToken && sessionHash) {
      if (migratedCount === 0) {
        try { await dependencies.deleteOwnerShareSession(sessionHash); } catch { /* The unissued session is inaccessible and bounded pruning removes expiry residue. */ }
      } else if (!setOwnerSessionCookie(response, request, newSessionToken)) {
        try { await dependencies.deleteOwnerShareSession(sessionHash); } catch { /* The unissued session is inaccessible and bounded pruning removes expiry residue. */ }
        response.status(403).json({ error: "세션 쿠키를 안전하게 발급할 수 없습니다.", code: "OWNER_SESSION_COOKIE_POLICY_UNSUPPORTED" });
        return;
      }
    }
    response.json({
      migratedCount,
      rejectedCount: results.length - migratedCount,
      items: results
    });
  });

  router.get("/resources", async (request, response) => {
    const sessionHash = ownerSessionRouteContext(request, response, request.header("Origin") !== undefined);
    if (!sessionHash) return;
    const now = new Date();
    try {
      await dependencies.pruneExpiredOwnerShareSessions(100, now);
      await dependencies.pruneExpiredOwnerShareSessionGrants?.(100, now);
      if (!await dependencies.ownerShareSessionIsActive(sessionHash, now)) {
        response.status(401).json({ error: "소유자 세션이 만료되었습니다.", code: "OWNER_SESSION_EXPIRED" });
        return;
      }
      const grants = await dependencies.listOwnerShareSessionGrants(sessionHash, now);
      const resourceMaps = new Map<OwnerSessionResourceType, Map<string, OwnerSessionResource>>();
      for (const resourceType of new Set(grants.map((grant) => grant.resourceType))) {
        resourceMaps.set(resourceType, new Map((await dependencies.readResources(resourceType)).map((resource) => [resource.id, resource])));
      }
      const resources = new Map<string, { id: string; kind: OwnerSessionResourceType }>();
      for (const grant of grants) {
        const resource = resourceMaps.get(grant.resourceType)?.get(grant.resourceId);
        if (!activeResource(resource, now.getTime()) || resource?.id !== grant.resourceId || resource.ownerTokenHash !== grant.ownerTokenHash) continue;
        resources.set(`${grant.resourceType}\u0000${grant.resourceId}`, { id: grant.resourceId, kind: grant.resourceType });
      }
      response.json({ resources: [...resources.values()].sort((left, right) => left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id)) });
    } catch {
      response.status(503).json({ error: "소유자 세션 항목을 불러오지 못했습니다.", code: "OWNER_SESSION_UNAVAILABLE" });
    }
  });

  router.delete("/", async (request, response) => {
    const issue = ownerSessionContextIssue(request, true);
    if (issue) {
      contextIssueResponse(response, issue);
      return;
    }
    const sessionHash = ownerSessionHashFromRequest(request);
    try {
      if (sessionHash) await dependencies.deleteOwnerShareSession(sessionHash);
      if (!clearOwnerSessionCookie(response, request)) {
        response.status(403).json({ error: "세션 쿠키를 안전하게 지울 수 없습니다.", code: "OWNER_SESSION_COOKIE_POLICY_UNSUPPORTED" });
        return;
      }
      response.json({ loggedOut: true });
    } catch {
      response.status(503).json({ error: "소유자 세션을 종료하지 못했습니다.", code: "OWNER_SESSION_REVOKE_FAILED" });
    }
  });

  return router;
}
