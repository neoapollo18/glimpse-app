import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

// scripts/glamnetic-v3-sync.mts against Glamnetic's live state on Oct 17
// (fixtures/glamnetic-v3: the storefront payload, the chat_assistant_config
// row and the quiz_offers row) in an in-memory database. The real supabase
// client must never be touched: the sync only talks to the db it is given.
vi.hoisted(() => {
  process.env.SUPABASE_URL ||= "https://example.supabase.co";
  process.env.SUPABASE_API_KEY ||= "test-key";
});
vi.mock("@supabase/supabase-js", () => ({
  createClient: () =>
    new Proxy(
      {},
      {
        get: (_t, prop) => {
          throw new Error(`real supabase client used (${String(prop)})`);
        },
      },
    ),
}));

import {
  CROSS_SELL_HANDLES,
  RERUN_SNAPSHOT_LABEL,
  SNAPSHOT_LABEL,
  applyPlan,
  formatPlan,
  loadLiveState,
  newSkips,
  orderConsistent,
  parseCsv,
  parsePoolHandles,
  parsePoolSnapshot,
  planSync,
  widgetTextureNotes,
  type ApplyDeps,
  type PlanOptions,
} from "../../../scripts/glamnetic-v3-sync-plan";
import { OPTION_TEXTURES } from "../supabase.server";
import {
  createFakeDb,
  glamnetic1017Tables,
  rng,
  servedQuestions,
  studioResave,
  type FakeDb,
} from "./fixtures/glamnetic-v3/fake-db";

const HANDLES = parsePoolSnapshot(
  fs.readFileSync(path.resolve(__dirname, "../../../scripts/brand-configs/glamnetic-pool-v3-handles.json"), "utf8"),
);
const PRODUCTS = [...Object.values(CROSS_SELL_HANDLES), "mani-maintenance-kit-accessory-bundle"];
const NOW = "2026-10-17T22:00:00.000Z";
const EM_DASH = String.fromCharCode(0x2014);

let db: FakeDb;
beforeEach(() => {
  db = createFakeDb(glamnetic1017Tables());
});

const plan = async (extra: Partial<PlanOptions> = {}) =>
  planSync(await loadLiveState(db, PRODUCTS), { handles: HANDLES, now: NOW, ...extra });

function deps(overrides: Partial<ApplyDeps> = {}): ApplyDeps {
  return {
    db,
    snapshot: async (label) => {
      db.log.push({ op: "snapshot", label });
      return { ok: true };
    },
    writeBackup: (data) => {
      db.log.push({ op: "backup", row: data as Record<string, unknown> });
      return "scripts/backups/glamnetic-v3-test.json";
    },
    ...overrides,
  };
}

const writes = () => db.log.filter((o) => o.op !== "snapshot" && o.op !== "backup");
const question = (axisKey: string) => servedQuestions(db.tables).find((q) => q.axisKey === axisKey)!;
const labels = (axisKey: string) => question(axisKey).options.map((o: { label: string }) => o.label);

describe("Glamnetic v3 sync: plan against the Oct 17 live state", () => {
  it("expects exactly what was live: nothing diverged, nothing skipped", async () => {
    const p = await plan();
    expect(p.diffs.filter((d) => d.status === "diverged" || d.status === "held")).toEqual([]);
    expect(p.writes.filter((w) => w.op === "insert").map((w) => `${w.table}:${w.keys.join()}`)).toEqual([
      "recommendation_axis_values:color_family.metallics.value",
      "recommendation_question_options:color_family.metallics.option",
      "recommendation_axis_values:color_family.oranges_yellows.value",
      "recommendation_question_options:color_family.oranges_yellows.option",
      "recommendation_axis_values:color_family.white.value",
      "recommendation_question_options:color_family.white.option",
    ]);
    // Helper copy is the mockups' own text, em dashes included.
    const written = JSON.stringify(p.writes.map((w) => (w.op === "update" ? w.set : w.row)));
    expect(written).toContain(`This is the design ${EM_DASH} pick up to two.`);
  });

  it("prints a diff and writes nothing on a dry run", async () => {
    const out = formatPlan(await plan(), { apply: false });
    expect(out).toContain("DRY RUN");
    expect(out).toContain('option_8 "Holiday-ready" label: "Holiday-ready" -> "Holiday-Ready"');
    expect(out).toContain("+ new axis value metallics");
    expect(out).toContain("Skipped fields: 0.");
    expect(db.log).toEqual([]);
  });
});

