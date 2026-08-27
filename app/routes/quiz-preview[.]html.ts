import type { LoaderFunctionArgs } from "@remix-run/node";
import fs from "node:fs";
import path from "node:path";
import jwt from "jsonwebtoken";
import { getQuizDraft, captureLiveConfig } from "../lib/quiz-draft.server";
import {
  buildPreviewFlow,
  buildPreviewQuizConfig,
  buildPreviewSampleRecommend,
} from "../lib/quiz-preview.server";

// Draft quiz preview document, rendered inside an iframe in the admin Quiz
// Builder. Lives OUTSIDE the /app layout because embedded-admin iframes
// don't share the Shopify session cookie — auth is a short-lived JWT minted
// by the builder's loader and passed as ?token=.
//
// The document is self-contained: real storefront quiz CSS/JS inlined, with
// window.GLEAME_QUIZ_PREVIEW injected so the widget renders the DRAFT and
// stubs all network side effects (see gleame-quiz.js preview mode).

const ASSETS_DIR = path.join(process.cwd(), "extensions", "glimpse-widget", "assets");

// Assets are immutable per deploy — cache them (sync disk reads block the
// event loop for every concurrent request otherwise). Dev skips the cache so
// widget edits show up on refresh.
const assetCache = new Map<string, string>();
function readAsset(name: string): string {
  if (process.env.NODE_ENV === "production" && assetCache.has(name)) return assetCache.get(name)!;
  try {
    const content = fs.readFileSync(path.join(ASSETS_DIR, name), "utf8");
    assetCache.set(name, content);
    return content;
  } catch (e) {
    console.error(`[quiz-preview] missing asset ${name}:`, e);
    return "";
  }
}

const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";

  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) return new Response("Preview unavailable", { status: 503 });

  let payload: { shopId: string; shopDomain: string };
  try {
    // Pin the algorithm: SHOPIFY_API_SECRET also signs other HS256 tokens in
    // this app (Intercom JWT), so verify the SHAPE too — any other token
    // signed with the same secret must 401, not 500 downstream.
    const decoded = jwt.verify(token, secret, { algorithms: ["HS256"] }) as Record<string, unknown>;
    if (typeof decoded.shopId !== "string" || typeof decoded.shopDomain !== "string") {
      return new Response("Invalid preview token", { status: 401 });
    }
    payload = { shopId: decoded.shopId, shopDomain: decoded.shopDomain };
  } catch {
    return new Response("Invalid or expired preview token", { status: 401 });
  }

  const draft = (await getQuizDraft(payload.shopId).catch(() => null)) ?? (await captureLiveConfig(payload.shopId));

  const [config, sample] = await Promise.all([
    buildPreviewQuizConfig(payload.shopDomain, draft),
    buildPreviewSampleRecommend(payload.shopId, draft),
  ]);
  const { productJson, ...sampleRecommend } = sample;
  const flow = buildPreviewFlow(draft);

  const css = readAsset("gleame-quiz.css");
  const js = readAsset("gleame-quiz.js");

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Quiz preview</title>
<style>${css}</style>
<style>
  html, body { margin: 0; padding: 0; background: #fff; }
  #gleame-quiz-root { min-height: 100vh; }
</style>
</head>
<body>
<div id="gleame-quiz-root" data-shop-domain="${escapeAttr(payload.shopDomain)}"></div>
<script>
window.GLEAME_QUIZ_PREVIEW = ${JSON.stringify({ config, flow, sampleRecommend, productJson }).replace(/</g, "\\u003c")};
</script>
<script>${js}</script>
</body>
</html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      // Only the embedded admin (and our own app) should frame this.
      "Content-Security-Policy": "frame-ancestors https://admin.shopify.com https://*.myshopify.com 'self'",
    },
  });
};
