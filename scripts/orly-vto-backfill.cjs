// ORLY VTO backfill: one universal swatch-driven prompt + ONE reference image
// (the product's first live-store image) for every product in the pool v2
// (spec "ORLY Recommendation Backfill v2" §6, 165 products).
//
// Unlike the Glamnetic backfill this DOES overwrite existing try-on config
// (Charles, 2026-10-09: the universal prompt goes on every pool product). It
// is guarded accordingly:
//   - dry-run by default; nothing is written without --apply
//   - before the first write, every column it will change
//     (transformation_prompt, ai_model, reference_image_url,
//     reference_image_urls) is dumped for every affected row to
//     scripts/backups/orly-vto-<date>.json
//   - each UPDATE is keyed by row id + shop_id and uses .select('id'); a
//     0-row match is a failure, never a silent success
//   - --restore <backup.json> --apply writes those four columns back
//   - the Shopify store is never written to; old reference images stay in
//     storage (the backup keeps their URLs)
//
// Pool rows that don't exist yet are NOT created here — orly-pool-v2.cjs
// inserts them (already carrying this prompt + image, via the helpers
// exported below, so no new row is ever live in the try-on-enabled quiz
// without a prompt).
//
// Image: products/<handle>.json -> images sorted by position -> position 1.
// The prompt calls that image "a flat swatch"; on ORLY it mostly is NOT one
// (bottle-in-puddle shots; GELFX = opaque silver bottle with a printed
// label). --image swatch picks the catalog's flat swatch disc (P_ filename,
// else a pixel test for renamed discs), falling back to the first image.
// Default stays "first" as
// requested; the dry-run audit shows what each choice would send.
//
// USAGE:
//   node scripts/orly-vto-backfill.cjs                      # dry-run report
//   node scripts/orly-vto-backfill.cjs --apply              # overwrite pool rows
//   options: --ai-model keep|<model id>  (default keep: existing ai_model, else
//              gemini-3.1-flash-image-preview)
//            --image first|swatch       (default first)
//            --only handle1,handle2     (limit to these spec handles)
//            --force                    (re-host even rows already on the prompt)
//            --sample N                 (dry-run image-audit sample size, default 8)
//   node scripts/orly-vto-backfill.cjs --restore scripts/backups/orly-vto-2026-10-09.json [--apply]
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const lib = require('./orly-v2-lib.cjs');

// Verbatim (Charles, 2026-10-09). Do not edit.
const VTO_PROMPT = "You have been provided two images: a flat swatch showing a nail polish's true color and finish, and a photo of a customer's hand. Recreate the customer's photo exactly as it is, with one change: every visible nail now wears this exact polish — the swatch's color and finish applied like a fresh professional manicure, following the natural curve of each nail with the smooth, even surface and glossy topcoat shine of a salon application. The polish is a manufactured product with one fixed color, matched precisely to the swatch: it looks identical on every skin tone, never darkening, lightening, or shifting to match the hand. It covers each nail fully and sits only on the nail plate, cleanly inside the natural nail boundary. Everything else in the customer photo — hand position, nail shape and length, skin tone and texture, lighting, and background — remains exactly unchanged.";
const DEFAULT_AI_MODEL = 'gemini-3.1-flash-image-preview';
const STORAGE_PREFIX = () => `${process.env.SUPABASE_URL}/storage/v1/object/public/reference-images/${lib.SHOP_DOMAIN}/`;

const fileName = (im) => decodeURIComponent(String(im.src).split('/').pop().split('?')[0]);
const byPosition = (images) => [...(images || [])].sort((a, b) => a.position - b.position);
// ORLY's flat swatch discs are named P_<Shade>, <sku>_P_<Shade> or
// P<Shade>.png (case-sensitive; never PDP_*, which are bottle/macro shots).
const isSwatchFile = (im) => /(^|_)P_|^P(?!DP)[A-Z]/.test(fileName(im)) && !/^PDP_/i.test(fileName(im));

