// Glamnetic's Oct 17 pool for the columnar engine tests and
// scripts/columnar-qa.mts: the 424 collection products (tags trimmed to
// the prefixes the derivation reads, FALSE flags dropped, stored as indexes
// into one tag list), each with its row of Aaron's attribute export
// (pool-attributes-v3.csv) as the QA reference. The spec mirrors the
// shared contract's Glamnetic axis mapping.

import fs from "node:fs";
import { fileURLToPath } from "node:url";
import type { PoolProductInput } from "../../columnar/attributes";
import { sanitizeColumnarSpec, type ColumnarSpec } from "../../columnar/spec";

const here = (name: string) => fileURLToPath(new URL(name, import.meta.url));

type FixtureRow = [
  handle: string,
  title: string,
  productId: string,
  productType: string,
  price: number | null,
  tagIndexes: number[],
  /** length,shape,colors,finish,flags,drama,holiday from the export. */
  exported: string,
];

let cached: { tags: string[]; products: FixtureRow[] } | null = null;
const fixture = () =>
  (cached ??= JSON.parse(fs.readFileSync(here("./glamnetic-pool.json"), "utf8")) as {
    tags: string[];
    products: FixtureRow[];
  });

export function loadGlamneticPool(): Array<PoolProductInput & { variantId: string }> {
  const file = fixture();
  return file.products.map(([handle, title, productId, productType, price, tagIndexes]) => ({
    id: handle,
    shopifyId: `gid://shopify/Product/${productId}`,
    handle,
    title,
    productType,
    status: "active",
    tags: tagIndexes.map((i) => file.tags[i]),
    price,
    imageUrl: null,
    // Press-ons are one variant; the id only has to be unique per set.
    variantId: `gid://shopify/ProductVariant/${productId}1`,
  }));
}

const FLAG_COLUMNS = ["is_french", "is_ombre", "is_3d", "has_glitter", "has_pattern", "is_solid", "is_chrome"];

/** The export's rows, keyed by the CSV's column names ("|"-joined lists,
 * "True"/"False" booleans) exactly as Aaron delivered them. */
export function loadAttributeExport(): Array<Record<string, string>> {
  return fixture().products.map(([handle, title, , , , , exported]) => {
    const [length, shape, colors, finish, flags, drama, holiday] = exported.split(",");
    const row: Record<string, string> = {
      handle,
      title,
      length,
      shape,
      color_families: colors.replace(/\+/g, "|"),
      finish,
      drama: drama.replace(/\+/g, "|"),
      holiday: holiday === "1" ? "True" : "False",
    };
    FLAG_COLUMNS.forEach((c, i) => (row[c] = flags[i] === "1" ? "True" : "False"));
    return row;
  });
}

export const GLAMNETIC_AXES = {
  vibe: {
    role: "vibe",
    values: {
      model_off_duty: "clean_girl",
      soft_sweet: "soft_sweet",
      french_girl: "french_girl",
      main_character: "main_character",
      vacation: "vacay",
      option_7: "alt_edgy",
      option_8: "holiday",
    },
  },
  length: { role: "length", values: { super_short: "super_short", short: "short", medium: "medium" } },
  shape: {
    role: "shape",
    values: { almond: "almond", coffin: "coffin", oval: "oval", round: "round", squoval: "squoval", square: "square" },
  },
  color_family: {
    role: "color",
    values: {
      nudes_neutrals: "nudes",
      pinks_pastels: "pinks_purples",
      reds_berries: "reds_berries",
      bold_bright: "bold_bright",
      dark_moody: "dark_moody",
      metallics: "metallics",
      oranges_yellows: "oranges_yellows",
      white: "white",
    },
  },
  question_6: {
    role: "finish",
    values: {
      option_1: "glossy",
      option_2: "glazed_pearl",
      option_3: "velvet_cateye",
      option_4: "chrome",
      option_5: "matte",
    },
  },
  style_tier: {
    role: "drama",
    values: { clean: "clean_classic", extra: "little_extra", statement: "statement", art: "full_art" },
  },
} as const;

export function glamneticSpec(overrides: Record<string, unknown> = {}): ColumnarSpec {
  const pool = loadGlamneticPool();
  return sanitizeColumnarSpec({
    enabled: true,
    version: 1,
    pool: {
      collectionHandle: "shop-all-nails-gleame-quiz-flow",
      handles: pool.map((p) => p.handle),
      syncedAt: "2026-10-17T00:00:00.000Z",
      source: "csv",
    },
    axes: GLAMNETIC_AXES,
    ...overrides,
  })!;
}

export interface FixtureFlowQuestion {
  axisKey: string;
  prompt: string | null;
  multiSelect: boolean;
  maxSelections: number | null;
  options: Array<{ label: string; axisValue: string; selectAll: boolean }>;
}

/** The live quiz's questions (Oct 21 recommendation-config): the order,
 * select-all options and max selections the widget branches over. */
export function loadGlamneticFlow(): FixtureFlowQuestion[] {
  return (JSON.parse(fs.readFileSync(here("./glamnetic-flow-v3.json"), "utf8")) as { questions: FixtureFlowQuestion[] })
    .questions;
}

/** The brief's eight products missing a core tag (section 10, item 5). */
export const MISSING_CORE_TAG = {
  "queen-of-hearts-medium-coffin-press-on-nails": "length",
  "red-legacy-super-short-press-on-nails": "shape",
  "platinum-metallic-chrome-short-almond-nails": "color",
  "gunmetal-metallic-chrome-medium-coffin-nails": "color",
  "pure-gray-short-oval-press-on-nails": "color",
  "ash-gray-short-almond-press-on-nails": "color",
  "paris-short-almond-press-on-nails": "finish",
  "angel-short-almond-press-on-nails": "finish",
} as const;
