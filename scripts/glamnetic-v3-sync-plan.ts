// Glamnetic "Find My Match" v3 sync (2026-10-17): the plan and apply
// halves of scripts/glamnetic-v3-sync.mts, kept apart from the CLI so the
// test suite can run them against the Oct 17 fixtures with an in-memory
// database (app/lib/__tests__/glamnetic-v3-sync.test.ts).
//
// Target: the approved Find My Match UI v2 mockups (canvas build spec
// v3.0, Lisa's Oct 17 changes) for shopper copy and order, the v3 engine
// brief for answer IDs and select rules, and the shared columnar contract
// for recommendation_tuning.columnar.
//
// Safety model (Charles's hard rule: never wipe or rewrite live data):
//   - Only targeted UPDATEs (matched by row id, plus the old value of every
//     scalar being changed) and INSERTs. No deletes, no upserts, no RPCs:
//     the Studio's wipe-and-rewrite save_recommendation_config is never
//     called. That RPC re-creates every quiz row, so a Studio save landing
//     mid-run makes the id match fail and the run stops instead of
//     clobbering it.
//   - Every field carries the value it had live on Oct 17 ("from"). A live
//     value that is neither that nor the target is a merchant edit: it is
//     reported and skipped unless named in --force-field. Option order is
//     judged pair by pair: only a pair the mockups do not reorder can show
//     a merchant's reorder, so a run that stopped part way (or Studio saves
//     of that state) re-plans to the target, not to a skip.
//   - jsonb is merged, never replaced: display_meta keeps keys the sync
//     does not own (Bold & bright's texture, anything Studio adds),
//     recommendation_tuning keeps every other tuning key, quiz_offers keeps
//     every column the sync does not set.
//   - Never touches prompts, images, show_if, reasons, bot responses,
//     rules, landing copy or the quiz surface toggle.

import { numericShopifyId, offersPatchToRow, validateOffersPatch, type OffersPatch } from "../app/lib/quiz-offers.server";
import { OPTION_TEXTURES, mapRecommendationTuning } from "../app/lib/supabase.server";

export const SHOP_DOMAIN = "glamrco.myshopify.com";
export const SHOP_ID = "8121d154-2019-490f-9343-7bddbc1a64be";
export const SNAPSHOT_LABEL = "Before v3 mockup sync";
/** A re-run after a partial apply snapshots the half-synced quiz: labeled
 * apart so "undo the whole sync" stays the first one. */
export const RERUN_SNAPSHOT_LABEL = "Before v3 mockup sync (re-run)";
export const POOL_COLLECTION_HANDLE = "shop-all-nails-gleame-quiz-flow";

/** The slice of supabase-js the sync uses, so tests can pass a fake. */
export interface Db {
  from(table: string): any;
}

type Row = Record<string, any>;

// ---------------------------------------------------------------------
// Target
// ---------------------------------------------------------------------

/** A field the sync owns: a plain value means "already live, keep it";
 * {from, to} is a change from the value live on Oct 17. */
type Field<T> = T | { from: T; to: T };
const chg = <T>(from: T, to: T): { from: T; to: T } => ({ from, to });

interface OptionSpec {
  /** Diff / --force-field key: the axis value, or "select_all" for the
   * question's "open to anything" option (it borrows another option's
   * axis value). */
  key: string;
  /** value + selectAll false: that plain option. selectAll true: the
   * question's select-all. value alone: that value, select-all or not. */
  match: { value: string; selectAll?: false } | { selectAll: true };
  /** Created (with its axis value) when missing. */
  isNew?: boolean;
  label: Field<string>;
  sublabel?: Field<string | null>;
  swatch?: Field<string | null>;
  swatch2?: Field<string | null>;
  texture?: Field<string | null>;
  selectAll?: Field<boolean>;
}

interface QuestionSpec {
  axisKey: string;
  axisLabel?: Field<string>;
  helper?: Field<string | null>;
  multiSelect?: Field<boolean>;
  maxSelections?: Field<number | null>;
  optionStyle?: Field<string | null>;
  /** Option keys in the order they were live on Oct 17. */
  liveOrder: string[];
  /** Target order. */
  options: OptionSpec[];
  /** Existing axis value labels (value -> field). */
  valueLabels?: Record<string, Field<string>>;
}

const plain = (value: string) => ({ value, selectAll: false as const });
const ANY = { selectAll: true as const };
// Live Oct 17 copy has em dashes and curly apostrophes; built from char
// codes so this source stays free of the characters.
const EM = String.fromCharCode(0x2014);
const RQ = String.fromCharCode(0x2019);