// Many swatch discs were re-uploaded under Shopify-generated names
// (mind-over-matter-655335.jpg), so the filename misses them. Pixel test on a
// 96px CDN rendition: white corners, a fully filled centre circle, and a
// dominant colour. Validated 2026-10-09 against the 118 P_-named files plus a
// visual check of the renamed hits; thresholds are strict on purpose (a GELFX
// bottle shot scored fill 0.97 / uniformity 0.68). White-on-white discs fail
// it — those are P_-named.
async function discScore(sharp, src) {
  const N = 48;
  const buf = await fetchImage(src + (src.includes('?') ? '&' : '?') + 'width=96');
  const { data } = await sharp(buf).flatten({ background: '#ffffff' }).resize(N, N, { fit: 'fill' })
    .removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const c = (N - 1) / 2;
  const isWhite = (i) => data[i] > 225 && data[i + 1] > 225 && data[i + 2] > 225;
  let inN = 0, inFilled = 0, outN = 0, outWhite = 0;
  const inside = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = (y * N + x) * 3, r = Math.hypot(x - c, y - c) / N;
    if (r < 0.42) { inN++; if (!isWhite(i)) inFilled++; inside.push([data[i], data[i + 1], data[i + 2]]); }
    else if (r > 0.56) { outN++; if (isWhite(i)) outWhite++; }
  }
  const med = [0, 1, 2].map((k) => inside.map((p) => p[k]).sort((a, b) => a - b)[inside.length >> 1]);
  const uniformity = inside.filter((p) => Math.hypot(p[0] - med[0], p[1] - med[1], p[2] - med[2]) < 70).length / inside.length;
  return { fill: inFilled / inN, corners: outWhite / outN, uniformity };
}
const isDisc = (s) => s.fill >= 0.99 && s.corners >= 0.97 && s.uniformity >= 0.75;

async function findSwatch(sharp, product) {
  const imgs = byPosition(product.images);
  const named = imgs.find(isSwatchFile);
  if (named) return { image: named, via: 'filename' };
  let best = null;
  for (const im of imgs) {
    try {
      const s = await discScore(sharp, im.src);
      if (isDisc(s) && (!best || s.uniformity > best.s.uniformity)) best = { image: im, s };
    } catch { /* unreadable image: not a swatch */ }
  }
  return best ? { image: best.image, via: 'pixel' } : null;
}

// mode 'first' = images[0] (position 1). mode 'swatch' = flat swatch disc
// (filename, else pixel test), falling back to images[0]. sharp is only
// needed for 'swatch'.
async function pickReferenceImage(product, mode = 'first', sharp = null) {
  const imgs = byPosition(product.images);
  if (imgs.length === 0) return null;
  if (mode === 'swatch') {
    const sw = await findSwatch(sharp, product);
    if (sw) return { image: sw.image, picked: `swatch (${sw.via})` };
    return { image: imgs[0], picked: 'first (no swatch found)' };
  }
  return { image: imgs[0], picked: 'first' };
}

// What the image most likely shows, from filename + formula + tags (alt text
// is empty on every ORLY pool image). Spot-checked visually 2026-10-09.
function classifyImage(im, product, formula) {
  const f = fileName(im);
  // products.json gives tags as an array, products/<handle>.json as a string.
  const tags = (Array.isArray(product.tags) ? product.tags : String(product.tags || '').split(','))
    .map((t) => String(t).trim().toLowerCase());
  if (tags.some((t) => t.includes('duos'))) return 'two-bottle duo kit shot (two different shades)';
  if (isSwatchFile(im)) return 'flat swatch disc';
  if (/BIP/i.test(f)) return 'bottle standing in a poured puddle of the polish';
  if (/^sty_/i.test(f)) return 'stylized bottle on a decorative texture background';
  if (formula === 'GELFX') return 'GELFX bottle only (opaque silver bottle; shade visible only as the printed label)';
  if (/^B_/i.test(f) || /Bottle/i.test(f)) return 'bottle only';
  return 'bottle + puddle (likely; Shopify-renamed file, verify visually)';
}

