// Columnar recommendation spec (Glamnetic recommendation logic v3).
//
// Per-shop config at chat_assistant_config.recommendation_tuning.columnar.
// Absent or enabled:false = the shop's quiz behaves exactly as before. The
// spec maps the shop's quiz axes (DB keys/values, unchanged) onto stable
// answer IDs the matching layer keys on, so labels can change freely.
//
// Pure (no server imports): the tuning mapper in supabase.server, the
// Studio card and the unit tests all share this one sanitizer, so the read
// and write sides can't drift.

export const COLUMNAR_ROLES = ["vibe", "length", "shape", "color", "finish", "drama"] as const;
export type ColumnarRole = (typeof COLUMNAR_ROLES)[number];

// Answer vocabularies. Append-only: resultKey encodes positions in these
// lists, so reordering would silently change what an old permalink means.
export const VIBE_IDS = [
  "clean_girl",
  "soft_sweet",
  "french_girl",
  "main_character",
  "vacay",
  "alt_edgy",
  "holiday",
] as const;
export const LENGTH_IDS = ["super_short", "short", "medium", "long"] as const;
// super_short is a shape too: Glamnetic tags super short sets
// "Nail Shape_Super Short" (they have no other shape).
export const SHAPE_IDS = ["almond", "coffin", "oval", "round", "squoval", "square", "super_short"] as const;
export const COLOR_IDS = [
  "nudes",
  "pinks_purples",
  "reds_berries",
  "bold_bright",
  "dark_moody",
  "metallics",
  "oranges_yellows",
  "white",
] as const;
export const FINISH_IDS = ["glossy", "glazed_pearl", "velvet_cateye", "chrome", "matte"] as const;
export const DRAMA_IDS = ["clean_classic", "little_extra", "statement", "full_art"] as const;

export type VibeId = (typeof VIBE_IDS)[number];

export const ROLE_VOCAB: Record<ColumnarRole, readonly string[]> = {
  vibe: VIBE_IDS,
  length: LENGTH_IDS,
  shape: SHAPE_IDS,
  color: COLOR_IDS,
  finish: FINISH_IDS,
  drama: DRAMA_IDS,
};

/** Shopper-facing words for each answer ID, used when the quiz's own option
 * label isn't available (meta lines, templated why-lines, headers). */
export const DEFAULT_ANSWER_LABELS: Record<string, string> = {
  clean_girl: "Clean Girl & Minimalist",
  soft_sweet: "Soft & Sweet",
  french_girl: "French Girl Chic",
  main_character: "Main Character Energy",
  vacay: "Vacay Mode",
  alt_edgy: "Alternative & Edgy",
  holiday: "Holiday-Ready",
  super_short: "Super Short",
  short: "Short",
  medium: "Medium",
  long: "Long",
  almond: "Almond",
  coffin: "Coffin",
  oval: "Oval",
  round: "Round",
  squoval: "Squoval",
  square: "Square",
  nudes: "Nudes & neutrals",
  pinks_purples: "Pinks & purples",
  reds_berries: "Reds & berries",
  bold_bright: "Bold & bright",
  dark_moody: "Dark & moody",
  metallics: "Metallics",
  oranges_yellows: "Oranges & yellows",
  white: "White",
  glossy: "Glossy",
  glazed_pearl: "Glazed & pearl",
  velvet_cateye: "Velvet & cat eye",
  chrome: "Chrome",
  matte: "Matte",
  clean_classic: "Clean & classic",
  little_extra: "A little extra",
  statement: "Statement",
  full_art: "Full-on nail art",
};

export interface ColumnarAxis {
  role: ColumnarRole;
  /** quiz axisValue -> answer ID */
  values: Record<string, string>;
}

