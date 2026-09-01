import { describe, expect, it } from "vitest";
import { physicalSourceCheckFreshness, physicalSourceCheckNeedsReview } from "../shared/physical-source-check";
import { checkPhysicalSourceUrl } from "./physical-source-check";

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];
const now = () => "2026-09-01T00:00:00.000Z";

describe("physical source URL check", () => {
  it("confirms a reachable text page and matching manufacturer identity", async () => {
    const result = await checkPhysicalSourceUrl("https://vendor.example/gpu", "SKU-123", {
      lookup: publicLookup,
      now,
      fetcher: async () => new Response("<html>Manufacturer SKU-123 specifications</html>", { status: 200, headers: { "content-type": "text/html" } })
    });

    expect(result).toMatchObject({ status: "reachable", identityStatus: "matched", httpStatus: 200, redirectCount: 0, finalUrl: "https://vendor.example/gpu" });
    expect(physicalSourceCheckNeedsReview(result)).toBe(false);
  });

  it("follows a bounded HTTPS redirect and reports the final identity", async () => {
    const requestedUrls: string[] = [];
    const result = await checkPhysicalSourceUrl("https://vendor.example/redirect", "SKU-REDIRECT", {
      lookup: publicLookup,
      now,
      fetcher: async (url) => {
        requestedUrls.push(url);
        return url.endsWith("/redirect")
          ? new Response(null, { status: 302, headers: { location: "https://vendor.example/final" } })
          : new Response("SKU-REDIRECT", { status: 200, headers: { "content-type": "text/plain" } });
      }
    });

    expect(result).toMatchObject({ status: "redirected", identityStatus: "matched", redirectCount: 1, finalUrl: "https://vendor.example/final" });
    expect(requestedUrls).toEqual(["https://vendor.example/redirect", "https://vendor.example/final"]);
  });

  it("downgrades a reachable page when the registered model is not found", async () => {
    const result = await checkPhysicalSourceUrl("https://vendor.example/wrong-model", "SKU-EXPECTED", {
      lookup: publicLookup,
      now,
      fetcher: async () => new Response("<html>SKU-OTHER</html>", { status: 200, headers: { "content-type": "text/html" } })
    });

    expect(result).toMatchObject({ status: "identity_mismatch", identityStatus: "not_found", httpStatus: 200 });
    expect(physicalSourceCheckNeedsReview(result)).toBe(true);
  });

  it("does not claim PDF identity from bytes and leaves the document for manual review", async () => {
    const result = await checkPhysicalSourceUrl("https://vendor.example/manual.pdf", "SKU-PDF", {
      lookup: publicLookup,
      now,
      pdfTextExtractor: async () => undefined,
      fetcher: async () => new Response(new Uint8Array([37, 80, 68, 70]), { status: 200, headers: { "content-type": "application/pdf" } })
    });

    expect(result).toMatchObject({ status: "reachable", identityStatus: "manual_required", contentType: "application/pdf" });
    expect(physicalSourceCheckNeedsReview(result)).toBe(true);
  });

  it("confirms a PDF model when the optional extractor returns document text", async () => {
    const result = await checkPhysicalSourceUrl("https://vendor.example/extracted.pdf", "SKU-PDF-EXTRACTED", {
      lookup: publicLookup,
      now,
      pdfTextExtractor: async () => "Manufacturer brochure SKU-PDF-EXTRACTED",
      fetcher: async () => new Response(new Uint8Array([37, 80, 68, 70]), { status: 200, headers: { "content-type": "application/pdf" } })
    });

    expect(result).toMatchObject({ status: "reachable", identityStatus: "matched", contentType: "application/pdf" });
    expect(result.detail).toContain("PDF 본문");
    expect(physicalSourceCheckNeedsReview(result)).toBe(false);
  });

  it("does not run PDF extraction after the bounded document body limit", async () => {
    let extractorCalls = 0;
    const result = await checkPhysicalSourceUrl("https://vendor.example/large.pdf", "SKU-LARGE", {
      lookup: publicLookup,
      now,
      pdfTextExtractor: async () => {
        extractorCalls += 1;
        return "SKU-LARGE";
      },
      fetcher: async () => new Response(new Uint8Array(8 * 1024 * 1024 + 1), { status: 200, headers: { "content-type": "application/pdf" } })
    });

    expect(result).toMatchObject({ status: "reachable", identityStatus: "manual_required" });
    expect(extractorCalls).toBe(0);
    expect(physicalSourceCheckNeedsReview(result)).toBe(true);
  });

  it("blocks private DNS results and never sends the request", async () => {
    let fetchCount = 0;
    const privateResult = await checkPhysicalSourceUrl("https://internal.example/manual", "SKU-INTERNAL", {
      now,
      lookup: async () => [{ address: "127.0.0.1", family: 4 }],
      fetcher: async () => {
        fetchCount += 1;
        return new Response("should not be fetched", { status: 200 });
      }
    });
    const insecureResult = await checkPhysicalSourceUrl("http://vendor.example/manual", "SKU-INSECURE", {
      now,
      lookup: publicLookup,
      fetcher: async () => {
        fetchCount += 1;
        return new Response("should not be fetched", { status: 200 });
      }
    });

    expect(privateResult).toMatchObject({ status: "blocked", identityStatus: "not_checked" });
    expect(insecureResult).toMatchObject({ status: "blocked", identityStatus: "not_checked" });
    expect(fetchCount).toBe(0);
    expect(physicalSourceCheckNeedsReview(privateResult)).toBe(true);
    expect(physicalSourceCheckNeedsReview(insecureResult)).toBe(true);
  });

  it("reports HTTP failures and connection failures separately from blocked URLs", async () => {
    const httpFailure = await checkPhysicalSourceUrl("https://vendor.example/missing", "SKU-MISSING", {
      lookup: publicLookup,
      now,
      fetcher: async () => new Response(null, { status: 404 })
    });
    const connectionFailure = await checkPhysicalSourceUrl("https://vendor.example/offline", "SKU-OFFLINE", {
      lookup: publicLookup,
      now,
      fetcher: async () => { throw new Error("offline"); }
    });

    expect(httpFailure).toMatchObject({ status: "http_error", identityStatus: "not_checked", httpStatus: 404 });
    expect(connectionFailure).toMatchObject({ status: "unreachable", identityStatus: "not_checked" });
  });

  it("requires a new check when a saved URL check is stale or has never been run", () => {
    const staleCheck = {
      requestedUrl: "https://vendor.example/manual",
      checkedAt: "2026-07-01T00:00:00.000Z",
      status: "reachable" as const,
      identityStatus: "matched" as const,
      redirectCount: 0
    };

    expect(physicalSourceCheckFreshness(staleCheck, "2026-09-01T00:00:00.000Z")).toBe("stale");
    expect(physicalSourceCheckNeedsReview(staleCheck, true, "2026-09-01T00:00:00.000Z")).toBe(true);
    expect(physicalSourceCheckNeedsReview(undefined, true)).toBe(true);
    expect(physicalSourceCheckNeedsReview(undefined, false)).toBe(false);
  });
});
