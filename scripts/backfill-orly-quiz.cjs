// One-off backfill: ORLY quiz funnel (Charlie handoff v1, 2026-08) into Gleame.
// Replaces the placeholder skintone/undertone makeup matrix on
// orlybeauty.myshopify.com with the 4-question nail quiz, LLM-ranked
// (recommendation_mode 'ai', zero matrix rules).
//
// Prior config backed up at scripts/backups/orly-config-backup-2026-08-15.json.
// Gleame data only — writes recommendation_* tables via the
// save_recommendation_config RPC (atomic wipe-and-rewrite) plus a
// chat_assistant_config update. Never touches Shopify store data.
//
// USAGE: node scripts/backfill-orly-quiz.cjs [--dry-run]
'use strict';
const fs = require('fs');
const path = require('path');

const SHOP_DOMAIN = 'orlybeauty.myshopify.com';
const dryRun = process.argv.includes('--dry-run');
const { buildGuidance, ATTRIBUTES_PATH } = require('./orly-guidance.cjs');

// ---- Axes ----
const axes = [
  {
    key: 'vibe', label: 'Vibe', source: 'user_question', position: 0,
    values: [
      { value: 'model_off_duty', label: 'Model Off-Duty' },
      { value: 'soft_sweet', label: 'Soft & Sweet' },
      { value: 'timeless', label: 'Timeless' },
      { value: 'girls_night_out', label: "Girls' Night Out" },
      { value: 'full_glam', label: 'Full Glam' },
      { value: 'vacation', label: 'Vacation' },
      { value: 'coastal_cool', label: 'Coastal Cool' },
      { value: 'moody', label: 'Moody' },
    ],
  },
  {
    key: 'intensity', label: 'Intensity', source: 'user_question', position: 1,
    values: [
      { value: 'subtle', label: 'Subtle' },
      { value: 'just_right', label: 'Just right' },
      { value: 'full_look', label: 'The full look' },
    ],
  },
  {
    key: 'colors', label: 'Colors', source: 'user_question', position: 2,
    values: [
      { value: 'reds', label: 'Reds', swatchColor: '#c0392b' },
      { value: 'oranges', label: 'Oranges', swatchColor: '#e67e22' },
      { value: 'yellows', label: 'Yellows', swatchColor: '#f1c40f' },
      { value: 'greens', label: 'Greens', swatchColor: '#27ae60' },
      { value: 'blues', label: 'Blues', swatchColor: '#2980b9' },
      { value: 'purples', label: 'Purples', swatchColor: '#8e44ad' },
      { value: 'pinks', label: 'Pinks', swatchColor: '#f48fb1' },
      { value: 'nudes', label: 'Nudes', swatchColor: '#d7b49e' },
      { value: 'browns', label: 'Browns', swatchColor: '#8d6e63' },
      { value: 'whites', label: 'Whites', swatchColor: '#f5f5f5' },
      { value: 'greys', label: 'Greys', swatchColor: '#9e9e9e' },
      { value: 'blacks', label: 'Blacks', swatchColor: '#212121' },
    ],
  },
  {
    key: 'finishes', label: 'Finishes', source: 'user_question', position: 3,
    values: [
      { value: 'classic_creme', label: 'Classic Creme' },
      { value: 'soft_shimmer', label: 'Soft Shimmer' },
      { value: 'full_sparkle', label: 'Full Sparkle' },
      { value: 'chrome_metallic', label: 'Chrome & Metallic' },
      { value: 'sheer_glossy', label: 'Sheer & Glossy' },
    ],
  },
];

