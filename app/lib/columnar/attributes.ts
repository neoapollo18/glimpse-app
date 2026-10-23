// Product attributes for columnar matching, derived from Glamnetic's
// structured Shopify tags (brief section 3). Pure: built at pool-load time
// from the synced products rows, validated against Aaron's Oct 17 QA
// export (pool-attributes-v3.csv) by scripts/columnar-qa.mts.
//
// Never inferred from titles or images. A product missing its length,
// shape, color or finish tag is excluded from matching until Lisa tags it.
// Vibes come from Lisa's approved labels (spec.vibeLabels) where a set has
// them, else from the section 7 tag rules below.

import { COLUMNAR_DEFAULTS, LABELED_VIBE_IDS, VIBE_IDS } from "./spec";

export interface PoolProductInput {
  id: string;
  shopifyId: string;
  handle: string;
  title: string;
  productType: string | null;
  status: string | null;
  tags: string[];
  price: number | null;
  imageUrl: string | null;
}

export type CoreField = "length" | "shape" | "color" | "finish";

export interface DerivedProduct {
  id: string;
  shopifyId: string;
  handle: string;
  title: string;
  price: number | null;
  imageUrl: string | null;
  status: string | null;
  length: string | null;
  shape: string | null;
  colors: string[];
  /** The set's Color_ tag words ("nude", "pink", "gold"), tag order, for
   * the why-line that describes it. */
  colorNames: string[];
  finish: string | null;
  /** Finer shopper-facing finish word for the card meta ("Cat eye", "Pearl"). */
  finishLabel: string | null;
  isFrench: boolean;
  isOmbre: boolean;
  is3d: boolean;
  hasGlitter: boolean;
  hasPattern: boolean;
  isSolid: boolean;
  isChrome: boolean;
  isVelvet: boolean;
  semiTransparent: boolean;
  /** _Design Archetype_ values, lowercased. */
  design: string[];
  /** _Nail Collection_ names. */
  collections: string[];
  /** In a holiday collection (keyword match). */
  holiday: boolean;
  drama: string[];
  bestseller: boolean;
  /** Numeric Shopify product id: newer products have larger ids. */
  recency: number;
  nonNail: boolean;
  /** Core fields with no usable tag (or conflicting tags). */
  missing: CoreField[];
  /** Vibe IDs the set fits, vocabulary order. */
  vibes: string[];
  /** "labels" = Lisa approved them; "rules" = guessed from tags. */
  vibeSource: "labels" | "rules";
}

// Color_* tag value -> color answer ID. Derived from the Oct 17 export,
// where every Color_ value maps to exactly one family (0 disagreements).
export const COLOR_TAG_FAMILY: Record<string, string> = {
  nude: "nudes",
  brown: "nudes",
  pink: "pinks_purples",
  purple: "pinks_purples",
  red: "reds_berries",
  blue: "bold_bright",
  green: "bold_bright",
  multicolor: "bold_bright",
  black: "dark_moody",
  gray: "dark_moody",
  grey: "dark_moody",
  silver: "metallics",
  gold: "metallics",
  yellow: "oranges_yellows",
  orange: "oranges_yellows",
  white: "white",
};

const LENGTH_TAG: Record<string, string> = {
  "super short": "super_short",
  "extra short": "super_short",
  short: "short",
  medium: "medium",
  long: "long",
  "extra long": "long",
};

const SHAPE_TAG: Record<string, string> = {
  almond: "almond",
  coffin: "coffin",
  ballerina: "coffin",
  oval: "oval",
  round: "round",
  squoval: "squoval",
  square: "square",
  "super short": "super_short",
};

const FINISH_TAG: Record<string, string> = {
  glossy: "glossy",
  gloss: "glossy",
  foil: "glossy",
  gems: "glossy",
  glitter: "glossy",
  glazed: "glazed_pearl",
  pearl: "glazed_pearl",
  "glazed pearl": "glazed_pearl",
  velvet: "velvet_cateye",
  "cat eye": "velvet_cateye",
  "magnetic cat eye": "velvet_cateye",
  magnetic: "velvet_cateye",
  chrome: "chrome",
  "metallic chrome": "chrome",
  "pearl chrome": "chrome",
  matte: "matte",
};
// One finish per product: a chrome flag wins over everything (brief),
// then velvet / cat eye, matte, glazed, and glossy last (most sets carry a
// Finish_Glossy tag next to their real finish).
const FINISH_PRIORITY = ["chrome", "velvet_cateye", "matte", "glazed_pearl", "glossy"];