export interface ColumnarSpec {
  enabled: boolean;
  version: 1;
  pool: {
    collectionHandle: string | null;
    handles: string[];
    syncedAt: string | null;
    source: "collection" | "csv";
  };
  /** Branching availability threshold (brief section 6). */
  threshold: number;
  /** Step C top-K sent to the ranker. */
  candidateCount: number;
  resultCount: number;
  alsoMatchedCount: number;
  weights: { color: number; drama: number; vibe: number };
  axes: Record<string, ColumnarAxis>;
  /** Studio toggle to retire a vibe tile without a code change. */
  vibes: Record<string, { enabled: boolean }>;
  /** Substrings matched against _Nail Collection_ names for Holiday-Ready. */
  holidayCollections: string[];
  llm: { enabled: boolean; timeoutMs: number };
}

export const COLUMNAR_DEFAULTS = {
  threshold: 6,
  candidateCount: 40,
  resultCount: 6,
  alsoMatchedCount: 6,
  weights: { color: 0.4, drama: 0.35, vibe: 0.25 },
  holidayCollections: ["Holiday", "Snow", "Sleigh", "Winter", "Polar"],
  llm: { enabled: true, timeoutMs: 4000 },
} as const;

// Pool handles can number in the thousands for a big collection; the cap
// only stops a malformed blob from ballooning every config read.
const MAX_POOL_HANDLES = 5000;
export const HANDLE_RE = /^[a-z0-9][a-z0-9_-]{0,254}$/i;
const ID_RE = /^[a-z_][a-z0-9_]{0,63}$/;
// Plain-object records: these keys pass ID_RE but would hit the prototype.
const PROTO_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const isObj = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === "object" && !Array.isArray(v);
const clampInt = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof v === "number" ? Math.round(v) : NaN;
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};
const clampNum = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback;
const safeKey = (k: string) => ID_RE.test(k) && !PROTO_KEYS.has(k);

function sanitizeAxes(raw: unknown): Record<string, ColumnarAxis> {
  const out: Record<string, ColumnarAxis> = {};
  if (!isObj(raw)) return out;
  for (const [axisKey, axis] of Object.entries(raw).slice(0, 16)) {
    if (!safeKey(axisKey) || !isObj(axis)) continue;
    const role = axis.role as ColumnarRole;
    if (!(COLUMNAR_ROLES as readonly string[]).includes(role)) continue;
    const vocab = ROLE_VOCAB[role];
    const values: Record<string, string> = {};
    if (isObj(axis.values)) {
      for (const [axisValue, answerId] of Object.entries(axis.values).slice(0, 48)) {
        if (!safeKey(axisValue) || typeof answerId !== "string" || !vocab.includes(answerId)) continue;
        values[axisValue] = answerId;
      }
    }
    out[axisKey] = { role, values };
  }
  return out;
}

/**
 * The stored spec, cleaned key by key; undefined when there is none (the
 * caller then keeps today's behavior). Idempotent, so writing a sanitized
 * spec back never changes it.
 */
