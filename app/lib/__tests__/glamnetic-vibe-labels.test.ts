import { describe, it, expect } from "vitest";
import {
  buildPrompt,
  isApproved,
  parseAiResponse,
  parseCsv,
  parseVibeList,
  planApply,
  sheetRow,
  SHEET_HEADER,
  toCsv,
  withVibeLabels,
  writeDrift,
} from "../../../scripts/glamnetic-vibe-labels-lib";
import { glamneticSpec } from "./fixtures/glamnetic-columnar";

// The vibe-label sheet workflow (fix spec v4, item 3): the AI pass's sheet
// rows, Lisa's approvals, and the merge that may only ever touch
// recommendation_tuning.columnar.vibeLabels.

const POOL = ["berry-baby-super-short-press-on-nails", "pink-pop-super-short-press-on-nails", "unbothered-super-short-press-on-nails"];
const sheet = (rows: string[][]) => toCsv([[...SHEET_HEADER], ...rows]);
const row = (handle: string, proposed: string, approved = "", final = "") => [handle, "T", "", proposed, "0.9", "", approved, final, ""];

describe("sheet CSV", () => {
  it("round-trips commas, quotes and line breaks", () => {
    const rows = [["a", 'say "hi", twice', "line\nbreak", ""]];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
    expect(parseCsv('\uFEFFh1,h2\r\nx,"y,z"\r\n\r\n')).toEqual([["h1", "h2"], ["x", "y,z"]]);
  });
});

describe("vibe names", () => {
  it("reads names or IDs, in vocabulary order; none is an empty list; blank is nothing", () => {
    expect(parseVibeList("Holiday-Ready | soft & sweet")).toEqual({ ids: ["soft_sweet", "holiday"], unknown: [] });
    expect(parseVibeList("alt_edgy, Clean Girl")).toEqual({ ids: ["clean_girl", "alt_edgy"], unknown: [] });
    expect(parseVibeList("none")).toEqual({ ids: [], unknown: [] });
    expect(parseVibeList("  ")).toEqual({ ids: null, unknown: [] });
    expect(parseVibeList("Spooky Season | Vacay Mode")).toEqual({ ids: ["vacay"], unknown: ["Spooky Season"] });
    // French Girl Chic follows the tags: naming it is not a label.
    expect(parseVibeList("French Girl Chic | Soft & Sweet")).toEqual({ ids: ["soft_sweet"], unknown: [] });
  });

  it("approval takes the usual yeses and nothing else", () => {
    for (const y of ["yes", "Y", "x", "TRUE", "approved", "\u2713"]) expect(isApproved(y), y).toBe(true);
    for (const n of ["", "no", "maybe", "n"]) expect(isApproved(n), n).toBe(false);
  });
});

describe("AI pass", () => {
  it("prompts with the photo's tags that describe the look, not every tag", () => {
    const { system, user } = buildPrompt({
      title: "Berry Baby",
      tags: ["Color_Red", "_Is Solid_TRUE", "_Is 3D_FALSE", "Nail Length_Super Short", "Product Type_Nail", "_Nail Collection_Glossy Dark Maroon"],
    });
    expect(user).toBe("Title: Berry Baby\nTags: Color_Red, _Is Solid_TRUE, _Nail Collection_Glossy Dark Maroon");
    expect(system).toMatch(/alt_edgy \(Alternative & Edgy\)/);
    expect(system).not.toMatch(/french_girl/);
  });

  it("keeps only known vibes, once each, with confidences clamped", () => {
    const parsed = parseAiResponse(
      '```json\n{"vibes":[{"id":"holiday","confidence":1.4},{"id":"french_girl","confidence":0.9},{"id":"spooky","confidence":1},{"id":"alt_edgy","confidence":0.6},{"id":"holiday","confidence":0.1}],"confidence":0.8,"note":"Deep  red."}\n```',
    );
    expect(parsed).toEqual({ vibes: [{ id: "alt_edgy", confidence: 0.6 }, { id: "holiday", confidence: 1 }], confidence: 0.8, note: "Deep red." });
    expect(parseAiResponse("not json")).toBeNull();
  });

  it("a sheet row proposes what the model is fairly sure of and shows today's rules", () => {
    const r = sheetRow(
      { handle: "berry", title: "Berry Baby", imageUrl: "https://cdn/x.webp" },
      ["french_girl", "alt_edgy"],
      { vibes: [{ id: "alt_edgy", confidence: 0.7 }, { id: "holiday", confidence: 0.4 }], confidence: 0.8, note: "Deep red." },
    );
    expect(r).toEqual([
      "berry", "Berry Baby", "https://cdn/x.webp", "Alternative & Edgy", "0.80", "Alternative & Edgy", "", "",
      "Deep red. / scores: alt_edgy 0.70, holiday 0.40",
    ]);
    expect(sheetRow({ handle: "x", title: "X", imageUrl: null }, [], null, "image 404")[8]).toBe("error: image 404");
  });
});

