import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { apiBaseUrlCspOrigin, BOOTSTRAP_FAILURE_SCRIPT_CSP_HASH, BOOTSTRAP_STYLE_CSP_HASH, contentSecurityPolicyMetaFromHtml, createContentSecurityPolicy, parseCspConnectOrigins, THEME_SCRIPT_CSP_HASH } from "./content-security-policy";
import { SAFE_EXTERNAL_SOURCE_HOSTS } from "./safe-source-url";

describe("Content Security Policy", () => {
  it("keeps the inline theme initializer tied to its exact SHA-256 source", () => {
    const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    expect(script).toBeTruthy();
    expect(`sha256-${createHash("sha256").update(script!).digest("base64")}`).toBe(THEME_SCRIPT_CSP_HASH);
  });

  it("allows only the exact inline bootstrap scripts and style in source and built HTML", () => {
    const sourceHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    const builtHtmlUrl = new URL("../dist/index.html", import.meta.url);
    const documents = [sourceHtml];
    if (existsSync(builtHtmlUrl)) documents.push(readFileSync(builtHtmlUrl, "utf8"));

    for (const html of documents) {
      const inlineScripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
      const inlineStyles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/gi)].map((match) => match[1]);
      const scriptHashes = inlineScripts.map((script) => `sha256-${createHash("sha256").update(script).digest("base64")}`);
      const styleHashes = inlineStyles.map((style) => `sha256-${createHash("sha256").update(style).digest("base64")}`);
      const policy = contentSecurityPolicyMetaFromHtml(html) ?? createContentSecurityPolicy();
      const directives = new Map(policy.split(";").map((directive) => {
        const [name, ...sources] = directive.trim().split(/\s+/);
        return [name, sources];
      }));
      const scriptSources = directives.get("script-src") ?? [];
      const styleElementSources = directives.get("style-src-elem") ?? [];

      expect(scriptHashes).toEqual([THEME_SCRIPT_CSP_HASH, BOOTSTRAP_FAILURE_SCRIPT_CSP_HASH]);
      expect(styleHashes).toEqual([BOOTSTRAP_STYLE_CSP_HASH]);
      expect(scriptSources).toContain(`'${THEME_SCRIPT_CSP_HASH}'`);
      expect(scriptSources).toContain(`'${BOOTSTRAP_FAILURE_SCRIPT_CSP_HASH}'`);
      expect(scriptSources).not.toContain("'unsafe-inline'");
      expect(styleElementSources).toContain(`'${BOOTSTRAP_STYLE_CSP_HASH}'`);
      expect(styleElementSources).not.toContain("'unsafe-inline'");
    }
  });

  it("reduces an API base URL to its HTTP(S) origin and rejects unsafe schemes", () => {
    expect(apiBaseUrlCspOrigin("https://api.example.com/v1/" )).toBe("https://api.example.com");
    expect(apiBaseUrlCspOrigin("http://10.0.2.2:4174")).toBe("http://10.0.2.2:4174");
    expect(apiBaseUrlCspOrigin("")).toBeUndefined();
    expect(() => apiBaseUrlCspOrigin("javascript:alert(1)")).toThrow(/HTTP\(S\)/);
    expect(() => apiBaseUrlCspOrigin("https://user:secret@api.example.com")).toThrow(/credentials/);
  });

  it("parses only explicit canonical HTTP(S) connect origins", () => {
    expect(parseCspConnectOrigins("https://api.example.com, http://localhost:4174,https://api.example.com"))
      .toEqual(["https://api.example.com", "http://localhost:4174"]);
    expect(() => parseCspConnectOrigins("https://api.example.com/path")).toThrow(/origins without paths/);
    expect(() => parseCspConnectOrigins("https://api.example.com; script-src *")).toThrow(/HTTP\(S\) origins/);
  });

  it("reads one HTML policy meta value and decodes its CSP attribute", () => {
    const policy = createContentSecurityPolicy({ connectOrigins: ["https://api.example.com"] });
    const html = `<head><meta http-equiv="Content-Security-Policy" content="${policy.replaceAll("'", "&#39;")}"></head>`;
    expect(contentSecurityPolicyMetaFromHtml(html)).toBe(policy);
    expect(() => contentSecurityPolicyMetaFromHtml(`${html}${html}`)).toThrow(/multiple/);
  });

  it("keeps remote document sources scoped to the app's actual dependencies", () => {
    const policy = createContentSecurityPolicy({
      connectOrigins: ["https://api.example.com"],
      includeFrameAncestors: true
    });

    expect(policy).toContain(`script-src 'self' '${THEME_SCRIPT_CSP_HASH}'`);
    expect(policy).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("script-src-attr 'none'");
    expect(policy).toContain("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com");
    expect(policy).toContain(`style-src-elem 'self' '${BOOTSTRAP_STYLE_CSP_HASH}' https://fonts.googleapis.com`);
    expect(policy).toContain("style-src-attr 'unsafe-inline'");
    expect(policy).toContain("font-src 'self' https://fonts.gstatic.com");
    for (const host of SAFE_EXTERNAL_SOURCE_HOSTS) {
      expect(policy).toContain(`img-src 'self' ${SAFE_EXTERNAL_SOURCE_HOSTS.map((item) => `https://${item}`).join(" ")}`);
      expect(policy).toContain(`https://${host}`);
    }
    expect(policy).toContain("connect-src 'self' https://api.example.com");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
  });
});