export function sanitizeColumnarSpec(raw: unknown): ColumnarSpec | undefined {
  if (!isObj(raw)) return undefined;
  const d = COLUMNAR_DEFAULTS;
  const pool = isObj(raw.pool) ? raw.pool : {};
  const weights = isObj(raw.weights) ? raw.weights : {};
  const llm = isObj(raw.llm) ? raw.llm : {};
  const handles: string[] = [];
  const seen = new Set<string>();
  for (const h of Array.isArray(pool.handles) ? pool.handles : []) {
    if (typeof h !== "string" || !HANDLE_RE.test(h) || seen.has(h)) continue;
    seen.add(h);
    handles.push(h);
    if (handles.length >= MAX_POOL_HANDLES) break;
  }
  const syncedAt =
    typeof pool.syncedAt === "string" && !Number.isNaN(Date.parse(pool.syncedAt)) ? pool.syncedAt : null;
  const vibes: Record<string, { enabled: boolean }> = {};
  if (isObj(raw.vibes)) {
    for (const id of VIBE_IDS) {
      const v = raw.vibes[id];
      if (isObj(v) && typeof v.enabled === "boolean") vibes[id] = { enabled: v.enabled };
    }
  }
  return {
    enabled: raw.enabled === true,
    version: 1,
    pool: {
      collectionHandle:
        typeof pool.collectionHandle === "string" && HANDLE_RE.test(pool.collectionHandle)
          ? pool.collectionHandle
          : null,
      handles,
      syncedAt,
      source: pool.source === "csv" ? "csv" : "collection",
    },
    threshold: clampInt(raw.threshold, 1, 50, d.threshold),
    candidateCount: clampInt(raw.candidateCount, 6, 100, d.candidateCount),
    resultCount: clampInt(raw.resultCount, 1, 12, d.resultCount),
    alsoMatchedCount: clampInt(raw.alsoMatchedCount, 0, 12, d.alsoMatchedCount),
    weights: {
      color: clampNum(weights.color, 0, 1, d.weights.color),
      drama: clampNum(weights.drama, 0, 1, d.weights.drama),
      vibe: clampNum(weights.vibe, 0, 1, d.weights.vibe),
    },
    axes: sanitizeAxes(raw.axes),
    vibes,
    holidayCollections: Array.isArray(raw.holidayCollections)
      ? raw.holidayCollections
          .filter((s): s is string => typeof s === "string")
          .map((s) => s.trim())
          .filter((s) => s.length > 0 && s.length <= 60)
          .slice(0, 20)
      : [...d.holidayCollections],
    llm: {
      enabled: llm.enabled !== false,
      timeoutMs: clampInt(llm.timeoutMs, 500, 15_000, d.llm.timeoutMs),
    },
  };
}

/** A vibe tile is live unless the merchant retired it in Studio. */
export const vibeEnabled = (spec: Pick<ColumnarSpec, "vibes">, id: string): boolean =>
  spec.vibes[id]?.enabled !== false;

/** The first axis mapped to a role (one per role in practice). */
export function axisForRole(spec: Pick<ColumnarSpec, "axes">, role: ColumnarRole): string | null {
  for (const [key, axis] of Object.entries(spec.axes)) if (axis.role === role) return key;
  return null;
}

export interface ColumnarSettingsPatch {
  enabled?: boolean;
  threshold?: number;
  vibes?: Record<string, boolean>;
}

/** The Studio card's save: only the merchant-editable knobs, each
 * validated; keys not sent stay as stored. */
export function validateColumnarPatch(
  raw: unknown,
): { ok: true; patch: ColumnarSettingsPatch } | { ok: false; error: string } {
  if (!isObj(raw)) return { ok: false, error: "Malformed settings" };
  const patch: ColumnarSettingsPatch = {};
  if ("enabled" in raw) {
    if (typeof raw.enabled !== "boolean") return { ok: false, error: "Malformed settings" };
    patch.enabled = raw.enabled;
  }
  if ("threshold" in raw) {
    const n = Number(raw.threshold);
    if (!Number.isInteger(n) || n < 1 || n > 50) return { ok: false, error: "Pick a threshold between 1 and 50" };
    patch.threshold = n;
  }
  if ("vibes" in raw) {
    if (!isObj(raw.vibes)) return { ok: false, error: "Malformed settings" };
    const vibes: Record<string, boolean> = {};
    for (const [id, on] of Object.entries(raw.vibes)) {
      if (!(VIBE_IDS as readonly string[]).includes(id) || typeof on !== "boolean") continue;
      vibes[id] = on;
    }
    patch.vibes = vibes;
  }
  if (Object.keys(patch).length === 0) return { ok: false, error: "Nothing to save" };
  return { ok: true, patch };
}

/** Apply a validated Studio patch to a stored spec (vibe toggles merge). */
export function applyColumnarPatch(spec: ColumnarSpec, patch: ColumnarSettingsPatch): ColumnarSpec {
  const vibes = { ...spec.vibes };
  for (const [id, on] of Object.entries(patch.vibes ?? {})) vibes[id] = { enabled: on };
  return {
    ...spec,
    ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    ...(patch.threshold !== undefined ? { threshold: patch.threshold } : {}),
    vibes,
  };
}
