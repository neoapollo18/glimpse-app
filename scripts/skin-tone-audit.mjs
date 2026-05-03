/**
 * Offline tone-fairness audit for the AI skin-analysis feature.
 *
 * Goal: detect systematic bias in the AI's scoring across skin tones, BEFORE
 * a real customer ever runs into it. Runs entirely offline against a corpus
 * you curate. Stores nothing in the production DB.
 *
 * Usage:
 *   node scripts/skin-tone-audit.mjs ./audit-corpus
 *
 * Expected directory layout — one folder per tone group, any image format
 * the API accepts (jpg, png, heic):
 *   audit-corpus/
 *     fair/
 *       photo1.jpg
 *       photo2.jpg
 *     medium/
 *       photo3.jpg
 *     dark/
 *       photo4.jpg
 *
 * Tone group folder names are arbitrary — the script just groups results by
 * folder. Suggested groupings: monk-1-2 / monk-3-4 / monk-5-6 / monk-7-8 / monk-9-10
 * (Monk Skin Tone Scale) or fair / medium / olive / brown / dark.
 *
 * Output: a CSV at <corpus>/audit-results.csv plus a summary table to stdout
 * showing per-tone-group score distributions and flags any concerns where
 * a group's mean deviates >1 stddev from the overall mean.
 *
 * Requires OPENAI_API_KEY in the environment (or in .env at the repo root).
 *
 * Curating the corpus: aim for 10+ photos per tone group. Use diverse,
 * permissively-licensed sources (UTKFace, FairFace, your own consenting
 * volunteers). Photos should be roughly comparable in lighting and pose so
 * we're measuring the model's tone-conditioned bias, not artifact
 * differences.
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';

// ---------------------------------------------------------------------------
// Tiny .env loader — same pattern as scripts/diagnose-overlap.mjs.
// ---------------------------------------------------------------------------
try {
  const raw = readFileSync('.env', 'utf8');
  for (const line of raw.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {
  // .env optional — env vars may already be set
}

const corpusDir = process.argv[2];
if (!corpusDir) {
  console.error('Usage: node scripts/skin-tone-audit.mjs <corpus-directory>');
  process.exit(1);
}

if (!process.env.OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY not set. Add it to .env or export it.');
  process.exit(1);
}

// We import the production analyzer so the audit measures the EXACT prompt
// + model + schema customers will hit. If you change the prompt and don't
// re-run this audit, you're flying blind on fairness.
const { analyzeSkin, SCORE_KEYS } = await import('../app/lib/skin-analysis.server.ts').catch(async () => {
  // Fallback for environments without ts loader: use the compiled JS.
  // If that doesn't exist either, surface a clear error.
  return await import('../app/lib/skin-analysis.server.js');
});

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'];

function listImages(dir) {
  return readdirSync(dir)
    .filter((f) => IMAGE_EXTS.some((e) => f.toLowerCase().endsWith(e)))
    .map((f) => join(dir, f));
}

function listToneGroups(root) {
  return readdirSync(root)
    .map((name) => ({ name, path: join(root, name) }))
    .filter((entry) => {
      try { return statSync(entry.path).isDirectory(); } catch { return false; }
    });
}

function mimeFromExt(p) {
  const lower = p.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.heic') || lower.endsWith('.heif')) return 'image/heic';
  return 'image/jpeg';
}

function mean(xs) {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function stddev(xs) {
  if (xs.length === 0) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

const groups = listToneGroups(corpusDir);
if (groups.length === 0) {
  console.error(`No subdirectories found in ${corpusDir}. See header comment for layout.`);
  process.exit(1);
}

console.log(`\nTone groups: ${groups.map((g) => g.name).join(', ')}`);
console.log(`Model: production analyzeSkin() — same prompt and model as live\n`);

const allRows = []; // { group, file, ...scores, skin_type, rejected, reason }

for (const group of groups) {
  const files = listImages(group.path);
  console.log(`  [${group.name}] ${files.length} image(s)`);
  for (const file of files) {
    const buf = readFileSync(file);
    const b64 = buf.toString('base64');
    const mime = mimeFromExt(file);
    process.stdout.write(`    ${basename(file).padEnd(40)} `);
    try {
      const result = await analyzeSkin({ inputImage: b64, mimeType: mime });
      if (!result.success || !result.result) {
        console.log(`× ${result.error ?? 'unknown error'}`);
        allRows.push({ group: group.name, file: basename(file), rejected: true, reason: 'analyze_failed' });
        continue;
      }
      const r = result.result;
      if (r.rejected) {
        console.log(`× rejected (${r.reason})`);
        allRows.push({ group: group.name, file: basename(file), rejected: true, reason: r.reason ?? '' });
        continue;
      }
      const row = { group: group.name, file: basename(file), rejected: false, skin_type: r.skin_type ?? '' };
      for (const key of SCORE_KEYS) row[key] = r.scores?.[key] ?? null;
      allRows.push(row);
      console.log(`✓ ${result.latencyMs}ms`);
    } catch (err) {
      console.log(`× ${err.message ?? err}`);
      allRows.push({ group: group.name, file: basename(file), rejected: true, reason: 'threw' });
    }
  }
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------
const csvHeader = ['group', 'file', 'rejected', 'reason', 'skin_type', ...SCORE_KEYS].join(',');
const csvLines = [csvHeader];
for (const row of allRows) {
  csvLines.push([
    row.group,
    row.file,
    row.rejected ? '1' : '0',
    row.reason ?? '',
    row.skin_type ?? '',
    ...SCORE_KEYS.map((k) => (row[k] === null || row[k] === undefined ? '' : String(row[k]))),
  ].map((v) => /[,"\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v)).join(','));
}
const csvPath = join(corpusDir, 'audit-results.csv');
writeFileSync(csvPath, csvLines.join('\n'), 'utf8');
console.log(`\nWrote ${csvPath}`);

// ---------------------------------------------------------------------------
// Summary table + flagging
// ---------------------------------------------------------------------------
const accepted = allRows.filter((r) => !r.rejected);
console.log(`\nAccepted: ${accepted.length} / ${allRows.length}`);

const overallByMetric = {};
for (const k of SCORE_KEYS) {
  overallByMetric[k] = { mean: mean(accepted.map((r) => r[k]).filter((v) => v !== null)), stddev: stddev(accepted.map((r) => r[k]).filter((v) => v !== null)) };
}

console.log('\nPer-tone-group means (HIGH = more visible concern):');
const header = '  ' + 'group'.padEnd(14) + 'n'.padEnd(4) + SCORE_KEYS.map((k) => k.padEnd(13)).join('');
console.log(header);
console.log('  ' + '─'.repeat(header.length - 2));
const flags = []; // { group, metric, delta, ratio }
for (const group of groups) {
  const groupRows = accepted.filter((r) => r.group === group.name);
  const cells = SCORE_KEYS.map((k) => {
    const vals = groupRows.map((r) => r[k]).filter((v) => v !== null && v !== undefined);
    if (vals.length === 0) return ''.padEnd(13);
    const m = mean(vals);
    const overall = overallByMetric[k];
    const ratio = overall.stddev > 0 ? Math.abs(m - overall.mean) / overall.stddev : 0;
    if (ratio >= 1) flags.push({ group: group.name, metric: k, mean: m, overall: overall.mean, ratio });
    const flag = ratio >= 1 ? '*' : ' ';
    return (m.toFixed(1) + flag).padEnd(13);
  });
  console.log('  ' + group.name.padEnd(14) + String(groupRows.length).padEnd(4) + cells.join(''));
}

console.log('\n* = mean for this tone group is >=1 stddev from the overall mean.');
if (flags.length === 0) {
  console.log('\nVERDICT: no metric flagged — scoring looks consistent across tone groups.');
} else {
  console.log(`\nVERDICT: ${flags.length} metric(s) flagged. Review:`);
  for (const f of flags) {
    const direction = f.mean > f.overall ? 'higher' : 'lower';
    console.log(`  - ${f.group} scores ${direction} on ${f.metric} (mean ${f.mean.toFixed(1)} vs overall ${f.overall.toFixed(1)}, ${f.ratio.toFixed(2)} stddev away)`);
  }
  console.log('\nDoes the difference reflect a real skin-condition disparity in your corpus, or model bias? Look at sample images in each group to decide.');
}
