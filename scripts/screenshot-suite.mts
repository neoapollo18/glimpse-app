// v3 screenshot suite (docs/overhaul/V3-SPEC.md Part 8.2 / task F3).
//
// Captures every template × Look × viewport × screen × library state of a
// shop's quiz through the Studio preview document (the same renderer the
// canvas and the gallery use), so Aaron can diff a build against the
// wireframes without opening the admin.
//
//   npx tsx scripts/screenshot-suite.mts <shop.myshopify.com> [outDir]
//
// Requires: a running app (APP_URL, default http://localhost:3000),
// SHOPIFY_API_SECRET + SUPABASE env (same .env the app uses), and
// Playwright: `npm i -D playwright && npx playwright install chromium`
// (deliberately NOT a package.json dependency — browsers are heavy and
// this runs on a laptop, not in the deploy).
//
// Output: <outDir>/<template>-<look>-<screen>-<viewport>-<library>.png plus
// an index.html contact sheet. Nothing is written to the database.

import fs from "node:fs";
import path from "node:path";
import jwt from "jsonwebtoken";
import { createClient } from "@supabase/supabase-js";

const shopDomain = process.argv[2];
if (!shopDomain) {
  console.error("usage: npx tsx scripts/screenshot-suite.mts <shop.myshopify.com> [outDir]");
  process.exit(1);
}
const outDir = path.resolve(process.argv[3] ?? `screenshots/${shopDomain.replace(/\W+/g, "_")}-${Date.now()}`);
const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const secret = process.env.SHOPIFY_API_SECRET;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_KEY;
if (!secret || !supabaseUrl || !supabaseKey) {
  console.error("Missing SHOPIFY_API_SECRET / SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in the environment.");
  process.exit(1);
}

const TEMPLATES = ["t1", "t2", "t3", "t4", "t5"] as const;
const LOOKS = ["editorial", "minimal", "bold"] as const;
const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "mobile", width: 390, height: 844 },
] as const;
const LIBRARY = ["full", "empty"] as const;

async function main() {
  let playwright: typeof import("playwright");
  try {
    playwright = await import("playwright");
  } catch {
    console.error("Playwright is not installed. Run: npm i -D playwright && npx playwright install chromium");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl!, supabaseKey!);
  const shop = await supabase.from("shops").select("id").eq("shop_domain", shopDomain).single();
  if (shop.error || !shop.data) throw new Error(`unknown shop ${shopDomain}`);
  const token = jwt.sign({ shopId: shop.data.id, shopDomain }, secret!, { expiresIn: "1h" });

  // The first visual question is the one the gallery strip shows; ask the
  // live flow which one that is (falls back to q1).
  const flowRes = await fetch(
    `${appUrl}/api/storefront/recommendation-config?shopDomain=${encodeURIComponent(shopDomain)}`
  ).catch(() => null);
  let visualStep = "q1";
  if (flowRes?.ok) {
    const flow = (await flowRes.json()) as { questions?: Array<{ options?: Array<{ imageUrl?: string | null }> }> };
    const idx = (flow.questions ?? []).findIndex((q) => (q.options ?? []).some((o) => o.imageUrl));
    if (idx >= 0) visualStep = `q${idx + 1}`;
  }
  const SCREENS = ["intro", visualStep, "lead", "results"];

  fs.mkdirSync(outDir, { recursive: true });
  const browser = await playwright.chromium.launch();
  const rows: string[] = [];
  try {
    for (const vp of VIEWPORTS) {
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2 });
      const page = await context.newPage();
      for (const template of TEMPLATES) {
        for (const look of LOOKS) {
          for (const library of LIBRARY) {
            for (const step of SCREENS) {
              const url =
                `${appUrl}/quiz-preview.html?token=${encodeURIComponent(token)}` +
                `&template=${template}&look=${look}&step=${step}` +
                (library === "empty" ? "&library=empty" : "");
              await page.goto(url, { waitUntil: "networkidle" });
              // Let the template's enter transition and any loading screen settle.
              await page.waitForTimeout(step === "results" ? 4500 : 600);
              const file = `${template}-${look}-${step}-${vp.name}-${library}.png`;
              await page.screenshot({ path: path.join(outDir, file), fullPage: true });
              rows.push(file);
              process.stdout.write(`${file}\n`);
            }
          }
        }
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }

  const html = `<!doctype html><meta charset="utf-8"><title>Gleame v3 screenshots · ${shopDomain}</title>
<style>body{font:13px -apple-system,sans-serif;margin:24px;background:#f6f6f7}h1{font-size:18px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px}
figure{margin:0;background:#fff;border:1px solid #e1e3e5;border-radius:10px;padding:10px}
img{width:100%;height:auto;border-radius:6px;border:1px solid #eee}figcaption{margin-top:6px;color:#444}</style>
<h1>Gleame v3 · ${shopDomain} · ${new Date().toISOString()}</h1>
<div class="grid">${rows.map((f) => `<figure><a href="${f}"><img loading="lazy" src="${f}"></a><figcaption>${f}</figcaption></figure>`).join("")}</div>`;
  fs.writeFileSync(path.join(outDir, "index.html"), html);
  console.log(`\n${rows.length} screenshots → ${outDir}/index.html`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
