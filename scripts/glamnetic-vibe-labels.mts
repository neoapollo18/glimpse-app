// Glamnetic vibe labels (fix spec v4, item 3).
//
// Products carry no vibe data, so the quiz guessed vibes from color and
// collection tags. This script asks Gemini (the app's ranker model, with
// the product photo, title and tags) which of the six labeled vibes each
// pool set fits, writes a sheet for Lisa to approve, and merges only her
// approved rows into recommendation_tuning.columnar.vibeLabels. A labeled
// set then uses exactly its labels in ranking, branching and why-lines;
// every other set keeps the tag rules. French Girl Chic always follows the
// French tip / ombre tags.
//
// 1. AI pass, DRY RUN (reads only; writes a CSV, never the database):
//      npx tsx --env-file=.env scripts/glamnetic-vibe-labels.mts            # first 5 pool sets
//      npx tsx --env-file=.env scripts/glamnetic-vibe-labels.mts --limit=424 --out=glamnetic-vibe-sheet.csv
//    --limit=N (default 5) --offset=N --handles=a,b,c --out=path.csv
//    --model=lite|flash|pro (default flash) --concurrency=N (default 3)
//    Default output: scripts/backups/glamnetic-vibe-labels-<time>.csv
//
// 2. Lisa reviews the sheet: approved = yes per row; final_vibes to
//    change a row (names or IDs, | separated, or none).
//
// 3. Apply, preview first (reads only, prints every change):
//      npx tsx --env-file=.env scripts/glamnetic-vibe-labels.mts --apply-sheet=glamnetic-vibe-sheet.csv
//    then write:
//      npx tsx --env-file=.env scripts/glamnetic-vibe-labels.mts --apply-sheet=glamnetic-vibe-sheet.csv --write
//    --write saves a JSON backup of the row (scripts/backups/, ignored by
//    git), then writes back the row's own recommendation_tuning with ONLY
//    columnar.vibeLabels changed, guarded by updated_at (a Studio save in
//    between makes it stop, re-run it), and re-reads to verify that
//    nothing else moved. Rollback: write the backup's recommendation_tuning
//    back (or re-apply a sheet without the rows to undo).
//
// The engine picks the labels up on its next pool load (the pool cache key
// includes them); the storefront's flow cache turns over within a minute.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { supabase } from "../app/lib/supabase.server";
import { geminiClient, extractGeminiText } from "../app/lib/gemini.server";
import { RANKER_MODELS, NO_THINKING } from "../app/lib/llm-recommender.server";
import { compressImage } from "../app/lib/ai.server";
import { deriveProduct } from "../app/lib/columnar/attributes";
import { sanitizeColumnarSpec } from "../app/lib/columnar/spec";
import {
  RESPONSE_SCHEMA,
  SHEET_HEADER,
  SHEET_HELP,
  SHOP_DOMAIN,
  SHOP_ID,
  buildPrompt,
  formatVibes,
  parseAiResponse,
  planApply,
  sheetRow,
  toCsv,
  withVibeLabels,
  writeDrift,
  type AiLabel,
} from "./glamnetic-vibe-labels-lib";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const KNOWN = new Set(["--limit", "--offset", "--handles", "--out", "--model", "--concurrency", "--apply-sheet", "--write"]);
for (const a of args) {
  if (!KNOWN.has(a.split("=")[0])) {
    console.error(`unknown argument ${a}`);
    process.exit(2);
  }
}
const flag = (name: string): string | null => {
  const hit = args.find((a) => a === name || a.startsWith(`${name}=`));
  return hit ? (hit.includes("=") ? hit.slice(name.length + 1) : "") : null;
};
const intFlag = (name: string, fallback: number) => {
  const v = flag(name);
  const n = v ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 0 ? n : fallback;
};

type Row = Record<string, any>;

async function loadSpecRow(): Promise<{ tuning: Row; updatedAt: string | null }> {
  const { data, error } = await supabase
    .from("chat_assistant_config")
    .select("shop_domain, recommendation_tuning, updated_at")
    .eq("shop_domain", SHOP_DOMAIN)
    .maybeSingle();
  if (error) throw new Error(`chat_assistant_config: ${error.message}`);
  if (!data) throw new Error(`no chat_assistant_config row for ${SHOP_DOMAIN}`);
  return { tuning: (data.recommendation_tuning ?? {}) as Row, updatedAt: (data.updated_at as string) ?? null };
}

