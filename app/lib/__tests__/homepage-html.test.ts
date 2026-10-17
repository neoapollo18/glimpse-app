import { describe, it, expect, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("../supabase.server", () => ({ supabase: {}, findShopByDomain: vi.fn(), uploadReferenceImage: vi.fn() }));

import { analyzeHomepageHtml } from "../brand-profile.server";
import { extractHomepageImageCandidates } from "../brand-library.server";
import {
  HOMEPAGE_HTML_MAX_CHARS,
  HOMEPAGE_MAX_BYTES,
  buttonRadii,
  capHomepageHtml,
  cssVariable,
  h1FontFamily,
  imgTags,
  isPasswordPage,
  ogImageContent,
  stripElements,
  stripTags,
} from "../homepage-html.server";
import { CLASSIC, DAWN, PASSWORD_PAGE, heavyStorefront } from "./fixtures/homepages";

// ---------------------------------------------------------------------
// The parsing as it was before the ReDoS fix, kept verbatim as the oracle
// for "real homepages extract the same values". Only ever run on realistic
// pages and short fuzz strings: on crafted input these scans are quadratic.
// ---------------------------------------------------------------------

const LEGACY_RADIUS = /(?:button|btn)[^{}]*\{[^}]*border-radius\s*:\s*(\d+(?:\.\d+)?)px/gi;

const legacy = {
  isPassword: (url: string, html: string) =>
    /\/password/.test(url) || /<body[^>]*class="[^"]*password/i.test(html),
  fontVar: (html: string, name: string) => {
    const m = new RegExp(`--${name}\\s*:\\s*([^;}]+)[;}]`).exec(html);
    return m ? m[1].trim() : null;
  },
  h1Font: (html: string) => {
    const m = /h1[^{}]*\{[^}]*font-family\s*:\s*([^;}]+)/i.exec(html);
    return m ? m[1].trim() : null;
  },
  radii: (html: string) => [...html.matchAll(LEGACY_RADIUS)].map((m) => m[1]),
  ogImage: (html: string) => {
    const og = /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i.exec(html) ||
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/i.exec(html);
    return og ? og[1] : null;
  },
};

