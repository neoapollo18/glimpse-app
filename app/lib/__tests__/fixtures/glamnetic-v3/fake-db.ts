// In-memory stand-in for the slice of supabase-js the Glamnetic v3 sync
// uses (scripts/glamnetic-v3-sync-plan.ts), seeded from the Oct 17 live
// fixtures in this folder. Every call that writes is logged in order;
// delete, upsert and rpc are logged and throw, so a test can prove the
// sync never reaches them.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type Row = Record<string, any>;
export interface Op {
  op: string;
  table?: string;
  ids?: string[];
  row?: Row;
  set?: Row;
  label?: string;
}

const JSONB = new Set(["display_meta", "show_if", "recommendation_tuning", "cross_sell_items"]);

// Postgres jsonb does not keep key order (shorter keys first, then
// bytewise); the fake reorders the same way so key-order bugs surface.
function jsonbOrder(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(jsonbOrder);
  if (x && typeof x === "object") {
    const keys = Object.keys(x as Row).sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(keys.map((k) => [k, jsonbOrder((x as Row)[k])]));
  }
  return x;
}
const clone = <T>(x: T): T => (x === undefined ? x : JSON.parse(JSON.stringify(x)));
const stored = (row: Row): Row =>
  Object.fromEntries(Object.entries(row).map(([k, v]) => [k, JSONB.has(k) ? jsonbOrder(clone(v)) : clone(v)]));

/** Seeded PRNG (mulberry32), so a failing seed reproduces. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** uuid-looking ids in random order, like Postgres gen_random_uuid(): a
 * tie on position then sorts by an id that says nothing about the row. */
export function uuidSource(seed: number): () => string {
  const next = rng(seed);
  const hex = (n: number) => Array.from({ length: n }, () => Math.floor(next() * 16).toString(16)).join("");
  return () => `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`;
}

export interface FakeDb {
  from(table: string): any;
  rpc(name: string): never;
  tables: Record<string, Row[]>;
  log: Op[];
  /** Writes (update / insert) allowed before every further one fails, as
   * when a run is killed or a Studio save swaps the rows. null = no limit. */
  stopAfter: number | null;
}

export function createFakeDb(seed: Record<string, Row[]>, opts: { idSeed?: number } = {}): FakeDb {
  const tables: Record<string, Row[]> = Object.fromEntries(Object.entries(seed).map(([t, rows]) => [t, rows.map(stored)]));
  const log: Op[] = [];
  let seq = 0;
  let writes = 0;
  // A different stream from the seed rows' ids, same seed.
  const uuid = opts.idSeed === undefined ? null : uuidSource(opts.idSeed + 7919);
  const newId = (table: string) => (uuid ? uuid() : `${table}-new-${++seq}`);

  class Query {
    private filters: Array<(r: Row) => boolean> = [];
    private mode: "select" | "update" | "insert" = "select";
    private patch: Row = {};
    private inserts: Row[] = [];
    constructor(private table: string) {}
    select() {
      return this;
    }
    eq(col: string, val: unknown) {
      this.filters.push((r) => r[col] !== null && r[col] !== undefined && String(r[col]) === String(val));
      return this;
    }
    is(col: string, val: null) {
      this.filters.push((r) => (r[col] ?? null) === val);
      return this;
    }
    in(col: string, vals: unknown[]) {
      this.filters.push((r) => vals.includes(r[col]));
      return this;
    }
    update(patch: Row) {
      this.mode = "update";
      this.patch = patch;
      return this;
    }
    insert(rows: Row | Row[]) {
      this.mode = "insert";
      this.inserts = Array.isArray(rows) ? rows : [rows];
      return this;
    }
    delete(): never {
      log.push({ op: "delete", table: this.table });
      throw new Error(`fake db: delete on ${this.table}`);
    }
    upsert(): never {
      log.push({ op: "upsert", table: this.table });
      throw new Error(`fake db: upsert on ${this.table}`);
    }
    private run(): { data: Row[]; error: null } | { data: null; error: { message: string } } {
      const rows = (tables[this.table] ??= []);
      if (this.mode !== "select") {
        if (db.stopAfter !== null && writes >= db.stopAfter) return { data: null, error: { message: "fake db: stopped" } };
        writes++;
      }
      if (this.mode === "insert") {
        const out = this.inserts.map((r) => {
          const row = stored({ id: newId(this.table), ...r });
          rows.push(row);
          log.push({ op: "insert", table: this.table, row: clone(r) });
          return clone(row);
        });
        return { data: out, error: null };
      }
      const hits = rows.filter((r) => this.filters.every((f) => f(r)));
      if (this.mode === "update") {
        for (const r of hits) Object.assign(r, stored(this.patch));
        log.push({ op: "update", table: this.table, ids: hits.map((r) => r.id ?? r.shop_id), set: clone(this.patch) });
      }
      return { data: hits.map(clone), error: null };
    }
    async maybeSingle() {
      const res = this.run();
      if (!res.data) return res;
      if (res.data.length > 1) return { data: null, error: { message: "multiple rows" } };
      return { data: res.data[0] ?? null, error: null };
    }
    async single() {
      const res = this.run();
      if (!res.data) return res;
      return res.data.length === 1 ? { data: res.data[0], error: null } : { data: null, error: { message: `${res.data.length} rows` } };
    }
    then<A, B>(resolve: (v: ReturnType<Query["run"]>) => A, reject?: (e: unknown) => B) {
      return Promise.resolve()
        .then(() => this.run())
        .then(resolve, reject);
    }
  }

  const db: FakeDb = {
    tables,
    log,
    stopAfter: null,
    from: (table: string) => new Query(table),
    rpc: (name: string): never => {
      log.push({ op: "rpc", label: name });
      throw new Error(`fake db: rpc ${name}`);
    },
  };
  return db;
}