// Shopper copy comes from the mockups' desktop boards, verbatim: it is
// Glamnetic's copy, em dashes included.
export const QUESTIONS: QuestionSpec[] = [
  {
    axisKey: "vibe",
    // The mockup shows no helper line, so the brief's "Pick the one that
    // feels most like you." is not added.
    helper: null,
    multiSelect: false,
    optionStyle: "boxed",
    liveOrder: ["model_off_duty", "soft_sweet", "french_girl", "main_character", "vacation", "select_all", "option_7", "option_8"],
    options: [
      { key: "model_off_duty", match: plain("model_off_duty"), label: "Clean Girl & Minimalist", sublabel: "quiet luxury, effortless" },
      { key: "soft_sweet", match: plain("soft_sweet"), label: "Soft & Sweet", sublabel: "pastel & pretty" },
      { key: "french_girl", match: plain("french_girl"), label: "French Girl Chic", sublabel: "fresh take on the classics" },
      { key: "main_character", match: plain("main_character"), label: "Main Character Energy", sublabel: "gems & maximum sparkle" },
      { key: "vacation", match: plain("vacation"), label: "Vacay Mode", sublabel: "bright, tropical hues" },
      { key: "option_7", match: plain("option_7"), label: "Alternative & Edgy", sublabel: "dark, moody, a little dangerous" },
      { key: "option_8", match: plain("option_8"), label: chg("Holiday-ready", "Holiday-Ready"), sublabel: "festive sparkle & glam" },
      {
        key: "select_all",
        match: ANY,
        label: "Surprise me",
        sublabel: chg("open to anything", "just here for a mani check"),
        selectAll: true,
      },
    ],
  },
  {
    axisKey: "length",
    helper: chg(
      `Select every length you${RQ}d wear ${EM} one or all three.`,
      `Pick all the lengths you'd wear. On your hands a lot ${EM} typing, gym, kids? Shorter holds up best.`,
    ),
    multiSelect: true,
    optionStyle: "visual",
    liveOrder: ["super_short", "short", "medium"],
    // Only helper + sublabels: the live labels stay ("Super Short" is the
    // catalog's own term; the mockup sets it in sentence case).
    options: [
      { key: "super_short", match: plain("super_short"), label: "Super Short", sublabel: chg(null, "Barely-there, ultra practical") },
      { key: "short", match: plain("short"), label: "Short", sublabel: chg(null, "The everyday sweet spot") },
      { key: "medium", match: plain("medium"), label: "Medium", sublabel: chg(null, "Elegant, still functional") },
    ],
  },
  {
    axisKey: "shape",
    helper: chg(`Select every shape you${RQ}d wear. You can pick as many as you'd like.`, "Tap all the ones you'd wear."),
    multiSelect: true,
    optionStyle: "visual",
    liveOrder: ["almond", "coffin", "oval", "round", "squoval", "square", "select_all"],
    options: [
      { key: "almond", match: plain("almond"), label: "Almond" },
      { key: "oval", match: plain("oval"), label: "Oval" },
      { key: "round", match: plain("round"), label: "Round" },
      { key: "square", match: plain("square"), label: "Square" },
      { key: "squoval", match: plain("squoval"), label: "Squoval" },
      { key: "coffin", match: plain("coffin"), label: "Coffin" },
      { key: "select_all", match: ANY, label: "Open to anything", selectAll: true },
    ],
  },
  {
    axisKey: "color_family",
    // Live already matches the mockup.
    helper: `Select up to three ${EM} or let us surprise you.`,
    multiSelect: true,
    maxSelections: chg(null, 3),
    optionStyle: "nails",
    liveOrder: ["nudes_neutrals", "pinks_pastels", "reds_berries", "bold_bright", "dark_moody", "select_all"],
    // swatch / swatch2 = first and last stop of each ColorDesktop nail
    // gradient (the rule the live swatches came from), except Metallic,
    // whose five stops end in grey: its gold and bronze stops instead.
    options: [
      { key: "nudes_neutrals", match: plain("nudes_neutrals"), label: "Nudes & neutrals", swatch: "#F8E6E0", swatch2: "#D6A899" },
      {
        key: "pinks_pastels",
        match: plain("pinks_pastels"),
        label: chg("Pinks & pastels", "Pinks & purples"),
        swatch: chg("#FCE7EC", "#FBD8E3"),
        swatch2: chg("#E28FAA", "#B48BD1"),
      },
      { key: "reds_berries", match: plain("reds_berries"), label: "Reds & berries", swatch: "#E85468", swatch2: "#601222" },
      {
        key: "bold_bright",
        match: plain("bold_bright"),
        label: "Bold & bright",
        swatch: chg("#FF7A59", "#FF6B9D"),
        swatch2: chg("#3E7DE0", "#2BB3A3"),
      },
      { key: "dark_moody", match: plain("dark_moody"), label: "Dark & moody", swatch: "#5E3C53", swatch2: "#121014" },
      {
        key: "metallics",
        match: plain("metallics"),
        isNew: true,
        label: "Metallic gold, bronze & silver",
        swatch: "#F7E3A6",
        swatch2: "#B57A3C",
      },
      {
        key: "oranges_yellows",
        match: plain("oranges_yellows"),
        isNew: true,
        label: "Bright oranges & yellows",
        swatch: "#FFE066",
        swatch2: "#FF6A2A",
      },
      { key: "white", match: plain("white"), isNew: true, label: "White", swatch: "#FFFFFF", swatch2: "#E9E3E0" },
      { key: "select_all", match: ANY, label: chg("\u{1F3A8} Surprise me", "Surprise me"), selectAll: true },
    ],
    valueLabels: { pinks_pastels: chg("Pinks & pastels", "Pinks & purples") },
  },
  {
    axisKey: "question_6",
    // The axis label is shopper-facing (the results answers rail).
    axisLabel: chg("Question 6", "Finish"),
    helper: chg("Select up to two finishes, or let us surprise you.", `Select up to two ${EM} or let us surprise you.`),
    multiSelect: chg(false, true),
    maxSelections: chg(null, 2),
    optionStyle: chg(null, "nails"),
    liveOrder: ["option_1", "option_2", "option_3", "option_4", "option_5", "option_6"],
    // Textures are the widget package's Finish nails, one per finish
    // (glossy, glazed, velvet, chrome, matte). Swatch pairs are the first and
    // last stop of each FinishDesktop nail, except the two banded ones, which
    // take the widget package's meaning: Velvet is band tint then base,
    // Chrome is silver then gunmetal.
    options: [
      {
        key: "option_1",
        match: plain("option_1"),
        label: "Classic Glossy",
        texture: chg(null, "glossy"),
        swatch: chg(null, "#D59AA3"),
        swatch2: chg(null, "#A86B76"),
      },
      {
        key: "option_2",
        match: plain("option_2"),
        label: "Glazed & Pearlescent",
        texture: chg(null, "glazed"),
        swatch: chg(null, "#E8C3CA"),
        swatch2: chg(null, "#CDA0B5"),
      },
      {
        key: "option_3",
        match: plain("option_3"),
        label: chg("Velvet & Cateye ", "Velvet & Cateye"),
        texture: chg(null, "velvet"),
        swatch: chg(null, "#F3CFE0"),
        swatch2: chg(null, "#6B2E4A"),
      },
      {
        key: "option_4",
        match: plain("option_4"),
        label: "Bold Chrome",
        texture: chg(null, "chrome"),
        swatch: chg(null, "#E8E2E4"),
        swatch2: chg(null, "#2E2326"),
      },
      {
        key: "option_5",
        match: plain("option_5"),
        label: "Matte",
        texture: chg(null, "matte"),
        swatch: chg(null, "#D6ACB3"),
        swatch2: chg(null, "#A97A84"),
      },
      // Matched by value: a plain option today, the select-all after the
      // sync ("surprise": no finish filter), found either way on a re-run.
      { key: "option_6", match: { value: "option_6" }, label: "Surprise Me!", selectAll: chg(false, true) },
    ],
  },
  {
    axisKey: "style_tier",
    helper: chg(
      `Select up to two. Mix a classic with a statement if that${RQ}s you.`,
      `You've picked the vibe and the colors. This is the design ${EM} pick up to two.`,
    ),
    multiSelect: true,
    maxSelections: 2,
    optionStyle: "visual",
    liveOrder: ["clean", "extra", "statement", "art"],
    options: [
      {
        key: "clean",
        match: plain("clean"),
        label: chg("Clean & Classic", "Clean & classic"),
        sublabel: chg("solids, french tips, glazed", "Solids, french tips, glazed"),
      },
      {
        key: "extra",
        match: plain("extra"),
        label: "A little extra",
        sublabel: chg("pearls, ombre, subtle art", "Pearls, ombre, subtle art"),
      },
      {
        key: "statement",
        match: plain("statement"),
        label: "Statement",
        sublabel: chg("chrome, glitter, cat eye", "Chrome, glitter, cat eye"),
      },
      { key: "art", match: plain("art"), label: "Full-on nail art", sublabel: "3D gems, patterns, abstract" },
    ],
  },
];

// ---- Columnar engine spec (shared contract §1) ------------------------

export interface ColumnarSpec {
  enabled: boolean;
  version: 1;
  pool: { collectionHandle: string | null; handles: string[]; syncedAt: string | null; source: "collection" | "csv" };
  threshold: number;
  candidateCount: number;
  resultCount: number;
  alsoMatchedCount: number;
  weights: { color: number; drama: number; vibe: number };
  axes: Record<string, { role: "vibe" | "length" | "shape" | "color" | "finish" | "drama"; values: Record<string, string> }>;
  vibes: Record<string, { enabled: boolean }>;
  holidayCollections: string[];
  llm: { enabled: boolean; timeoutMs: number };
}

// DB axis keys and values stay as they are; the spec maps them to brief
// answer IDs. Select-all answers mean "surprise" and are not mapped.
export const COLUMNAR_AXES: ColumnarSpec["axes"] = {
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
    values: { option_1: "glossy", option_2: "glazed_pearl", option_3: "velvet_cateye", option_4: "chrome", option_5: "matte" },
  },
  style_tier: {
    role: "drama",
    values: { clean: "clean_classic", extra: "little_extra", statement: "statement", art: "full_art" },
  },
};