// Non-nail products live in the catalog only as cross-sells (glue, tabs,
// tools, bundles); a stray one in the collection must never be matched.
const NON_NAIL_TYPE_RE = /accessor|bundle|duplicate|lash|glue|tab|tool|remover|kit|gift/i;

/** Values of every tag starting with `prefix` (case-insensitive: the
 * catalog has "_Nail collection_" and "Nail STyle_" typos). */
export function tagValues(tags: string[], prefix: string): string[] {
  const p = prefix.toLowerCase();
  const out: string[] = [];
  for (const t of tags) {
    if (typeof t === "string" && t.toLowerCase().startsWith(p)) {
      const v = t.slice(prefix.length).trim();
      if (v) out.push(v);
    }
  }
  return out;
}

/** Boolean tag pair: TRUE anywhere wins (a few sets carry both). */
const flag = (tags: string[], name: string) =>
  tagValues(tags, `_${name}_`).some((v) => v.toUpperCase() === "TRUE");

function single(values: string[], map: Record<string, string>): string | null | "conflict" {
  const mapped = [...new Set(values.map((v) => map[v.toLowerCase()]).filter(Boolean))];
  if (mapped.length === 0) return null;
  return mapped.length === 1 ? mapped[0] : "conflict";
}

const numericId = (gid: string): number => {
  const m = /(\d+)$/.exec(gid ?? "");
  return m ? Number(m[1]) : 0;
};