describe("Glamnetic v3 sync: apply", () => {
  it("backs up, snapshots, then only updates and inserts", async () => {
    const res = await applyPlan(await plan(), deps());
    expect(res.ok).toBe(true);
    const ops = db.log.map((o) => o.op);
    expect(ops[0]).toBe("backup");
    expect(ops[1]).toBe("snapshot");
    expect(db.log[1].label).toBe(SNAPSHOT_LABEL);
    expect(new Set(ops.slice(2))).toEqual(new Set(["update", "insert"]));
    expect(ops).not.toContain("delete");
    expect(ops).not.toContain("upsert");
    expect(ops).not.toContain("rpc");
    // The backup holds every updated row as it was before.
    const backup = db.log[0].row as { rows: Record<string, Array<{ id?: string }>> };
    const updatedIds = writes()
      .filter((o) => o.op === "update" && o.table !== "quiz_offers")
      .flatMap((o) => o.ids ?? []);
    const backedUp = Object.values(backup.rows)
      .flat()
      .map((r) => r.id);
    for (const id of updatedIds) expect(backedUp).toContain(id);
    expect(backup.rows.quiz_offers).toHaveLength(1);
  });

  it("is idempotent: the second plan is empty and a second apply writes nothing", async () => {
    await applyPlan(await plan(), deps());
    const again = await plan();
    expect(again.writes).toEqual([]);
    expect(again.diffs).toEqual([]);
    const before = db.log.length;
    const res = await applyPlan(again, deps());
    expect(res).toEqual({ ok: true, written: 0, backupPath: null });
    expect(db.log.length).toBe(before); // no backup, no snapshot either
  });

  it("lands the mockup flow and leaves everything else alone", async () => {
    const tablesBefore = glamnetic1017Tables();
    await applyPlan(await plan(), deps());

    expect(labels("vibe")).toEqual([
      "Clean Girl & Minimalist",
      "Soft & Sweet",
      "French Girl Chic",
      "Main Character Energy",
      "Vacay Mode",
      "Alternative & Edgy",
      "Holiday-Ready",
      "Surprise me",
    ]);
    const surprise = question("vibe").options.at(-1);
    expect(surprise.selectAll).toBe(true);
    expect(surprise.displayMeta).toEqual({ sublabel: "just here for a mani check" });
    expect(question("vibe").multiSelect).toBe(false);

    expect(question("length").options.map((o: { displayMeta: { sublabel: string } }) => o.displayMeta.sublabel)).toEqual([
      "Barely-there, ultra practical",
      "The everyday sweet spot",
      "Elegant, still functional",
    ]);
    expect(labels("shape")).toEqual(["Almond", "Oval", "Round", "Square", "Squoval", "Coffin", "Open to anything"]);
    expect(question("shape").helperText).toBe("Tap all the ones you'd wear.");

    const color = question("color_family");
    expect(color.maxSelections).toBe(3);
    expect(color.options.map((o: { axisValue: string; label: string }) => [o.axisValue, o.label])).toEqual([
      ["nudes_neutrals", "Nudes & neutrals"],
      ["pinks_pastels", "Pinks & purples"],
      ["reds_berries", "Reds & berries"],
      ["bold_bright", "Bold & bright"],
      ["dark_moody", "Dark & moody"],
      ["metallics", "Metallic gold, bronze & silver"],
      ["oranges_yellows", "Bright oranges & yellows"],
      ["white", "White"],
      ["nudes_neutrals", "Surprise me"],
    ]);
    // Merged: Bold & bright keeps its texture, only the swatches move.
    expect(color.options[3].displayMeta).toEqual({ swatch: "#FF6B9D", swatch2: "#2BB3A3", texture: "rainbow" });
    expect(color.options[1].displayMeta).toEqual({ swatch: "#FBD8E3", swatch2: "#B48BD1" });
    // Gold to bronze, not the gradient's grey end.
    expect(color.options[5].displayMeta).toEqual({ swatch: "#F7E3A6", swatch2: "#B57A3C" });

    const finish = question("question_6");
    expect(finish).toMatchObject({ axisLabel: "Finish", multiSelect: true, maxSelections: 2, optionStyle: "nails" });
    expect(
      finish.options.map((o: { label: string; selectAll: boolean; displayMeta: { texture?: string } | null }) => [
        o.label,
        o.selectAll,
        o.displayMeta?.texture ?? null,
      ]),
    ).toEqual([
      ["Classic Glossy", false, "glossy"],
      ["Glazed & Pearlescent", false, "glazed"],
      ["Velvet & Cateye", false, "velvet"],
      ["Bold Chrome", false, "chrome"],
      ["Matte", false, "matte"],
      ["Surprise Me!", true, null],
    ]);

    const style = question("style_tier");
    expect(style.helperText).toBe(`You've picked the vibe and the colors. This is the design ${EM_DASH} pick up to two.`);
    expect(
      style.options.map((o: { label: string; displayMeta: { sublabel: string } }) => `${o.label} / ${o.displayMeta.sublabel}`),
    ).toEqual([
      "Clean & classic / Solids, french tips, glazed",
      "A little extra / Pearls, ombre, subtle art",
      "Statement / Chrome, glitter, cat eye",
      "Full-on nail art / 3D gems, patterns, abstract",
    ]);

    // Untouched: prompts, images, reasons, show_if, question order, and
    // every row that existed (nothing deleted; the old axis values stay).
    const served = servedQuestions(db.tables);
    const was = servedQuestions(tablesBefore);
    expect(served.map((q) => q.axisKey)).toEqual(was.map((q) => q.axisKey));
    expect(served.map((q) => q.prompt)).toEqual(was.map((q) => q.prompt));
    const media = (qs: typeof served) =>
      qs
        .flatMap((q) =>
          q.options.filter((o: { imageUrl: string | null }) => o.imageUrl).map((o: { label: string; imageUrl: string }) => o.imageUrl),
        )
        .sort();
    expect(media(served)).toEqual(media(was));
    expect(question("vibe").options[0].reasonText).toBe("barely-there");
    for (const table of [
      "recommendation_axes",
      "recommendation_axis_values",
      "recommendation_questions",
      "recommendation_question_options",
    ]) {
      const ids = new Set(db.tables[table].map((r) => r.id));
      for (const r of tablesBefore[table]) expect(ids.has(r.id)).toBe(true);
    }
    expect(db.tables.recommendation_axis_values.map((v) => v.value)).toEqual(expect.arrayContaining(["metallics_shimmer", "french_white"]));
  });

  it("merges the columnar spec into recommendation_tuning, disabled", async () => {
    await applyPlan(await plan(), deps());
    const tuning = db.tables.chat_assistant_config[0].recommendation_tuning;
    expect(tuning).toMatchObject({
      llmReasons: true,
      colorFilter: "off",
      rankerModel: "flash",
      mismatchGuard: true,
      priorityStyle: "boost",
      maxLlmCandidates: 200,
      productDiversity: true,
      priorityBoostSlots: 2,
    });
    const spec = tuning.columnar;
    expect(spec).toMatchObject({
      enabled: false,
      version: 1,
      threshold: 6,
      candidateCount: 40,
      resultCount: 6,
      alsoMatchedCount: 6,
      weights: { color: 0.4, drama: 0.35, vibe: 0.25 },
      holidayCollections: ["Holiday", "Snow", "Sleigh", "Winter", "Polar"],
      llm: { enabled: true, timeoutMs: 4000 },
    });
    expect(spec.pool).toEqual({ collectionHandle: "shop-all-nails-gleame-quiz-flow", handles: HANDLES, syncedAt: NOW, source: "csv" });
    expect(spec.pool.handles).toHaveLength(424);
    expect(spec.axes.vibe.values).toMatchObject({
      model_off_duty: "clean_girl",
      vacation: "vacay",
      option_7: "alt_edgy",
      option_8: "holiday",
    });
    expect(spec.axes.color_family.values).toMatchObject({ pinks_pastels: "pinks_purples", metallics: "metallics", white: "white" });
    expect(spec.axes.question_6).toEqual({
      role: "finish",
      values: { option_1: "glossy", option_2: "glazed_pearl", option_3: "velvet_cateye", option_4: "chrome", option_5: "matte" },
    });
    expect(Object.keys(spec.vibes)).toHaveLength(7);
    // Every other config column is untouched.
    const config = JSON.parse(fs.readFileSync(path.resolve(__dirname, "fixtures/glamnetic-v3/chat-assistant-config.json"), "utf8"));
    const row = db.tables.chat_assistant_config[0];
    for (const [k, v] of Object.entries(config)) {
      if (k === "recommendation_tuning" || k === "updated_at") continue;
      expect(row[k]).toEqual(v);
    }
  });

  it("sets the offers from the brief and keeps every other offers column", async () => {
    const p = await plan();
    // The four live items are already the brief's slots, with the remover
    // standing in for the Prep Kit: the list is not rewritten.
    expect(p.diffs.map((d) => d.key)).not.toContain("offers.cross_sell_items");
    expect(p.notes.join("\n")).toContain('"Prep Kit" slot keeps Press-On Nail Remover');
    // Offers sit outside the version snapshot: the dry run says so.
    expect(p.notes.join("\n")).toContain("version history does not cover quiz_offers");
    await applyPlan(p, deps());
    const offers = db.tables.quiz_offers[0];
    const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, "fixtures/glamnetic-v3/quiz-offers.json"), "utf8"));
    expect(offers.cross_sell_items).toEqual(fixture.cross_sell_items);
    expect(offers.cross_sell_items.map((i: { handle: string }) => i.handle)).toEqual([
      "brush-on-nail-glue",
      "press-on-nail-remover",
      "adhesive-nail-tabs",
      "press-on-nail-remover-pen-nail-accessory",
    ]);
    expect(offers).toMatchObject({
      cross_sell_enabled: true,
      cross_sell_source: "manual",
      cross_sell_title: "Finish the look",
      cross_sell_subtext: "Everything your sets need to last",
      cross_sell_max: 4,
      bundle_discount_mode: "code",
      bundle_discount_type: "percentage",
      bundle_discount_value: 15,
      bundle_discount_min_qty: 2,
      bundle_discount_once_per_customer: true,
      bundle_discount_code: null,
      bundle_discount_shopify_id: null,
      bundle_discount_note: null,
      created_at: fixture.created_at,
    });
  });

  it("fills the Prep Kit slot second when one is named", async () => {
    await applyPlan(await plan({ prepKitHandle: "mani-maintenance-kit-accessory-bundle", bundleCode: "GLAMBUNDLE15" }), deps());
    const offers = db.tables.quiz_offers[0];
    expect(offers.cross_sell_items[1]).toEqual({
      productId: "7341262798891",
      handle: "mani-maintenance-kit-accessory-bundle",
      title: "Mani Maintenance Kit",
      imageUrl: null,
      when: null,
    });
    expect(offers.cross_sell_items.map((i: { handle: string }) => i.handle)).toEqual([
      "brush-on-nail-glue",
      "mani-maintenance-kit-accessory-bundle",
      "adhesive-nail-tabs",
      "press-on-nail-remover-pen-nail-accessory",
    ]);
    expect(offers.bundle_discount_code).toBe("GLAMBUNDLE15");
  });

  it("stops before planning anything when --prep-kit names no active product", async () => {
    const before = JSON.stringify(db.tables);
    await expect(plan({ prepKitHandle: "polish-prep-typo" })).rejects.toThrow(/polish-prep-typo is not an active Glamnetic product/);
    expect(JSON.stringify(db.tables)).toBe(before);
  });

  it("labels a re-run's snapshot apart from the first one", async () => {
    await applyPlan(await plan(), deps({ label: RERUN_SNAPSHOT_LABEL }));
    expect(db.log.find((o) => o.op === "snapshot")!.label).toBe(RERUN_SNAPSHOT_LABEL);
    expect((db.log[0].row as { label: string }).label).toBe(RERUN_SNAPSHOT_LABEL);
  });

  it("says to apply with --enable-columnar while the spec is off", async () => {
    expect((await plan()).notes.join("\n")).toContain("Apply with --enable-columnar");
    expect((await plan({ enableColumnar: true })).notes.join("\n")).not.toContain("Apply with --enable-columnar");
  });
});