function legacyProfileSignals(html: string, url: string) {
  if (legacy.isPassword(url, html)) return null;
  let headingFont = legacy.fontVar(html, "font-heading-family");
  const bodyFont = legacy.fontVar(html, "font-body-family");
  if (!headingFont) headingFont = legacy.h1Font(html);
  const radiusMatches = legacy.radii(html);
  const buttonRadius = radiusMatches.length
    ? Math.round(radiusMatches.map((m) => parseFloat(m)).reduce((a, b) => a + b, 0) / radiusMatches.length)
    : null;
  const counts = new Map<string, number>();
  for (const m of html.matchAll(/#([0-9a-f]{6})\b/gi)) {
    const hex = `#${m[1].toLowerCase()}`;
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
  const palette = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([h]) => h);
  const head = html.slice(0, Math.floor(html.length * 0.6));
  const imgs = [...head.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  const imageryDensity = Math.min(1, imgs.length / 12);
  const lifestyleImageCount = imgs.filter((tag) => {
    const widths = [...tag.matchAll(/(\d{3,4})w/g)].map((m) => parseInt(m[1], 10));
    const wAttr = /width="(\d+)"/.exec(tag);
    return Math.max(0, ...widths, wAttr ? parseInt(wAttr[1], 10) : 0) >= 1600;
  }).length;
  const copySample = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2000);
  return { headingFont, bodyFont, buttonRadius, palette, imageryDensity, lifestyleImageCount, copySample };
}

function legacyImageCandidates(html: string): Array<{ url: string; width: number | null }> {
  const out: Array<{ url: string; width: number | null }> = [];
  const seen = new Set<string>();
  const push = (url: string | null, width: number | null) => {
    if (!url || !/^https?:\/\//i.test(url) || seen.has(url)) return;
    seen.add(url);
    out.push({ url, width });
  };
  const og = legacy.ogImage(html);
  push(og ? og.replace(/&amp;/g, "&") : null, null);
  const head = html.slice(0, Math.floor(html.length * 0.6));
  for (const m of head.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const src = /src=["']([^"']+)["']/i.exec(tag)?.[1] ?? null;
    if (!src) continue;
    const widths = [...tag.matchAll(/(\d{3,4})w/g)].map((x) => parseInt(x[1], 10));
    const wAttr = /width=["'](\d+)["']/.exec(tag);
    const width = Math.max(0, ...widths, wAttr ? parseInt(wAttr[1], 10) : 0) || null;
    if ((width ?? 0) >= 1200) {
      push(src.startsWith("//") ? `https:${src}` : src, width);
    }
    if (out.length >= 6) break;
  }
  return out.slice(0, 6);
}

const SIGNAL_KEYS = [
  "headingFont",
  "bodyFont",
  "buttonRadius",
  "palette",
  "imageryDensity",
  "lifestyleImageCount",
  "copySample",
] as const;

function profileSignals(html: string, url: string) {
  const out = analyzeHomepageHtml(html, url);
  if (!out) return null;
  return Object.fromEntries(SIGNAL_KEYS.map((k) => [k, out[k]]));
}

/** What production parses: the first HOMEPAGE_MAX_BYTES off the wire, decoded. */
const asFetched = (html: string) =>
  new TextDecoder().decode(Buffer.from(html).subarray(0, HOMEPAGE_MAX_BYTES));

const HOME = "https://glow-lab.com/";

// Dawn variants: full size (mostly repeated sections), and without the font
// custom properties so the h1 fallback scans the whole page, with and
// without an inline h1/button rule.
const DAWN_SECTIONS = DAWN.slice(DAWN.indexOf("<section"), DAWN.indexOf("</main>"));
const DAWN_LARGE = DAWN.replace("</main>", `${DAWN_SECTIONS.repeat(8)}</main>`);
const DAWN_NO_FONT_VARS = DAWN.replace(/--font-(heading|body)-family:[^;]*;/g, "");
const DAWN_INLINE_RULES = DAWN_NO_FONT_VARS.replace(
  "</main>",
  `<style>
  h1, .h1 { font-family: var(--font-heading-family); font-style: var(--font-heading-style); letter-spacing: 0.06rem; }
  .button, .shopify-challenge__button { min-height: 4.5rem; border-radius: 6px; }
  .quick-add__submit.button { padding: 0 1.5rem; border-radius: 4.5px; }
</style></main>`
);
const DAWN_VARIANTS = { DAWN, DAWN_LARGE, DAWN_NO_FONT_VARS, DAWN_INLINE_RULES };
const HEAVY = heavyStorefront();

describe("real homepages extract the same values as before", () => {
  it("Dawn variants: profile signals and image candidates match the old parsing", () => {
    expect(DAWN_LARGE.length).toBeGreaterThan(200_000);
    for (const [name, html] of Object.entries(DAWN_VARIANTS)) {
      expect(profileSignals(html, HOME), name).toEqual(legacyProfileSignals(html, HOME));
      expect(extractHomepageImageCandidates(html), name).toEqual(legacyImageCandidates(html));
    }
    expect(analyzeHomepageHtml(DAWN_INLINE_RULES, HOME)).toMatchObject({
      headingFont: "var(--font-heading-family)",
      buttonRadius: 5,
    });
  });

  it("Dawn: the extracted values are the page's real ones", () => {
    const out = analyzeHomepageHtml(DAWN, HOME)!;
    expect(out.headingFont).toBe('"Playfair Display", serif');
    expect(out.bodyFont).toBe("Assistant, sans-serif");
    expect(out.headingSerif).toBe(true);
    expect(out.palette).toContain("#fbf6f2");
    expect(out.lifestyleImageCount).toBeGreaterThan(0);
    expect(out.copySample).toContain("Glow, naturally.");
    expect(out.copySample).not.toContain("window.shopUrl");
    expect(out.copySample).not.toContain("font-family");

    const got = extractHomepageImageCandidates(DAWN);
    expect(got[0]).toEqual({ url: "http://glow-lab.com/cdn/shop/files/social-share.jpg?v=1712345678", width: null });
    expect(got.some((c) => c.url.includes("hero-glow.jpg") && c.width === 3840)).toBe(true);
  });

  it("classic inline-CSS theme: h1 font, button radius and candidates match the old parsing", () => {
    expect(profileSignals(CLASSIC, HOME)).toEqual(legacyProfileSignals(CLASSIC, HOME));
    const out = analyzeHomepageHtml(CLASSIC, HOME)!;
    expect(out.headingFont).toBe('"Lora", Georgia, serif');
    expect(out.buttonRadius).toBe(10);
    const got = extractHomepageImageCandidates(CLASSIC);
    expect(got).toEqual(legacyImageCandidates(CLASSIC));
    expect(got[0].url).toBe(
      "https://cdn.shopify.com/s/files/1/0123/4567/files/og-petal.png?v=1650000000&width=1200"
    );
  });

  it("a 3.5 MB storefront parses in full, matching the old parsing", () => {
    // The shapes that made a 1 MB cap or bounded regexes change real pages.
    expect(HEAVY.length).toBeGreaterThan(3_000_000);
    expect(Buffer.byteLength(HEAVY)).toBeLessThan(HOMEPAGE_MAX_BYTES);
    expect(HEAVY.indexOf('property="og:image"')).toBeGreaterThan(1_000_000);
    const longSelectors = [...HEAVY.matchAll(LEGACY_RADIUS)].filter((m) => m[0].indexOf("{") > 50_000);
    expect(longSelectors.length).toBeGreaterThan(0);

    const html = asFetched(HEAVY);
    expect(html).toBe(HEAVY);
    expect(profileSignals(html, HOME)).toEqual(legacyProfileSignals(HEAVY, HOME));
    expect(extractHomepageImageCandidates(capHomepageHtml(html))).toEqual(legacyImageCandidates(HEAVY));

    const out = analyzeHomepageHtml(html, HOME)!;
    expect(out.headingFont).toBe("inherit"); // the h1 rule reached through 90 KB of cards
    expect(out.lifestyleImageCount).toBe(40); // none of them in the first 1M characters
    expect(out.copySample).toContain("Lumen Beauty");
    expect(out.copySample).not.toContain("window.Lumen");
    expect(extractHomepageImageCandidates(html)[0].url).toBe(
      "http://lumen-beauty.com/cdn/shop/files/share.jpg?v=1&width=1200"
    );
  });

  it("password pages are still skipped, by final URL or body class", () => {
    expect(analyzeHomepageHtml(PASSWORD_PAGE, HOME)).toBeNull();
    expect(analyzeHomepageHtml(DAWN, "https://glow-lab.com/password")).toBeNull();
    for (const [url, html] of [
      [HOME, PASSWORD_PAGE],
      ["https://glow-lab.com/password", DAWN],
      [HOME, DAWN],
      [HOME, CLASSIC],
      [HOME, HEAVY],
      [HOME, '<body id="x" class="template-password gradient">'],
    ]) {
      expect(isPasswordPage(url, html)).toBe(legacy.isPassword(url, html));
    }
  });

  it("only the first HOMEPAGE_HTML_MAX_CHARS characters are parsed", () => {
    expect(capHomepageHtml(DAWN)).toBe(DAWN);
    const late = "<style>:root{--font-heading-family: Late;}</style>";
    const padded = "<p>x</p>".repeat(HOMEPAGE_HTML_MAX_CHARS / 8) + late;
    expect(capHomepageHtml(padded).length).toBe(HOMEPAGE_HTML_MAX_CHARS);
    expect(analyzeHomepageHtml(padded, HOME)!.headingFont).toBeNull();
    expect(analyzeHomepageHtml(padded.slice(late.length), HOME)!.headingFont).toBe("Late");
  });
});

// Saved storefront homepages are third-party pages of several MB each, so
// they are not checked in. To compare them with the old parsing:
//   HOMEPAGE_SNAPSHOTS_DIR=/path/to/html npx vitest run app/lib/__tests__/homepage-html.test.ts
const SNAPSHOTS = process.env.HOMEPAGE_SNAPSHOTS_DIR;

describe.skipIf(!SNAPSHOTS)("saved storefront homepages extract the same values as before", () => {
  const files = SNAPSHOTS ? readdirSync(SNAPSHOTS).filter((f) => f.endsWith(".html")) : [];
  for (const file of files) {
    it(file, () => {
      const page = readFileSync(join(SNAPSHOTS!, file), "utf8");
      const html = asFetched(page);
      expect(profileSignals(html, HOME)).toEqual(legacyProfileSignals(page, HOME));
      expect(extractHomepageImageCandidates(capHomepageHtml(html))).toEqual(legacyImageCandidates(page));
    }, 60_000);
  }
});

// Deterministic PRNG so a failure reproduces.
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomHtml(next: () => number, tokens: string[], maxTokens: number): string {
  const n = Math.floor(next() * maxTokens);
  let s = "";
  for (let i = 0; i < n; i++) s += tokens[Math.floor(next() * tokens.length)];
  return s;
}

describe("single-pass scans return exactly what the regexes they replace returned", () => {
  const next = rng(20261016);

  // Runs `scan` and `oracle` on random strings built from `tokens`, and
  // checks the fuzz reached the matching paths, not only the misses.
  function fuzz<T>(tokens: string[], scan: (html: string) => T, oracle: (html: string) => T, hit: (r: T) => boolean) {
    let hits = 0;
    for (let i = 0; i < 4000; i++) {
      const html = randomHtml(next, tokens, 40);
      const expected = oracle(html);
      expect(scan(html), JSON.stringify(html)).toEqual(expected);
      if (hit(expected)) hits++;
    }
    expect(hits).toBeGreaterThan(200);
  }

  it("imgTags == matchAll(/<img\\b[^>]*>/gi)", () => {
    const tokens = ["<img", "<IMG", "<img ", "<imgx", "<im", "g", ">", "<", "a", " ", "src='x'", "\n", "<img>", "<IMG/>"];
    fuzz(tokens, (h) => [...imgTags(h)], (h) => [...h.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]), (r) => r.length > 0);
  });

  it("stripElements == the lazy <script>/<style> regex strips", () => {
    const tokens = ["<script", "<SCRIPT", "</script>", "</SCRIPT>", "</script", "<scripts", "<style", "</style>",
      "<STYLE>", "</Style>", "x", " ", ">", "<", "/"];
    fuzz(tokens, (h) => stripElements(h, "script"), (h) => h.replace(/<script[\s\S]*?<\/script>/gi, " "), () => true);
    fuzz(tokens, (h) => stripElements(h, "style"), (h) => h.replace(/<style[\s\S]*?<\/style>/gi, " "), () => true);
  });

  it("stripTags == replace(/<[^>]+>/g, \" \")", () => {
    const tokens = ["<", ">", "<>", "a", " ", "<a>", "<<", ">>", "/", "\n", "</p>"];
    fuzz(tokens, stripTags, (h) => h.replace(/<[^>]+>/g, " "), () => true);
  });

  it("cssVariable == /--NAME\\s*:\\s*([^;}]+)[;}]/", () => {
    const tokens = ["--font-heading-family", "--font-heading-family:", "--font-heading-family :", ":", " ", "\n", ";",
      "}", "{", "x", "Serif", "-", "--", "font-heading-family", "--font-heading-family-x:"];
    fuzz(
      tokens,
      (h) => cssVariable(h, "font-heading-family"),
      (h) => legacy.fontVar(h, "font-heading-family"),
      (r) => r !== null
    );
  });

  it("h1FontFamily == /h1[^{}]*\\{[^}]*font-family\\s*:\\s*([^;}]+)/i", () => {
    const tokens = ["h1", "H1", "h1 ", "{", "}", ";", ":", " ", "font-family", "FONT-FAMILY", "font-family:",
      "font-family :", "x", "h", "1", "\n", "Lora"];
    fuzz(tokens, h1FontFamily, legacy.h1Font, (r) => r !== null);
  });

  it("buttonRadii == the captures of /(?:button|btn)[^{}]*\\{[^}]*border-radius\\s*:\\s*(\\d+(?:\\.\\d+)?)px/gi", () => {
    const tokens = ["button", "btn", "BTN", "Button", ".btn {", "{", "}", ";", ":", " ", "border-radius",
      "border-radius:", "BORDER-RADIUS :", "border-radius: 12px", "border-radius:1.5PX;", "12", "4", ".", "5", "px",
      "PX", "p", "x", "bu", "tn"];
    fuzz(tokens, buttonRadii, legacy.radii, (r) => r.length > 0);
  });

  it("ogImageContent == the two og:image meta regexes", () => {
    const tokens = ["<meta", "<META ", " ", ">", "<", 'property="og:image"', "property='og:image:secure_url'",
      'property="og:image', 'property="og:image:secure_url"', 'content="', "content='", '"', "'", "x", "&amp;",
      "og:image", "content=", "/"];
    fuzz(tokens, ogImageContent, legacy.ogImage, (r) => r !== null);
  });

  it("isPasswordPage == /<body[^>]*class=\"[^\"]*password/i", () => {
    const tokens = ["<body", "<BODY ", " ", ">", '"', 'class="', 'CLASS="', "class=", "password", "PASSWORD", "x",
      "<", "pass", "word"];
    fuzz(tokens, (h) => isPasswordPage(HOME, h), (h) => legacy.isPassword(HOME, h), (r) => r);
  });
});

describe("crafted homepages can't stall the event loop", () => {
  const repeat = (unit: string, size = HOMEPAGE_HTML_MAX_CHARS) =>
    unit.repeat(Math.ceil(size / unit.length)).slice(0, size);
  const timed = (fn: () => void) => {
    const started = performance.now();
    fn();
    return performance.now() - started;
  };

  // The shapes that made the old scans quadratic (or cubic, for og:image),
  // and the worst ones for bounded regexes, at the full parse cap. A pair
  // is [prefix, unit]: one rule, tag or attribute holding the whole page.
  const PAYLOADS: Array<string | [string, string]> = [
    "h1",
    "btn",
    "<script",
    "<",
    "<img ",
    "h1{",
    "h1{h1",
    "h1".repeat(99) + "{",
    "btn{",
    "button",
    "<style",
    "<body ",
    '<body class="',
    "<body " + 'class="x'.repeat(140) + "y".repeat(1000),
    "<meta ",
    '<meta property="og:image" ',
    '<meta content="',
    "<meta " + 'property="og:image" '.repeat(50) + 'content="' + "x".repeat(1999),
    "<meta " + 'content="a" '.repeat(80) + 'content="' + "x".repeat(1990) + '"',
    "--font-heading-family:",
    "font-family:",
    "border-radius:",
    "border-radius: 1",
    ["h1{", "font-family:"],
    ["btn{", "border-radius: 1"],
    ['<meta property="og:image" ', 'content="x" '],
    ['<body class="', "passwor"],
  ];

  for (const payload of PAYLOADS) {
    const [prefix, unit] = typeof payload === "string" ? ["", payload] : payload;
    const label = JSON.stringify(unit.length > 40 ? `${unit.slice(0, 40)}...` : unit);
    it(`8 MB of ${prefix ? `${JSON.stringify(prefix)} + ` : ""}${label} parses in under a second`, () => {
      const html = (prefix + repeat(unit)).slice(0, HOMEPAGE_HTML_MAX_CHARS);
      const ms = timed(() => {
        analyzeHomepageHtml(html, HOME);
        isPasswordPage(HOME, html);
        extractHomepageImageCandidates(capHomepageHtml(html));
      });
      expect(ms).toBeLessThan(1000);
    });
  }

  // Review finding: every font-family declaration in one block ends at the
  // same "}", so trimming each candidate rescanned the whitespace tail.
  it("many h1 font-family declarations before a long whitespace tail stay linear", () => {
    const half = Math.floor(HOMEPAGE_HTML_MAX_CHARS / 2) - 32;
    const html = "<style>h1{" + repeat("font-family:x", half) + " ".repeat(half) + "}</style>";
    const ms = timed(() => analyzeHomepageHtml(html, HOME));
    expect(ms).toBeLessThan(1000);
  });

  it("a page past the cap costs no more than the cap", () => {
    const ms = timed(() => analyzeHomepageHtml(repeat("h1{", 3 * HOMEPAGE_HTML_MAX_CHARS), HOME));
    expect(ms).toBeLessThan(1000);
  });
});
