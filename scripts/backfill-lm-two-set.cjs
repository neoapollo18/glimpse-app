// Backfill Locks & Mane's 2-set try-on config (migration 053):
//   - products.multi_set_prompt        ← scripts/lm-two-set-prompts/clip-*.txt
//     (standalone per-product prompts; they REPLACE the single-set prompt
//     when a recommendation's quantity >= 2)
//   - product_variants.multi_set_reference_urls ← per-shade 2-set reference
//     photos, uploaded to the public 'reference-images' storage bucket
//   - chat_assistant_config.quiz_multi_set_prompt ← NULLed (belt-and-braces:
//     migration 053 already clears all 052-era addendum values, which are
//     harmful under the replacement semantics)
//
// The reference photos ship as four zips (one per clip-in length, one image
// per stocked shade). Extract them first:
//   unzip -j "12 inch 2 Sets.zip" -d <dir>/12   (same for 16 / 18 / 20)
//
// USAGE: node scripts/backfill-lm-two-set.cjs [extracted-dir] [--dry-run]
//   default extracted-dir: /tmp/lm-two-set
//
// --dry-run resolves products/variants and prints the full file→shade→variant
// mapping without uploading or writing anything.
//
// Two-phase: EVERY product is validated before ANY write happens, so one bad
// zip can't leave the catalog half-updated. Idempotent: storage paths are
// stable (upsert) and DB writes are plain UPDATEs. FAILS LOUDLY if a stocked
// shade has no image, a file maps to no variant, a query errors, or an
// UPDATE matches 0 rows (Supabase does not error on those).
'use strict';
const fs = require('fs');
const path = require('path');

const SHOP_DOMAIN = 'locks-mane.myshopify.com';
const BUCKET = 'reference-images';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const baseDir = args.find((a) => !a.startsWith('--')) || '/tmp/lm-two-set';

const PRODUCTS = [
  { title: '12" Clip-In Extensions', promptFile: 'clip-12.txt', dir: '12' },
  { title: '16" Clip-In Extensions', promptFile: 'clip-16.txt', dir: '16' },
  { title: '18" Clip-In Extensions', promptFile: 'clip-18.txt', dir: '18' },
  { title: '20" Clip-In Extensions', promptFile: 'clip-20.txt', dir: '20' },
];

// Exact-filename overrides, scoped per directory — never generalized, so a
// future zip's stray "download (1).jpeg" fails loudly instead of silently
// becoming some shade. The 20" zip's one unnamed file was visually verified
// 2026-08-11 as the Dark Chocolate shot (the only shade otherwise missing
// from that zip).
const FILENAME_OVERRIDES = {
  '20': { 'download (2).jpeg': 'darkchocolate' },
};

// Filename → shade key. Files are hand-named ("PB Cup.jpeg", "milk choc 18_
// 2 set.jpeg", "Toasted Marshmellow.jpg"), so match on a normalized substring.
// First hit wins — keep more specific fragments before shorter ones.
const SHADE_FRAGMENTS = [
  ['toastedmarsh', 'toastedmarshmallow'],
  ['cinnamonbun', 'cinnamonbun'],
  ['butterpecan', 'butterpecan'],
  ['butterscotch', 'butterscotch'],
  ['peanut', 'peanutbuttercup'],
  ['pbcup', 'peanutbuttercup'],
  ['milkchoc', 'milkchocolate'],
  ['darkchoc', 'darkchocolate'],
  ['gingerbread', 'gingerbread'],
  ['espresso', 'espresso'],
  ['vanilla', 'vanilla'],
];

const CONTENT_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

const shadeKeyFromFilename = (dirKey, fileName) => {
  const override = (FILENAME_OVERRIDES[dirKey] || {})[fileName];
  if (override) return override;
  const normalized = fileName.replace(/\.[a-z0-9]+$/i, '').toLowerCase().replace(/[^a-z]/g, '');
  const hit = SHADE_FRAGMENTS.find(([frag]) => normalized.includes(frag));
  return hit ? hit[1] : null;
};

