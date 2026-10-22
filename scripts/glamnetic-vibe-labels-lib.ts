// Glamnetic vibe labels (fix spec v4, item 3): the pure half of
// scripts/glamnetic-vibe-labels.mts, kept apart from the CLI so the test
// suite can run it (app/lib/__tests__/glamnetic-vibe-labels.test.ts).
//
// Products carry no vibe data, so the quiz guessed vibes from color and
// collection tags. The AI pass proposes labels from each set's photo,
// title and tags into a sheet; Lisa approves rows; --apply-sheet merges
// only the approved rows into recommendation_tuning.columnar.vibeLabels.
// French Girl Chic is not labeled: it follows the French tip / ombre tags
// (her own rule), whatever a sheet says.

import { LABELED_VIBE_IDS, DEFAULT_ANSWER_LABELS, HANDLE_RE, sanitizeColumnarSpec, type VibeId } from "../app/lib/columnar/spec";

export const SHOP_DOMAIN = "glamrco.myshopify.com";
export const SHOP_ID = "8121d154-2019-490f-9343-7bddbc1a64be";

/** What each labeled vibe means, for the model and for Lisa's sheet. */
export const VIBE_DEFS: Record<string, string> = {
  clean_girl:
    "understated and polished: sheer, milky, nude, beige or soft white sets, solid or barely-there detail, no bold art, no 3D",
  soft_sweet:
    "romantic and girly: soft pinks, lilacs, pastels or soft white, delicate details like bows, hearts, tiny florals, pearls, glazed or glossy",
  main_character:
    "bold, glam and attention-grabbing: chrome, glitter, gems, 3D charms, saturated or metallic statement sets",
  vacay:
    "bright, sunny, beachy: vivid oranges, yellows, corals, turquoise, tropical greens, fruit, flowers, waves, summer prints",
  alt_edgy:
    "dark, moody or rebellious: black, charcoal, deep plum or oxblood, grunge, goth, punk, flames, spikes, skulls, smoky cat eye",
  holiday:
    "festive winter holidays: red and green, gold or silver sparkle, snowflakes, candy canes, ornaments, plaid, winter white",
};

export const SHEET_HEADER = [
  "handle",
  "title",
  "image_url",
  "proposed_vibes",
  "confidence",
  "current_rule_vibes",
  "approved",
  "final_vibes",
  "ai_notes",
] as const;

/** Lisa's sheet instructions, printed by the dry run. */
export const SHEET_HELP = [
  "For each row: put yes in `approved` to accept it. To change the vibes, write them in `final_vibes` (and approve).",
  "`final_vibes` (or `proposed_vibes` when final is blank) takes names or IDs separated by |, e.g. Soft & Sweet | Holiday-Ready, or none.",
  "Rows not approved are left alone: those sets keep today's tag rules. French Girl Chic always follows the French tip / ombre tags.",
  `Vibes: ${LABELED_VIBE_IDS.map((id) => `${DEFAULT_ANSWER_LABELS[id]} (${id})`).join(", ")}.`,
];

// ---------------------------------------------------------------------
// CSV (RFC 4180: quotes, doubled quotes, newlines inside quotes)
// ---------------------------------------------------------------------

export function toCsv(rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>): string {
  const cell = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(",")).join("\n") + "\n";
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

// ---------------------------------------------------------------------
// Vibe names
// ---------------------------------------------------------------------

const norm = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
const VIBE_BY_NAME = new Map<string, VibeId>();
for (const id of LABELED_VIBE_IDS) {
  VIBE_BY_NAME.set(norm(id), id);
  VIBE_BY_NAME.set(norm(DEFAULT_ANSWER_LABELS[id]), id);
}
// Glamnetic's tile words and the obvious short forms.
for (const [name, id] of [
  ["clean girl", "clean_girl"],
  ["minimalist", "clean_girl"],
  ["soft and sweet", "soft_sweet"],
  ["main character", "main_character"],
  ["vacay", "vacay"],
  ["vacation", "vacay"],
  ["alt", "alt_edgy"],
  ["alternative", "alt_edgy"],
  ["edgy", "alt_edgy"],
  ["holiday", "holiday"],
  ["holiday ready", "holiday"],
] as const) {
  VIBE_BY_NAME.set(name, id);
}

export const vibeName = (id: string) => DEFAULT_ANSWER_LABELS[id] ?? id;

/** "Soft & Sweet | holiday" -> ["soft_sweet", "holiday"]; "none" -> [];
 * blank -> null (nothing written). Unknown names come back in `unknown`. */