export function buildColumnarTarget(handles: string[], enabled: boolean, syncedAt: string): ColumnarSpec {
  return {
    enabled,
    version: 1,
    pool: { collectionHandle: POOL_COLLECTION_HANDLE, handles: [...handles], syncedAt, source: "csv" },
    threshold: 6,
    candidateCount: 40,
    resultCount: 6,
    alsoMatchedCount: 6,
    weights: { color: 0.4, drama: 0.35, vibe: 0.25 },
    axes: COLUMNAR_AXES,
    vibes: Object.fromEntries(Object.values(COLUMNAR_AXES.vibe.values).map((id) => [id, { enabled: true }])),
    holidayCollections: ["Holiday", "Snow", "Sleigh", "Winter", "Polar"],
    llm: { enabled: true, timeoutMs: 4000 },
  };
}

// ---- Offers (brief §8) -------------------------------------------------

/** "Finish the look", in order. No accessory in the catalog is a file /
 * buffer / cuticle kit, so the Prep Kit slot keeps the Press-On Nail
 * Remover that stood in for the v2 "Prep & Remove Kit" tile (same $12.99,
 * live today) until --prep-kit names a real one. */
export const CROSS_SELL_HANDLES = {
  glue: "brush-on-nail-glue",
  prepStandIn: "press-on-nail-remover",
  tabs: "adhesive-nail-tabs",
  pen: "press-on-nail-remover-pen-nail-accessory",
};
const CROSS_SELL_LIVE = ["brush-on-nail-glue", "press-on-nail-remover", "adhesive-nail-tabs", "press-on-nail-remover-pen-nail-accessory"];

// ---------------------------------------------------------------------
// Live state
// ---------------------------------------------------------------------

export interface LiveState {
  shop: { id: string; shop_domain: string };
  axes: Row[];
  values: Row[];
  questions: Row[];
  options: Row[];
  /** chat_assistant_config: id, shop_domain, recommendation_tuning, updated_at. */
  config: Row | null;
  offers: Row | null;
  /** Catalog rows for the cross-sell handles. */
  products: Row[];
}

function must<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  // Fail closed: a swallowed read error would plan against an empty quiz.
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

export async function loadLiveState(db: Db, productHandles: string[]): Promise<LiveState> {
  const shop = must(await db.from("shops").select("id, shop_domain").eq("shop_domain", SHOP_DOMAIN).maybeSingle(), "shops") as Row | null;
  if (!shop) throw new Error(`${SHOP_DOMAIN} shop row not found`);
  if (shop.id !== SHOP_ID) throw new Error(`${SHOP_DOMAIN} has id ${shop.id}, expected ${SHOP_ID}: wrong database?`);

  const axes = (must(
    await db.from("recommendation_axes").select("id, shop_id, key, label, source, position, updated_at").eq("shop_id", shop.id),
    "recommendation_axes",
  ) ?? []) as Row[];
  const axisIds = axes.map((a) => a.id);
  const values = axisIds.length
    ? ((must(
        await db.from("recommendation_axis_values").select("id, axis_id, value, label, position, swatch_color").in("axis_id", axisIds),
        "recommendation_axis_values",
      ) ?? []) as Row[])
    : [];
  const questions = axisIds.length
    ? ((must(
        await db
          .from("recommendation_questions")
          .select("id, axis_id, prompt, helper_text, multi_select, max_selections, screen_group, show_if, option_style, updated_at")
          .in("axis_id", axisIds),
        "recommendation_questions",
      ) ?? []) as Row[])
    : [];
  const questionIds = questions.map((q) => q.id);
  const options = questionIds.length
    ? ((must(
        await db
          .from("recommendation_question_options")
          .select(
            "id, question_id, label, axis_value_id, bot_response, position, reason_text, image_url, show_if, select_all, display_meta",
          )
          .in("question_id", questionIds),
        "recommendation_question_options",
      ) ?? []) as Row[])
    : [];
  const config = must(
    await db
      .from("chat_assistant_config")
      .select("id, shop_domain, recommendation_tuning, updated_at")
      .eq("shop_domain", SHOP_DOMAIN)
      .maybeSingle(),
    "chat_assistant_config",
  ) as Row | null;
  const offers = must(await db.from("quiz_offers").select("*").eq("shop_id", shop.id).maybeSingle(), "quiz_offers") as Row | null;
  const products = productHandles.length
    ? ((must(
        await db
          .from("products")
          .select("id, shopify_id, handle, product_name, status, image_url")
          .eq("shop_id", shop.id)
          .in("handle", productHandles),
        "products",
      ) ?? []) as Row[])
    : [];
  return { shop: { id: shop.id, shop_domain: shop.shop_domain }, axes, values, questions, options, config, offers, products };
}

// ---------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------

export interface PlanOptions {
  /** Pool handles (the Oct 17 CSV). */
  handles: string[];
  enableColumnar?: boolean;
  /** Field keys allowed to overwrite a merchant edit. */
  forceFields?: string[];
  /** Shopify handle of the Prep Kit cross-sell, once Lisa names one. */
  prepKitHandle?: string | null;
  /** The Shopify discount code the merchant created for the bundle. */
  bundleCode?: string | null;
  /** ISO time stamped on a newly written pool. */
  now?: string;
  /** The widget's gleame-quiz.css, to flag finishes it cannot draw yet. */
  widgetCss?: string;
}

/** change: live is the Oct 17 value. forced: a merchant edit overwritten
 * by --force-field. diverged: a merchant edit, skipped. held: would change,
 * but its group (the bundle) is skipped. insert: a new row / key. */
export type DiffStatus = "change" | "forced" | "diverged" | "held" | "insert";

export interface Diff {
  section: string;
  key: string;
  what: string;
  from?: unknown;
  to: unknown;
  live?: unknown;
  status: DiffStatus;
}

export type Write =
  | { op: "update"; table: string; match: Row; guard: Row; set: Row; keys: string[] }
  | {
      op: "insert";
      table: string;
      ref: string;
      row: Row;
      /** column -> ref of an earlier insert whose new id fills it. */
      refs?: Record<string, string>;
      keys: string[];
    };

export interface Plan {
  writes: Write[];
  diffs: Diff[];
  notes: string[];
  /** Every row a write updates (as read) plus the parents of inserts. */
  touched: Record<string, Row[]>;
}

// jsonb does not keep key order, so equality sorts object keys.
function canonical(x: unknown): unknown {
  if (x === undefined) return null;
  if (Array.isArray(x)) return x.map(canonical);
  if (x && typeof x === "object") {
    return Object.fromEntries(
      Object.keys(x as Row)
        .sort()
        .map((k) => [k, canonical((x as Row)[k])]),
    );
  }
  return x;
}
export const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

const isChange = <T>(f: Field<T>): f is { from: T; to: T } =>
  typeof f === "object" && f !== null && !Array.isArray(f) && "from" in (f as object) && "to" in (f as object);
const fromOf = <T>(f: Field<T>): T => (isChange(f) ? f.from : f);
const toOf = <T>(f: Field<T>): T => (isChange(f) ? f.to : f);

type Decision = "same" | "change" | "forced" | "diverged";
function decide(live: unknown, from: unknown, to: unknown, key: string, forced: Set<string>): Decision {
  if (sameValue(live, to)) return "same";
  if (sameValue(live, from)) return "change";
  return forced.has(key) ? "forced" : "diverged";
}

