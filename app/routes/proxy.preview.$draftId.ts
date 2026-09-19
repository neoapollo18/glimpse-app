// On-store quiz preview via Shopify app proxy (Overhaul Part 4 / D1).
//
// Storefront URL: https://{shop}/apps/gleame/preview/:draftId?token=…
// Shopify forwards it here and — because the response is
// application/liquid — wraps the body in the LIVE theme's layout: real
// header, footer, and fonts, with nothing written to the theme. The quiz
// widget then runs exactly as it would on a published page (real config
// + flow fetches), forced visible while the surface is still off.
//
// draftId "live" previews the shop's current live config (drafts are the
// live config in today's model; generated-draft ids arrive with Part 3).
//
// Security: Shopify's proxy signature is verified on every request; the
// token is a signed 7-day JWT bound to shop + draftId; any failure is a
// plain 404 so the route never confirms its own existence. noindex via
// X-Robots-Tag (the theme owns <head>).

import type { LoaderFunctionArgs } from "@remix-run/node";
import fs from "node:fs";
import path from "node:path";
import { verifyProxySignature, verifyStorePreviewToken } from "../lib/app-proxy.server";
import { findShopByDomain } from "../lib/supabase.server";

const ASSETS_DIR = path.join(process.cwd(), "extensions", "glimpse-widget", "assets");
const assetCache = new Map<string, string>();
function readAsset(name: string): string {
  if (process.env.NODE_ENV === "production" && assetCache.has(name)) return assetCache.get(name)!;
  try {
    const content = fs.readFileSync(path.join(ASSETS_DIR, name), "utf8");
    assetCache.set(name, content);
    return content;
  } catch (e) {
    console.error(`[proxy-preview] missing asset ${name}:`, e);
    return "";
  }
}

const NOT_FOUND = new Response("Not found", { status: 404 });

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const draftId = params.draftId ?? "";
  // Shopify adds shop=… to every proxied request; it is signature-covered.
  const shopDomain = url.searchParams.get("shop") ?? "";
  const token = url.searchParams.get("token") ?? "";

  if (!verifyProxySignature(url)) return NOT_FOUND;
  if (!shopDomain || !draftId) return NOT_FOUND;
  if (!verifyStorePreviewToken(token, shopDomain, draftId)) return NOT_FOUND;
  if (!(await findShopByDomain(shopDomain))) return NOT_FOUND;

  const css = readAsset("gleame-quiz.css") + "\n" + readAsset("gleame-camera.css");
  const js = readAsset("gleame-camera.js") + "\n;\n" + readAsset("gleame-quiz.js");

  // Liquid body — Shopify renders the {{ … }} tags against the live store
  // before wrapping the whole thing in the theme layout.
  const body = `
<div class="gleame-preview-bar">
  <span><strong>Preview</strong> — shoppers can’t see this</span>
  <span class="gleame-preview-bar-actions">
    <button type="button" onclick="navigator.clipboard&&navigator.clipboard.writeText(window.location.href).then(function(){var b=document.getElementById('gleame-copy-btn');if(b){b.textContent='Copied ✓';setTimeout(function(){b.textContent='Copy link';},2000);}})" id="gleame-copy-btn">Copy link</button>
    <a href="https://admin.shopify.com/store/{{ shop.permanent_domain | remove: '.myshopify.com' }}/apps">Back to Gleame</a>
  </span>
</div>
<style>
  .gleame-preview-bar{position:fixed;top:0;left:0;right:0;z-index:100000;display:flex;justify-content:space-between;align-items:center;gap:12px;padding:8px 16px;background:#16161a;color:#fff;font:13px/-apple-system,BlinkMacSystemFont,sans-serif;font-size:13px;}
  .gleame-preview-bar a,.gleame-preview-bar button{color:#fff;background:transparent;border:1px solid rgba(255,255,255,.4);border-radius:8px;padding:4px 10px;font-size:12px;text-decoration:none;cursor:pointer;margin-left:8px;}
  .gleame-preview-bar-actions{display:flex;align-items:center;}
  body{margin-top:40px;}
</style>
<div id="gleame-quiz-root"
     data-shop-domain="{{ shop.permanent_domain }}"
     data-cart-token="{{ cart.token }}"
     data-customer-first-name="{{ customer.first_name | escape }}"></div>
<style>${css}</style>
<script>window.GLEAME_QUIZ_FORCE = true;</script>
<script>${js.replace(/<\/script>/gi, "<\\/script>")}</script>
`;

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/liquid",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
};
