// Onboard ORLY color SKUs from the public catalog into Gleame products for
// orlybeauty.myshopify.com — the handoff's hero list (page-1 bestsellers +
// French anchors) that aren't configured yet.
//
// Per new product:
//   - attributes from products.json tags (Color_* / Type_* / Formula_*)
//   - display hex extracted from the bottle image via sharp (dominant
//     saturated color, background-filtered), validated against the tag
//     family; canonical per-family hex when extraction is unreliable;
//     no single hex for multi/holo/topper shades
//   - transformation_prompt generated from the house template (same
//     structure as the hand-authored 22: color truth, finish, nail-shape
//     preservation, prohibitions)
//   - up to 2 catalog images re-hosted to the reference-images bucket as webp
//
// Also rewrites scripts/brand-configs/orly-attributes.json for ALL of the
// shop's products (the guidance builder's source) and updates
// chat_assistant_config.ai_guidance + priority_product_ids (bestseller
// ranks 1-10 present in the pool).
//
// Gleame data only; the Shopify store is never written to. Idempotent:
// products already in Gleame (by shopify numeric id) are skipped.
//
// USAGE: node scripts/onboard-orly-products.cjs [--dry-run]
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SHOP_DOMAIN = 'orlybeauty.myshopify.com';
const AI_MODEL = 'gemini-3.1-flash-image-preview';
const dryRun = process.argv.includes('--dry-run');
const { buildGuidance, ATTRIBUTES_PATH } = require('./orly-guidance.cjs');

// Handoff bestseller ranks (page-1, best-selling sort). Rank 16 is absent in
// the handoff table. French anchors + extras carry no rank.
const BESTSELLER_RANK = {
  "All Dahlia'd Up": 1, "She's A Wildflower": 2, 'Retrograde': 3, 'Turn It Up': 4,
  'Kaleidoscope Eyes': 5, 'Sagebrush': 6, 'Morning Mantra': 7, "Kiss Me, I'm Kind": 8,
  'Citrus Got Real': 9, 'Heart Beet': 10, 'Kick Glass': 11, "Don't Pop My Balloon": 12,
  'Almond Milk': 13, 'Detox My Socks Off': 14, 'Fairy Godmother': 15,
  'De-Stressed Denim': 17, "It's Not A Phase": 18, 'Mind Over Matter': 19,
  'Love My Nails': 20, 'Liquid Vinyl': 21, 'White Tips': 22, 'Astral Flaire': 23,
  'Kiss The Bride': 24, 'Beautifully Bizarre': 25, 'Crystal Healing': 26,
  'Crush': 27, 'Sweet Serenity': 28, 'Haute Red': 29,
};
const TARGETS = Object.keys(BESTSELLER_RANK).concat([
  'Bare Rose', 'Sheer Nude', 'Pointe Blanche', 'Des Fleurs', 'Beverly Hills Plum',
  'Canyon Clay',
]);

// Canonical fallback hex per Color_* family, also used to sanity-check the
// extracted color's hue family.
const FAMILY_HEX = {
  red: '#c8102e', pink: '#f48fb1', magenta: '#e0218a', orange: '#e8622d',
  peach: '#f5a17e', coral: '#f76c5e', yellow: '#f1c40f', gold: '#d4af37',
  green: '#4c7a4c', teal: '#2f8f83', turquoise: '#40c4b4', blue: '#3b6bb5',
  purple: '#7b4fa6', lilac: '#b79fd6', brown: '#7a5230', nude: '#d7b49e',
  neutral: '#d7b49e', beige: '#d7b49e', white: '#f2f0ec', black: '#1a1a1a',
  grey: '#8e8e8e', gray: '#8e8e8e', 'rose gold': '#c48a80',
};
// Families where a single hex is meaningless — no hex in prompt or facts.
const NO_HEX_FAMILIES = new Set(['multi', 'rainbow', 'holo', 'iridescent']);