async function loadProducts(handles: string[]): Promise<Row[]> {
  const out: Row[] = [];
  for (let i = 0; i < handles.length; i += 100) {
    const { data, error } = await supabase
      .from("products")
      .select("id, shopify_id, handle, product_name, status, product_type, tags, price, image_url")
      .eq("shop_id", SHOP_ID)
      .in("handle", handles.slice(i, i + 100));
    if (error) throw new Error(`products: ${error.message}`);
    out.push(...((data ?? []) as Row[]));
  }
  // A handle can have a soft-deleted row next to the live one.
  const live = (r: Row) => r.status == null || r.status === "active";
  const byHandle = new Map<string, Row>();
  for (const r of out) {
    const prev = byHandle.get(r.handle);
    if (!prev || (!live(prev) && live(r))) byHandle.set(r.handle, r);
  }
  return handles.map((h) => byHandle.get(h)).filter((r): r is Row => Boolean(r));
}

/** Shopify CDN images take a width; ask for a small one. */
const smallImage = (url: string) =>
  /cdn\.shopify\.com|\/cdn\/shop\//.test(url) ? `${url}${url.includes("?") ? "&" : "?"}width=768` : url;

async function labelOne(p: Row, model: keyof typeof RANKER_MODELS): Promise<AiLabel> {
  const { system, user } = buildPrompt({ title: String(p.product_name ?? p.handle), tags: (p.tags ?? []) as string[] });
  const parts: Array<Record<string, unknown>> = [];
  if (typeof p.image_url === "string" && p.image_url) {
    const res = await fetch(smallImage(p.image_url));
    if (!res.ok) throw new Error(`image ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const img = await compressImage(buf.toString("base64"), res.headers.get("content-type") || "image/jpeg", 768);
    parts.push({ inlineData: { mimeType: img.compressedMimeType, data: img.compressedBase64 } });
  }
  parts.push({ text: user });
  const response = await geminiClient().models.generateContent({
    model: RANKER_MODELS[model],
    contents: [{ role: "user", parts }],
    config: {
      systemInstruction: system,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA as unknown as Record<string, unknown>,
      temperature: 0,
      ...(NO_THINKING[model] ? { thinkingConfig: NO_THINKING[model] } : {}),
    },
  });
  const parsed = parseAiResponse(extractGeminiText(response));
  if (!parsed) throw new Error("unreadable model answer");
  return parsed;
}

async function aiPass() {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set");
  const model = (flag("--model") || "flash") as keyof typeof RANKER_MODELS;
  if (!RANKER_MODELS[model]) throw new Error(`--model must be one of ${Object.keys(RANKER_MODELS).join(", ")}`);
  const { tuning } = await loadSpecRow();
  const spec = sanitizeColumnarSpec(tuning.columnar);
  if (!spec) throw new Error("no columnar spec for Glamnetic");
  const only = flag("--handles");
  const handles = only
    ? only.split(",").map((h) => h.trim()).filter((h) => spec.pool.handles.includes(h))
    : spec.pool.handles.slice(intFlag("--offset", 0), intFlag("--offset", 0) + intFlag("--limit", 5));
  const products = await loadProducts(handles);
  console.log(`AI pass (${RANKER_MODELS[model]}), DRY RUN: ${products.length} of ${spec.pool.handles.length} pool sets; nothing is written to the database`);
  const rows: string[][] = new Array(products.length);
  let next = 0;
  const worker = async () => {
    while (next < products.length) {
      const i = next++;
      const p = products[i];
      const derived = deriveProduct(
        {
          id: String(p.id),
          shopifyId: String(p.shopify_id ?? ""),
          handle: p.handle,
          title: String(p.product_name ?? p.handle),
          productType: p.product_type ?? null,
          status: p.status ?? null,
          tags: (p.tags ?? []) as string[],
          price: null,
          imageUrl: p.image_url ?? null,
        },
        // The rule column shows the tag rules, never earlier labels.
        { holidayCollections: spec.holidayCollections },
      );
      const base = { handle: p.handle, title: String(p.product_name ?? p.handle), imageUrl: p.image_url ?? null };
      let ai: AiLabel | null = null;
      let error: string | undefined;
      for (let attempt = 0; attempt < 2 && !ai; attempt++) {
        try {
          ai = await labelOne(p, model);
          error = undefined;
        } catch (e) {
          error = e instanceof Error ? e.message : String(e);
        }
      }
      rows[i] = sheetRow(base, derived.vibes, ai, error);
      console.log(`  ${p.handle}: ${ai ? formatVibes(ai.vibes.filter((v) => v.confidence >= 0.5).map((v) => v.id)) : `ERROR ${error}`} (rules: ${formatVibes(derived.vibes.filter((v) => v !== "french_girl"))})`);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(8, intFlag("--concurrency", 3))) }, worker));
  const out =
    flag("--out") || path.join(HERE, "backups", `glamnetic-vibe-labels-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`);
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, toCsv([[...SHEET_HEADER], ...rows]));
  console.log(`\nsheet: ${path.resolve(out)}`);
  for (const line of SHEET_HELP) console.log(`  ${line}`);
}

async function applySheet(sheetPath: string, write: boolean) {
  const sheet = fs.readFileSync(sheetPath, "utf8");
  const { tuning, updatedAt } = await loadSpecRow();
  const spec = sanitizeColumnarSpec(tuning.columnar);
  if (!spec) throw new Error("no columnar spec for Glamnetic");
  const plan = planApply(sheet, spec.vibeLabels, spec.pool.handles);
  console.log(
    `sheet ${path.resolve(sheetPath)}: ${plan.approved} approved (${plan.changes.length} change, ${plan.unchanged} already so), ${plan.notApproved} not approved`,
  );
  if (plan.errors.length) {
    for (const e of plan.errors) console.error(`  ${e}`);
    throw new Error("the sheet has errors; nothing written");
  }
  for (const c of plan.changes) console.log(`  ${c.handle}: ${c.from ? formatVibes(c.from) : "(tag rules)"} -> ${formatVibes(c.to)}`);
  if (plan.changes.length === 0) return console.log("nothing to write");
  const next = withVibeLabels(tuning, plan.next);
  if (!write) return console.log(`\nPREVIEW: nothing written. Add --write to save these ${plan.changes.length} changes.`);

  const dir = path.join(HERE, "backups");
  fs.mkdirSync(dir, { recursive: true });
  const backup = path.join(dir, `glamnetic-vibe-labels-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(backup, JSON.stringify({ shop_domain: SHOP_DOMAIN, updated_at: updatedAt, recommendation_tuning: tuning }, null, 2));
  console.log(`backup: ${backup}`);

  // Compare-and-set on updated_at: a Studio save since the read makes the
  // update match no row, and the run stops instead of overwriting it.
  let q = supabase
    .from("chat_assistant_config")
    .update({ recommendation_tuning: next, updated_at: new Date().toISOString() })
    .eq("shop_domain", SHOP_DOMAIN);
  q = updatedAt ? q.eq("updated_at", updatedAt) : q.is("updated_at", null);
  const { data, error } = await q.select("shop_domain");
  if (error) throw new Error(`write failed: ${error.message}`);
  if (!data || data.length !== 1) throw new Error("the row changed since it was read (a Studio save?): nothing written, re-run");
  const after = await loadSpecRow();
  const drift = writeDrift(tuning, after.tuning, plan.next);
  if (drift) throw new Error(`written, but on re-read ${drift}: restore from ${backup}`);
  console.log(`written: ${plan.changes.length} sets labeled (${Object.keys(plan.next).length} labeled in all); re-read verified`);
}

const sheetPath = flag("--apply-sheet");
try {
  if (sheetPath !== null) {
    if (!sheetPath) throw new Error("--apply-sheet needs a path");
    await applySheet(sheetPath, flag("--write") !== null);
  } else {
    if (flag("--write") !== null) throw new Error("--write only goes with --apply-sheet");
    await aiPass();
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
}