export function parseVibeList(text: string): { ids: VibeId[] | null; unknown: string[] } {
  const t = (text ?? "").trim();
  if (!t) return { ids: null, unknown: [] };
  if (/^(none|no vibe|-)$/i.test(t)) return { ids: [], unknown: [] };
  const unknown: string[] = [];
  const found = new Set<VibeId>();
  for (const part of t.split(/[|;,\n]/)) {
    const k = norm(part);
    if (!k) continue;
    // French Girl Chic follows the tags; naming it is harmless, not a label.
    if (k === "french girl chic" || k === "french girl") continue;
    const id = VIBE_BY_NAME.get(k);
    if (id) found.add(id);
    else unknown.push(part.trim());
  }
  return { ids: LABELED_VIBE_IDS.filter((v) => found.has(v)), unknown };
}

export const formatVibes = (ids: readonly string[]): string =>
  ids.length ? ids.map(vibeName).join(" | ") : "none";

export function isApproved(cell: string | undefined): boolean {
  return /^(y|yes|true|x|ok|approve|approved|1|\u2713|\u2714)$/i.test((cell ?? "").trim());
}

// ---------------------------------------------------------------------
// The AI pass
// ---------------------------------------------------------------------

// The tags that say something about a set's look.
const LOOK_TAG = /^(Color_|Nail Style_|_Design Archetype_|_Nail Collection_|Finish_|Opacity_|_Is |_Has )/i;

export function buildPrompt(p: { title: string; tags: string[] }): { system: string; user: string } {
  const vibes = LABELED_VIBE_IDS.map((id) => `- ${id} (${vibeName(id)}): ${VIBE_DEFS[id]}`).join("\n");
  const system =
    "You label press-on nail sets for a style quiz. Look at the product photo first; use the title and tags only to confirm. " +
    "Pick every vibe a shopper who chose it would be happy to see this set for, and none that would surprise them. " +
    "Most sets fit one or two vibes; some fit none. Give each vibe you pick a confidence from 0 to 1, " +
    "an overall confidence for the whole answer, and a note of at most 20 words on what you saw.\n" +
    `Vibes:\n${vibes}`;
  const tags = p.tags.filter((t) => LOOK_TAG.test(t) && !/_FALSE$/i.test(t)).slice(0, 60);
  const user = `Title: ${p.title}\nTags: ${tags.join(", ") || "(none)"}`;
  return { system, user };
}

export const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    vibes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", enum: [...LABELED_VIBE_IDS] },
          confidence: { type: "number" },
        },
        required: ["id", "confidence"],
      },
    },
    confidence: { type: "number" },
    note: { type: "string" },
  },
  required: ["vibes", "confidence", "note"],
} as const;

export interface AiLabel {
  vibes: Array<{ id: VibeId; confidence: number }>;
  confidence: number;
  note: string;
}

const clamp01 = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);

export function parseAiResponse(raw: string): AiLabel | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, ""));
  } catch {
    return null;
  }
  const o = parsed as { vibes?: unknown; confidence?: unknown; note?: unknown } | null;
  if (!o || !Array.isArray(o.vibes)) return null;
  const vibes: AiLabel["vibes"] = [];
  for (const v of o.vibes as Array<{ id?: unknown; confidence?: unknown }>) {
    const id = typeof v?.id === "string" ? (v.id as VibeId) : null;
    if (!id || !LABELED_VIBE_IDS.includes(id) || vibes.some((x) => x.id === id)) continue;
    vibes.push({ id, confidence: clamp01(v.confidence) });
  }
  return {
    vibes: LABELED_VIBE_IDS.flatMap((id) => vibes.filter((v) => v.id === id)),
    confidence: clamp01(o.confidence),
    note: typeof o.note === "string" ? o.note.replace(/\s+/g, " ").trim().slice(0, 200) : "",
  };
}

/** Vibes the model is at least this sure of go in proposed_vibes; the
 * rest are listed in ai_notes for Lisa. */
export const PROPOSE_AT = 0.5;

export function sheetRow(
  p: { handle: string; title: string; imageUrl: string | null },
  ruleVibes: readonly string[],
  ai: AiLabel | null,
  error?: string,
): string[] {
  const proposed = ai ? ai.vibes.filter((v) => v.confidence >= PROPOSE_AT).map((v) => v.id) : [];
  const scores = ai ? ai.vibes.map((v) => `${v.id} ${v.confidence.toFixed(2)}`).join(", ") : "";
  return [
    p.handle,
    p.title,
    p.imageUrl ?? "",
    ai ? formatVibes(proposed) : "",
    ai ? ai.confidence.toFixed(2) : "",
    formatVibes(ruleVibes.filter((v) => v !== "french_girl")),
    "",
    "",
    error ? `error: ${error}` : [ai?.note, scores && `scores: ${scores}`].filter(Boolean).join(" / "),
  ];
}