describe("Glamnetic v3 sync: merchant edits since Oct 17", () => {
  function editLive() {
    const opt = (axisKey: string, label: string) =>
      db.tables.recommendation_question_options.find((o) => o.question_id === `question-${axisKey}` && o.label === label)!;
    opt("vibe", "Holiday-ready").label = "Holiday Glam";
    db.tables.recommendation_questions.find((q) => q.id === "question-length")!.helper_text = "Lisa's helper";
    // Lisa moved Coffin to the front.
    opt("shape", "Coffin").position = -1;
    db.tables.quiz_offers[0].bundle_discount_mode = "managed";
    db.tables.quiz_offers[0].bundle_discount_value = 20;
  }

  it("reports each edit and leaves it alone", async () => {
    editLive();
    const p = await plan();
    expect(p.diffs.filter((d) => d.status === "diverged").map((d) => d.key)).toEqual([
      "vibe.option_8.label",
      "length.helper",
      "shape.order",
      "offers.bundle_discount_mode",
      "offers.bundle_discount_value",
    ]);
    // The untouched bundle fields move with the edited ones: held.
    expect(p.diffs.filter((d) => d.status === "held").map((d) => d.key)).toEqual([
      "offers.bundle_discount_min_qty",
      "offers.bundle_discount_once_per_customer",
    ]);
    const out = formatPlan(p, { apply: false });
    expect(out).toContain("SKIPPED: edited since Oct 17. Overwrite with --force-field=vibe.option_8.label");

    await applyPlan(p, deps());
    expect(labels("vibe")).toContain("Holiday Glam");
    expect(question("length").helperText).toBe("Lisa's helper");
    expect(labels("shape")[0]).toBe("Coffin");
    expect(db.tables.quiz_offers[0]).toMatchObject({
      bundle_discount_mode: "managed",
      bundle_discount_value: 20,
      bundle_discount_min_qty: null,
    });
    // The rest of the sync still lands.
    expect(question("shape").helperText).toBe("Tap all the ones you'd wear.");
    expect(db.tables.quiz_offers[0].cross_sell_max).toBe(4);
    // And a re-run reports the same edits, nothing else.
    const again = await plan();
    expect(again.writes).toEqual([]);
    expect(again.diffs.map((d) => d.status)).toEqual(["diverged", "diverged", "diverged", "diverged", "diverged", "held", "held"]);
  });

  it("--force-field on one bundle field says the rest of the bundle holds it", async () => {
    editLive();
    const p = await plan({ forceFields: ["offers.bundle_discount_value"] });
    expect(p.diffs.find((d) => d.key === "offers.bundle_discount_value")!.status).toBe("held");
    expect(p.notes).toContain(
      "--force-field offers.bundle_discount_value is held with the rest of the bundle: also force offers.bundle_discount_mode",
    );
    expect(p.notes.join("\n")).not.toContain("matched no diverged field");
  });

  it("--force-field overwrites only the named field", async () => {
    editLive();
    const p = await plan({ forceFields: ["vibe.option_8.label"] });
    expect(p.diffs.find((d) => d.key === "vibe.option_8.label")!.status).toBe("forced");
    await applyPlan(p, deps());
    expect(labels("vibe")).toContain("Holiday-Ready");
    expect(question("length").helperText).toBe("Lisa's helper");
  });

  it("stops at a row that changed after it was read, without a retry", async () => {
    const p = await plan();
    // A Studio save re-creates every quiz row with new ids.
    for (const o of db.tables.recommendation_question_options) o.id = `${o.id}-resaved`;
    const res = await applyPlan(p, deps());
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/matched 0 rows/);
    // Backup and snapshot ran first; nothing after the failed update.
    const ops = db.log.map((o) => o.op);
    expect(ops.slice(0, 2)).toEqual(["backup", "snapshot"]);
    expect(ops.at(-1)).toBe("update");
  });

  it("writes nothing when the snapshot fails", async () => {
    const res = await applyPlan(await plan(), deps({ snapshot: async () => ({ ok: false, error: "db down" }) }));
    expect(res).toMatchObject({ ok: false, written: 0 });
    expect(writes()).toEqual([]);
  });

  it("writes nothing when the backup fails", async () => {
    let snapshots = 0;
    const res = await applyPlan(
      await plan(),
      deps({
        writeBackup: () => {
          throw new Error("disk full");
        },
        snapshot: async () => ((snapshots += 1), { ok: true }),
      }),
    );
    expect(res).toMatchObject({ ok: false, written: 0 });
    expect(snapshots).toBe(0);
    expect(writes()).toEqual([]);
  });
});