// ---- Questions (locked final strings from the handoff — verbatim) ----
const questions = [
  {
    axisKey: 'vibe',
    prompt: 'What’s the vibe?',
    position: 0,
    options: [
      { label: 'Model Off-Duty — milky, sheer, expensive-looking nothing', value: 'model_off_duty' },
      { label: 'Soft & Sweet — soft pinks, baby blue, butter yellow', value: 'soft_sweet' },
      { label: 'Timeless — the classics — cherry red, French, goes with everything', value: 'timeless' },
      { label: "Girls' Night Out — vampy, sexy, dressed to be seen", value: 'girls_night_out' },
      { label: 'Full Glam — glitter, chrome, maximum sparkle', value: 'full_glam' },
      { label: 'Vacation — tropical brights, sunshine colors', value: 'vacation' },
      { label: 'Coastal Cool — blues, greens, sea-glass', value: 'coastal_cool' },
      { label: 'Moody — dark, mysterious, a little dangerous', value: 'moody' },
    ],
  },
  {
    axisKey: 'intensity',
    prompt: 'How far are we taking this look?',
    position: 1,
    options: [
      { label: 'Subtle - a hint of it', value: 'subtle' },
      { label: 'Just right - balanced, everyday-proof', value: 'just_right' },
      { label: 'The full look - all the way', value: 'full_look' },
    ],
  },
  {
    axisKey: 'colors',
    prompt: 'Any colors you’re drawn to?',
    position: 2,
    multiSelect: true,
    maxSelections: 3, // enforced by the widget once migration 055 is applied
    helperText: 'Pick up to 3.',
    options: [
      { label: 'Reds', value: 'reds' },
      { label: 'Oranges', value: 'oranges' },
      { label: 'Yellows', value: 'yellows' },
      { label: 'Greens', value: 'greens' },
      { label: 'Blues', value: 'blues' },
      { label: 'Purples', value: 'purples' },
      { label: 'Pinks', value: 'pinks' },
      { label: 'Nudes', value: 'nudes' },
      { label: 'Browns', value: 'browns' },
      { label: 'Whites', value: 'whites' },
      { label: 'Greys', value: 'greys' },
      { label: 'Blacks', value: 'blacks' },
      // select_all: widget sends _any; the anchor axis value is ignored.
      { label: 'Surprise Me', value: 'reds', selectAll: true },
    ],
  },
  {
    axisKey: 'finishes',
    prompt: 'Any finishes you love?',
    position: 3,
    multiSelect: true,
    maxSelections: 2, // enforced by the widget once migration 055 is applied
    helperText: 'Pick up to 2.',
    options: [
      { label: 'Classic Creme', value: 'classic_creme' },
      { label: 'Soft Shimmer', value: 'soft_shimmer' },
      { label: 'Full Sparkle', value: 'full_sparkle' },
      { label: 'Chrome & Metallic', value: 'chrome_metallic' },
      { label: 'Sheer & Glossy', value: 'sheer_glossy' },
      { label: 'No Preference', value: 'classic_creme', selectAll: true },
    ],
  },
];

// Heroes + guidance come from scripts/orly-guidance.cjs +
// brand-configs/orly-attributes.json (rewritten by onboard-orly-products.cjs
// on each catalog pull). Heroes = bestseller ranks 1-10 present in the pool.