const norm = (s) => s.toLowerCase().replace(/’/g, "'").replace(/[^a-z0-9]/g, '');

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return { h, s, l };
}

// Rough hue windows per family for validating the extracted color.
function hexMatchesFamily(hex, families) {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  const { h, s, l } = rgbToHsl(r, g, b);
  const checks = {
    red: () => (h < 20 || h > 340) && s > 0.3,
    pink: () => (h > 300 || h < 20) && l > 0.35,
    magenta: () => h > 300 && h < 345 && s > 0.4,
    orange: () => h >= 10 && h <= 45 && s > 0.3,
    peach: () => h >= 10 && h <= 45 && l > 0.55,
    coral: () => (h >= 0 && h <= 30) && s > 0.3 && l > 0.4,
    yellow: () => h >= 40 && h <= 70,
    gold: () => h >= 35 && h <= 60,
    green: () => h >= 70 && h <= 180,
    teal: () => h >= 150 && h <= 200,
    turquoise: () => h >= 150 && h <= 200,
    blue: () => h >= 190 && h <= 260,
    purple: () => h >= 255 && h <= 310,
    lilac: () => h >= 255 && h <= 310 && l > 0.55,
    brown: () => h >= 10 && h <= 45 && l < 0.5,
    nude: () => s < 0.45 && l > 0.5,
    neutral: () => s < 0.45,
    beige: () => s < 0.45 && l > 0.5,
    white: () => l > 0.82,
    black: () => l < 0.2,
    grey: () => s < 0.18 && l >= 0.2 && l <= 0.82,
    gray: () => s < 0.18 && l >= 0.2 && l <= 0.82,
    'rose gold': () => (h < 40 || h > 330) && l > 0.4,
  };
  return families.some((f) => checks[f] && checks[f]());
}

// Dominant polish color from the bottle shot: drop near-white background
// pixels, histogram the rest into coarse buckets, average the biggest bucket.
async function extractHex(sharp, buf) {
  const { data, info } = await sharp(buf).resize(64, 64, { fit: 'inside' })
    .removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const buckets = new Map();
  for (let i = 0; i + 2 < data.length; i += 3) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (r > 232 && g > 232 && b > 232) continue; // background
    const key = `${r >> 5}|${g >> 5}|${b >> 5}`;
    const cur = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    cur.n++; cur.r += r; cur.g += g; cur.b += b;
    buckets.set(key, cur);
  }
  let best = null;
  for (const v of buckets.values()) if (!best || v.n > best.n) best = v;
  if (!best || best.n < 40) return null; // not enough signal
  const hx = (v) => Math.round(v / best.n).toString(16).padStart(2, '0');
  return `#${hx(best.r)}${hx(best.g)}${hx(best.b)}`;
}

function attrsFromCatalog(c) {
  const tags = c.tags || [];
  const colors = tags.filter((t) => t.startsWith('Color_')).map((t) => t.slice(6));
  const types = tags.filter((t) => t.startsWith('Type_')).map((t) => t.slice(5));
  const formula = /breathable/i.test(c.product_type) ? 'Breathable'
    : /gel/i.test(c.product_type) ? 'GELFX' : 'Lacquer';
  return {
    colors,
    types,
    formula,
    topper: types.includes('Topper'),
    available: (c.variants || []).some((v) => v.available),
  };
}

const FORMULA_LABEL = {
  Breathable: 'ORLY Breathable 1-Step Manicure',
  Lacquer: 'ORLY Nail Lacquer',
  GELFX: 'ORLY GELFX Gel Nail Polish',
};