describe("Glamnetic v3 sync: a run that stops part way", () => {
  // The target, from one clean run.
  async function targetFlow() {
    const clean = createFakeDb(glamnetic1017Tables());
    await applyPlan(
      planSync(await loadLiveState(clean, PRODUCTS), { handles: HANDLES, now: NOW }),
      deps({ db: clean, snapshot: async () => ({ ok: true }), writeBackup: () => "x" }),
    );
    return servedQuestions(clean.tables);
  }
  const keepTexture = (t: string) => (OPTION_TEXTURES as readonly string[]).includes(t);

  it("re-runs to the target from every stop point, with or without a Studio save in between", async () => {
    const target = await targetFlow();
    const total = (await plan()).writes.length;
    expect(total).toBe(37);
    let runs = 0;
    for (const seed of [11, 23, 47, 101, 977]) {
      for (let k = 0; k < total; k++) {
        for (const resave of [false, true]) {
          db = createFakeDb(glamnetic1017Tables({ idSeed: seed }), { idSeed: seed });
          db.stopAfter = k;
          const first = await applyPlan(await plan(), deps());
          expect(first).toMatchObject({ ok: false, written: k });
          db.stopAfter = null;
          // A Studio save of the half-synced quiz: new ids, positions
          // renumbered, Finish textures not in OPTION_TEXTURES yet dropped.
          if (resave) studioResave(db.tables, seed * 1000 + k, keepTexture);

          const where = `seed ${seed}, stopped after ${k}${resave ? ", Studio save" : ""}`;
          const again = await plan();
          const skipped = again.diffs.filter((d) => d.status === "diverged" || d.status === "held").map((d) => d.key);
          expect(skipped, where).toEqual([]);
          expect(await applyPlan(again, deps()), where).toMatchObject({ ok: true });
          const done = await plan();
          expect(done.writes, where).toEqual([]);
          expect(done.diffs, where).toEqual([]);
          expect(servedQuestions(db.tables), where).toEqual(target);
          runs++;
        }
      }
    }
    expect(runs).toBe(5 * 37 * 2);
  }, 60_000);

  it("never strands Surprise me among the new colors", async () => {
    const total = (await plan()).writes.length;
    for (let k = 0; k <= total; k++) {
      db = createFakeDb(glamnetic1017Tables({ idSeed: 5 }), { idSeed: 5 });
      db.stopAfter = k;
      await applyPlan(await plan(), deps());
      const color = question("color_family").options;
      expect(color.at(-1).selectAll, `stopped after ${k}`).toBe(true);
    }
  }, 30_000);

  it("still calls a real reorder a merchant's after a partial run", async () => {
    db.stopAfter = 3;
    await applyPlan(await plan(), deps());
    db.stopAfter = null;
    // Lisa drags Coffin to the top of the half-synced shape step.
    const coffin = db.tables.recommendation_question_options.find((o) => o.question_id === "question-shape" && o.label === "Coffin")!;
    coffin.position = -1;
    const p = await plan();
    expect(p.diffs.filter((d) => d.status === "diverged").map((d) => d.key)).toEqual(["shape.order"]);
  });

  it("re-runs to the target after several stops, each maybe followed by a Studio save", async () => {
    const target = await targetFlow();
    // Found by fuzzing: stop after 9 writes (Oval moved up), Studio save
    // (Oval and Coffin renumbered), stop 2 writes into the re-run (Round
    // lands on Coffin's renumbered slot, a tie). A slot-by-slot order check
    // called that a merchant's reorder.
    // Each stop: writes before it stops, then the seed of a Studio save
    // (null: none).
    const scenarios: Array<{ seed: number; stops: Array<[number, number | null]> }> = [
      { seed: 3, stops: [[9, 30], [2, null]] },
    ];
    const pick = rng(20261017);
    for (let i = 0; i < 300; i++) {
      const stops: Array<[number, number | null]> = Array.from({ length: 1 + Math.floor(pick() * 5) }, () => [
        Math.floor(pick() * 12),
        pick() < 0.6 ? Math.floor(pick() * 1e6) : null,
      ]);
      scenarios.push({ seed: 1000 + i, stops });
    }
    for (const { seed, stops } of scenarios) {
      db = createFakeDb(glamnetic1017Tables({ idSeed: seed }), { idSeed: seed });
      let written = 0;
      for (const [i, [k, saveSeed]] of stops.entries()) {
        const p = await plan();
        const skipped = p.diffs.filter((d) => d.status === "diverged" || d.status === "held").map((d) => d.key);
        expect(skipped, `seed ${seed}, run ${i}`).toEqual([]);
        db.stopAfter = written + k;
        written += (await applyPlan(p, deps())).written;
        db.stopAfter = null;
        if (saveSeed !== null) studioResave(db.tables, saveSeed, keepTexture);
      }
      const where = `seed ${seed}, stops ${JSON.stringify(stops)}`;
      const last = await plan();
      expect(last.diffs.filter((d) => d.status === "diverged" || d.status === "held"), where).toEqual([]);
      expect(await applyPlan(last, deps()), where).toMatchObject({ ok: true });
      expect((await plan()).diffs, where).toEqual([]);
      expect(servedQuestions(db.tables), where).toEqual(target);
    }
  }, 60_000);

  it("judges order pair by pair: only a pair both orders agree on shows a reorder", () => {
    // Oct 17 a, b, c, s; target a, c, b, n, s (n is new).
    const old = (k: string) => ["a", "b", "c", "s"].indexOf(k);
    const next = (k: string) => ["a", "c", "b", "n", "s"].indexOf(k);
    const at = (...keys: Array<string | string[]>) =>
      keys.flatMap((k, position) => (Array.isArray(k) ? k : [k]).map((key) => ({ key, position })));
    expect(orderConsistent(at("a", "b", "c", "s"), old, next)).toBe(true); // Oct 17
    expect(orderConsistent(at("a", "c", "b", "n", "s"), old, next)).toBe(true); // target
    expect(orderConsistent(at("a", "b", "c", "n", "s"), old, next)).toBe(true); // b, c not swapped yet
    expect(orderConsistent(at("a", ["b", "c"], "s"), old, next)).toBe(true); // a tie says nothing
    expect(orderConsistent(at("c", "a", "b", "s"), old, next)).toBe(false); // c moved above a
    expect(orderConsistent(at("s", "a", "b", "c"), old, next)).toBe(false); // s moved to the top
    expect(orderConsistent(at("a", "c", "b", "s", "n"), old, next)).toBe(false); // the new option after s
  });

  it("the CLI's check flags a field skipped after apply that the plan did not skip", async () => {
    const before = await plan();
    await applyPlan(before, deps());
    expect(newSkips(before, await plan())).toEqual([]);
    // Lisa renames an option while the run is going.
    db.tables.recommendation_question_options.find((o) => o.label === "Holiday-Ready")!.label = "Holiday Glam";
    expect(newSkips(before, await plan()).map((d) => d.key)).toEqual(["vibe.option_8.label"]);
  });
});

