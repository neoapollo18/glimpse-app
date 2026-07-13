// Hard-code the two Glamnetic demo flows as high-specificity scored rules,
// wire the Press & go conditional, and keep occasion-level backstops so ANY
// path stays curated.
//
// HOW TO USE (until the rules-list editor UI ships):
//   1. Edit the product-name lists just below (FLOW_A_TRIO etc.). Names
//      must match Gleame-configured products exactly — the script fails
//      loudly on a missing name.
//   2. Run from the repo root:  node scripts/seed-demo-flows.cjs
//   3. Reload any open Recommendation-logic editor tabs afterwards —
//      saving from a stale tab overwrites this config.
//
// Idempotent: reads current axes/questions from the DB and rewrites
// options/rules atomically via the save RPC. Storefront picks the new
// config up within ~60s (config cache).
'use strict';
const fs = require('fs');
for (const line of fs.readFileSync(__dirname + '/../.env', 'utf8').split('\n')) {
  const i = line.indexOf('=');
  if (i > 0) process.env[line.slice(0, i)] = line.slice(i + 1).replace(/^["']|["']$/g, '').trim();
}
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_API_KEY);
const SHOP_DOMAIN = 'hx5hqt-na.myshopify.com';

// ---- The demo flows' expected results, by product name ----
// Swap these names and re-run once the real Glamnetic sets are configured.
const FLOW_A_TRIO = ['Sapphire', 'Mystic Topaz', 'Pink Tourmaline'];          // Wedding Guest
const FLOW_B_TRIO = ['Almond Milk', 'A Vibe', 'Anything Goes'];               // Your Nails, But Better (subs for Nude Glazed/Teddy/Velvet French)
const GENERIC = ['Star Spangled', 'Blue Tango', 'Bubbly Bombshell', 'Embrace Danger', 'Heart Beet', 'Moments of Bliss - NAIL LACQUER'];

(async () => {
  const shop = await sb.from('shops').select('id').eq('shop_domain', SHOP_DOMAIN).single();
  const shopId = shop.data.id;

  // Product name -> internal id
  const prods = await sb.from('products').select('id, product_name').eq('shop_id', shopId);
  const byName = new Map(prods.data.map(p => [p.product_name, p.id]));
  for (const n of [...FLOW_A_TRIO, ...FLOW_B_TRIO, ...GENERIC]) {
    if (!byName.has(n)) throw new Error('missing product: ' + n);
  }
  const P = (n) => byName.get(n);

  // ---- Read current axes/questions to preserve verbatim ----
  const axesRes = await sb.from('recommendation_axes')
    .select('id, key, label, source, position, recommendation_axis_values ( id, value, label, position, swatch_color )')
    .eq('shop_id', shopId).order('position');
  const axes = axesRes.data;
  const qRes = await sb.from('recommendation_questions')
    .select('id, axis_id, prompt, position, helper_text, multi_select, screen_group, recommendation_question_options ( label, axis_value_id, bot_response, position, reason_text, image_url, show_if, select_all, display_meta )')
    .in('axis_id', axes.map(a => a.id));
  const valueById = new Map();
  for (const a of axes) for (const v of a.recommendation_axis_values) valueById.set(v.id, v.value);
  const axisKeyById = new Map(axes.map(a => [a.id, a.key]));

  const axesPayload = axes.map((a) => ({
    key: a.key, label: a.label, source: a.source, position: a.position,
    values: (a.recommendation_axis_values || []).sort((x, y) => x.position - y.position)
      .map((v, j) => ({ value: v.value, label: v.label, position: j, swatchColor: v.swatch_color || null })),
  }));

  const questionsPayload = qRes.data.sort((x, y) => x.position - y.position).map((q, qi) => ({
    axisKey: axisKeyById.get(q.axis_id),
    prompt: q.prompt, position: qi,
    helperText: q.helper_text || null,
    multiSelect: !!q.multi_select,
    screenGroup: q.screen_group || null,
    options: (q.recommendation_question_options || []).sort((x, y) => x.position - y.position)
      .map((o, i) => {
        let showIf = o.show_if || null;
        // Wire the demo's conditional: Press & go only after Super short.
        // (length is asked before application, so the condition is legal.)
        if (axisKeyById.get(q.axis_id) === 'application' && valueById.get(o.axis_value_id) === 'pressandgo') {
          showIf = { axis_key: 'length', axis_value: 'super' };
        }
        return {
          label: o.label,
          axisValueValue: valueById.get(o.axis_value_id),
          botResponse: o.bot_response || null,
          reasonText: o.reason_text || null,
          imageUrl: o.image_url || null,
          showIf,
          selectAll: !!o.select_all,
          displayMeta: o.display_meta || null,
          position: i,
        };
      }),
  }));

  // ---- Rules: demo flows as high-specificity rules + backstops ----
  const R = (criteria, names) => names.map((n, i) => ({
    criteria, variantId: null, productId: P(n), rank: i + 1, quantity: 1,
  }));
  const rules = [
    // FLOW A — "The Wedding Guest". The 2-key rule wins over every 1-key
    // backstop for any special-event + statement path, regardless of
    // length/application/shape/colors variations mid-demo.
    ...R({ occasion: 'specialevent', style: 'statement' }, FLOW_A_TRIO),
    ...R({ occasion: 'specialevent' }, FLOW_A_TRIO), // backstop: same trio

    // FLOW B — "Your Nails, But Better". Same shape: clean_classic locks
    // the trio; the everydaylife backstop keeps variations curated.
    ...R({ occasion: 'everydaylife', style: 'clean_classic' }, FLOW_B_TRIO),
    ...R({ occasion: 'everydaylife' }, FLOW_B_TRIO),
    // Collaborator's original exact cell, retargeted to agree with Flow B
    // (it outranks the 2-key rule on specificity when its combo is hit).
    ...R({ occasion: 'everydaylife', length: 'super', application: 'pressandgo' }, FLOW_B_TRIO),

    // Occasion backstops for non-demo paths.
    ...R({ occasion: 'work' }, [GENERIC[0], GENERIC[1], GENERIC[2]]),
    ...R({ occasion: 'vacation' }, [GENERIC[3], GENERIC[4], GENERIC[5]]),
    ...R({ occasion: 'newlook' }, [GENERIC[1], GENERIC[3], GENERIC[0]]),

    // Flavor overrides (1-key, add color-truth when picked).
    ...R({ colors: 'dark' }, ['Blue Tango']).slice(0, 1),
    ...R({ colors: 'french' }, ['Almond Milk']).slice(0, 1),
  ];

  const payload = { axes: axesPayload, questions: questionsPayload, rules };
  console.log('payload: axes', payload.axes.length, '| questions', payload.questions.length, '| rules', rules.length);
  const { error } = await sb.rpc('save_recommendation_config', { p_shop_id: shopId, p_payload: payload });
  if (error) throw new Error('RPC failed: ' + error.message);
  console.log('SAVED. Press & go conditional wired: length=super.');
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