// "Vanilla #613" → "vanilla"; matches the shade keys above.
const shadeKeyFromVariantTitle = (title) =>
  title.replace(/\s*#.*$/, '').toLowerCase().replace(/[^a-z]/g, '');

// .single()/.maybeSingle() null out data on real query errors too — surface
// the error instead of misreporting it as "not found".
const must = (res, what) => {
  if (res.error) throw new Error(`${what}: ` + res.error.message);
  return res;
};

(async () => {
  for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) process.env[line.slice(0, i)] = line.slice(i + 1).replace(/^["']|["']$/g, '').trim();
  }
  const { createClient } = require('@supabase/supabase-js');
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_API_KEY);

  const shop = must(
    await sb.from('shops').select('id').eq('shop_domain', SHOP_DOMAIN).maybeSingle(),
    'shops query'
  );
  if (!shop.data) throw new Error('shop not found: ' + SHOP_DOMAIN);
  const shopId = shop.data.id;

  // ---- Phase 1: validate EVERYTHING before any write ----
  const problems = [];
  const plans = [];

  for (const cfg of PRODUCTS) {
    const prompt = fs.readFileSync(path.join(__dirname, 'lm-two-set-prompts', cfg.promptFile), 'utf8').trim();
    if (!prompt) throw new Error('empty prompt file: ' + cfg.promptFile);

    const dir = path.join(baseDir, cfg.dir);
    if (!fs.existsSync(dir)) throw new Error(`missing image dir ${dir} — extract the zips first (see header)`);
    const files = fs.readdirSync(dir).filter((f) => CONTENT_TYPES[f.split('.').pop().toLowerCase()]);

    const product = must(
      await sb.from('products').select('id').eq('shop_id', shopId).eq('product_name', cfg.title).maybeSingle(),
      `products query (${cfg.title})`
    );
    if (!product.data) throw new Error('missing product: ' + cfg.title);
    const variants = must(
      await sb.from('product_variants').select('id, variant_title').eq('product_id', product.data.id),
      `variants query (${cfg.title})`
    );
    const variantByShade = new Map();
    for (const v of variants.data || []) {
      const key = shadeKeyFromVariantTitle(v.variant_title);
      if (variantByShade.has(key)) {
        problems.push(`${cfg.title}: variants "${variantByShade.get(key).variant_title}" and "${v.variant_title}" both normalize to shade "${key}" — one would silently miss its 2-set ref`);
        continue;
      }
      variantByShade.set(key, v);
    }
    if (variantByShade.size === 0) {
      problems.push(`${cfg.title}: no variants in Gleame — run backfill-lm-live-catalog.cjs first`);
      continue;
    }

    // Map every image to a shade, and every shade to at most one image.
    const imageByShade = new Map();
    for (const file of files) {
      const shade = shadeKeyFromFilename(cfg.dir, file);
      if (!shade) { problems.push(`${cfg.dir}/${file}: unrecognized shade`); continue; }
      if (imageByShade.has(shade)) { problems.push(`${cfg.dir}/${file}: duplicate image for "${shade}" (already have ${imageByShade.get(shade)})`); continue; }
      imageByShade.set(shade, file);
    }
    for (const shade of variantByShade.keys()) {
      if (!imageByShade.has(shade)) problems.push(`${cfg.title}: stocked shade "${shade}" has NO 2-set reference image`);
    }
    for (const shade of imageByShade.keys()) {
      if (!variantByShade.has(shade)) problems.push(`${cfg.dir}/${imageByShade.get(shade)}: shade "${shade}" is not stocked on ${cfg.title}`);
    }

    console.log(`${cfg.title}: prompt ${prompt.length} chars, ${imageByShade.size}/${variantByShade.size} stocked shades covered`);
    for (const [shade, file] of imageByShade) {
      console.log(`  ${shade.padEnd(20)} ← ${cfg.dir}/${file}${variantByShade.has(shade) ? '' : '  (NO VARIANT)'}`);
    }
    plans.push({ cfg, prompt, dir, productId: product.data.id, variantByShade, imageByShade });
  }

  if (problems.length > 0) {
    console.error('\nPROBLEMS — nothing was written:');
    for (const p of problems) console.error('  - ' + p);
    process.exit(1);
  }
  if (dryRun) { console.log('\ndry run — nothing written.'); return; }

  // ---- Phase 2: write (all products validated clean) ----
  for (const { cfg, prompt, dir, productId, variantByShade, imageByShade } of plans) {
    const upd = must(
      await sb.from('products').update({ multi_set_prompt: prompt }).eq('id', productId).select('id'),
      `update ${cfg.title}`
    );
    if (!upd.data || upd.data.length === 0) throw new Error(`update ${cfg.title} matched 0 rows`);

    for (const [shade, file] of imageByShade) {
      const variant = variantByShade.get(shade);
      const ext = file.split('.').pop().toLowerCase();
      const storagePath = `${SHOP_DOMAIN}/two-set/${cfg.dir}/${shade}.${ext}`;
      const up = await sb.storage.from(BUCKET).upload(storagePath, fs.readFileSync(path.join(dir, file)), {
        contentType: CONTENT_TYPES[ext],
        upsert: true,
      });
      if (up.error) throw new Error(`upload ${storagePath}: ` + up.error.message);
      const { data: urlData } = sb.storage.from(BUCKET).getPublicUrl(up.data.path);

      const vUpd = must(
        await sb.from('product_variants')
          .update({ multi_set_reference_urls: [urlData.publicUrl] })
          .eq('id', variant.id).select('id'),
        `update variant ${variant.variant_title}`
      );
      if (!vUpd.data || vUpd.data.length === 0) throw new Error(`update variant ${variant.variant_title} matched 0 rows`);
      console.log(`  saved ${variant.variant_title} → ${urlData.publicUrl}`);
    }
  }

  // Belt-and-braces with migration 053's global clear (see header). The
  // update must see the row — its absence would mean the quiz config
  // vanished, which is a louder problem than this backfill.
  const cfgUpd = must(
    await sb.from('chat_assistant_config')
      .update({ quiz_multi_set_prompt: null }).eq('shop_domain', SHOP_DOMAIN).select('shop_domain'),
    'null quiz_multi_set_prompt'
  );
  if (!cfgUpd.data || cfgUpd.data.length === 0) throw new Error('chat_assistant_config row missing for ' + SHOP_DOMAIN);

  console.log('\nDONE. quiz_multi_set_prompt cleared; per-product 2-set prompts + per-shade refs live.');
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