export function deriveProduct(
  p: PoolProductInput,
  opts: {
    holidayCollections?: readonly string[];
    /** spec.vibeLabels: a listed handle takes exactly these vibes. */
    vibeLabels?: Readonly<Record<string, readonly string[]>>;
  } = {},
): DerivedProduct {
  const tags = Array.isArray(p.tags) ? p.tags.filter((t): t is string => typeof t === "string") : [];
  const missing: CoreField[] = [];

  const length = single(tagValues(tags, "Nail Length_"), LENGTH_TAG);
  const shape = single(tagValues(tags, "Nail Shape_"), SHAPE_TAG);
  if (length === null || length === "conflict") missing.push("length");
  if (shape === null || shape === "conflict") missing.push("shape");

  const colorTags = tagValues(tags, "Color_").map((v) => v.toLowerCase());
  const colors = [...new Set(colorTags.map((v) => COLOR_TAG_FAMILY[v]).filter(Boolean))];
  if (colors.length === 0) missing.push("color");
  const colorNames = [...new Set(colorTags.filter((v) => COLOR_TAG_FAMILY[v]).map((v) => (v === "grey" ? "gray" : v)))];

  const isChrome = flag(tags, "Is Chrome");
  const isVelvet = flag(tags, "Is Velvet");
  const finishTags = tagValues(tags, "Finish_").map((v) => v.toLowerCase());
  const styles = new Set(tagValues(tags, "Nail Style_").map((v) => v.toLowerCase()));
  const finishes = new Set(finishTags.map((v) => FINISH_TAG[v]).filter(Boolean));
  if (isChrome) finishes.add("chrome");
  if (isVelvet) finishes.add("velvet_cateye");
  let finish: string | null = FINISH_PRIORITY.find((f) => finishes.has(f)) ?? null;
  // Aura and jelly sets are tagged Finish_Glossy but read as glazed (the
  // export classes all 7 that way).
  if (finish === "glossy" && (styles.has("aura") || styles.has("jelly"))) finish = "glazed_pearl";
  if (!finish) missing.push("finish");

  const isFrench = flag(tags, "Is French Tip");
  const isOmbre = flag(tags, "Is Ombre");
  const is3d = flag(tags, "Is 3D");
  const hasGlitter = flag(tags, "Has Glitter");
  const hasPattern = flag(tags, "Has Pattern");
  const isSolid = flag(tags, "Is Solid");
  const design = [...new Set(tagValues(tags, "_Design Archetype_").map((v) => v.toLowerCase()))];
  const arch = new Set(design);

  // Drama, reverse-engineered from the export (matches all 424 rows): a
  // set can carry several levels.
  const drama: string[] = [];
  if (isSolid || isFrench || (finish === "glazed_pearl" && !hasPattern)) drama.push("clean_classic");
  if (
    isOmbre ||
    finish === "glazed_pearl" ||
    (hasPattern && !is3d) ||
    arch.has("accent nail") ||
    arch.has("reverse french tip")
  ) {
    drama.push("little_extra");
  }
  if (isVelvet || finish === "chrome" || finish === "velvet_cateye" || hasGlitter || arch.has("sparkle overlay")) {
    drama.push("statement");
  }
  if (
    is3d ||
    arch.has("pattern") ||
    arch.has("patterns") ||
    arch.has("sparkle overlay") ||
    styles.has("abstract") ||
    styles.has("3d gems")
  ) {
    drama.push("full_art");
  }

  const collections = [...new Set(tagValues(tags, "_Nail Collection_"))];
  const holidayKeys = (opts.holidayCollections ?? COLUMNAR_DEFAULTS.holidayCollections).map((k) => k.toLowerCase());
  const holiday = collections.some((c) => holidayKeys.some((k) => c.toLowerCase().includes(k)));

  const typeTags = tagValues(tags, "Product Type_").map((v) => v.toLowerCase());
  const nonNail =
    NON_NAIL_TYPE_RE.test(p.productType ?? "") || typeTags.some((t) => t !== "nail" && t !== "nails");

  let finishLabel: string | null = null;
  if (finish === "chrome") finishLabel = "Chrome";
  else if (finish === "velvet_cateye") {
    const catEye = [...finishTags, ...styles].some((v) => v.includes("cat eye") || v.includes("magnetic"));
    finishLabel = catEye ? "Cat eye" : "Velvet";
  } else if (finish === "matte") finishLabel = "Matte";
  else if (finish === "glazed_pearl") {
    const pearl = finishTags.some((v) => v.includes("pearl")) || styles.has("pearl");
    finishLabel = pearl && !finishTags.includes("glazed") ? "Pearl" : "Glazed";
  } else if (finish === "glossy") finishLabel = "Glossy";

  const out: DerivedProduct = {
    id: p.id,
    shopifyId: p.shopifyId,
    handle: p.handle,
    title: p.title,
    price: p.price,
    imageUrl: p.imageUrl,
    status: p.status,
    length: length === "conflict" ? null : length,
    shape: shape === "conflict" ? null : shape,
    colors,
    colorNames,
    finish,
    finishLabel,
    isFrench,
    isOmbre,
    is3d,
    hasGlitter,
    hasPattern,
    isSolid,
    isChrome,
    isVelvet,
    semiTransparent: tagValues(tags, "Opacity_").some((v) => v.toLowerCase() === "semi-transparent"),
    design,
    collections,
    holiday,
    drama,
    bestseller: tags.some((t) => typeof t === "string" && t.toLowerCase() === "bestsellers"),
    recency: numericId(p.shopifyId),
    nonNail,
    missing,
    vibes: [],
    vibeSource: "rules",
  };
  const labels =
    opts.vibeLabels && Object.prototype.hasOwnProperty.call(opts.vibeLabels, p.handle) ? opts.vibeLabels[p.handle] : null;
  if (Array.isArray(labels)) {
    out.vibeSource = "labels";
    out.vibes = VIBE_IDS.filter((v) =>
      v === "french_girl" ? vibeRule(out, v) : LABELED_VIBE_IDS.includes(v) && labels.includes(v),
    );
  } else {
    out.vibes = VIBE_IDS.filter((v) => vibeRule(out, v));
  }
  return out;
}

export const EXCLUSION_LABELS = {
  unpublished: "Not active in Shopify",
  nonNail: "Not a nail set",
  length: "No length tag",
  shape: "No shape tag",
  color: "No color tag",
  finish: "No finish tag",
} as const;

