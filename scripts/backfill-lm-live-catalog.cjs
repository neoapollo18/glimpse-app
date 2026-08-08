// Backfill Gleame's products/product_variants for the REAL Locks & Mane store
// (locks-mane.myshopify.com) so compile-brand-flow.cjs can resolve targets.
//
// READ-ONLY against Shopify — it only queries the Admin API to discover
// product/variant ids; every write goes to Gleame's Supabase tables. This is
// deliberate: the live store's catalog must not be modified (contrast with
// backfill-lm-testing-catalog.cjs, which productSets the dev store).
//
// Idempotent: Gleame products are matched by (shop_id, product_name); variant
// rows are wiped and re-inserted per extension product. Accessories get
// product rows only (the rec engine targets them at product level).
//
// USAGE: node scripts/backfill-lm-live-catalog.cjs
'use strict';
const fs = require('fs');
const path = require('path');

for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n')) {
  const i = line.indexOf('=');
  if (i > 0) process.env[line.slice(0, i)] = line.slice(i + 1).replace(/^["']|["']$/g, '').trim();
}

const SHOP_DOMAIN = 'locks-mane.myshopify.com';
const API_VERSION = '2024-10';

// Swatch hexes by shade name — variant titles on the live store carry dye
// codes ("Vanilla #613"), so we match on the name prefix.
const SHADE_HEX = {
  'Vanilla': '#f3d6b7',
  'Toasted Marshmallow': '#e8dac6',
  'Cinnamon Bun': '#f6d9c1',
  'Butter Pecan': '#d3a96f',
  'Butterscotch': '#b98a4e',
  'Peanut Butter Cup': '#8a5f3a',
  'Gingerbread': '#6f452a',
  'Milk Chocolate': '#483632',
  'Dark Chocolate': '#261a16',
  'Espresso': '#191816',
};

// Live Shopify titles, verbatim. Extensions get try-on prompts + shade
// variants; accessories only need a product row for rule targets.
const EXTENSION_TITLES = [
  '12" Clip-In Extensions',
  '16" Clip-In Extensions',
  '18" Clip-In Extensions',
  '20" Clip-In Extensions',
  '14" Clip-In Ponytail',
  '18" Clip-In Ponytail',
];
const ACCESSORY_TITLES = [
  'Denim Headband',
  'Fleurette Gem Stone Headband',
  'Embroidered Floral Headband',
  'Lavish Gemstone Headband',
  '3 Hearts Barrette Set',
  'Mini Gem Skinny Headband - Gold',
  'Diamond Veil Headband',
  'Cozumel Headband',
  "Midsummer Night's Dream Headband",
  'Vintage Gem Headband - Mint Green',
  'So 90s Barrette Set',
  'Pearl Laurel Headband',
  'Soft Touch Braided Headband',
  'Blue Gemstone Barrette Set',
  'Tawny Diamond Headband',
];

const HAIR_PROMPT = [
  'Apply realistic clip-in hair extensions in the specified shade to the',
  'person\'s existing hair, adding length and volume while preserving the',
  'natural hairline, part, and texture. Blend the extension strands',
  'seamlessly with the existing hair. Do not change the face, skin,',
  'lighting, or background.',
].join('\n');

(async () => {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const session = await prisma.session.findFirst({
    where: { shop: SHOP_DOMAIN },
    orderBy: { expires: 'desc' },
  });
  await prisma.$disconnect();
  if (!session) throw new Error('no Shopify session for ' + SHOP_DOMAIN);

  // Single read-only query; paginate so a ~100-product catalog can't truncate.
  const nodes = [];
  let cursor = null;
  for (;;) {
    const res = await fetch(`https://${SHOP_DOMAIN}/admin/api/${API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': session.accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: `query($cursor: String) {
          products(first: 100, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            nodes { id title status variants(first: 20) { nodes { id title } } }
          }
        }`,
        variables: { cursor },
      }),
    });
    const json = await res.json();
    if (json.errors) throw new Error('GraphQL: ' + JSON.stringify(json.errors));
    nodes.push(...json.data.products.nodes);
    if (!json.data.products.pageInfo.hasNextPage) break;
    cursor = json.data.products.pageInfo.endCursor;
  }

  // Prefer ACTIVE when titles are duplicated across archived/draft copies.
  const byTitle = new Map();
  for (const p of nodes) {
    const cur = byTitle.get(p.title);
    if (!cur || (cur.status !== 'ACTIVE' && p.status === 'ACTIVE')) byTitle.set(p.title, p);
  }
  const missing = [...EXTENSION_TITLES, ...ACCESSORY_TITLES].filter((t) => !byTitle.has(t));
  if (missing.length) throw new Error('titles not found on Shopify: ' + missing.join(' | '));
  for (const t of [...EXTENSION_TITLES, ...ACCESSORY_TITLES]) {
    if (byTitle.get(t).status !== 'ACTIVE') console.warn(`WARN: "${t}" is ${byTitle.get(t).status} on Shopify`);
  }

  const { createClient } = require('@supabase/supabase-js');
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_API_KEY);
  const shop = await sb.from('shops').select('id').eq('shop_domain', SHOP_DOMAIN).single();
  if (!shop.data) throw new Error('Gleame shop not found: ' + SHOP_DOMAIN);
  const shopId = shop.data.id;

  const upsertProduct = async (title, prompt) => {
    const product = byTitle.get(title);
    const existing = (await sb.from('products')
      .select('id')
      .eq('shop_id', shopId)
      .eq('product_name', title)
      .maybeSingle()).data;
    if (existing) {
      const upd = await sb.from('products')
        .update({ shopify_id: product.id, transformation_prompt: prompt })
        .eq('id', existing.id)
        .select('id');
      if (upd.error) throw new Error(`update ${title}: ` + upd.error.message);
      if (!upd.data || upd.data.length === 0) throw new Error(`update ${title} matched 0 rows`);
      return { rowId: existing.id, product };
    }
    const ins = await sb.from('products')
      .insert({ shop_id: shopId, product_name: title, shopify_id: product.id, transformation_prompt: prompt })
      .select('id')
      .single();
    if (ins.error) throw new Error(`insert ${title}: ` + ins.error.message);
    return { rowId: ins.data.id, product };
  };

  for (const title of EXTENSION_TITLES) {
    const { rowId, product } = await upsertProduct(title, HAIR_PROMPT);
    const del = await sb.from('product_variants').delete().eq('product_id', rowId);
    if (del.error) throw new Error(`clear variants ${title}: ` + del.error.message);

    const variantRows = product.variants.nodes.map((v) => {
      const shadeName = v.title.replace(/\s*#.*$/, '');
      const hex = SHADE_HEX[shadeName] || null;
      if (!hex) console.warn(`WARN: no swatch hex for variant "${v.title}" on ${title}`);
      return {
        product_id: rowId,
        shopify_variant_id: v.id,
        variant_title: v.title,
        display_color: hex,
        transformation_prompt:
          HAIR_PROMPT + `\n\nExtension shade: ${shadeName}` + (hex ? ` (approximately ${hex}).` : '.'),
      };
    });
    const insV = await sb.from('product_variants').insert(variantRows);
    if (insV.error) throw new Error(`insert variants ${title}: ` + insV.error.message);
    console.log(`gleame synced: ${title} (${variantRows.length} variants)`);
  }

  for (const title of ACCESSORY_TITLES) {
    await upsertProduct(title, null);
    console.log(`gleame synced: ${title} (accessory, product-level)`);
  }

  console.log('backfill complete — no Shopify writes performed.');
})().catch((e) => { console.error(e); process.exit(1); });