describe("Glamnetic v3 sync: widget textures", () => {
  it("names each finish the widget cannot draw yet", () => {
    const css = fs.readFileSync(path.resolve(__dirname, "../../../extensions/glimpse-widget/assets/gleame-quiz.css"), "utf8");
    const missing = ["glossy", "glazed", "velvet", "chrome", "matte"].filter((t) => !css.includes(`.gq-nail--${t}`));
    expect(widgetTextureNotes(css)).toEqual(
      missing.map((t) => `widget has no .gq-nail--${t} style: the "${t}" finish draws as a plain glossy nail until the widget package ships it`),
    );
    expect(widgetTextureNotes(".gq-nail--glossy{} .gq-nail--glazed{} .gq-nail--velvet{} .gq-nail--chrome{} .gq-nail--matte{}")).toEqual([]);
  });
});

describe("Glamnetic v3 sync: columnar flag", () => {
  it("--enable-columnar turns the spec on; a re-run without it never turns it off", async () => {
    await applyPlan(await plan({ enableColumnar: true }), deps());
    expect(db.tables.chat_assistant_config[0].recommendation_tuning.columnar.enabled).toBe(true);
    const again = await plan();
    expect(again.writes).toEqual([]);
  });

  it("turns an existing disabled spec on without touching the rest of it", async () => {
    await applyPlan(await plan(), deps());
    db.tables.chat_assistant_config[0].recommendation_tuning.columnar.threshold = 4; // tuned in Studio
    const p = await plan({ enableColumnar: true });
    expect(p.diffs.map((d) => [d.key, d.status])).toEqual([
      ["columnar.enabled", "change"],
      ["columnar.threshold", "diverged"],
    ]);
    await applyPlan(p, deps());
    expect(db.tables.chat_assistant_config[0].recommendation_tuning.columnar).toMatchObject({ enabled: true, threshold: 4 });
  });
});