const META_FIELDS = ["sublabel", "swatch", "swatch2", "texture"] as const;
const isObject = (x: unknown): x is Row => Boolean(x) && typeof x === "object" && !Array.isArray(x);

export function planSync(state: LiveState, opts: PlanOptions): Plan {
  const forced = new Set(opts.forceFields ?? []);
  const now = opts.now ?? new Date().toISOString();
  const writes: Write[] = [];
  const diffs: Diff[] = [];
  const notes: string[] = [];
  const touched: Record<string, Row[]> = {};
  const usedForce = new Set<string>();
  const ctx: Ctx = {
    forced,
    now,
    writes,
    notes,
    record: (d) => {
      diffs.push(d);
      if (d.status === "forced") usedForce.add(d.key);
    },
    touch: (table, row) => {
      const list = (touched[table] ??= []);
      if (!list.includes(row)) list.push(row);
    },
  };

  for (const q of QUESTIONS) planQuestion(state, q, ctx);
  planColumnar(state, opts, ctx);
  planOffers(state, opts, ctx);

  // Both depend on sibling packages; until they ship, the data is inert on
  // the storefront and the next Studio save of that field drops it.
  const unknownTextures = syncTextures().filter((t) => !(OPTION_TEXTURES as readonly string[]).includes(t));
  if (unknownTextures.length) {
    notes.push(
      `finish textures ${unknownTextures.join(", ")} are not in OPTION_TEXTURES: the server drops them until the widget package ships, and a Studio save before then removes them (a re-run writes them again)`,
    );
  }
  if (opts.widgetCss !== undefined) notes.push(...widgetTextureNotes(opts.widgetCss));
  const probe = mapRecommendationTuning({ columnar: buildColumnarTarget(opts.handles, false, now) }) as unknown as Row;
  if (!isObject(probe.columnar)) {
    notes.push(
      "mapRecommendationTuning drops recommendation_tuning.columnar in this build: a Studio Matching save erases the spec until the engine package ships (a re-run writes it again)",
    );
  }
  // The new answers go live with the quiz writes; without the columnar
  // engine the old ai_guidance ranks them, and it has no rules for them.
  const liveTuning = state.config && isObject(state.config.recommendation_tuning) ? state.config.recommendation_tuning : {};
  const columnarOn = isObject(liveTuning.columnar) && liveTuning.columnar.enabled === true;
  if (!opts.enableColumnar && !columnarOn && writes.some((w) => w.table.startsWith("recommendation_"))) {
    notes.push(
      "columnar stays disabled: shoppers get the new answers (White, Metallic, Oranges, multi-select Finish) while the old ai_guidance still ranks them. Apply with --enable-columnar once the engine and widget packages are deployed and verified",
    );
  }
  for (const k of forced) {
    if (usedForce.has(k)) continue;
    if (diffs.some((d) => d.key === k && d.status === "held")) {
      const others = diffs.filter((d) => d.key.startsWith("offers.bundle_") && d.status === "diverged").map((d) => d.key);
      notes.push(`--force-field ${k} is held with the rest of the bundle: also force ${others.join(", ")}`);
    } else {
      notes.push(`--force-field ${k} matched no diverged field`);
    }
  }
  return { writes, diffs, notes, touched };
}

/** Fields an apply left skipped that its plan did not: something changed
 * mid-run (a Studio save, say), so "nothing left to write" is not success. */
export function newSkips(before: Plan, after: Plan): Diff[] {
  const skipped = (d: Diff) => d.status === "diverged" || d.status === "held";
  const known = new Set(before.diffs.filter(skipped).map((d) => d.key));
  return after.diffs.filter((d) => skipped(d) && !known.has(d.key));
}

/** Every display_meta texture the sync writes. */
function syncTextures(): string[] {
  const textures = new Set<string>();
  for (const q of QUESTIONS) {
    for (const o of q.options) if (o.texture !== undefined && toOf(o.texture)) textures.add(String(toOf(o.texture)));
  }
  return [...textures];
}

/** Finish textures the sync writes that the widget in this checkout has no
 * nail style for (they render as a plain glossy gradient until it does). */
export function widgetTextureNotes(css: string): string[] {
  // creme is the plain gradient the nail draws by default.
  return syncTextures()
    .filter((t) => t !== "creme" && !css.includes(`.gq-nail--${t}`))
    .map((t) => `widget has no .gq-nail--${t} style: the "${t}" finish draws as a plain glossy nail until the widget package ships it`);
}

interface Ctx {
  forced: Set<string>;
  now: string;
  writes: Write[];
  notes: string[];
  record: (d: Diff) => void;
  touch: (table: string, row: Row) => void;
}