// ---------------------------------------------------------------------
// --apply-sheet
// ---------------------------------------------------------------------

export interface ApplyPlan {
  /** The full map to write: stored labels with the approved rows merged in. */
  next: Record<string, VibeId[]>;
  changes: Array<{ handle: string; from: VibeId[] | null; to: VibeId[] }>;
  approved: number;
  unchanged: number;
  notApproved: number;
  errors: string[];
}

/** Approved rows of Lisa's sheet merged over the stored labels. Any bad
 * row (unknown handle or vibe, approved with nothing to apply) fails the
 * whole sheet: a typo must never drop a set silently. */
export function planApply(
  sheet: string,
  stored: Readonly<Record<string, readonly string[]>>,
  poolHandles: readonly string[],
): ApplyPlan {
  const rows = parseCsv(sheet);
  const errors: string[] = [];
  const header = (rows.shift() ?? []).map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  for (const need of ["handle", "approved", "proposed_vibes", "final_vibes"]) {
    if (col(need) === -1) errors.push(`the sheet has no "${need}" column`);
  }
  const next: Record<string, VibeId[]> = {};
  for (const [h, ids] of Object.entries(stored)) next[h] = LABELED_VIBE_IDS.filter((v) => ids.includes(v));
  const plan: ApplyPlan = { next, changes: [], approved: 0, unchanged: 0, notApproved: 0, errors };
  if (errors.length) return plan;
  const pool = new Set(poolHandles);
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    const line = i + 2;
    const handle = (r[col("handle")] ?? "").trim();
    if (!isApproved(r[col("approved")])) {
      plan.notApproved++;
      return;
    }
    if (!HANDLE_RE.test(handle) || !pool.has(handle)) return void errors.push(`line ${line}: "${handle}" is not in the quiz pool`);
    if (seen.has(handle)) return void errors.push(`line ${line}: ${handle} is approved twice`);
    seen.add(handle);
    const finalCell = r[col("final_vibes")] ?? "";
    const parsed = parseVibeList(finalCell.trim() ? finalCell : r[col("proposed_vibes")] ?? "");
    if (parsed.unknown.length) return void errors.push(`line ${line}: unknown vibe ${parsed.unknown.map((u) => `"${u}"`).join(", ")}`);
    if (parsed.ids === null) return void errors.push(`line ${line}: approved with no vibes (write none for a set that fits none)`);
    plan.approved++;
    const from = Object.prototype.hasOwnProperty.call(stored, handle) ? LABELED_VIBE_IDS.filter((v) => stored[handle].includes(v)) : null;
    if (from && from.join() === parsed.ids.join()) {
      plan.unchanged++;
      return;
    }
    next[handle] = parsed.ids;
    plan.changes.push({ handle, from, to: parsed.ids });
  });
  return plan;
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/** The tuning to write back: the stored blob with ONLY
 * columnar.vibeLabels replaced. Throws when there is no columnar spec, or
 * when the engine's own sanitizer would not keep these labels. */
export function withVibeLabels(tuning: unknown, labels: Record<string, VibeId[]>): Json {
  if (!isObj(tuning) || !isObj(tuning.columnar)) throw new Error("recommendation_tuning has no columnar spec");
  const next = { ...tuning, columnar: { ...tuning.columnar, vibeLabels: labels } };
  const kept = sanitizeColumnarSpec(next.columnar)?.vibeLabels;
  if (JSON.stringify(kept) !== JSON.stringify(labels)) throw new Error("the engine's sanitizer would drop some of these labels");
  return next;
}

/** After the write: everything but columnar.vibeLabels must read back as
 * it was, and the labels as written. Returns what differs. */
export function writeDrift(before: unknown, after: unknown, labels: Record<string, VibeId[]>): string | null {
  if (!isObj(before) || !isObj(after) || !isObj(before.columnar) || !isObj(after.columnar)) return "tuning missing";
  const strip = (t: Json) => ({ ...t, columnar: { ...(t.columnar as Json), vibeLabels: null } });
  const canon = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(canon) : isObj(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v;
  if (JSON.stringify(canon(strip(before))) !== JSON.stringify(canon(strip(after)))) return "a key other than columnar.vibeLabels changed";
  if (JSON.stringify(canon(after.columnar.vibeLabels)) !== JSON.stringify(canon(labels))) return "the labels did not land as written";
  return null;
}