describe("--apply-sheet", () => {
  it("merges only approved rows over the stored labels; final_vibes wins over the proposal", () => {
    const stored = { "unbothered-super-short-press-on-nails": ["clean_girl"], "kept-elsewhere": ["vacay"] };
    const plan = planApply(
      sheet([
        row(POOL[0], "Alternative & Edgy | Holiday-Ready", "yes"),
        row(POOL[1], "Clean Girl & Minimalist | Soft & Sweet", "yes", "Soft & Sweet"),
        row(POOL[2], "Main Character Energy", ""),
      ]),
      stored,
      POOL,
    );
    expect(plan.errors).toEqual([]);
    expect([plan.approved, plan.notApproved, plan.unchanged]).toEqual([2, 1, 0]);
    expect(plan.next).toEqual({
      "unbothered-super-short-press-on-nails": ["clean_girl"],
      "kept-elsewhere": ["vacay"],
      [POOL[0]]: ["alt_edgy", "holiday"],
      [POOL[1]]: ["soft_sweet"],
    });
    expect(plan.changes.map((c) => [c.handle, c.from, c.to])).toEqual([
      [POOL[0], null, ["alt_edgy", "holiday"]],
      [POOL[1], null, ["soft_sweet"]],
    ]);
  });

  it("refuses the whole sheet on any bad row", () => {
    const bad = planApply(
      sheet([
        row("not-in-pool", "Vacay Mode", "yes"),
        row(POOL[0], "Spooky", "yes"),
        row(POOL[1], "", "yes"),
        row(POOL[2], "none", "yes"),
        row(POOL[2], "none", "yes"),
      ]),
      {},
      POOL,
    );
    expect(bad.errors).toEqual([
      'line 2: "not-in-pool" is not in the quiz pool',
      'line 3: unknown vibe "Spooky"',
      "line 4: approved with no vibes (write none for a set that fits none)",
      `line 6: ${POOL[2]} is approved twice`,
    ]);
    expect(planApply("handle,title\nx,y\n", {}, POOL).errors).toEqual([
      'the sheet has no "approved" column',
      'the sheet has no "proposed_vibes" column',
      'the sheet has no "final_vibes" column',
    ]);
  });

  it("writes back the stored tuning with only columnar.vibeLabels changed", () => {
    const tuning = { rankerModel: "lite", futureKnob: { a: 1 }, columnar: { ...glamneticSpec(), extraKey: "kept" } };
    const next = withVibeLabels(JSON.parse(JSON.stringify(tuning)), { [POOL[0]]: ["alt_edgy"] });
    expect(next.rankerModel).toBe("lite");
    expect(next.futureKnob).toEqual({ a: 1 });
    expect((next.columnar as Record<string, unknown>).extraKey).toBe("kept");
    expect((next.columnar as Record<string, unknown>).vibeLabels).toEqual({ [POOL[0]]: ["alt_edgy"] });
    expect(writeDrift(tuning, next, { [POOL[0]]: ["alt_edgy"] })).toBeNull();
    expect(writeDrift(tuning, { ...next, rankerModel: "pro" }, { [POOL[0]]: ["alt_edgy"] })).toBe(
      "a key other than columnar.vibeLabels changed",
    );
    expect(writeDrift(tuning, next, { [POOL[0]]: ["vacay"] })).toBe("the labels did not land as written");
    expect(() => withVibeLabels({ rankerModel: "lite" }, {})).toThrow(/no columnar spec/);
  });
});