function planQuestion(state: LiveState, q: QuestionSpec, ctx: Ctx) {
  const { forced, now, writes, notes, record, touch } = ctx;
  const axis = state.axes.find((a) => a.key === q.axisKey);
  const question = axis ? state.questions.find((r) => r.axis_id === axis.id) : undefined;
  if (!axis || !question) {
    notes.push(`question ${q.axisKey} not found live: skipped entirely`);
    return;
  }
  const section = `Question ${q.axisKey} ("${question.prompt}")`;
  const values = state.values.filter((r) => r.axis_id === axis.id);
  const valueRowOf = (value: string) => values.find((r) => r.value === value);
  const valueOfId = new Map(values.map((r) => [r.id as string, r.value as string]));
  const options = state.options.filter((r) => r.question_id === question.id);

  // Axis label.
  if (q.axisLabel !== undefined) {
    const key = `${q.axisKey}.axis_label`;
    const d = decide(axis.label, fromOf(q.axisLabel), toOf(q.axisLabel), key, forced);
    if (d !== "same") {
      record({ section, key, what: "axis label", from: fromOf(q.axisLabel), to: toOf(q.axisLabel), live: axis.label, status: d });
      if (d !== "diverged") {
        writes.push({
          op: "update",
          table: "recommendation_axes",
          match: { id: axis.id },
          guard: { label: axis.label },
          set: { label: toOf(q.axisLabel), updated_at: now },
          keys: [key],
        });
        touch("recommendation_axes", axis);
      }
    }
  }

  // Question-level fields, one UPDATE.
  const qSet: Row = {};
  const qGuard: Row = {};
  const qKeys: string[] = [];
  const qFields: Array<[string, Field<unknown> | undefined, string]> = [
    ["helper_text", q.helper, "helper"],
    ["multi_select", q.multiSelect, "multi_select"],
    ["max_selections", q.maxSelections, "max_selections"],
    ["option_style", q.optionStyle, "option_style"],
  ];
  for (const [col, spec, name] of qFields) {
    if (spec === undefined) continue;
    const key = `${q.axisKey}.${name}`;
    const live = col === "multi_select" ? Boolean(question[col]) : question[col];
    const d = decide(live, fromOf(spec), toOf(spec), key, forced);
    if (d === "same") continue;
    record({ section, key, what: name, from: fromOf(spec), to: toOf(spec), live, status: d });
    if (d === "diverged") continue;
    qSet[col] = toOf(spec);
    qGuard[col] = question[col] ?? null;
    qKeys.push(key);
  }
  if (qKeys.length) {
    writes.push({
      op: "update",
      table: "recommendation_questions",
      match: { id: question.id },
      guard: qGuard,
      set: { ...qSet, updated_at: now },
      keys: qKeys,
    });
    touch("recommendation_questions", question);
  }

  // Existing axis value labels.
  for (const [value, spec] of Object.entries(q.valueLabels ?? {})) {
    const row = valueRowOf(value);
    const key = `${q.axisKey}.${value}.value_label`;
    if (!row) {
      notes.push(`${q.axisKey}: axis value ${value} not found live, its label was not changed`);
      continue;
    }
    const d = decide(row.label, fromOf(spec), toOf(spec), key, forced);
    if (d === "same") continue;
    record({ section, key, what: `axis value ${value} label`, from: fromOf(spec), to: toOf(spec), live: row.label, status: d });
    if (d === "diverged") continue;
    writes.push({
      op: "update",
      table: "recommendation_axis_values",
      match: { id: row.id },
      guard: { label: row.label },
      set: { label: toOf(spec) },
      keys: [key],
    });
    touch("recommendation_axis_values", row);
  }

  // Resolve each target option to its live row.
  const resolved: Array<{ spec: OptionSpec; row: Row | null }> = [];
  let ambiguous = false;
  for (const spec of q.options) {
    const m = spec.match;
    const hits = options.filter((o) =>
      "value" in m
        ? valueOfId.get(o.axis_value_id) === m.value && (m.selectAll === undefined || Boolean(o.select_all) === m.selectAll)
        : Boolean(o.select_all),
    );
    if (hits.length > 1) {
      notes.push(`${q.axisKey}: ${hits.length} live options match "${toOf(spec.label)}": left alone, order not changed`);
      ambiguous = true;
      resolved.push({ spec, row: null });
      continue;
    }
    resolved.push({ spec, row: hits[0] ?? null });
  }
  const tracked = new Set(resolved.map((r) => r.row).filter(Boolean));
  for (const o of options) {
    if (!tracked.has(o)) notes.push(`${q.axisKey}: live option "${o.label}" is not in the mockups: left as is`);
  }

  // Order: target position = index. The sync's own writes (and Studio
  // saves, which only renumber what they read) never reverse a pair of
  // options that the Oct 17 order and the target agree on, however a run
  // stopped. So the order is the sync's to finish unless such a pair is
  // reversed, or an option the mockups do not have is in the question:
  // that is the merchant's reorder, never undone silently.
  const targetKeys = q.options.map((s) => s.key);
  const existing = resolved.filter((r): r is { spec: OptionSpec; row: Row } => r.row !== null);
  const existingKeys = new Set(existing.map((r) => r.spec.key));
  const liveOrder = [...existing]
    .sort((a, b) => (Number(a.row.position) || 0) - (Number(b.row.position) || 0) || String(a.row.id).localeCompare(String(b.row.id)))
    .map((r) => r.spec.key);
  const willInsert = resolved.some((r) => !r.row && r.spec.isNew);
  const expectedExisting = q.liveOrder.filter((k) => existingKeys.has(k));
  const inPlace = existing.every((r) => Number(r.row.position) === targetKeys.indexOf(r.spec.key));
  const untracked = options.some((o) => !tracked.has(o));
  const orderKey = `${q.axisKey}.order`;
  let renumber = false;
  if (!ambiguous && (!inPlace || willInsert)) {
    const liveLabel = new Map(existing.map((r) => [r.spec.key, String(r.row.label).trim()]));
    const targetLabel = (k: string) => String(toOf(q.options.find((s) => s.key === k)!.label));
    const labelOf = (k: string) => liveLabel.get(k) ?? targetLabel(k);
    const consistent =
      !untracked &&
      orderConsistent(
        existing.map((r) => ({ key: r.spec.key, position: Number(r.row.position) || 0 })),
        (k) => q.liveOrder.indexOf(k),
        (k) => targetKeys.indexOf(k),
      );
    const status: Decision = consistent ? "change" : forced.has(orderKey) ? "forced" : "diverged";
    record({
      section,
      key: orderKey,
      what: "order",
      from: expectedExisting.map(labelOf),
      to: targetKeys.map(targetLabel),
      live: liveOrder.map(labelOf),
      status,
    });
    renumber = status !== "diverged";
  }

  // Write order: the select-all moves to its final slot first and new
  // options land last, so a run that stops part way never strands
  // "Surprise me" between new colors.
  const selectAllUpdates: Write[] = [];
  const updates: Write[] = [];
  const inserts: Write[] = [];
  resolved.forEach(({ spec, row }, index) => {
    const keyBase = `${q.axisKey}.${spec.key}`;
    if (!row) {
      if (spec.isNew && !ambiguous) planNewOption(q, spec, index, axis, question, values, section, ctx, inserts);
      else if (!ambiguous) notes.push(`${q.axisKey}: option "${toOf(spec.label)}" (${spec.key}) is missing live: not re-created`);
      return;
    }

    const set: Row = {};
    const guard: Row = {};
    const keys: string[] = [];
    const name = `${spec.key} "${String(row.label).trim()}"`;
    const labelKey = `${keyBase}.label`;
    const label = decide(row.label, fromOf(spec.label), toOf(spec.label), labelKey, forced);
    if (label !== "same") {
      record({
        section,
        key: labelKey,
        what: `${name} label`,
        from: fromOf(spec.label),
        to: toOf(spec.label),
        live: row.label,
        status: label,
      });
      if (label !== "diverged") {
        set.label = toOf(spec.label);
        guard.label = row.label;
        keys.push(labelKey);
      }
    }
    if (spec.selectAll !== undefined) {
      const key = `${keyBase}.select_all`;
      const d = decide(Boolean(row.select_all), fromOf(spec.selectAll), toOf(spec.selectAll), key, forced);
      if (d !== "same") {
        record({
          section,
          key,
          what: `${name} select_all`,
          from: fromOf(spec.selectAll),
          to: toOf(spec.selectAll),
          live: Boolean(row.select_all),
          status: d,
        });
        if (d !== "diverged") {
          set.select_all = toOf(spec.selectAll);
          guard.select_all = row.select_all ?? null;
          keys.push(key);
        }
      }
    }
    const liveMeta = isObject(row.display_meta) ? row.display_meta : null;
    const metaPatch: Row = {};
    for (const f of META_FIELDS) {
      const specF = spec[f];
      if (specF === undefined) continue;
      const key = `${keyBase}.${f}`;
      const d = decide(liveMeta?.[f], fromOf(specF), toOf(specF), key, forced);
      if (d === "same") continue;
      record({ section, key, what: `${name} ${f}`, from: fromOf(specF), to: toOf(specF), live: liveMeta?.[f] ?? null, status: d });
      if (d === "diverged") continue;
      metaPatch[f] = toOf(specF);
      keys.push(key);
    }
    if (Object.keys(metaPatch).length) {
      // Merge: keys the sync does not own stay exactly as they are.
      set.display_meta = { ...(liveMeta ?? {}), ...metaPatch };
    }
    if (renumber && Number(row.position) !== index) {
      set.position = index;
      guard.position = row.position ?? null;
      keys.push(orderKey);
    }
    if (Object.keys(set).length) {
      const w: Write = { op: "update", table: "recommendation_question_options", match: { id: row.id }, guard, set, keys };
      (spec.key === "select_all" ? selectAllUpdates : updates).push(w);
      touch("recommendation_question_options", row);
    }
  });
  writes.push(...selectAllUpdates, ...updates, ...inserts);
}