/** What a Studio save does to the quiz tables (save_recommendation_config
 * wipes and re-inserts them): every row gets a new id, options and values
 * are renumbered 0..n in the order the editor showed them (position, ties
 * in whatever order the read returned), and display_meta textures the
 * editor does not know are dropped (mapDisplayMeta). */
export function studioResave(tables: Record<string, Row[]>, seed: number, keepTexture: (t: string) => boolean) {
  const next = uuidSource(seed);
  const shuffle = rng(seed + 1);
  const ids = new Map<string, string>();
  const renew = (id: string) => {
    const fresh = next();
    ids.set(id, fresh);
    return fresh;
  };
  const renumber = (rows: Row[], parent: string) => {
    const groups = new Map<string, Row[]>();
    for (const r of rows) groups.set(r[parent], [...(groups.get(r[parent]) ?? []), r]);
    for (const group of groups.values()) {
      const tie = new Map(group.map((r) => [r, shuffle()]));
      group
        .sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0) || tie.get(a)! - tie.get(b)!)
        .forEach((r, i) => (r.position = i));
    }
  };
  for (const a of tables.recommendation_axes) a.id = renew(a.id);
  for (const v of tables.recommendation_axis_values) {
    v.id = renew(v.id);
    v.axis_id = ids.get(v.axis_id);
  }
  for (const q of tables.recommendation_questions) {
    q.id = renew(q.id);
    q.axis_id = ids.get(q.axis_id);
  }
  for (const o of tables.recommendation_question_options) {
    o.id = next();
    o.question_id = ids.get(o.question_id);
    o.axis_value_id = ids.get(o.axis_value_id) ?? null;
    const meta = o.display_meta;
    if (meta && typeof meta.texture === "string" && !keepTexture(meta.texture)) {
      const { texture: _dropped, ...rest } = meta;
      o.display_meta = Object.keys(rest).length ? rest : null;
    }
  }
  renumber(tables.recommendation_axis_values, "axis_id");
  renumber(tables.recommendation_question_options, "question_id");
}

// ---- Seed: Glamnetic as live on Oct 17 ---------------------------------

const DIR = path.dirname(fileURLToPath(import.meta.url));
const read = (name: string) => JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8"));
export const GLAM_SHOP_ID = "8121d154-2019-490f-9343-7bddbc1a64be";

/** Live tables rebuilt from the storefront payload (recommendation-config-live.json),
 * the chat_assistant_config row and the quiz_offers row. Row ids are
 * synthetic (readable, or uuid-looking with idSeed); positions follow the
 * served order. */