function finishSpec(types) {
  const t = new Set(types.map((x) => x.toLowerCase()));
  if (t.has('glitter') || t.has('confetti') || t.has('flakie'))
    return 'Apply as a dense, even layer of the glitter/confetti particles shown in the reference images, suspended in a glossy clear base. Particle size, density and sparkle must match the reference.';
  if (t.has('metallic'))
    return 'Apply at full opacity in two coats with a smooth metallic sheen — light reflects in a soft liquid-metal band across the nail. No chunky glitter particles.';
  if (t.has('shimmer') || t.has('pearl'))
    return 'Apply at full opacity in two coats with a fine, even shimmer suspended in the color — a soft glow, not chunky glitter.';
  if (t.has('sheer') || t.has('jelly'))
    return 'Apply as a sheer, glossy wash of color — the natural nail remains softly visible through the tint. Do not apply at full opacity.';
  return 'Apply at full opacity in two coats with a smooth, glossy creme finish. No shimmer, no metallic quality, no pearl.';
}

function buildPrompt(name, a, hex) {
  const colorPhrase = (a.colors.join('/').toLowerCase() || 'the shade shown in the reference images');
  const finishWord = a.types.length ? a.types.join(' + ').toLowerCase() : 'creme';
  const colorTruth = hex
    ? `${name} is a ${colorPhrase} ${finishWord}, hex ${hex}. Use the reference images as the primary truth for how the shade reads on the nail, and reproduce ${hex} as the primary color. Do not darken it. Do not mute it.`
    : `${name} is a ${colorPhrase} ${finishWord}. The reference images are the color truth — reproduce the color(s) and particle character exactly as shown.`;
  const wear = a.topper
    ? `${name} is a topper: render it worn on its own over the bare nail, exactly as a salon would for a full sparkle look — every visible nail fully covered.`
    : null;
  return [
    'You have been provided reference images of the ORLY product bottle and shade. Use them for color truth, finish quality and gloss level.',
    `Using the provided photo of the customer's hand, apply ${FORMULA_LABEL[a.formula]} in the shade ${name} as a realistic, professionally applied nail color try-on.`,
    colorTruth,
    wear,
    finishSpec(a.types),
    "The polish color is completely independent of the hand's skin tone and must not darken, deepen, or shift on any skin tone.",
    "CRITICAL — nail shape preservation: Do not alter the shape, length, curve, or proportions of the customer's nails in any way. The nails in the original photo have a specific natural shape — reproduce that exact shape under the polish. Do not round, extend, reshape, or reinterpret the nails. The only change from the original photo is the color on the nail plate. Everything else — shape, length, curvature, hand position, skin, background — must be pixel-identical to the original.",
    'Apply only to the nail plate of every visible finger. Every visible nail must be fully covered — leaving any nail bare is a critical failure. Color must sit cleanly within the natural nail boundary; do not bleed into cuticles or surrounding skin.',
    'The result must look like a hyper-realistic salon manicure. Natural nail texture, subtle nail curvature, and specular highlight must remain visible through the polish. The finish is glossy but not mirrored — a professional topcoat sheen.',
    'Do not change, rotate, flip, or alter the hand orientation, finger positioning, camera angle, background, or lighting in any way.',
    'Strict prohibitions:',
    hex ? `Do not darken or shift the color away from ${hex}` : 'Do not shift the color away from the reference images',
    'Do not change the nail shape, nail length, or nail proportions from the original photo',
    'Do not alter skin tone, skin texture, or hand proportions',
    'Do not apply color outside the nail plate',
    'Do not leave any visible nail unpolished',
    "The final image should show the customer's hand exactly as photographed with identical nail shape, coated in the shade exactly as it appears in the reference images, under a glossy topcoat.",
  ].filter(Boolean).join('\n');
}