/** False when the live positions put option a strictly before option b
 * while every reference order puts b first: the Oct 17 order and the target
 * when both have the pair, the target alone for an option the sync adds.
 * Pairs the two orders disagree on may sit either way, and tied positions
 * (a Studio save breaks them by row id) say nothing. */
export function orderConsistent(
  rows: Array<{ key: string; position: number }>,
  oldSlot: (k: string) => number,
  newSlot: (k: string) => number,
): boolean {
  for (const a of rows) {
    for (const b of rows) {
      if (!(a.position < b.position)) continue;
      const targetFlips = newSlot(b.key) < newSlot(a.key);
      const oldA = oldSlot(a.key);
      const oldB = oldSlot(b.key);
      const oldFlips = oldA < 0 || oldB < 0 ? targetFlips : oldB < oldA;
      if (targetFlips && oldFlips) return false;
    }
  }
  return true;
}

function planNewOption(
  q: QuestionSpec,
  spec: OptionSpec,
  index: number,
  axis: Row,
  question: Row,
  values: Row[],
  section: string,
  ctx: Ctx,
  out: Write[],
) {
  const { forced, record, touch } = ctx;
  const value = (spec.match as { value: string }).value;
  const keyBase = `${q.axisKey}.${spec.key}`;
  const label = toOf(spec.label);
  const valueRow = values.find((r) => r.value === value);
  const valueRef = `value:${keyBase}`;
  if (!valueRow) {
    const pending = out.filter((w) => w.op === "insert" && w.table === "recommendation_axis_values").length;
    const position = values.reduce((m, r) => Math.max(m, Number(r.position) || 0), -1) + 1 + pending;
    out.push({
      op: "insert",
      table: "recommendation_axis_values",
      ref: valueRef,
      row: { axis_id: axis.id, value, label, position },
      keys: [`${keyBase}.value`],
    });
    record({ section, key: `${keyBase}.value`, what: `new axis value ${value}`, to: label, status: "insert" });
    touch("recommendation_axes", axis);
  } else {
    // A value left over from an earlier, partial run: reuse it.
    const key = `${keyBase}.value_label`;
    const d = decide(valueRow.label, null, label, key, forced);
    if (d !== "same") {
      record({ section, key, what: `axis value ${value} label`, from: null, to: label, live: valueRow.label, status: d });
      if (d !== "diverged") {
        out.push({
          op: "update",
          table: "recommendation_axis_values",
          match: { id: valueRow.id },
          guard: { label: valueRow.label },
          set: { label },
          keys: [key],
        });
        touch("recommendation_axis_values", valueRow);
      }
    }
  }
  const meta: Row = {};
  for (const f of META_FIELDS) {
    const val = spec[f] === undefined ? null : toOf(spec[f]!);
    if (val != null) meta[f] = val;
  }
  out.push({
    op: "insert",
    table: "recommendation_question_options",
    ref: `option:${keyBase}`,
    row: {
      question_id: question.id,
      label,
      ...(valueRow ? { axis_value_id: valueRow.id } : {}),
      position: index,
      select_all: false,
      display_meta: Object.keys(meta).length ? meta : null,
    },
    ...(valueRow ? {} : { refs: { axis_value_id: valueRef } }),
    keys: [`${keyBase}.option`],
  });
  record({ section, key: `${keyBase}.option`, what: `new option at position ${index}`, to: { label, ...meta }, status: "insert" });
  touch("recommendation_questions", question);
}

function planColumnar(state: LiveState, opts: PlanOptions, ctx: Ctx) {
  const { forced, now, writes, notes, record, touch } = ctx;
  const section = "recommendation_tuning.columnar";
  if (!state.config) {
    notes.push("chat_assistant_config row not found: columnar spec not written");
    return;
  }
  const tuning: Row = isObject(state.config.recommendation_tuning) ? state.config.recommendation_tuning : {};
  const live = isObject(tuning.columnar) ? tuning.columnar : null;
  const target = buildColumnarTarget(opts.handles, Boolean(opts.enableColumnar), now);

  let next: Row | null = null;
  const keys: string[] = [];
  if (!live) {
    next = target as unknown as Row;
    keys.push("columnar");
    record({ section, key: "columnar", what: "columnar spec", from: null, to: summarizeColumnar(target), status: "insert" });
  } else {
    const patch: Row = {};
    for (const [k, to] of Object.entries(target)) {
      const key = `columnar.${k}`;
      if (k === "enabled") {
        // Only --enable-columnar turns it on; a re-run never turns it off.
        if (opts.enableColumnar && live.enabled !== true) {
          record({ section, key, what: "enabled", from: live.enabled ?? null, to: true, live: live.enabled ?? null, status: "change" });
          patch.enabled = true;
          keys.push(key);
        }
        continue;
      }
      if (k === "pool") {
        // syncedAt is a stamp, not content: same handles = same pool.
        const lp = isObject(live.pool) ? live.pool : null;
        const tp = to as ColumnarSpec["pool"];
        const content = (p: Row | null) =>
          p ? { collectionHandle: p.collectionHandle ?? null, handles: p.handles ?? null, source: p.source ?? null } : null;
        const d = decide(content(lp), null, content(tp), key, forced);
        if (d === "same") continue;
        const count = (p: Row) => (Array.isArray(p.handles) ? p.handles.length : 0);
        record({
          section,
          key,
          what: "pool",
          from: null,
          to: `${tp.handles.length} handles from ${tp.source} (${tp.collectionHandle})`,
          live: lp ? `${count(lp)} handles from ${lp.source} (${lp.collectionHandle})` : null,
          status: d,
        });
        if (d !== "diverged") {
          patch.pool = tp;
          keys.push(key);
        }
        continue;
      }
      const d = decide(live[k], null, to, key, forced);
      if (d === "same") continue;
      record({ section, key, what: k, from: null, to, live: live[k] ?? null, status: d });
      if (d === "diverged") continue;
      patch[k] = to;
      keys.push(key);
    }
    if (keys.length) next = { ...live, ...patch };
  }
  if (!next) return;
  writes.push({
    op: "update",
    table: "chat_assistant_config",
    match: { id: state.config.id },
    guard: { updated_at: state.config.updated_at ?? null },
    // Every other tuning key rides along untouched.
    set: { recommendation_tuning: { ...tuning, columnar: next }, updated_at: now },
    keys,
  });
  touch("chat_assistant_config", state.config);
}

function summarizeColumnar(s: ColumnarSpec): string {
  const axes = Object.entries(s.axes)
    .map(([k, a]) => `${k}=${a.role}(${Object.keys(a.values).length})`)
    .join(" ");
  return (
    `enabled ${s.enabled}, version ${s.version}, pool ${s.pool.handles.length} handles from ${s.pool.source} ` +
    `(${s.pool.collectionHandle}), threshold ${s.threshold}, candidates ${s.candidateCount}, results ${s.resultCount}, ` +
    `also matched ${s.alsoMatchedCount}, weights color ${s.weights.color} / drama ${s.weights.drama} / vibe ${s.weights.vibe}, ` +
    `axes ${axes}, vibes ${Object.keys(s.vibes).join("/")} on, holiday [${s.holidayCollections.join(", ")}], ` +
    `llm ${s.llm.enabled ? "on" : "off"} ${s.llm.timeoutMs}ms`
  );
}