async function fetchImage(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`image HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// Re-host as 1024px webp in the reference-images bucket (Glamnetic pattern).
// Transparent PNGs (GELFX bottle shots) are flattened onto white.
async function rehostImage(sharp, srcUrl, productId) {
  const buf = await fetchImage(srcUrl);
  const webp = await sharp(buf)
    .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .webp({ quality: 85 }).toBuffer();
  const objectPath = `${lib.SHOP_DOMAIN}/${productId}-${crypto.randomInt(1e9)}.webp`;
  const up = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/reference-images/${objectPath}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.SUPABASE_API_KEY}`, 'Content-Type': 'image/webp' },
    body: webp,
  });
  if (!up.ok) throw new Error(`storage upload HTTP ${up.status}: ${await up.text()}`);
  return `${process.env.SUPABASE_URL}/storage/v1/object/public/reference-images/${objectPath}`;
}

function resolveModel(existing, modelFlag) {
  if (modelFlag && modelFlag !== 'keep') return modelFlag;
  return existing || DEFAULT_AI_MODEL;
}

// Full VTO column set for one product (used by this script's updates and by
// orly-pool-v2.cjs's inserts). Uploads the image — call only when writing.
async function buildVtoFields({ sharp, productJson, productId, existingModel = null, modelFlag = 'keep', imageMode = 'first' }) {
  const pick = await pickReferenceImage(productJson, imageMode, sharp);
  if (!pick) throw new Error(`no catalog images for ${productJson.handle}`);
  const refUrl = await rehostImage(sharp, pick.image.src, productId);
  return {
    transformation_prompt: VTO_PROMPT,
    ai_model: resolveModel(existingModel, modelFlag),
    reference_image_url: refUrl,
    reference_image_urls: [refUrl],
  };
}

