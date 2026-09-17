// One-off backfill: Glamnetic "Find My Nail Match" v1 (Mia handoff, Sept
// 2026) into Gleame for glamrco.myshopify.com. Recommendation logic and
// questions ONLY — never touches transformation prompts, reference images,
// or any try-on/VTO configuration.
//
// What it writes:
//   - axes + questions (with the handoff's branching) via the
//     save_recommendation_config RPC (atomic wipe-and-rewrite), zero matrix
//     rules — recommendation_mode 'ai', the LLM ranks per the guidance.
//   - chat_assistant_config upsert: quiz mode, ai mode, guidance from
//     glamnetic-guidance.cjs, the 200-product pool as selected_product_ids
//     (product_scope 'selected'), bestseller boost, availability filter.
//   - backs up then deletes the shop's studio DRAFT row so the studio
//     re-seeds from this backfilled live config instead of showing the
//     stale blank draft (quiz_config_versions status='draft').
//
// Branching (per the handoff — gate for impossibility, weight for preference):
//   - "Press & go" option only shows when the length answer includes Super
//     short (showIf length=super_short; conditionMet handles multi-select).
//   - Adhesive tabs maps to the SAME axis value as Glue-on (glue_on): same
//     catalog, tabs is an accessory + copy difference. This is also what
//     makes the shape gate expressible: Coffin and Squoval carry
//     showIf application=glue_on, so they hide exactly when Press & go is
//     picked and show for both Glue-on and Tabs. (show_if is a single
//     axis/value pair — a two-value application axis is the L&M-precedent
//     encoding, not a shortcut.) Known limit: the ranker can't tell tabs
//     from glue-on, so the tabs-specific reason bullet and the tabs
//     add-to-cart accessory need app work (handoff §8, not wired yet).
//
// !! RE-RUN WARNING (2026-09-16): this script already ran on 2026-09-09 and
// the DB has since been edited by hand — studio draft styling (boxed vibe
// cards, title-cased labels, colors/copy, assistant "Laura") on 09-14, and a
// targeted spec sync (Out of Office rename + vibe sublabels, applied to BOTH
// live tables and the draft) on 09-16. Re-running would wipe the draft
// (backed up, but still) and reset live to this file. Diff DB vs this config
// before ever running it again.
//
// USAGE: node scripts/backfill-glamnetic-quiz.cjs [--dry-run]
'use strict';
const fs = require('fs');
const path = require('path');

const SHOP_DOMAIN = 'glamrco.myshopify.com';
const dryRun = process.argv.includes('--dry-run');
const { buildGuidance, POOL_PATH } = require('./glamnetic-guidance.cjs');

// ---- Axes ----
const axes = [
  {
    key: 'vibe', label: 'Vibe', source: 'user_question', position: 0,
    values: [
      { value: 'model_off_duty', label: 'Model off-duty' },
      { value: 'soft_sweet', label: 'Soft & sweet' },
      { value: 'french_girl', label: 'French girl forever' },
      { value: 'girls_night_out', label: 'Girls night out' },
      { value: 'main_character', label: 'Main character energy' },
      { value: 'vacation', label: 'Out of Office' },
      { value: 'after_hours', label: 'After hours' },
      { value: 'spooky_season', label: 'Spooky season' },
    ],
  },
  {
    key: 'length', label: 'Length', source: 'user_question', position: 1,
    values: [
      { value: 'super_short', label: 'Super Short' },
      { value: 'short', label: 'Short' },
      { value: 'medium', label: 'Medium' },
      { value: 'long', label: 'Long' },
    ],
  },
  {
    key: 'application', label: 'Application', source: 'user_question', position: 2,
    values: [
      { value: 'press_and_go', label: 'Press & go' },
      { value: 'glue_on', label: 'Glue-on' },
    ],
  },
  {
    key: 'shape', label: 'Shape', source: 'user_question', position: 3,
    values: [
      { value: 'almond', label: 'Almond' },
      { value: 'coffin', label: 'Coffin' },
      { value: 'oval', label: 'Oval' },
      { value: 'round', label: 'Round' },
      { value: 'squoval', label: 'Squoval' },
      { value: 'square', label: 'Square' },
    ],
  },
  {
    key: 'color_family', label: 'Color', source: 'user_question', position: 4,
    values: [
      { value: 'nudes_neutrals', label: 'Nudes & neutrals', swatchColor: '#d7b49e' },
      { value: 'pinks_pastels', label: 'Pinks & pastels', swatchColor: '#f6c6d7' },
      { value: 'reds_berries', label: 'Reds & berries', swatchColor: '#8e2135' },
      { value: 'bold_bright', label: 'Bold & bright', swatchColor: '#ff6f3c' },
      { value: 'dark_moody', label: 'Dark & moody', swatchColor: '#2b2b35' },
      { value: 'metallics_shimmer', label: 'Metallics & shimmer', swatchColor: '#c9ccd6' },
      { value: 'french_white', label: 'Classic french & white', swatchColor: '#f7f3ee' },
    ],
  },
  {
    key: 'style_tier', label: 'Style', source: 'user_question', position: 5,
    values: [
      { value: 'clean', label: 'Clean & Classic' },
      { value: 'extra', label: 'A little extra' },
      { value: 'statement', label: 'Statement' },
      { value: 'art', label: 'Full-on nail art' },
    ],
  },
];