function planOffers(state: LiveState, opts: PlanOptions, ctx: Ctx) {
  const { forced, now, writes, notes, record, touch } = ctx;
  const section = "quiz_offers";
  const row = state.offers;
  const handles = [
    CROSS_SELL_HANDLES.glue,
    opts.prepKitHandle || CROSS_SELL_HANDLES.prepStandIn,
    CROSS_SELL_HANDLES.tabs,
    CROSS_SELL_HANDLES.pen,
  ];
  if (!opts.prepKitHandle) {
    notes.push(
      '"Prep Kit" slot keeps Press-On Nail Remover (the v2 "Prep & Remove Kit" stand-in): no catalog accessory is a file / buffer / cuticle kit. Swap it with --prep-kit=<handle> once Lisa names one',
    );
  }

  const patch: Record<string, unknown> = {};
  const keys: string[] = [];
  type Pending = { col: string; patchKey: keyof OffersPatch; from: unknown; to: unknown; live: unknown; d: Exclude<Decision, "same"> };
  const check = (col: string, patchKey: keyof OffersPatch, spec: Field<unknown>): Pending | null => {
    const live = row ? row[col] : null;
    const d = decide(live, fromOf(spec), toOf(spec), `offers.${col}`, forced);
    return d === "same" ? null : { col, patchKey, from: fromOf(spec), to: toOf(spec), live: live ?? null, d };
  };
  const take = (p: Pending | null, held = false) => {
    if (!p) return;
    const key = `offers.${p.col}`;
    const status: DiffStatus = held && p.d !== "diverged" ? "held" : p.d;
    record({ section, key, what: p.col, from: p.from, to: p.to, live: p.live, status });
    if (status === "change" || status === "forced") {
      patch[p.patchKey] = p.to;
      keys.push(key);
    }
  };

  take(check("cross_sell_enabled", "crossSellEnabled", true));
  take(check("cross_sell_source", "crossSellSource", "manual"));
  take(check("cross_sell_title", "crossSellTitle", "Finish the look"));
  take(check("cross_sell_subtext", "crossSellSubtext", "Everything your sets need to last"));
  take(check("cross_sell_max", "crossSellMax", chg(3, 4)));

  // Items compare by handle, in order. Kept items are reused as stored; a
  // new one is built from its catalog row.
  const liveItems: Row[] = row && Array.isArray(row.cross_sell_items) ? row.cross_sell_items : [];
  const liveHandles = liveItems.map((i) => i?.handle);
  // Every new slot must resolve before anything is planned: a typo'd
  // --prep-kit must stop the run, not shrink the list and drop a live item.
  for (const handle of handles) {
    if (liveItems.some((i) => i?.handle === handle)) continue;
    const p = state.products.find((r) => r.handle === handle);
    if (!p || !numericShopifyId(p.shopify_id) || (p.status != null && p.status !== "active")) {
      throw new Error(`cross-sell ${handle} is not an active Glamnetic product: nothing written`);
    }
  }
  const itemsKey = "offers.cross_sell_items";
  const d = decide(liveHandles, CROSS_SELL_LIVE, handles, itemsKey, forced);
  if (d !== "same") {
    record({ section, key: itemsKey, what: "cross_sell_items", from: CROSS_SELL_LIVE, to: handles, live: liveHandles, status: d });
    if (d !== "diverged") {
      const items: Row[] = [];
      for (const handle of handles) {
        const kept = liveItems.find((i) => i?.handle === handle);
        if (kept) {
          items.push(kept);
          continue;
        }
        // Resolved above; the guard only narrows the types.
        const p = state.products.find((r) => r.handle === handle);
        const productId = p ? numericShopifyId(p.shopify_id) : null;
        if (!p || !productId) continue;
        items.push({
          productId,
          handle,
          title: p.product_name || handle,
          imageUrl: typeof p.image_url === "string" && p.image_url.startsWith("https://") ? p.image_url : null,
          when: null,
        });
      }
      for (const i of liveItems.filter((i) => !handles.includes(i?.handle))) {
        notes.push(`cross-sell "${i?.title ?? i?.handle}" leaves "Finish the look" (kept in the backup file)`);
      }
      patch.crossSellItems = items;
      keys.push(itemsKey);
    }
  }

  // The bundle fields feed one Shopify discount, so they move together: if
  // any of them was edited since Oct 17 (say, a managed discount), none is
  // changed.
  const bundle = [
    check("bundle_discount_mode", "bundleDiscountMode", chg("off", "code")),
    check("bundle_discount_type", "bundleDiscountType", "percentage"),
    check("bundle_discount_value", "bundleDiscountValue", chg(null, 15)),
    check("bundle_discount_min_qty", "bundleDiscountMinQty", chg(null, 2)),
    check("bundle_discount_once_per_customer", "bundleDiscountOncePerCustomer", chg(false, true)),
    ...(opts.bundleCode ? [check("bundle_discount_code", "bundleDiscountCode", chg(null, opts.bundleCode))] : []),
  ];
  const held = bundle.some((p) => p?.d === "diverged");
  for (const p of bundle) take(p, held);
  if (held) {
    notes.push("bundle discount was edited since Oct 17: no bundle field changed (force every diverged one to override)");
  } else if (!opts.bundleCode && !row?.bundle_discount_code) {
    notes.push("bundle discount stays off for shoppers until its Shopify code is set (--bundle-code=<CODE>, or Studio > Sell more)");
  }

  if (!keys.length) return;
  // quiz_offers is its own table, outside the quiz version snapshot.
  notes.push("version history does not cover quiz_offers: to undo, put these columns back from rows.quiz_offers in the backup file");
  const valid = validateOffersPatch(patch);
  if (!valid.ok) throw new Error(`offers patch rejected: ${valid.error}`);
  const cols = offersPatchToRow(valid.patch);
  if (row) {
    writes.push({
      op: "update",
      table: "quiz_offers",
      match: { shop_id: state.shop.id },
      guard: { updated_at: row.updated_at ?? null },
      set: { ...cols, updated_at: now },
      keys,
    });
    touch("quiz_offers", row);
  } else {
    writes.push({ op: "insert", table: "quiz_offers", ref: "offers", row: { shop_id: state.shop.id, ...cols, updated_at: now }, keys });
  }
}

// ---------------------------------------------------------------------
// Pool CSV
// ---------------------------------------------------------------------

/** RFC 4180 rows (quoted fields, doubled quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
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

const HANDLE_RE = /^[a-z0-9][a-z0-9_-]{0,254}$/;

function validHandles(list: unknown[], what: string): string[] {
  const seen = new Set<string>();
  for (const raw of list) {
    const h = typeof raw === "string" ? raw.trim() : "";
    if (!HANDLE_RE.test(h)) throw new Error(`${what}: bad handle "${String(raw)}"`);
    if (seen.has(h)) throw new Error(`${what}: duplicate handle "${h}"`);
    seen.add(h);
  }
  if (seen.size === 0) throw new Error(`${what}: no handles`);
  return [...seen];
}

/** The handle column of a pool CSV export (Aaron's attribute CSV, or a
 * Shopify product export, which repeats the handle on image rows). */
export function parsePoolHandles(csv: string): string[] {
  const [header, ...rows] = parseCsv(csv);
  const col = (header ?? []).map((h) => h.trim().toLowerCase()).indexOf("handle");
  if (col < 0) throw new Error("pool CSV has no handle column");
  return validHandles([...new Set(rows.map((r) => (r[col] ?? "").trim()))], "pool CSV");
}