async function mapLimit(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

const tally = (arr) => arr.reduce((m, k) => ((m[k] = (m[k] || 0) + 1), m), {});

async function restore(sb, file, apply) {
  const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (backup.shopId !== lib.SHOP_ID) throw new Error(`backup is for shop ${backup.shopId}, not ORLY`);
  const rows = backup.rows || [];
  console.log(`restore: ${rows.length} rows from ${file}${apply ? '' : ' (DRY RUN)'}`);
  let ok = 0, failed = 0;
  for (const r of rows) {
    if (!apply) { console.log(`DRY restore ${r.product_name}`); continue; }
    const upd = await sb.from('products').update({
      transformation_prompt: r.transformation_prompt,
      ai_model: r.ai_model,
      reference_image_url: r.reference_image_url,
      reference_image_urls: r.reference_image_urls,
    }).eq('id', r.id).eq('shop_id', lib.SHOP_ID).select('id');
    if (upd.error || !upd.data || upd.data.length !== 1) {
      failed++; console.warn(`FAIL restore ${r.product_name}: ${upd.error?.message || `matched ${upd.data?.length ?? 0} rows`}`);
    } else { ok++; console.log(`restored ${r.product_name}`); }
  }
  console.log(`restored ${ok}, failed ${failed}`);
  if (failed) process.exitCode = 1;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const force = process.argv.includes('--force');
  const modelFlag = lib.argValue('--ai-model', 'keep');
  const imageMode = lib.argValue('--image', 'first');
  const only = lib.argValue('--only') ? new Set(lib.argValue('--only').split(',')) : null;
  const sampleN = Number(lib.argValue('--sample', '8'));
  if (!['first', 'swatch'].includes(imageMode)) throw new Error('--image must be first|swatch');

  const sb = lib.supabaseClient();
  const restoreFile = lib.argValue('--restore');
  if (restoreFile) return restore(sb, restoreFile, apply);

  console.log(`ORLY VTO backfill — ${apply ? 'APPLY' : 'DRY RUN'}; image=${imageMode}; ai-model=${modelFlag}`);
  console.log(`prompt sha256 ${crypto.createHash('sha256').update(VTO_PROMPT).digest('hex').slice(0, 16)}, ${VTO_PROMPT.length} chars, single paragraph: ${!/\n/.test(VTO_PROMPT)}`);

  const { rows: specRows } = lib.loadSpecRows({ writeSnapshot: false });
  const targets = specRows.filter((r) => !only || only.has(r.handle));
  const state = await lib.loadShopState(sb);
  const rowByNumericId = new Map(state.products.map((p) => [lib.numericId(p.shopify_id), p]));

  // Shop-wide snapshot of current try-on config (all rows, not just pool).
  console.log(`\nshop rows today: ${state.products.length}; with transformation_prompt: ${state.products.filter((p) => p.transformation_prompt).length}; ai_model: ${JSON.stringify(tally(state.products.map((p) => p.ai_model || '(null)')))}; reference_image_urls count: ${JSON.stringify(tally(state.products.map((p) => (p.reference_image_urls || []).length)))}`);

  // products/<handle>.json for every target (the exact endpoint the image
  // pick uses; also proves every odd handle resolves).
  const fetched = await mapLimit(targets, 3, async (r) => {
    try { return { r, product: await lib.fetchProductByHandle(r.handle) }; } catch (e) { return { r, error: e.message }; }
  });
  const unresolved = fetched.filter((x) => x.error);
  if (unresolved.length) console.warn(`WARN ${unresolved.length} handles failed products/<handle>.json:`, unresolved.map((x) => `${x.r.handle} (${x.error})`));

  // ---- Image audit ----
  const sharp = require(path.join(lib.ROOT, 'node_modules', 'sharp'));
  const ok = fetched.filter((x) => x.product);
  console.log(`\nimage audit over ${ok.length} pool products (products/<handle>.json):`);
  console.log(`  variants per product: ${JSON.stringify(tally(ok.map((x) => x.product.variants.length)))}; variants with their own featured image: ${ok.filter((x) => x.product.variants.some((v) => v.image_id)).length}`);
  console.log(`  images per product: ${JSON.stringify(tally(ok.map((x) => x.product.images.length)))}`);
  const alts = ok.map((x) => byPosition(x.product.images)[0]?.alt).filter(Boolean);
  console.log(`  images[0] alt text present: ${alts.length}; distinct examples: ${JSON.stringify([...new Set(alts)].slice(0, 6))}`);
  console.log(`  images[0] kind: ${JSON.stringify(tally(ok.map((x) => classifyImage(byPosition(x.product.images)[0], x.product, x.r.formula))), null, 2).replace(/\n/g, '\n  ')}`);
  // Where a real flat swatch exists (what the prompt describes).
  await mapLimit(ok, 4, async (x) => { x.swatch = await findSwatch(sharp, x.product); });
  const noSwatch = ok.filter((x) => !x.swatch);
  console.log(`  flat swatch disc available: ${ok.length - noSwatch.length}/${ok.length} (by filename ${ok.filter((x) => x.swatch?.via === 'filename').length}, by pixel test ${ok.filter((x) => x.swatch?.via === 'pixel').length}); images[0] itself is the swatch for ${ok.filter((x) => x.swatch && x.swatch.image.position === byPosition(x.product.images)[0].position).length}`);
  console.log(`  no swatch disc anywhere (--image swatch falls back to images[0]): ${noSwatch.map((x) => x.r.handle).join(', ') || 'none'}`);
  const sampleHandles = ['reddy-or-not', 'bubblegum-pop', 'breathable-mind-over-matter', 'liquid-vinyl-gel-nail-color', 'bell-bottom-blues-gel-nail-color', 'nude-attitude', 'after-school-special', 'cherries', 'golden-french-drip', 'red-hot-copy'];
  console.log(`  sample (${sampleN}):`);
  for (const x of ok.filter((y) => sampleHandles.includes(y.r.handle)).slice(0, sampleN)) {
    const imgs = byPosition(x.product.images);
    const i0 = imgs[0];
    console.log(`    ${x.r.handle} [${x.r.formula}] images=${imgs.length}: #1 ${fileName(i0)} ${i0.width}x${i0.height} -> ${classifyImage(i0, x.product, x.r.formula)}${x.swatch ? `; swatch disc at #${x.swatch.image.position} ${fileName(x.swatch.image)} (${x.swatch.via})` : '; no swatch disc'}`);
  }

  // ---- Row plan ----
  const plan = [];
  const missing = [];
  for (const x of ok) {
    const row = rowByNumericId.get(String(x.product.id));
    if (!row) { missing.push(x.r.handle); continue; }
    const already = row.transformation_prompt === VTO_PROMPT
      && (row.reference_image_urls || []).length === 1
      && String(row.reference_image_url || '').startsWith(STORAGE_PREFIX());
    plan.push({ x, row, already });
  }
  const todo = plan.filter((p) => force || !p.already);
  console.log(`\npool rows found in DB: ${plan.length}; not yet onboarded (orly-pool-v2.cjs creates them, already configured): ${missing.length}`);
  console.log(`  of found: have a prompt ${plan.filter((p) => p.row.transformation_prompt).length}; already exactly the new prompt ${plan.filter((p) => p.row.transformation_prompt === VTO_PROMPT).length}; would be OVERWRITTEN ${todo.filter((p) => p.row.transformation_prompt && p.row.transformation_prompt !== VTO_PROMPT).length}; is_funnel_generated ${plan.filter((p) => p.row.is_funnel_generated).length}`);
  console.log(`  current ai_model on found rows: ${JSON.stringify(tally(plan.map((p) => p.row.ai_model || '(null)')))}; after: ${JSON.stringify(tally(todo.map((p) => resolveModel(p.row.ai_model, modelFlag))))}`);
  console.log(`  current reference_image_urls count on found rows: ${JSON.stringify(tally(plan.map((p) => (p.row.reference_image_urls || []).length)))} -> 1 each`);
  for (const p of todo) {
    const pick = imageMode === 'swatch' && p.x.swatch
      ? { image: p.x.swatch.image, picked: `swatch (${p.x.swatch.via})` }
      : { image: byPosition(p.x.product.images)[0], picked: imageMode === 'swatch' ? 'first (no swatch found)' : 'first' };
    console.log(`  ${apply ? '~' : 'DRY ~'} ${p.row.product_name} (${p.row.id}) prompt ${p.row.transformation_prompt ? `${p.row.transformation_prompt.length} chars -> replaced` : 'none -> set'}; refs ${(p.row.reference_image_urls || []).length} -> 1 [${pick.picked}: ${fileName(pick.image)}]`);
  }
  if (!apply) { console.log('\nDRY RUN — nothing written.'); return; }
  if (unresolved.length) throw new Error(`refusing to apply: ${unresolved.length} handles did not resolve (re-run; storefront rate limits)`);
  if (todo.length === 0) { console.log('nothing to do'); return; }

  // ---- Backup BEFORE any write ----
  const backupFile = lib.writeBackup('vto', {
    note: 'Pre-overwrite values of every column orly-vto-backfill.cjs changes. Restore: node scripts/orly-vto-backfill.cjs --restore <this file> --apply',
    rows: todo.map(({ row }) => ({
      id: row.id, product_name: row.product_name, shopify_id: row.shopify_id,
      transformation_prompt: row.transformation_prompt, ai_model: row.ai_model,
      reference_image_url: row.reference_image_url, reference_image_urls: row.reference_image_urls,
    })),
  });
  console.log(`backup written: ${backupFile} (${todo.length} rows)`);

  let done = 0, failed = 0;
  for (const { x, row } of todo) {
    try {
      const fields = await buildVtoFields({ sharp, productJson: x.product, productId: row.id, existingModel: row.ai_model, modelFlag, imageMode });
      const upd = await sb.from('products').update(fields).eq('id', row.id).eq('shop_id', lib.SHOP_ID).select('id');
      if (upd.error) throw new Error(`update: ${upd.error.message}`);
      if (!upd.data || upd.data.length !== 1) throw new Error(`update matched ${upd.data?.length ?? 0} rows`);
      done++;
      console.log(`~ ${row.product_name}`);
    } catch (e) {
      failed++;
      console.warn(`FAIL ${row.product_name}: ${e.message}`);
    }
  }
  console.log(`\nupdated ${done}, failed ${failed}, not yet onboarded ${missing.length}; backup ${backupFile}`);
  if (failed) process.exitCode = 1;
}

module.exports = { VTO_PROMPT, DEFAULT_AI_MODEL, pickReferenceImage, findSwatch, classifyImage, isSwatchFile, rehostImage, buildVtoFields, resolveModel };

if (require.main === module) main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