(async () => {
  for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) process.env[line.slice(0, i)] = line.slice(i + 1).replace(/^["']|["']$/g, '').trim();
  }
  const { createClient } = require('@supabase/supabase-js');
  const sharp = require(path.join(__dirname, '..', 'node_modules', 'sharp'));
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_API_KEY);

  // ---- Live catalog (all pages) ----
  const catalog = [];
  for (let page = 1; page <= 8; page++) {
    const res = await fetch(`https://www.orlybeauty.com/products.json?limit=250&page=${page}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!res.ok) throw new Error(`catalog page ${page}: HTTP ${res.status}`);
    const prods = (await res.json()).products || [];
    if (prods.length === 0) break;
    catalog.push(...prods);
  }
  console.log(`catalog: ${catalog.length} products`);

  const isColorSku = (c) => /lacquer|breathable|gel/i.test(c.product_type || '');
  const byNorm = new Map();
  for (const c of catalog) {
    if (!byNorm.has(norm(c.title))) byNorm.set(norm(c.title), []);
    byNorm.get(norm(c.title)).push(c);
  }

  // ---- Existing Gleame products ----
  const shop = await sb.from('shops').select('id').eq('shop_domain', SHOP_DOMAIN).single();
  if (!shop.data) throw new Error('shop not found');
  const shopId = shop.data.id;
  const existing = await sb.from('products')
    .select('id, product_name, shopify_id, category_id').eq('shop_id', shopId);
  const existingByNumericId = new Map();
  for (const p of existing.data || []) {
    existingByNumericId.set(p.shopify_id.split('/').pop(), p);
  }
  const categoryId = (existing.data || [])[0]?.category_id;
  if (!categoryId) throw new Error('no existing product to copy category_id from');

  // ---- Resolve targets against the catalog ----
  const toOnboard = [];
  for (const t of TARGETS) {
    const candidates = (byNorm.get(norm(t)) || []).filter(isColorSku);
    const c = candidates.find((x) => (x.variants || []).some((v) => v.available)) || candidates[0];
    if (!c) { console.warn(`SKIP (not in catalog): ${t}`); continue; }
    if (existingByNumericId.has(String(c.id))) continue; // already configured
    toOnboard.push({ handoffName: t, c });
  }
  console.log(`to onboard: ${toOnboard.length} products`);

  // ---- Create products ----
  const created = [];
  for (const { handoffName, c } of toOnboard) {
    const a = attrsFromCatalog(c);
    const families = a.colors.map((x) => x.toLowerCase());
    let hex = null;
    let hexSource = 'none';
    if (!families.some((f) => NO_HEX_FAMILIES.has(f))) {
      try {
        const imgRes = await fetch(c.images[0].src, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const buf = Buffer.from(await imgRes.arrayBuffer());
        const extracted = await extractHex(sharp, buf);
        if (extracted && hexMatchesFamily(extracted, families)) {
          hex = extracted; hexSource = 'image';
        } else {
          hex = FAMILY_HEX[families[0]] || null; hexSource = extracted ? 'family-fallback (image off-family)' : 'family-fallback (no signal)';
        }
      } catch (e) {
        hex = FAMILY_HEX[families[0]] || null; hexSource = `family-fallback (${e.message})`;
      }
    }

    const productId = crypto.randomUUID();
    // Re-host up to 2 images: bottle shot + a swatch shot when one exists.
    const swatchImg = (c.images || []).find((im) => /swatch/i.test(im.src));
    const chosen = [c.images[0], swatchImg].filter(Boolean).filter((im, i, arr) => arr.indexOf(im) === i).slice(0, 2);
    const refUrls = [];
    if (!dryRun) {
      for (const im of chosen) {
        try {
          const imgRes = await fetch(im.src, { headers: { 'User-Agent': 'Mozilla/5.0' } });
          const webp = await sharp(Buffer.from(await imgRes.arrayBuffer()))
            .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 85 }).toBuffer();
          const objectPath = `${SHOP_DOMAIN}/${productId}-${crypto.randomInt(1e9)}.webp`;
          const up = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/reference-images/${objectPath}`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${process.env.SUPABASE_API_KEY}`,
              'Content-Type': 'image/webp',
            },
            body: webp,
          });
          if (!up.ok) throw new Error(`storage upload HTTP ${up.status}: ${await up.text()}`);
          refUrls.push(`${process.env.SUPABASE_URL}/storage/v1/object/public/reference-images/${objectPath}`);
        } catch (e) {
          console.warn(`WARN ${c.title}: image upload failed (${e.message})`);
        }
      }
      if (refUrls.length === 0) throw new Error(`no reference image uploaded for ${c.title} — refusing to create a promptable product without color truth`);
      const { error } = await sb.from('products').insert({
        id: productId,
        shop_id: shopId,
        product_name: c.title,
        shopify_id: `gid://shopify/Product/${c.id}`,
        transformation_prompt: buildPrompt(c.title, a, hex),
        ai_model: AI_MODEL,
        category_id: categoryId,
        is_funnel_generated: false,
        reference_image_url: refUrls[0],
        reference_image_urls: refUrls,
      });
      if (error) throw new Error(`insert failed for ${c.title}: ${error.message}`);
    }
    created.push({ name: c.title, handoffName, hex, hexSource, ...a });
    console.log(`+ ${c.title} [${a.formula}] colors=${a.colors.join('/')} types=${a.types.join('/')} hex=${hex ?? '-'} (${hexSource}) refs=${dryRun ? 'dry' : refUrls.length}`);
  }

  // ---- Rewrite the attributes file for ALL shop products ----
  const all = await (dryRun
    ? Promise.resolve(existing)
    : sb.from('products').select('id, product_name, shopify_id').eq('shop_id', shopId));
  const catalogById = new Map(catalog.map((c) => [String(c.id), c]));
  const products = (all.data || []).map((p) => {
    const c = catalogById.get(p.shopify_id.split('/').pop());
    if (!c) {
      return { gleameId: p.id, name: p.product_name, colors: [], types: [], formula: 'Lacquer', retired: true };
    }
    const a = attrsFromCatalog(c);
    const rank = BESTSELLER_RANK[p.product_name.replace(/’/g, "'")] ?? null;
    return { gleameId: p.id, name: p.product_name, ...a, bestsellerRank: rank, retired: false };
  });
  // Retired names get their handoff color notes for the guidance line.
  const RETIRED_COLORS = {
    'Crash the Party': ['Red'], 'You Had Me At Hydrangea': ['Blue', 'Purple'],
    'Peaches and Dreams': ['Peach'], 'Rage': ['Copper'],
  };
  for (const p of products) {
    if (p.retired && RETIRED_COLORS[p.name]) p.colors = RETIRED_COLORS[p.name];
  }
  if (!dryRun) {
    fs.mkdirSync(path.dirname(ATTRIBUTES_PATH), { recursive: true });
    fs.writeFileSync(ATTRIBUTES_PATH, JSON.stringify({ shopDomain: SHOP_DOMAIN, products }, null, 1));
  }

  // ---- Guidance + priority heroes (bestseller ranks 1-10 in the pool) ----
  const heroes = products
    .filter((p) => !p.retired && p.bestsellerRank != null && p.bestsellerRank <= 10)
    .sort((a, b) => a.bestsellerRank - b.bestsellerRank);
  console.log(`heroes (rank<=10): ${heroes.map((h) => `${h.bestsellerRank}:${h.name}`).join(', ')}`);
  if (dryRun) { console.log(`dry run — ${created.length} would be created; config untouched.`); return; }

  const guidance = buildGuidance();
  const { data: updated, error: cfgErr } = await sb.from('chat_assistant_config').update({
    ai_guidance: guidance,
    priority_product_ids: heroes.map((h) => h.gleameId),
    updated_at: new Date().toISOString(),
  }).eq('shop_domain', SHOP_DOMAIN).select('shop_domain');
  if (cfgErr) throw new Error('config update failed: ' + cfgErr.message);
  if (!updated || updated.length === 0) throw new Error('config update matched 0 rows');
  console.log(`DONE: ${created.length} products created; guidance ${guidance.length} chars; ${heroes.length} priority heroes.`);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
