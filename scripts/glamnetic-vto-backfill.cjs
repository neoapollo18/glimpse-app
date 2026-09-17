// Glamnetic press-on nails VTO backfill for glamrco.myshopify.com.
//
// Configures try-on for the 200 "Find My Nail Match" pool products
// (brand-configs/glamnetic-pool.json): one universal reference-image-driven
// transformation prompt (Charles, 2026-09-16) + the product's hero catalog
// photo re-hosted to the reference-images bucket as webp. Purely additive:
// only fills rows whose transformation_prompt is NULL; never wipes or
// rewrites existing VTO config. The Shopify store is never written to.
//
// One reference image per product, on purpose — the prompt is written for
// exactly two images (reference set + customer hand), and the transform
// pipeline sends customer photo first, labeled references after
// (app/lib/ai.server.ts).
//
// USAGE: node scripts/glamnetic-vto-backfill.cjs [--dry-run]
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SHOP_DOMAIN = 'glamrco.myshopify.com';
const AI_MODEL = 'gemini-3.1-flash-image-preview';
const POOL_PATH = path.join(__dirname, 'brand-configs', 'glamnetic-pool.json');
const dryRun = process.argv.includes('--dry-run');

const VTO_PROMPT = [
  "You have been provided two images: a reference photo showing a press-on nail set — its exact shape, length, color, and design — and a photo of a customer's hand.",
  "Recreate the customer's photo exactly as it is, with one change: she is now wearing this press-on set, professionally applied — every visible nail takes on the set's shape, length, color, and design, scaled to the width of each finger, extending naturally past her fingertips, and sitting flush against her cuticles like a real press-on.",
  "The set's design is reproduced faithfully nail by nail, including any accent nails, French tips, chrome, gems, or 3D details, as a manufactured product that looks identical on every skin tone.",
  "The reference shows the set's true colors under studio light; in the result the nails are physical objects in the customer's photo — curved across each nail, with a visible edge thickness, lit by the same soft light, as sharp as her skin, and casting faint shadows where they meet it.",
  "The reference photo is used only for the nails themselves — its hand, skin, background, and lighting are disregarded entirely.",
  "Her hand position, finger proportions, skin tone and texture, jewelry, lighting, and background remain exactly unchanged.",
].join(' ');

function loadEnv() {
  for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) process.env[line.slice(0, i)] = line.slice(i + 1).replace(/^["']|["']$/g, '').trim();
  }
}

async function fetchImage(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`image HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// Hero image, with the public catalog as fallback when the synced
// image_url is missing or dead (products.json by handle).
async function resolveImageBuffer(p, poolEntry) {
  const candidates = [p.image_url, poolEntry?.imageUrl].filter(Boolean);
  for (const url of candidates) {
    try { return await fetchImage(url); } catch { /* try next */ }
  }
  const res = await fetch(`https://glamnetic.com/products/${p.handle}.json`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  if (res.ok) {
    const cat = (await res.json()).product;
    for (const im of cat?.images || []) {
      try { return await fetchImage(im.src); } catch { /* try next */ }
    }
  }
  throw new Error('no fetchable catalog image');
}

async function main() {
  loadEnv();
  const sharp = require(path.join(__dirname, '..', 'node_modules', 'sharp'));
  const { createClient } = require(path.join(__dirname, '..', 'node_modules', '@supabase/supabase-js'));
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_API_KEY);

  const pool = JSON.parse(fs.readFileSync(POOL_PATH, 'utf8')).pool;
  const poolById = new Map(pool.map((p) => [p.id, p]));
  console.log(`pool: ${pool.length} products${dryRun ? ' (DRY RUN)' : ''}`);

  const shop = await sb.from('shops').select('id').eq('shop_domain', SHOP_DOMAIN).single();
  if (shop.error) throw new Error(`shop lookup: ${shop.error.message}`);

  // Chunked .in() — 200 ids is fine in one call, but stay defensive.
  const rows = [];
  const ids = [...poolById.keys()];
  for (let i = 0; i < ids.length; i += 100) {
    const r = await sb.from('products')
      .select('id, product_name, handle, status, image_url, transformation_prompt, reference_image_url')
      .eq('shop_id', shop.data.id)
      .in('id', ids.slice(i, i + 100));
    if (r.error) throw new Error(`products fetch: ${r.error.message}`);
    rows.push(...r.data);
  }
  const missing = ids.filter((id) => !rows.some((r) => r.id === id));
  if (missing.length) console.warn(`WARN: ${missing.length} pool ids not found in products table:`, missing.slice(0, 5));

  let done = 0, skipped = 0, failed = 0;
  for (const p of rows) {
    if (p.transformation_prompt) { skipped++; continue; } // already configured — never overwrite
    try {
      const buf = await resolveImageBuffer(p, poolById.get(p.id));
      if (dryRun) {
        console.log(`DRY + ${p.product_name} (image ok, ${Math.round(buf.length / 1024)}kB)`);
        done++;
        continue;
      }
      const webp = await sharp(buf)
        .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 85 }).toBuffer();
      const objectPath = `${SHOP_DOMAIN}/${p.id}-${crypto.randomInt(1e9)}.webp`;
      const up = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/reference-images/${objectPath}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.SUPABASE_API_KEY}`,
          'Content-Type': 'image/webp',
        },
        body: webp,
      });
      if (!up.ok) throw new Error(`storage upload HTTP ${up.status}: ${await up.text()}`);
      const refUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/reference-images/${objectPath}`;

      const upd = await sb.from('products')
        .update({
          transformation_prompt: VTO_PROMPT,
          ai_model: AI_MODEL,
          reference_image_url: refUrl,
          reference_image_urls: [refUrl],
        })
        .eq('id', p.id)
        .is('transformation_prompt', null) // guard against races/re-runs
        .select('id');
      if (upd.error) throw new Error(`update: ${upd.error.message}`);
      if (!upd.data || upd.data.length === 0) throw new Error('update matched 0 rows');
      done++;
      console.log(`+ ${p.product_name}`);
    } catch (e) {
      failed++;
      console.warn(`FAIL ${p.product_name}: ${e.message}`);
    }
  }
  console.log(`\nconfigured: ${done}, already had prompt (skipped): ${skipped}, failed: ${failed}, pool ids missing from DB: ${missing.length}`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