(async () => {
  for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) process.env[line.slice(0, i)] = line.slice(i + 1).replace(/^["']|["']$/g, '').trim();
  }
  const { createClient } = require('@supabase/supabase-js');
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_API_KEY);

  const shop = await sb.from('shops').select('id').eq('shop_domain', SHOP_DOMAIN).single();
  if (!shop.data) throw new Error('shop not found: ' + SHOP_DOMAIN);
  const shopId = shop.data.id;

  // Heroes: bestseller ranks 1-10 from the attributes file (see
  // onboard-orly-products.cjs), verified against live product rows.
  const attrs = JSON.parse(fs.readFileSync(ATTRIBUTES_PATH, 'utf8'));
  const prods = await sb.from('products').select('id').eq('shop_id', shopId);
  const liveIds = new Set((prods.data || []).map((p) => p.id));
  const heroIds = attrs.products
    .filter((p) => !p.retired && p.bestsellerRank != null && p.bestsellerRank <= 10)
    .sort((a, b) => a.bestsellerRank - b.bestsellerRank)
    .map((p) => p.gleameId)
    .filter((id) => liveIds.has(id));
  const AI_GUIDANCE = buildGuidance();

  const payload = {
    axes: axes.map((a) => ({
      key: a.key, label: a.label, source: a.source, position: a.position,
      values: a.values.map((v, j) => ({
        value: v.value, label: v.label, position: j, swatchColor: v.swatchColor || null,
      })),
    })),
    questions: questions.map((q) => ({
      axisKey: q.axisKey,
      prompt: q.prompt,
      position: q.position,
      helperText: q.helperText || null,
      multiSelect: !!q.multiSelect,
      maxSelections: q.maxSelections ?? null,
      screenGroup: null,
      showIf: null,
      optionStyle: null,
      options: q.options.map((o, i) => ({
        label: o.label,
        axisValueValue: o.value,
        botResponse: null,
        reasonText: null,
        imageUrl: null,
        showIf: null,
        selectAll: !!o.selectAll,
        displayMeta: null,
        position: i,
      })),
    })),
    rules: [], // mode 'ai': the LLM ranks; no matrix
  };

  console.log(`shop ${shopId}: axes ${payload.axes.length}, questions ${payload.questions.length}, heroes ${heroIds.length}, guidance ${AI_GUIDANCE.length} chars`);
  if (dryRun) { console.log('dry run — nothing saved.'); return; }

  const { error } = await sb.rpc('save_recommendation_config', { p_shop_id: shopId, p_payload: payload });
  if (error) throw new Error('RPC failed: ' + error.message);

  const { data: updated, error: cfgErr } = await sb.from('chat_assistant_config').update({
    assistant_mode: 'quiz',
    recommendation_mode: 'ai',
    num_recommendations: 5, // engine max; handoff wants 6 (app change pending)
    ai_guidance: AI_GUIDANCE,
    priority_product_ids: heroIds,
    // boost (not pin): pin would front-load every picked hero; the handoff
    // wants heroes in slots 1-2 only, so a bounded nudge + the guidance line.
    recommendation_tuning: { priorityStyle: 'boost', priorityBoostSlots: 3, rankerModel: 'flash' },
    quiz_availability_filter: true, // handoff precondition: in-stock only
    updated_at: new Date().toISOString(),
  }).eq('shop_domain', SHOP_DOMAIN).select('shop_domain');
  if (cfgErr) throw new Error('chat_assistant_config update failed: ' + cfgErr.message);
  if (!updated || updated.length === 0) throw new Error('chat_assistant_config update matched 0 rows — config row missing?');

  console.log('SAVED. Verifying…');
  const ax = await sb.from('recommendation_axes').select('key, source, recommendation_axis_values(value)').eq('shop_id', shopId).order('position');
  for (const a of ax.data || []) console.log(`  axis ${a.key} (${a.source}): ${a.recommendation_axis_values.length} values`);
  const qs = await sb.from('recommendation_questions').select('prompt, multi_select, helper_text, recommendation_question_options(label, select_all)').in('axis_id', (await sb.from('recommendation_axes').select('id').eq('shop_id', shopId)).data.map((r) => r.id)).order('position');
  for (const q of qs.data || []) console.log(`  Q: "${q.prompt}" multi=${q.multi_select} options=${q.recommendation_question_options.length} selectAll=${q.recommendation_question_options.filter((o) => o.select_all).length}`);
  const rules = await sb.from('recommendation_rules').select('id', { count: 'exact', head: true }).eq('shop_id', shopId);
  console.log(`  rules: ${rules.count}`);
  const cfg = await sb.from('chat_assistant_config').select('assistant_mode, recommendation_mode, num_recommendations, priority_product_ids, quiz_availability_filter, recommendation_tuning').eq('shop_domain', SHOP_DOMAIN).single();
  console.log('  config:', JSON.stringify(cfg.data));
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