export function glamnetic1017Tables(opts: { idSeed?: number } = {}): Record<string, Row[]> {
  const uuid = opts.idSeed === undefined ? null : uuidSource(opts.idSeed);
  const id = (readable: string) => (uuid ? uuid() : readable);
  const flow = read("recommendation-config-live.json");
  const config = read("chat-assistant-config.json");
  const offers = read("quiz-offers.json");
  const products = read("accessory-products.json") as Row[];
  const axes: Row[] = [];
  const values: Row[] = [];
  const questions: Row[] = [];
  const options: Row[] = [];
  flow.questions.forEach((q: Row, i: number) => {
    const axisId = id(`axis-${q.axisKey}`);
    axes.push({
      id: axisId,
      shop_id: GLAM_SHOP_ID,
      key: q.axisKey,
      label: q.axisLabel,
      source: "user_question",
      position: i,
      updated_at: "2026-10-17T19:00:00+00:00",
    });
    const valueIds = new Map<string, string>();
    const addValue = (value: string, label: string) => {
      if (valueIds.has(value)) return;
      const valueId = id(`value-${q.axisKey}-${value}`);
      valueIds.set(value, valueId);
      values.push({ id: valueId, axis_id: axisId, value, label, position: valueIds.size - 1, swatch_color: null });
    };
    for (const o of q.options) if (!o.selectAll) addValue(o.axisValue, o.label);
    for (const o of q.options) addValue(o.axisValue, o.label);
    // Values the Oct 12 build asked and the live quiz no longer shows: the
    // Studio keeps unused axis values, and the sync must leave them be.
    if (q.axisKey === "color_family") {
      addValue("metallics_shimmer", "Metallics & shimmer");
      addValue("french_white", "Classic french & white");
    }
    const questionId = id(`question-${q.axisKey}`);
    questions.push({
      id: questionId,
      axis_id: axisId,
      prompt: q.prompt,
      helper_text: q.helperText,
      multi_select: q.multiSelect,
      max_selections: q.maxSelections,
      screen_group: q.screenGroup,
      show_if: q.showIf,
      option_style: q.optionStyle,
      updated_at: "2026-10-17T19:00:00+00:00",
    });
    q.options.forEach((o: Row, j: number) => {
      options.push({
        id: id(`option-${q.axisKey}-${j}`),
        question_id: questionId,
        label: o.label,
        axis_value_id: valueIds.get(o.axisValue),
        bot_response: o.botResponse,
        position: j,
        reason_text: o.reasonText,
        image_url: o.imageUrl,
        show_if: o.showIf,
        select_all: o.selectAll,
        display_meta: o.displayMeta,
      });
    });
  });
  return {
    shops: [{ id: GLAM_SHOP_ID, shop_domain: "glamrco.myshopify.com" }],
    recommendation_axes: axes,
    recommendation_axis_values: values,
    recommendation_questions: questions,
    recommendation_question_options: options,
    chat_assistant_config: [config],
    quiz_offers: [offers],
    products: products.map((p) => ({ ...p, shop_id: GLAM_SHOP_ID, image_url: null })),
  };
}

/** The storefront shape of the fake's quiz tables (as getRecommendationFlow
 * serves it), for asserting what shoppers would see. */
export function servedQuestions(tables: Record<string, Row[]>): Row[] {
  const valueOf = new Map(tables.recommendation_axis_values.map((v) => [v.id, v.value]));
  return [...tables.recommendation_axes]
    .sort((a, b) => a.position - b.position)
    .map((axis) => {
      const q = tables.recommendation_questions.find((r) => r.axis_id === axis.id)!;
      return {
        axisKey: axis.key,
        axisLabel: axis.label,
        prompt: q.prompt,
        helperText: q.helper_text ?? null,
        multiSelect: Boolean(q.multi_select),
        maxSelections: q.max_selections ?? null,
        screenGroup: q.screen_group ?? null,
        showIf: q.show_if ?? null,
        optionStyle: q.option_style ?? null,
        options: tables.recommendation_question_options
          .filter((o) => o.question_id === q.id)
          .sort((a, b) => a.position - b.position)
          .map((o) => ({
            label: o.label,
            axisValue: valueOf.get(o.axis_value_id) ?? "",
            botResponse: o.bot_response ?? null,
            reasonText: o.reason_text ?? null,
            imageUrl: o.image_url ?? null,
            showIf: o.show_if ?? null,
            selectAll: Boolean(o.select_all),
            displayMeta: o.display_meta ?? null,
          })),
      };
    });
}
