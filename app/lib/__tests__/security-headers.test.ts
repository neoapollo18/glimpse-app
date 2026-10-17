import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { addSecurityHeaders } from "../security-headers.server";

const ADMIN = "https://glimpse-app-charles.onrender.com/app?shop=glamrco.myshopify.com&host=abc";
// What addDocumentResponseHeaders sets for an embedded admin request.
const FRAME_ANCESTORS =
  "frame-ancestors https://glamrco.myshopify.com https://admin.shopify.com https://*.spin.dev https://admin.myshopify.io https://admin.shop.dev;";

function documentHeaders(url: string, production: boolean, init?: HeadersInit): Headers {
  const headers = new Headers(init);
  addSecurityHeaders(new Request(url), headers, production);
  return headers;
}

describe("addSecurityHeaders", () => {
  it("adds HSTS, nosniff and the referrer policy to production documents", () => {
    const headers = documentHeaders(ADMIN, true);
    expect(headers.get("Strict-Transport-Security")).toBe("max-age=31536000; includeSubDomains");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });

  it("keeps Shopify's frame-ancestors and never sends X-Frame-Options (the admin is framed)", () => {
    const headers = documentHeaders(ADMIN, true, { "Content-Security-Policy": FRAME_ANCESTORS });
    expect(headers.get("Content-Security-Policy")).toBe(FRAME_ANCESTORS);
    expect(headers.has("X-Frame-Options")).toBe(false);
  });

  it("leaves HSTS out of dev, so localhost is never pinned to HTTPS", () => {
    const headers = documentHeaders("http://localhost:3000/app", false);
    expect(headers.has("Strict-Transport-Security")).toBe(false);
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });

  it("leaves HSTS off app proxy pages, which load from the merchant's domain", () => {
    const proxied = "https://glimpse-app-charles.onrender.com/proxy/preview/abc?shop=glamrco.myshopify.com";
    expect(documentHeaders(proxied, true).has("Strict-Transport-Security")).toBe(false);
    expect(documentHeaders("https://glimpse-app-charles.onrender.com/proxy", true).has("Strict-Transport-Security")).toBe(false);
    expect(documentHeaders("https://glimpse-app-charles.onrender.com/proxyish", true).has("Strict-Transport-Security")).toBe(true);
  });

  it("does not override a value a route already set", () => {
    const headers = documentHeaders(ADMIN, true, { "Referrer-Policy": "no-referrer" });
    expect(headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  it("runs on every document response, after Shopify's headers", () => {
    const entry = fs.readFileSync(path.resolve(__dirname, "../../entry.server.tsx"), "utf8");
    const shopify = entry.indexOf("addDocumentResponseHeaders(request, responseHeaders);");
    const ours = entry.indexOf("addSecurityHeaders(request, responseHeaders);");
    expect(shopify).toBeGreaterThan(-1);
    expect(ours).toBeGreaterThan(shopify);
  });
});
