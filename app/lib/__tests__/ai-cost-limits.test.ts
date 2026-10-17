import { describe, it, expect } from "vitest";
import { RATE_LIMITS, checkRateLimits } from "../rate-limiter.server";

// Cost caps on paid AI calls (2026-10-16 security pass). Calibration from
// production analytics, busiest shop-day over 45 days: ~470 try-on
// generations, ~23 shade detections, ~225 results screens.

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe("skin analysis limits", () => {
  it("are back at the pre-conference values", () => {
    expect(RATE_LIMITS.ANALYZE_SKIN_PER_IP_MINUTE).toEqual({ limit: 5, windowMs: 60 * 1000 });
    expect(RATE_LIMITS.ANALYZE_SKIN_PER_IP_HOUR).toEqual({ limit: 20, windowMs: HOUR });
    expect(RATE_LIMITS.ANALYZE_SKIN_PER_SHOP_HOUR).toEqual({ limit: 200, windowMs: HOUR });
    expect(RATE_LIMITS.PROJECT_SKIN_PER_IP_MINUTE).toEqual({ limit: 3, windowMs: 60 * 1000 });
    expect(RATE_LIMITS.PROJECT_SKIN_PER_IP_HOUR).toEqual({ limit: 10, windowMs: HOUR });
    expect(RATE_LIMITS.PROJECT_SKIN_PER_SHOP_HOUR).toEqual({ limit: 100, windowMs: HOUR });
  });
});

describe("daily per-shop ceilings", () => {
  it("keep the existing hourly windows unchanged", () => {
    expect(RATE_LIMITS.QUIZ_TRYON_PER_SHOP_HOUR).toEqual({ limit: 1000, windowMs: HOUR });
    expect(RATE_LIMITS.QUIZ_SHADE_PER_SHOP_HOUR).toEqual({ limit: 600, windowMs: HOUR });
    expect(RATE_LIMITS.QUIZ_RECOMMEND_LLM_PER_SHOP_MINUTE).toEqual({ limit: 60, windowMs: 60 * 1000 });
    expect(RATE_LIMITS.TRANSLATE_QUIZ_PER_SHOP_HOUR).toEqual({ limit: 6, windowMs: HOUR });
  });

  it("sit far above the busiest real shop-day", () => {
    expect(RATE_LIMITS.QUIZ_TRYON_PER_SHOP_DAY).toEqual({ limit: 10000, windowMs: DAY });
    expect(RATE_LIMITS.QUIZ_SHADE_PER_SHOP_DAY).toEqual({ limit: 2000, windowMs: DAY });
    expect(RATE_LIMITS.QUIZ_RECOMMEND_LLM_PER_SHOP_DAY).toEqual({ limit: 5000, windowMs: DAY });
    expect(RATE_LIMITS.ANALYZE_SKIN_PER_SHOP_DAY).toEqual({ limit: 2000, windowMs: DAY });
    expect(RATE_LIMITS.PROJECT_SKIN_PER_SHOP_DAY).toEqual({ limit: 1000, windowMs: DAY });
    expect(RATE_LIMITS.QUIZ_TRYON_PER_SHOP_DAY.limit).toBeGreaterThan(470 * 10);
    expect(RATE_LIMITS.QUIZ_SHADE_PER_SHOP_DAY.limit).toBeGreaterThan(23 * 10);
    // Up to two ranking calls per results screen (shade merge-and-rerun).
    expect(RATE_LIMITS.QUIZ_RECOMMEND_LLM_PER_SHOP_DAY.limit).toBeGreaterThan(225 * 2 * 10);
  });

  it("admin AI budgets match the spec", () => {
    expect(RATE_LIMITS.ADMIN_TRANSFORM_PER_SHOP_HOUR).toEqual({ limit: 30, windowMs: HOUR });
    expect(RATE_LIMITS.ADMIN_TRANSFORM_PER_SHOP_DAY).toEqual({ limit: 150, windowMs: DAY });
    expect(RATE_LIMITS.CLASSIFY_PRODUCT_PER_SHOP_HOUR).toEqual({ limit: 120, windowMs: HOUR });
    expect(RATE_LIMITS.TRANSLATE_QUIZ_PER_SHOP_DAY).toEqual({ limit: 20, windowMs: DAY });
  });
});

describe("a daily window next to an hourly one", () => {
  const windows = (id: string) => [
    { key: `t:${id}:hour`, limit: 3, windowMs: HOUR },
    { key: `t:${id}:day`, limit: 5, windowMs: DAY },
  ];

  it("refuses once the day is spent without burning the fresh hour", () => {
    // Day already at its cap from earlier hours; the hour window is fresh.
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimits([{ key: "t:day:day", limit: 5, windowMs: DAY }]).allowed).toBe(true);
    }
    expect(checkRateLimits(windows("day")).allowed).toBe(false);
    // The refused request consumed nothing from the hourly window.
    expect(checkRateLimits([{ key: "t:day:hour", limit: 3, windowMs: HOUR }]).remaining).toBe(2);
  });

  it("an hour-blocked retry does not burn the day", () => {
    for (let i = 0; i < 3; i++) expect(checkRateLimits(windows("retry")).allowed).toBe(true);
    for (let i = 0; i < 10; i++) expect(checkRateLimits(windows("retry")).allowed).toBe(false);
    expect(checkRateLimits([{ key: "t:retry:day", limit: 5, windowMs: DAY }]).remaining).toBe(1);
  });
});