export interface PoolSplit {
  eligible: DerivedProduct[];
  excluded: Array<{ handle: string; title: string; reasons: string[] }>;
}

/** Eligible = active, a nail set, and tagged on all four core fields. */
export function splitPool(products: DerivedProduct[]): PoolSplit {
  const eligible: DerivedProduct[] = [];
  const excluded: PoolSplit["excluded"] = [];
  for (const p of products) {
    const reasons: string[] = [];
    // NULL status = a pre-catalog-sync row, which every reader treats as live.
    if (p.status != null && p.status !== "active") reasons.push(EXCLUSION_LABELS.unpublished);
    if (p.nonNail) reasons.push(EXCLUSION_LABELS.nonNail);
    for (const f of p.missing) reasons.push(EXCLUSION_LABELS[f]);
    if (reasons.length) excluded.push({ handle: p.handle, title: p.title, reasons });
    else eligible.push(p);
  }
  return { eligible, excluded };
}

// ---- Vibe rules (brief section 7) ----

// Vacay keywords: the brief also lists plain "Summer", but that matches the
// store-wide "Summer Shop 2026" collection (184 of 424 sets), which would
// boost half the pool. Bright colors carry the rest.
const VACAY_COLLECTIONS = ["euro summer", "siren", "juicy", "vivids"];
// Alternative & Edgy by collection: the Halloween drops (Fright Night,
// Spells & Sparkles). The brief's third keyword, "dark", only ever matched
// a colorway collection named for its shade ("Glossy Dark Maroon", the
// berry solids such as Berry Baby), which is a color, not a theme; dark
// sets get the vibe from their Color_Black / Color_Gray tags instead.
const ALT_COLLECTIONS = ["fright", "spells"];

const anyColor = (p: DerivedProduct, ids: string[]) => p.colors.some((c) => ids.includes(c));
const inCollection = (p: DerivedProduct, keys: string[]) =>
  p.collections.some((c) => keys.some((k) => c.toLowerCase().includes(k)));

/** Does the set fit the vibe (approved label, else the tag rule)? For
 * French Girl Chic this is the gate; for the others it ranks. */
export function vibeMatches(p: Pick<DerivedProduct, "vibes">, vibe: string): boolean {
  return p.vibes.includes(vibe);
}

/** Vibes a why-line may name: Lisa's approved labels, or the French tip /
 * ombre tags. A vibe only guessed from color tags ranks the set but is
 * never stated as fact. */
export function claimableVibes(p: Pick<DerivedProduct, "vibes" | "vibeSource">): string[] {
  return p.vibeSource === "labels" ? p.vibes : p.vibes.filter((v) => v === "french_girl");
}

/** The section 7 tag rule for one vibe (labels aside). */
export function vibeRule(p: DerivedProduct, vibe: string): boolean {
  switch (vibe) {
    case "french_girl":
      return p.isFrench || p.isOmbre;
    case "main_character":
      return p.is3d || p.isChrome || p.finish === "chrome" || p.hasGlitter || anyColor(p, ["bold_bright", "metallics"]);
    case "alt_edgy":
      return p.colors.includes("dark_moody") || inCollection(p, ALT_COLLECTIONS);
    case "holiday":
      return (
        p.holiday ||
        (anyColor(p, ["reds_berries", "metallics", "white"]) && (p.hasGlitter || p.is3d))
      );
    case "clean_girl":
      return (
        (p.isSolid || p.semiTransparent) &&
        anyColor(p, ["nudes", "white"]) &&
        (p.finish === "glossy" || p.finish === "glazed_pearl") &&
        !p.is3d &&
        !p.hasPattern
      );
    case "soft_sweet":
      return (
        anyColor(p, ["pinks_purples", "white"]) &&
        (p.finish === "glossy" || p.finish === "glazed_pearl") &&
        !p.colors.includes("dark_moody")
      );
    case "vacay":
      return anyColor(p, ["bold_bright", "oranges_yellows"]) || inCollection(p, VACAY_COLLECTIONS);
    default:
      return false;
  }
}