// ---- Questions (handoff strings verbatim where given; prompts for Q1/Q4/Q5
// were not in the handoff — placeholders marked EDITABLE for the studio) ----
const questions = [
  {
    axisKey: 'vibe',
    prompt: "What's the vibe?", // EDITABLE: handoff names the question "Vibe/Occasion" without a prompt string
    position: 0,
    optionStyle: 'boxed', // sublabels render under the label in boxed cards
    options: [
      { label: 'Model off-duty', value: 'model_off_duty', displayMeta: { sublabel: 'barely-there nudes, quiet luxury' } },
      { label: 'Soft & sweet', value: 'soft_sweet', displayMeta: { sublabel: 'blush pinks, sweet nothings' } },
      { label: 'French girl forever', value: 'french_girl', displayMeta: { sublabel: 'the classics, reinvented' } },
      { label: 'Girls night out', value: 'girls_night_out', displayMeta: { sublabel: 'vampy & glossy' } },
      { label: 'Main character energy', value: 'main_character', displayMeta: { sublabel: 'chrome, gems, maximum sparkle' } },
      { label: 'Out of Office', value: 'vacation', displayMeta: { sublabel: 'tropical brights, sea-glass blues' } },
      { label: 'After hours', value: 'after_hours', displayMeta: { sublabel: 'dark, moody, a little dangerous' } },
      { label: 'Spooky season', value: 'spooky_season', displayMeta: { sublabel: 'a little witchy, a little glittery' } },
      // select_all: widget sends _any; the anchor axis value is ignored.
      { label: 'Surprise me', value: 'model_off_duty', selectAll: true, displayMeta: { sublabel: "I'm just here for a mani check" } },
    ],
  },
  {
    axisKey: 'length',
    prompt: 'How long do you like your nails?',
    position: 1,
    multiSelect: true,
    options: [
      { label: 'Super Short', value: 'super_short' },
      { label: 'Short', value: 'short' },
      { label: 'Medium', value: 'medium' },
      { label: 'Long', value: 'long' },
    ],
  },
  {
    axisKey: 'application',
    prompt: 'How long should they go on & how long should they stay?',
    position: 2,
    options: [
      {
        label: 'Press & go - No glue needed, up to 5 days',
        value: 'press_and_go',
        // Quick Press is manufactured extra-short only: the option is
        // impossible unless Super short is among the length picks.
        showIf: { axis_key: 'length', axis_value: 'super_short' },
      },
      { label: 'Glue-on classic - The full salon mani, up to 2 weeks', value: 'glue_on' },
      // Same branch as Glue-on (same catalog; tabs = accessory + copy).
      { label: 'Adhesive tabs - No glue, up to 3 days, gentlest on natural nails', value: 'glue_on' },
    ],
  },
  {
    axisKey: 'shape',
    prompt: 'Pick your shapes', // EDITABLE: no prompt string in the handoff
    position: 3,
    multiSelect: true,
    options: [
      { label: 'Almond', value: 'almond' },
      // Quick Press ships in oval/almond/round/square only — coffin and
      // squoval don't exist extra-short, so they show only on the
      // glue-on/tabs branch (application=glue_on).
      { label: 'Coffin', value: 'coffin', showIf: { axis_key: 'application', axis_value: 'glue_on' } },
      { label: 'Oval', value: 'oval' },
      { label: 'Round', value: 'round' },
      { label: 'Squoval', value: 'squoval', showIf: { axis_key: 'application', axis_value: 'glue_on' } },
      { label: 'Square', value: 'square' },
      { label: 'Open to anything', value: 'almond', selectAll: true },
    ],
  },
  {
    axisKey: 'color_family',
    prompt: 'Which colors are you drawn to?', // EDITABLE: no prompt string in the handoff
    position: 4,
    multiSelect: true,
    options: [
      { label: 'Nudes & neutrals', value: 'nudes_neutrals' },
      { label: 'Pinks & pastels', value: 'pinks_pastels' },
      { label: 'Reds & berries', value: 'reds_berries' },
      { label: 'Bold & bright', value: 'bold_bright' },
      { label: 'Dark & moody', value: 'dark_moody' },
      { label: 'Metallics & shimmer', value: 'metallics_shimmer' },
      { label: 'Classic french & white', value: 'french_white' },
      { label: '🎨 Surprise me', value: 'nudes_neutrals', selectAll: true },
    ],
  },
  {
    axisKey: 'style_tier',
    prompt: "Last one — what's your style?",
    position: 5,
    multiSelect: true,
    maxSelections: 2,
    options: [
      { label: 'Clean & Classic: Solids, french tips, glazed', value: 'clean' },
      { label: 'A little extra: Pearls, ombre, subtle art', value: 'extra' },
      { label: 'Statement: Chrome, glitter, cat eye', value: 'statement' },
      { label: 'Full-on nail art: 3D gems, patterns, abstract', value: 'art' },
    ],
  },
];

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

  // Pool → selected_product_ids, verified against live product rows.
  const { pool } = JSON.parse(fs.readFileSync(POOL_PATH, 'utf8'));
  // Paginate: supabase caps every request at 1000 rows regardless of limit().
  const liveIds = new Set();
  for (let page = 0; ; page++) {
    const { data: prods, error: prodErr } = await sb.from('products').select('id')
      .eq('shop_id', shopId).order('id').range(page * 1000, page * 1000 + 999);
    if (prodErr) throw new Error('products fetch failed: ' + prodErr.message);
    prods.forEach((p) => liveIds.add(p.id));
    if (prods.length < 1000) break;
  }
  const poolIds = pool.map((p) => p.id).filter((id) => liveIds.has(id));
  if (poolIds.length !== pool.length) {
    throw new Error(`pool drift: ${pool.length - poolIds.length} pool products missing from live rows — re-run glamnetic-pool.cjs --rebuild`);
  }
  // Boost (not pin): current bestsellers, in pool order.
  const heroIds = pool.filter((p) => p.bestseller).slice(0, 10).map((p) => p.id);
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
      optionStyle: q.optionStyle || null,
      options: q.options.map((o, i) => ({
        label: o.label,
        axisValueValue: o.value,
        botResponse: null,
        reasonText: null,
        imageUrl: null,
        showIf: o.showIf || null,
        selectAll: !!o.selectAll,
        displayMeta: o.displayMeta || null,
        position: i,
      })),
    })),
    rules: [], // mode 'ai': the LLM ranks; no matrix
  };

  console.log(
    `shop ${shopId}: axes ${payload.axes.length}, questions ${payload.questions.length}, ` +
    `pool ${poolIds.length}, heroes ${heroIds.length}, guidance ${AI_GUIDANCE.length} chars`,
  );
  if (dryRun) { console.log('dry run — nothing saved.'); return; }

  // Back up + remove the stale studio draft BEFORE the config write: the
  // blank scratch draft would otherwise mask this backfill in the studio
  // (drafts with edits never auto-refresh from live).
  const { data: draftRows } = await sb.from('quiz_config_versions')
    .select('id, status, created_by, config, created_at, updated_at')
    .eq('shop_id', shopId).eq('status', 'draft');
  if (draftRows && draftRows.length > 0) {
    const backupPath = path.join(__dirname, 'backups', `glamnetic-draft-backup-${new Date().toISOString().slice(0, 10)}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(draftRows, null, 1));
    const { error: delErr, count } = await sb.from('quiz_config_versions')
      .delete({ count: 'exact' }).eq('shop_id', shopId).eq('status', 'draft');
    if (delErr) throw new Error('draft delete failed: ' + delErr.message);
    console.log(`backed up ${draftRows.length} draft row(s) to ${backupPath}; deleted ${count}`);
  }

  const { error } = await sb.rpc('save_recommendation_config', { p_shop_id: shopId, p_payload: payload });
  if (error) throw new Error('RPC failed: ' + error.message);

  // No chat_assistant_config row exists for this shop yet — upsert. Only
  // quiz/rec fields are set; styling stays at column defaults for the
  // studio/admin to own. enabled=false until Mia's team flips it on.
  const { data: upserted, error: cfgErr } = await sb.from('chat_assistant_config').upsert({
    shop_domain: SHOP_DOMAIN,
    enabled: false,
    assistant_mode: 'quiz',
    recommendation_mode: 'ai',
    num_recommendations: 5, // 3 primary + 2 "also matched" flexes (§5)
    product_scope: 'selected',
    selected_product_ids: poolIds,
    ai_guidance: AI_GUIDANCE,
    priority_product_ids: heroIds,
    recommendation_tuning: { rankerModel: 'flash', priorityStyle: 'boost', priorityBoostSlots: 2 },
    quiz_availability_filter: true, // §1: never recommend out-of-stock
    updated_at: new Date().toISOString(),
  }, { onConflict: 'shop_domain' }).select('shop_domain');
  if (cfgErr) throw new Error('chat_assistant_config upsert failed: ' + cfgErr.message);
  if (!upserted || upserted.length === 0) throw new Error('chat_assistant_config upsert matched 0 rows');

  console.log('SAVED. Verifying…');
  const ax = await sb.from('recommendation_axes').select('key, source, recommendation_axis_values(value)').eq('shop_id', shopId).order('position');
  for (const a of ax.data || []) console.log(`  axis ${a.key} (${a.source}): ${a.recommendation_axis_values.length} values`);
  const axisIds = (await sb.from('recommendation_axes').select('id').eq('shop_id', shopId)).data.map((r) => r.id);
  const qs = await sb.from('recommendation_questions')
    .select('prompt, multi_select, max_selections, show_if, recommendation_question_options(label, select_all, show_if)')
    .in('axis_id', axisIds).order('position');
  for (const q of qs.data || []) {
    const gated = q.recommendation_question_options.filter((o) => o.show_if);
    console.log(`  Q: "${q.prompt}" multi=${q.multi_select} max=${q.max_selections ?? '-'} options=${q.recommendation_question_options.length} selectAll=${q.recommendation_question_options.filter((o) => o.select_all).length} gated=${gated.map((o) => o.label.split(' ')[0]).join(',') || '-'}`);
  }
  const rules = await sb.from('recommendation_rules').select('id', { count: 'exact', head: true }).eq('shop_id', shopId);
  console.log(`  rules: ${rules.count}`);
  const cfg = await sb.from('chat_assistant_config')
    .select('enabled, assistant_mode, recommendation_mode, num_recommendations, product_scope, quiz_availability_filter, recommendation_tuning')
    .eq('shop_domain', SHOP_DOMAIN).single();
  console.log('  config:', JSON.stringify(cfg.data));
  const cfg2 = await sb.from('chat_assistant_config').select('selected_product_ids, priority_product_ids, ai_guidance').eq('shop_domain', SHOP_DOMAIN).single();
  console.log(`  pool saved: ${cfg2.data.selected_product_ids.length}; heroes: ${cfg2.data.priority_product_ids.length}; guidance: ${cfg2.data.ai_guidance.length} chars`);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