describe("pool handles", () => {
  it("the committed snapshot holds the 424 handles of the Oct 17 export", () => {
    expect(HANDLES).toHaveLength(424);
    expect(new Set(HANDLES).size).toBe(424);
    expect(HANDLES[0]).toBe("24k-short-almond-press-on-nails");
    expect(() => parsePoolSnapshot(JSON.stringify({ collectionHandle: "other", handles: ["a"] }))).toThrow(/other/);
    expect(() => parsePoolSnapshot(JSON.stringify({ collectionHandle: "shop-all-nails-gleame-quiz-flow", handles: ["a", "a"] }))).toThrow(
      /duplicate/,
    );
  });

  it("reads the handle column of a CSV export", () => {
    expect(parseCsv('handle,title\r\na,"Hi, ""you"""\r\n')).toEqual([
      ["handle", "title"],
      ["a", 'Hi, "you"'],
    ]);
    // A Shopify export repeats the handle on image rows.
    expect(parsePoolHandles('Handle,Title\nset-a,"A, B"\nset-a,\nset-b,B\n')).toEqual(["set-a", "set-b"]);
    expect(() => parsePoolHandles("title\nx\n")).toThrow(/no handle column/);
    expect(() => parsePoolHandles("handle\nNot A Handle\n")).toThrow(/bad handle/);
  });
});
