import { afterEach, describe, expect, it } from "vitest";
import {
  templateLivePatch,
  templateLivePatchForSave,
  templateRenderable,
  templateServedLive,
  templatesKilled,
} from "../template-live.server";

const ORIGINAL = process.env.QUIZ_TEMPLATES_LIVE;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.QUIZ_TEMPLATES_LIVE;
  else process.env.QUIZ_TEMPLATES_LIVE = ORIGINAL;
});

describe("templatesKilled", () => {
  it("is off unless explicitly killed", () => {
    delete process.env.QUIZ_TEMPLATES_LIVE;
    expect(templatesKilled()).toBe(false);
    process.env.QUIZ_TEMPLATES_LIVE = "true";
    expect(templatesKilled()).toBe(false);
    for (const v of ["off", "false", "0", " OFF ", "no", "disabled", "kill"]) {
      process.env.QUIZ_TEMPLATES_LIVE = v;
      expect(templatesKilled()).toBe(true);
    }
  });
});

describe("templateServedLive", () => {
  it("needs a valid template AND a publish stamp (09-25 incident: stale column alone never serves)", () => {
    delete process.env.QUIZ_TEMPLATES_LIVE;
    expect(templateServedLive({ quiz_template: "t1", template_live_at: null })).toBe(false);
    expect(templateServedLive({ quiz_template: null, template_live_at: "2026-10-04T00:00:00Z" })).toBe(false);
    expect(templateServedLive({ quiz_template: "t9", template_live_at: "2026-10-04T00:00:00Z" })).toBe(false);
    expect(templateServedLive({ quiz_template: "t2", template_live_at: "2026-10-04T00:00:00Z" })).toBe(true);
  });

  it("the kill switch forces classic even for published shops", () => {
    process.env.QUIZ_TEMPLATES_LIVE = "off";
    expect(templateServedLive({ quiz_template: "t2", template_live_at: "2026-10-04T00:00:00Z" })).toBe(false);
  });
});

describe("templateRenderable (signed on-store preview)", () => {
  it("ignores the publish stamp but still honors the kill switch", () => {
    delete process.env.QUIZ_TEMPLATES_LIVE;
    expect(templateRenderable({ quiz_template: "t4" })).toBe(true);
    expect(templateRenderable({ quiz_template: null })).toBe(false);
    expect(templateRenderable({ quiz_template: "t9" })).toBe(false);
    process.env.QUIZ_TEMPLATES_LIVE = "off";
    expect(templateRenderable({ quiz_template: "t4" })).toBe(false);
  });
});

describe("templateLivePatch", () => {
  it("stamps a template quiz going live", () => {
    delete process.env.QUIZ_TEMPLATES_LIVE;
    const r = templateLivePatch({ quiz_template: "t3", template_live_at: null }, true);
    expect(r.ok && typeof r.patch.template_live_at === "string").toBe(true);
  });

  it("refuses a template go-live while killed", () => {
    process.env.QUIZ_TEMPLATES_LIVE = "off";
    expect(templateLivePatch({ quiz_template: "t3", template_live_at: null }, true).ok).toBe(false);
  });

  it("turning off clears the stamp, even while killed", () => {
    process.env.QUIZ_TEMPLATES_LIVE = "off";
    expect(templateLivePatch({ quiz_template: "t3", template_live_at: "x" }, false)).toEqual({
      ok: true,
      patch: { template_live_at: null },
    });
  });

  it("never writes the column for classic shops without a stamp (works before migration 081)", () => {
    delete process.env.QUIZ_TEMPLATES_LIVE;
    expect(templateLivePatch({ quiz_template: null, template_live_at: null }, true)).toEqual({ ok: true, patch: {} });
    expect(templateLivePatch({ quiz_template: null, template_live_at: null }, false)).toEqual({ ok: true, patch: {} });
    expect(templateLivePatch({ quiz_template: "t1", template_live_at: null }, false)).toEqual({ ok: true, patch: {} });
  });

  it("classic quiz going live clears a leftover stamp", () => {
    expect(templateLivePatch({ quiz_template: null, template_live_at: "x" }, true)).toEqual({
      ok: true,
      patch: { template_live_at: null },
    });
  });
});

describe("templateLivePatchForSave", () => {
  const tpl = { quiz_template: "t1", template_live_at: null };
  it("unrelated saves never touch the stamp", () => {
    delete process.env.QUIZ_TEMPLATES_LIVE;
    expect(templateLivePatchForSave({ ...tpl, enabled: true, assistant_mode: "quiz" }, { enabled: true, assistant_mode: "quiz" })).toEqual({});
    expect(templateLivePatchForSave({ ...tpl, enabled: false, assistant_mode: "chat" }, { enabled: false, assistant_mode: "chat" })).toEqual({});
  });
  it("quiz turning on publishes the template", () => {
    delete process.env.QUIZ_TEMPLATES_LIVE;
    const p = templateLivePatchForSave({ ...tpl, enabled: true, assistant_mode: "chat" }, { enabled: true, assistant_mode: "both" });
    expect(typeof p.template_live_at).toBe("string");
  });
  it("quiz turning off clears it; killed turn-on degrades to classic without failing", () => {
    expect(templateLivePatchForSave({ quiz_template: "t1", template_live_at: "x", enabled: true, assistant_mode: "quiz" }, { enabled: false })).toEqual({ template_live_at: null });
    process.env.QUIZ_TEMPLATES_LIVE = "off";
    expect(templateLivePatchForSave({ ...tpl, enabled: false, assistant_mode: "quiz" }, { enabled: true })).toEqual({});
  });
});
