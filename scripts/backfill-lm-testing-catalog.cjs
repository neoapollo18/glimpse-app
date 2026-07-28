// One-time backfill for the Locks & Mane TESTING flow on
// glimpsetesting.myshopify.com: creates the clip-in/ponytail catalog on the
// Shopify dev store (productSet, 10 shade variants each) and mirrors it into
// Gleame's products/product_variants tables so compile-brand-flow.cjs can
// resolve targets by name.
//
// Idempotent: Shopify products are matched by title (productSet with id when
// found); Gleame rows are matched by (shop_id, product_name) and variant
// rows are wiped and re-inserted per product.
//
// USAGE: node scripts/backfill-lm-testing-catalog.cjs
'use strict';
const fs = require('fs');
const path = require('path');

for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n')) {
  const i = line.indexOf('=');
  if (i > 0) process.env[line.slice(0, i)] = line.slice(i + 1).replace(/^["']|["']$/g, '').trim();
}

const SHOP_DOMAIN = 'glimpsetesting.myshopify.com';
const API_VERSION = '2024-10';

// Locks & Mane's real shade range, lightest to darkest — must stay in sync
// with the hair_shade axis in brand-configs/locks-and-mane*.json.
const SHADES = [
  { title: 'Vanilla', hex: '#f3d6b7' },
  { title: 'Toasted Marshmallow', hex: '#e8dac6' },
  { title: 'Cinnamon Bun', hex: '#f6d9c1' },
  { title: 'Butter Pecan', hex: '#d3a96f' },
  { title: 'Butterscotch', hex: '#b98a4e' },
  { title: 'Peanut Butter Cup', hex: '#8a5f3a' },
  { title: 'Gingerbread', hex: '#6f452a' },
  { title: 'Milk Chocolate', hex: '#483632' },
  { title: 'Dark Chocolate', hex: '#261a16' },
  { title: 'Espresso', hex: '#191816' },
];

const PRODUCTS = [
  { name: '12" Clip-In Extensions', price: '169.00' },
  { name: '16" Clip-In Extensions', price: '189.00' },
  { name: '18" Clip-In Extensions', price: '209.00' },
  { name: '20" Clip-In Extensions', price: '229.00' },
  { name: '18" Clip-In Ponytail', price: '129.00' },
];

const HAIR_PROMPT = [
  'Apply realistic clip-in hair extensions in the specified shade to the',
  'person\'s existing hair, adding length and volume while preserving the',
  'natural hairline, part, and texture. Blend the extension strands',
  'seamlessly with the existing hair. Do not change the face, skin,',
  'lighting, or background.',
].join('\n');

(async () => {
  // ---- Shopify session token (offline) ----
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const session = await prisma.session.findFirst({
    where: { shop: SHOP_DOMAIN },
    orderBy: { expires: 'desc' },
  });
  if (!session) throw new Error('no Shopify session for ' + SHOP_DOMAIN);

  const gql = async (query, variables) => {
    const res = await fetch(`https://${SHOP_DOMAIN}/admin/api/${API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': session.accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });
    const json = await res.json();
    if (json.errors) throw new Error('GraphQL: ' + JSON.stringify(json.errors));
    return json.data;
  };

  // ---- Existing products by title ----
  const existing = await gql(
    '{ products(first: 100) { nodes { id title } } }'
  );
  const idByTitle = new Map(existing.products.nodes.map((p) => [p.title, p.id]));

  // ---- productSet each catalog product (create or replace variants) ----
  const PRODUCT_SET = `
    mutation productSet($input: ProductSetInput!) {
      productSet(synchronous: true, input: $input) {
        product {
          id
          title
          variants(first: 20) { nodes { id title } }
        }
        userErrors { field message }
      }
    }`;

  const shopifyProducts = [];
  for (const spec of PRODUCTS) {
    const input = {
      title: spec.name,
      status: 'ACTIVE',
      productOptions: [{ name: 'Shade', values: SHADES.map((s) => ({ name: s.title })) }],
      variants: SHADES.map((s) => ({
        optionValues: [{ optionName: 'Shade', name: s.title }],
        price: spec.price,
      })),
    };
    const id = idByTitle.get(spec.name);
    if (id) input.id = id;

    const data = await gql(PRODUCT_SET, { input });
    const errs = data.productSet.userErrors;
    if (errs && errs.length) {
      throw new Error(`productSet ${spec.name}: ` + JSON.stringify(errs));
    }
    const product = data.productSet.product;
    shopifyProducts.push({ spec, product });
    console.log(
      `shopify ${id ? 'updated' : 'created'}: ${product.title} ` +
      `(${product.variants.nodes.length} variants)`
    );
  }
  await prisma.$disconnect();

  // ---- Mirror into Gleame (Supabase) ----
  const { createClient } = require('@supabase/supabase-js');
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_API_KEY);

  const shop = await sb.from('shops').select('id').eq('shop_domain', SHOP_DOMAIN).single();
  if (!shop.data) throw new Error('Gleame shop not found: ' + SHOP_DOMAIN);
  const shopId = shop.data.id;

  for (const { spec, product } of shopifyProducts) {
    // Find-or-create the product row by name, keep shopify_id in sync.
    let row = (await sb
      .from('products')
      .select('id')
      .eq('shop_id', shopId)
      .eq('product_name', spec.name)
      .maybeSingle()).data;

    if (row) {
      const upd = await sb.from('products')
        .update({ shopify_id: product.id, transformation_prompt: HAIR_PROMPT })
        .eq('id', row.id);
      if (upd.error) throw new Error(`update product ${spec.name}: ` + upd.error.message);
    } else {
      const ins = await sb.from('products')
        .insert({
          shop_id: shopId,
          product_name: spec.name,
          shopify_id: product.id,
          transformation_prompt: HAIR_PROMPT,
        })
        .select('id')
        .single();
      if (ins.error) throw new Error(`insert product ${spec.name}: ` + ins.error.message);
      row = ins.data;
    }

    // Variants: wipe and re-insert (10 shades, display_color for swatches).
    const del = await sb.from('product_variants').delete().eq('product_id', row.id);
    if (del.error) throw new Error(`clear variants ${spec.name}: ` + del.error.message);

    const variantRows = product.variants.nodes.map((v) => {
      const shade = SHADES.find((s) => s.title === v.title);
      return {
        product_id: row.id,
        shopify_variant_id: v.id,
        variant_title: v.title,
        display_color: shade ? shade.hex : null,
        transformation_prompt:
          HAIR_PROMPT + `\n\nExtension shade: ${v.title}` +
          (shade ? ` (approximately ${shade.hex}).` : '.'),
      };
    });
    const insV = await sb.from('product_variants').insert(variantRows);
    if (insV.error) throw new Error(`insert variants ${spec.name}: ` + insV.error.message);
    console.log(`gleame synced: ${spec.name} (${variantRows.length} variants)`);
  }

  console.log('backfill complete.');
})().catch((e) => { console.error(e); process.exit(1); });