/** The committed Oct 17 snapshot (scripts/brand-configs/glamnetic-pool-v3-handles.json),
 * the handle column of the v3 attribute CSV in file order. */
export function parsePoolSnapshot(json: string): string[] {
  const data = JSON.parse(json) as { collectionHandle?: unknown; handles?: unknown };
  if (data.collectionHandle !== POOL_COLLECTION_HANDLE) throw new Error(`pool snapshot is for ${String(data.collectionHandle)}`);
  return validHandles(Array.isArray(data.handles) ? data.handles : [], "pool snapshot");
}

// ---------------------------------------------------------------------
// Diff output
// ---------------------------------------------------------------------

const show = (x: unknown): string => {
  if (x === null || x === undefined) return "(none)";
  if (typeof x === "string") return JSON.stringify(x);
  if (Array.isArray(x)) return x.map((i) => (typeof i === "string" ? i : JSON.stringify(i))).join(", ");
  return JSON.stringify(x);
};

export function formatPlan(plan: Plan, opts: { apply: boolean }): string {
  const lines: string[] = [`Glamnetic v3 mockup sync: ${SHOP_DOMAIN} (shop ${SHOP_ID})`];
  lines.push(
    opts.apply
      ? "APPLY: writes below run after a backup file and a version snapshot."
      : "DRY RUN: nothing is written. Pass --apply to write.",
  );
  let section = "";
  for (const d of plan.diffs) {
    if (d.section !== section) {
      section = d.section;
      lines.push("", section);
    }
    if (d.status === "insert") {
      lines.push(`  + ${d.what}: ${show(d.to)}`);
    } else if (d.status === "diverged") {
      lines.push(`  ! ${d.what}: live ${show(d.live)}, expected ${show(d.from)}, target ${show(d.to)}`);
      lines.push(`      SKIPPED: edited since Oct 17. Overwrite with --force-field=${d.key}`);
    } else if (d.status === "held") {
      lines.push(`  ! ${d.what}: ${show(d.live)} -> ${show(d.to)}  SKIPPED with the rest of the bundle (see notes)`);
    } else if (d.what === "order") {
      lines.push(`  ~ order: ${show(d.live)}`);
      lines.push(`       -> ${show(d.to)}`);
    } else {
      const forced = d.status === "forced" ? `  (forced over a merchant edit; Oct 17 value ${show(d.from)})` : "";
      lines.push(`  ~ ${d.what}: ${show(d.live ?? d.from)} -> ${show(d.to)}${forced}`);
    }
  }
  if (plan.notes.length) {
    lines.push("", "Notes");
    for (const n of plan.notes) lines.push(`  - ${n}`);
  }
  const count = (op: Write["op"], noun: string) => {
    const ws = plan.writes.filter((w) => w.op === op);
    const byTable = ws.reduce<Record<string, number>>((m, w) => ((m[w.table] = (m[w.table] ?? 0) + 1), m), {});
    const detail = Object.entries(byTable)
      .map(([t, n]) => `${t} ${n}`)
      .join(", ");
    return `${ws.length} ${noun}${detail ? ` (${detail})` : ""}`;
  };
  const skipped = plan.diffs.filter((d) => d.status === "diverged" || d.status === "held").length;
  lines.push("", `Writes: ${count("update", "row updates")}; ${count("insert", "inserts")}; 0 deletes. Skipped fields: ${skipped}.`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------

export interface ApplyDeps {
  db: Db;
  /** Forced, labeled version-history snapshot (quiz-draft.server). */
  snapshot: (label: string) => Promise<{ ok: boolean; error?: string }>;
  /** Snapshot label; SNAPSHOT_LABEL unless this is a re-run. */
  label?: string;
  /** Persists the backup JSON and returns where it went. */
  writeBackup: (data: unknown) => string;
  log?: (line: string) => void;
}

export type ApplyResult =
  | { ok: true; written: number; backupPath: string | null }
  | { ok: false; written: number; backupPath: string | null; error: string };

export async function applyPlan(plan: Plan, deps: ApplyDeps): Promise<ApplyResult> {
  const log = deps.log ?? (() => {});
  const label = deps.label ?? SNAPSHOT_LABEL;
  if (plan.writes.length === 0) return { ok: true, written: 0, backupPath: null };

  // 1. Backup of every row the writes touch, before anything else.
  let backupPath: string;
  try {
    backupPath = deps.writeBackup({
      label,
      shopDomain: SHOP_DOMAIN,
      shopId: SHOP_ID,
      createdAt: new Date().toISOString(),
      rows: plan.touched,
      writes: plan.writes,
    });
  } catch (e) {
    return { ok: false, written: 0, backupPath: null, error: `backup failed, nothing written: ${(e as Error).message}` };
  }
  log(`backup: ${backupPath}`);

  // 2. Version-history restore point. No snapshot, no write.
  const snap = await deps.snapshot(label);
  if (!snap.ok) return { ok: false, written: 0, backupPath, error: `snapshot failed, nothing written: ${snap.error ?? "unknown"}` };
  log(`version snapshot: "${label}"`);

  // 3. Writes in plan order (axis values before the options naming them).
  const newIds = new Map<string, string>();
  let written = 0;
  for (const w of plan.writes) {
    if (w.op === "insert") {
      const row = { ...w.row };
      for (const [col, ref] of Object.entries(w.refs ?? {})) {
        const id = newIds.get(ref);
        if (!id) return { ok: false, written, backupPath, error: `insert ${w.ref}: ${ref} was not created` };
        row[col] = id;
      }
      const { data, error } = await deps.db.from(w.table).insert(row).select("*");
      if (error || !Array.isArray(data) || data.length !== 1) {
        return {
          ok: false,
          written,
          backupPath,
          error: `insert into ${w.table} (${w.keys.join(", ")}) failed: ${error?.message ?? "no row"}`,
        };
      }
      if (data[0]?.id) newIds.set(w.ref, data[0].id);
      written++;
      log(`insert ${w.table}: ${w.keys.join(", ")}`);
      continue;
    }
    let query = deps.db.from(w.table).update(w.set);
    for (const [col, val] of Object.entries(w.match)) query = query.eq(col, val);
    // Compare-and-set on every changed scalar. jsonb is not compared: the
    // row id already changes on any Studio save of the quiz.
    for (const [col, val] of Object.entries(w.guard)) {
      if (val === null || val === undefined) query = query.is(col, null);
      else if (typeof val !== "object") query = query.eq(col, val);
    }
    const { data, error } = await query.select("*");
    if (error) return { ok: false, written, backupPath, error: `update ${w.table} (${w.keys.join(", ")}) failed: ${error.message}` };
    // An UPDATE that matches 0 rows still "succeeds": treat it as a
    // concurrent edit and stop.
    if (!Array.isArray(data) || data.length !== 1) {
      const n = Array.isArray(data) ? data.length : 0;
      return {
        ok: false,
        written,
        backupPath,
        error: `update ${w.table} (${w.keys.join(", ")}) matched ${n} rows: the row changed since it was read. Re-run to re-plan.`,
      };
    }
    written++;
    log(`update ${w.table}: ${w.keys.join(", ")}`);
  }
  return { ok: true, written, backupPath };
}
