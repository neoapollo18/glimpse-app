/**
 * Brand Profile extraction (Overhaul Part 1 / task A1).
 *
 * Builds a per-shop Brand Profile — design tokens + tone/category/imagery
 * signals with per-value source and confidence — from four sources merged
 * by precedence:
 *
 *   theme settings > Brand API > homepage analysis > preset defaults
 *   (except accent, where Brand API primary wins if it passes contrast)
 *
 * Schema is frozen in docs/overhaul/CONTRACTS.md (Contract 1). Every
 * rendered pair must pass WCAG AA; the accent is lightness-stepped until
 * it passes, else the template preset accent is used and contrastAdjusted
 * is set. The playful house style is NEVER the fallback.
 *
 * Budget: each network source has its own timeout; the whole extraction
 * runs sources in parallel and is safe to run alongside catalog sync.
 * Idempotent: re-extraction on an unchanged store produces the same
 * profile (deterministic merges, no randomness).
 */

import { supabase } from "./supabase.server";
import {
  selectTemplate,
  TEMPLATES,
  type BrandTokens,
  type TemplateAssignment,
  type TemplateSignals,
} from "./quiz-templates";

// ---------------------------------------------------------------------
// Types (Contract 1)
// ---------------------------------------------------------------------

export type Confidence = "high" | "medium" | "low";
type TokenSource = "theme" | "brand_api" | "homepage" | "preset";

export interface BrandProfile {
  version: 1;
  tokens: BrandTokens;
  sources: Record<string, { source: TokenSource; confidence: Confidence }>;
  confidence: Confidence;
  contrastAdjusted: boolean;
  theme: { name: string | null; version: string | null; family: "dawn" | "unknown" };
  brand: {
    slogan: string | null;
    logoUrl: string | null;
    coverImageUrl: string | null;
    primaryColor: string | null;
    secondaryColor: string | null;
  };
  homepage: {
    headingFont: string | null;
    bodyFont: string | null;
    buttonRadius: number | null;
    palette: string[];
    avgSaturation: number | null;
    avgLightness: number | null;
    imageryDensity: number | null;
    lifestyleImageCount: number;
    copySample: string;
  };
  catalog: {
    productCount: number;
    types: string[];
    collections: string[];
    imageCoverage: number | null;
  };
  category: string | null;
  tone: "playful" | "neutral" | "refined" | null;
  templateAssignment: TemplateAssignment;
  /** Verbatim brand statements only (v2 Part 4/G): the Brand API slogan
   * and a guarantee/shipping line lifted verbatim from homepage copy.
   * Never paraphrased, never invented — fewer is fine. */
  trustStatements: string[];
}

/** Minimal admin GraphQL caller: (query, variables?) => data. Callers wrap
 * either authenticate.admin's client or directGraphql (offline token). */
export type AdminGraphql = (query: string, variables?: Record<string, unknown>) => Promise<any>;

// ---------------------------------------------------------------------
// Color math (WCAG AA guardrails)
// ---------------------------------------------------------------------

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (x: number) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

function luminance(hex: string): number | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number | null {
  const la = luminance(a);
  const lb = luminance(b);
  if (la === null || lb === null) return null;
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

function setLightness(hex: string, l: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const [h, s] = rgbToHsl(...rgb);
  return rgbToHex(...hslToRgb(h, s, Math.max(0, Math.min(1, l))));
}

function getHsl(hex: string): [number, number, number] | null {
  const rgb = hexToRgb(hex);
  return rgb ? rgbToHsl(...rgb) : null;
}

/**
 * Step a color's lightness (0.05 increments, both directions) until it
 * clears `min` contrast against bg. Returns null when no step passes.
 */
export function stepUntilContrast(color: string, bg: string, min: number): string | null {
  if ((contrastRatio(color, bg) ?? 0) >= min) return color;
  const hsl = getHsl(color);
  if (!hsl) return null;
  for (let d = 0.05; d <= 0.9; d += 0.05) {
    for (const dir of [-1, 1]) {
      const candidate = setLightness(color, hsl[2] + dir * d);
      if ((contrastRatio(candidate, bg) ?? 0) >= min) return candidate;
    }
  }
  return null;
}

function textOn(bg: string): string {
  return (contrastRatio("#ffffff", bg) ?? 0) >= (contrastRatio("#16161a", bg) ?? 0)
    ? "#ffffff"
    : "#16161a";
}

/** Surface = bg shifted 3-6% lightness (toward the text's direction). */
function deriveSurface(bg: string, text: string): string {
  const hsl = getHsl(bg);
  if (!hsl) return "#ffffff";
  const darkText = (luminance(text) ?? 0) < 0.5;
  const delta = darkText ? -0.04 : 0.05;
  return setLightness(bg, hsl[2] + (hsl[2] > 0.5 ? delta : -delta * 1.2));
}

function deriveBorder(text: string): string {
  const rgb = hexToRgb(text) ?? [22, 22, 26];
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.2)`;
}

// ---------------------------------------------------------------------
// Source 1 — theme settings (config/settings_data.json via Admin API)
// ---------------------------------------------------------------------

const THEME_QUERY = `#graphql
  query OverhaulThemeSettings {
    themes(first: 1, roles: [MAIN]) {
      nodes {
        name
        themeStoreId
        files(filenames: ["config/settings_data.json"], first: 1) {
          nodes {
            body {
              ... on OnlineStoreThemeFileBodyText { content }
            }
          }
        }
      }
    }
  }
`;

/** Free OS 2.0 themes sharing Dawn's settings schema (spec Part 1). */
const DAWN_FAMILY = /^(dawn|refresh|craft|sense|studio|ride|taste|crave|colorblock|publisher|origin|spotlight)/i;

const SERIF_FAMILIES =
  /(georgia|garamond|baskerville|caslon|playfair|didot|bodoni|cormorant|lora|merriweather|pt serif|source serif|crimson|libre caslon|tiempos|freight|butler|canela|times)/i;
const ROUNDED_FAMILIES = /(quicksand|nunito|baloo|comfortaa|varela round|fredoka|rounded)/i;

/** Shopify font handle ("playfair_display_n4") → CSS stack + weight. */
function fontHandleToStack(handle: string): { stack: string; serif: boolean; rounded: boolean } | null {
  if (!handle || typeof handle !== "string") return null;
  const m = /^([a-z0-9_]+?)(?:_(n|i)(\d))?$/i.exec(handle.trim());
  if (!m) return null;
  const family = m[1].replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const serif = SERIF_FAMILIES.test(family);
  const rounded = ROUNDED_FAMILIES.test(family);
  const fallback = serif ? "Georgia, serif" : "-apple-system, BlinkMacSystemFont, sans-serif";
  return { stack: `"${family}", ${fallback}`, serif, rounded };
}

interface ThemeExtract {
  themeName: string | null;
  family: "dawn" | "unknown";
  headingFont: { stack: string; serif: boolean; rounded: boolean } | null;
  bodyFont: { stack: string; serif: boolean; rounded: boolean } | null;
  bg: string | null;
  text: string | null;
  accent: string | null;
  accentText: string | null;
  radiusButton: number | null;
  radiusCard: number | null;
  pageWidth: number | null;
}

function walkSettings(obj: any, visit: (key: string, value: unknown) => void) {
  if (!obj || typeof obj !== "object") return;
  for (const [k, v] of Object.entries(obj)) {
    visit(k, v);
    if (v && typeof v === "object") walkSettings(v, visit);
  }
}

export async function extractFromTheme(adminGraphql: AdminGraphql): Promise<ThemeExtract | null> {
  const data = await adminGraphql(THEME_QUERY);
  const node = data?.themes?.nodes?.[0];
  if (!node) return null;
  const out: ThemeExtract = {
    themeName: node.name ?? null,
    family: DAWN_FAMILY.test(String(node.name ?? "")) ? "dawn" : "unknown",
    headingFont: null, bodyFont: null,
    bg: null, text: null, accent: null, accentText: null,
    radiusButton: null, radiusCard: null, pageWidth: null,
  };
  const raw = node.files?.nodes?.[0]?.body?.content;
  if (!raw) return out;
  let settings: any;
  try {
    // settings_data.json legally opens with a /* comment */ block.
    settings = JSON.parse(String(raw).replace(/^\s*\/\*[\s\S]*?\*\//, ""));
  } catch {
    return out;
  }
  const current = typeof settings?.current === "string"
    ? settings?.presets?.[settings.current]
    : settings?.current;
  if (!current || typeof current !== "object") return out;

  // Dawn-family direct mapping: first color scheme carries the primary
  // background/text/button colors.
  const schemes = current.color_schemes;
  if (schemes && typeof schemes === "object") {
    const first: any = Object.values(schemes)[0];
    const s = first?.settings ?? first;
    if (s && typeof s === "object") {
      out.bg = typeof s.background === "string" ? s.background : null;
      out.text = typeof s.text === "string" ? s.text : null;
      out.accent = typeof s.button === "string" ? s.button : null;
      out.accentText = typeof s.button_label === "string" ? s.button_label : null;
    }
  }
  if (typeof current.type_header_font === "string") {
    out.headingFont = fontHandleToStack(current.type_header_font);
  }
  if (typeof current.type_body_font === "string") {
    out.bodyFont = fontHandleToStack(current.type_body_font);
  }

  // Generic heuristic scan (also fills gaps on Dawn-family themes whose
  // key names drifted across versions).
  walkSettings(current, (key, value) => {
    const k = key.toLowerCase();
    if (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)) {
      if (!out.bg && /background|bg_color/.test(k) && !/button|badge|card/.test(k)) out.bg = value;
      if (!out.text && /(^|_)(text|foreground|heading)_?colou?r/.test(k)) out.text = value;
      if (!out.accent && /(button|accent|primary)_?(background|colou?r)?$/.test(k) && !/label|text/.test(k)) out.accent = value;
    }
    if (typeof value === "number") {
      if (out.radiusButton === null && /button.*(radius|corner)/.test(k)) out.radiusButton = value;
      if (out.radiusCard === null && /(card|block).*(radius|corner)/.test(k)) out.radiusCard = value;
      if (out.pageWidth === null && /page_?width/.test(k)) out.pageWidth = value;
    }
    if (!out.headingFont && typeof value === "string" && /header_font|heading_font/.test(k)) {
      out.headingFont = fontHandleToStack(value);
    }
    if (!out.bodyFont && typeof value === "string" && /body_font/.test(k)) {
      out.bodyFont = fontHandleToStack(value);
    }
  });
  return out;
}

// ---------------------------------------------------------------------
// Source 2 — Shopify Brand API (shop.brand)
// ---------------------------------------------------------------------

const BRAND_QUERY = `#graphql
  query OverhaulBrand {
    shop {
      brand {
        slogan
        shortDescription
        logo { image { url } }
        coverImage { image { url } }
        colors {
          primary { background foreground }
          secondary { background foreground }
        }
      }
    }
  }
`;

interface BrandExtract {
  slogan: string | null;
  logoUrl: string | null;
  coverImageUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
}

export async function extractFromBrandApi(adminGraphql: AdminGraphql): Promise<BrandExtract | null> {
  const data = await adminGraphql(BRAND_QUERY);
  const brand = data?.shop?.brand;
  if (!brand) return null;
  const hex = (v: unknown) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v : null);
  return {
    slogan: brand.slogan ?? null,
    logoUrl: brand.logo?.image?.url ?? null,
    coverImageUrl: brand.coverImage?.image?.url ?? null,
    primaryColor: hex(brand.colors?.primary?.[0]?.background ?? brand.colors?.primary?.background),
    secondaryColor: hex(brand.colors?.secondary?.[0]?.background ?? brand.colors?.secondary?.background),
  };
}

// ---------------------------------------------------------------------
// Source 3 — homepage analysis (static fetch; no headless browser)
// ---------------------------------------------------------------------

interface HomepageExtract {
  headingFont: string | null;
  headingSerif: boolean;
  headingRounded: boolean;
  bodyFont: string | null;
  buttonRadius: number | null;
  palette: string[];
  avgSaturation: number | null;
  avgLightness: number | null;
  imageryDensity: number | null;
  lifestyleImageCount: number;
  copySample: string;
}

async function fetchWithTimeout(url: string, ms: number): Promise<Response | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, {
      signal: ctl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; GleameBrandBot/1.0)" },
      redirect: "follow",
    });
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function analyzeHomepage(shopDomain: string): Promise<HomepageExtract | null> {
  const res = await fetchWithTimeout(`https://${shopDomain}/`, 6000);
  if (!res || !res.ok) return null;
  const html = await res.text();
  // Password page → no public homepage; caller degrades gracefully.
  if (/\/password/.test(res.url) || /<body[^>]*class="[^"]*password/i.test(html)) return null;

  const out: HomepageExtract = {
    headingFont: null, headingSerif: false, headingRounded: false,
    bodyFont: null, buttonRadius: null,
    palette: [], avgSaturation: null, avgLightness: null,
    imageryDensity: null, lifestyleImageCount: 0, copySample: "",
  };

  // Dawn (and many OS 2.0 themes) print font CSS custom properties inline.
  const fontVar = (name: string) => {
    const m = new RegExp(`--${name}\\s*:\\s*([^;}]+)[;}]`).exec(html);
    return m ? m[1].trim() : null;
  };
  out.headingFont = fontVar("font-heading-family");
  out.bodyFont = fontVar("font-body-family");
  if (!out.headingFont) {
    const m = /h1[^{}]*\{[^}]*font-family\s*:\s*([^;}]+)/i.exec(html);
    out.headingFont = m ? m[1].trim() : null;
  }
  if (out.headingFont) {
    out.headingSerif = SERIF_FAMILIES.test(out.headingFont) || /\bserif\s*$/i.test(out.headingFont);
    out.headingRounded = ROUNDED_FAMILIES.test(out.headingFont);
  }

  // Button radius: scan inline CSS for button border-radius declarations.
  const radiusMatches = [...html.matchAll(/(?:button|btn)[^{}]*\{[^}]*border-radius\s*:\s*(\d+(?:\.\d+)?)px/gi)];
  if (radiusMatches.length) {
    out.buttonRadius = Math.round(
      radiusMatches.map((m) => parseFloat(m[1])).reduce((a, b) => a + b, 0) / radiusMatches.length
    );
  }

  // Palette: hex colors in inline styles/CSS, most frequent first.
  const counts = new Map<string, number>();
  for (const m of html.matchAll(/#([0-9a-f]{6})\b/gi)) {
    const hex = `#${m[1].toLowerCase()}`;
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
  out.palette = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([h]) => h);
  const hsls = out.palette.map(getHsl).filter(Boolean) as [number, number, number][];
  if (hsls.length) {
    out.avgSaturation = hsls.reduce((a, h) => a + h[1], 0) / hsls.length;
    out.avgLightness = hsls.reduce((a, h) => a + h[2], 0) / hsls.length;
  }

  // Imagery: count <img> in the first 60% of the document (fold proxy);
  // lifestyle = srcset/width hints ≥ 1600px.
  const head = html.slice(0, Math.floor(html.length * 0.6));
  const imgs = [...head.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  out.imageryDensity = Math.min(1, imgs.length / 12);
  out.lifestyleImageCount = imgs.filter((tag) => {
    const widths = [...tag.matchAll(/(\d{3,4})w/g)].map((m) => parseInt(m[1], 10));
    const wAttr = /width="(\d+)"/.exec(tag);
    return Math.max(0, ...widths, wAttr ? parseInt(wAttr[1], 10) : 0) >= 1600;
  }).length;

  // Copy sample for tone classification: strip scripts/styles/tags.
  out.copySample = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2000);

  return out;
}

// ---------------------------------------------------------------------
// Source 4 — catalog metadata (synced Supabase data; no network)
// ---------------------------------------------------------------------

interface CatalogExtract {
  productCount: number;
  types: string[];
  collections: string[];
  imageCoverage: number | null;
  category: string | null;
  /** Average catalog price in cents (considered-purchase signal, v2). */
  avgPriceCents: number | null;
  /** Average variant option (facet) count per variant, from " / "-joined
   * variant titles ("Red / Small" = 2). "Default Title" counts as 1. */
  avgOptionCount: number | null;
}

async function extractFromCatalog(shopId: string): Promise<CatalogExtract> {
  const { data, count } = await supabase
    .from("products")
    .select("id, product_type, image_url, price", { count: "exact" })
    .eq("shop_id", shopId)
    .neq("status", "deleted")
    .limit(1000);
  const rows = data ?? [];
  const typeCounts = new Map<string, number>();
  let withImage = 0;
  const prices: number[] = [];
  for (const r of rows) {
    const t = (r.product_type ?? "").trim();
    if (t) typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
    if (r.image_url) withImage++;
    const price = typeof r.price === "number" ? r.price : parseFloat(String(r.price ?? ""));
    if (Number.isFinite(price) && price > 0) prices.push(price);
  }
  const avgPriceCents = prices.length
    ? Math.round((prices.reduce((a, b) => a + b, 0) / prices.length) * 100)
    : null;

  // Variant option counts from a bounded sample of variant titles.
  let avgOptionCount: number | null = null;
  const sampleIds = rows.map((r) => r.id).filter(Boolean).slice(0, 150);
  if (sampleIds.length) {
    const { data: variantSample } = await supabase
      .from("product_variants")
      .select("variant_title")
      .in("product_id", sampleIds)
      .neq("status", "deleted")
      .limit(1000);
    const segCounts = (variantSample ?? [])
      .map((v) => String(v.variant_title ?? "").trim())
      .filter(Boolean)
      .map((title) => title.split("/").length);
    if (segCounts.length) {
      avgOptionCount = segCounts.reduce((a, b) => a + b, 0) / segCounts.length;
    }
  }
  const types = [...typeCounts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  const top = types[0] ?? null;
  let category: string | null = null;
  if (top) {
    if (/nail|polish|lacquer|press.?on/i.test(top)) category = "color-cosmetics";
    else if (/lip|mascara|foundation|makeup|cosmetic|shadow|blush|brow/i.test(top)) category = "color-cosmetics";
    else if (/skin|serum|moisturi|cleanser|spf|cream/i.test(top)) category = "skincare";
    else if (/hair|shampoo|conditioner|extension/i.test(top)) category = "haircare";
    else if (/apparel|shirt|dress|jewelry|ring|necklace|accessor/i.test(top)) category = "fit-style";
    else category = top.toLowerCase();
  }
  return {
    productCount: count ?? rows.length,
    types: types.slice(0, 12),
    collections: [], // collections are not synced yet (C1 adds them)
    imageCoverage: rows.length ? withImage / rows.length : null,
    category,
    avgPriceCents,
    avgOptionCount,
  };
}

// ---------------------------------------------------------------------
// Trust statements (verbatim only — spec forbids invented copy)
// ---------------------------------------------------------------------

const GUARANTEE_RE =
  /\b((?:free (?:standard |worldwide |express |us )?(?:shipping|returns?)|\d+[- ]day (?:returns?|money[- ]back guarantee|guarantee|trial)|money[- ]back guarantee|satisfaction guaranteed?|lifetime (?:warranty|guarantee)|\d+[- ]year warranty)[^.!?]{0,60})/i;

/** Verbatim-only extraction: the Brand API slogan plus one guarantee /
 * shipping line found word-for-word in the homepage copy (when trivially
 * extractable). Anything not verbatim is simply omitted. */
export function extractTrustStatements(slogan: string | null, homepageCopy: string): string[] {
  const out: string[] = [];
  const s = slogan?.trim();
  if (s) out.push(s);
  const m = GUARANTEE_RE.exec(homepageCopy);
  if (m) {
    const line = m[1].trim().replace(/\s+/g, " ");
    if (line && !out.includes(line)) out.push(line);
  }
  return out;
}

// ---------------------------------------------------------------------
// Tone classification (P5-lite: heuristic; the generation pipeline may
// refine with an LLM pass, but the profile always carries a value).
// ---------------------------------------------------------------------

function classifyTone(copy: string, avgSaturation: number | null, radius: number | null):
  "playful" | "neutral" | "refined" {
  const playfulHits = (copy.match(/!|😍|✨|🎉|omg|obsessed|bestie|vibes|fun|yay|treat yourself/gi) ?? []).length;
  const refinedHits = (copy.match(/\b(crafted|refined|timeless|elevated|essential|considered|heritage|atelier|purity)\b/gi) ?? []).length;
  if (playfulHits >= 5 || (avgSaturation !== null && avgSaturation > 0.55) || (radius !== null && radius >= 18)) {
    return "playful";
  }
  if (refinedHits >= 2 || (avgSaturation !== null && avgSaturation < 0.2)) return "refined";
  return "neutral";
}

// ---------------------------------------------------------------------
// Merge + guardrails
// ---------------------------------------------------------------------

const AA_BODY = 4.5;
const AA_LARGE = 3.0;

export async function extractBrandProfile(
  shopDomain: string,
  adminGraphql: AdminGraphql
): Promise<BrandProfile> {
  const shop = await supabase.from("shops").select("id").eq("shop_domain", shopDomain).single();
  if (shop.error || !shop.data) throw new Error(`brand-profile: unknown shop ${shopDomain}`);

  const settle = <T,>(p: Promise<T>): Promise<T | null> => p.catch(() => null);
  const [theme, brand, homepage, catalog] = await Promise.all([
    settle(extractFromTheme(adminGraphql)),
    settle(extractFromBrandApi(adminGraphql)),
    settle(analyzeHomepage(shopDomain)),
    extractFromCatalog(shop.data.id),
  ]);

  const sources: BrandProfile["sources"] = {};
  const pick = <T,>(
    key: string,
    themeVal: T | null | undefined,
    homepageVal: T | null | undefined,
    presetVal: T
  ): T => {
    if (themeVal !== null && themeVal !== undefined) {
      sources[key] = { source: "theme", confidence: "high" };
      return themeVal;
    }
    if (homepageVal !== null && homepageVal !== undefined) {
      sources[key] = { source: "homepage", confidence: "medium" };
      return homepageVal;
    }
    sources[key] = { source: "preset", confidence: "low" };
    return presetVal;
  };

  // Neutral preset fallbacks come from t2 Ivory — never the playful look.
  const neutral = TEMPLATES.t2.presets[0].tokens;

  const fontHeading = pick("fontHeading", theme?.headingFont?.stack, homepage?.headingFont, neutral.fontHeading);
  const fontBody = pick("fontBody", theme?.bodyFont?.stack, homepage?.bodyFont, neutral.fontBody);
  const colorBg = pick("colorBg", theme?.bg, null, neutral.colorBg);
  let colorText = pick("colorText", theme?.text, null, neutral.colorText);

  // Accent: Brand API primary wins when it passes AA-large on bg.
  let colorAccent: string;
  if (brand?.primaryColor && (contrastRatio(brand.primaryColor, colorBg) ?? 0) >= AA_LARGE) {
    colorAccent = brand.primaryColor;
    sources.colorAccent = { source: "brand_api", confidence: "high" };
  } else {
    colorAccent = pick("colorAccent", theme?.accent, homepage?.palette?.[2] ?? null, neutral.colorAccent);
  }

  const radiusButton = pick("radiusButton", theme?.radiusButton, homepage?.buttonRadius, neutral.radiusButton);
  const radiusCard = pick("radiusCard", theme?.radiusCard, null, Math.max(neutral.radiusCard, radiusButton));
  const maxWidth = pick("maxWidth", theme?.pageWidth, null, neutral.maxWidth);

  // --- Guardrails: no rendered pair may fail WCAG AA. ---
  let contrastAdjusted = false;
  const fixedText = stepUntilContrast(colorText, colorBg, AA_BODY);
  if (fixedText === null) {
    colorText = textOn(colorBg) === "#ffffff" ? "#ffffff" : "#16161a";
    contrastAdjusted = true;
  } else if (fixedText !== colorText) {
    colorText = fixedText;
    contrastAdjusted = true;
  }
  const fixedAccent = stepUntilContrast(colorAccent, colorBg, AA_LARGE);
  if (fixedAccent === null) {
    colorAccent = neutral.colorAccent;
    contrastAdjusted = true;
  } else if (fixedAccent !== colorAccent) {
    colorAccent = fixedAccent;
    contrastAdjusted = true;
  }
  const colorAccentText = textOn(colorAccent);

  const tokens: BrandTokens = {
    fontHeading,
    fontBody,
    colorBg,
    colorText,
    colorAccent,
    colorAccentText,
    colorSurface: deriveSurface(colorBg, colorText),
    colorBorder: deriveBorder(colorText),
    radiusButton,
    radiusCard,
    spaceUnit: 4,
    maxWidth,
  };

  // Overall confidence = lowest of the four load-bearing tokens.
  const order: Confidence[] = ["high", "medium", "low"];
  const overall = (["fontHeading", "fontBody", "colorBg", "colorAccent"] as const)
    .map((k) => sources[k]?.confidence ?? "low")
    .sort((a, b) => order.indexOf(b) - order.indexOf(a))[0] as Confidence;

  const tone = classifyTone(homepage?.copySample ?? "", homepage?.avgSaturation ?? null, radiusButton);

  // v2 signal source: the brand library (Part 4.1). Lazy import + settle:
  // a missing brand_library table (migration 075 pending) or any stats
  // failure degrades to the v1 signals, never throws.
  const stats = await import("./brand-library.server")
    .then((lib) => lib.libraryStats(shopDomain))
    .catch(() => null);
  // Distinguish "library built" from "not built yet": an unbuilt (or
  // missing-table) library reports all-zero/null stats, and writing those
  // zeros into the optional signals would wrongly fail T1/T3 gates for
  // stores whose v1 fallbacks pass. Only trust stats that show content.
  const libraryBuilt = Boolean(
    stats && (stats.heroImageCount > 0 || stats.lifestyleImageCount > 0 || stats.bannerCoverage !== null)
  );

  // Per-answer coverage: variant image coverage (the true per-answer
  // proxy, populated since the v2 variant-image sync fix) when known,
  // else the v1 product-image coverage.
  const variantCoverage = stats?.variantImageCoverage ?? null;
  const imagePerAnswerCoverage =
    variantCoverage !== null && catalog.imageCoverage !== null
      ? Math.max(variantCoverage, catalog.imageCoverage)
      : variantCoverage ?? catalog.imageCoverage;

  const signals: TemplateSignals = {
    serifHeading: Boolean(theme?.headingFont?.serif || homepage?.headingSerif || /serif/i.test(fontHeading) && !/sans-serif/i.test(fontHeading)),
    roundedHeading: Boolean(theme?.headingFont?.rounded || homepage?.headingRounded),
    avgSaturation: homepage?.avgSaturation ?? null,
    imageryDensity: homepage?.imageryDensity ?? null,
    lifestyleImageCount: Math.max(
      (homepage?.lifestyleImageCount ?? 0) + (brand?.coverImageUrl ? 1 : 0),
      libraryBuilt ? stats!.lifestyleImageCount : 0
    ),
    imagePerAnswerCoverage,
    buttonRadius: radiusButton,
    category: catalog.category,
    // v2 optional signals — only set when the library has real content.
    ...(libraryBuilt ? { heroImageCount: stats!.heroImageCount } : {}),
    ...(libraryBuilt ? { bannerCoverage: stats!.bannerCoverage } : {}),
    avgPriceCents: catalog.avgPriceCents,
    avgOptionCount: catalog.avgOptionCount,
  };
  const templateAssignment = selectTemplate(signals);

  const profile: BrandProfile = {
    version: 1,
    tokens,
    sources,
    confidence: overall,
    contrastAdjusted,
    theme: {
      name: theme?.themeName ?? null,
      version: null,
      family: theme?.family ?? "unknown",
    },
    brand: {
      slogan: brand?.slogan ?? null,
      logoUrl: brand?.logoUrl ?? null,
      coverImageUrl: brand?.coverImageUrl ?? null,
      primaryColor: brand?.primaryColor ?? null,
      secondaryColor: brand?.secondaryColor ?? null,
    },
    homepage: {
      headingFont: homepage?.headingFont ?? null,
      bodyFont: homepage?.bodyFont ?? null,
      buttonRadius: homepage?.buttonRadius ?? null,
      palette: homepage?.palette ?? [],
      avgSaturation: homepage?.avgSaturation ?? null,
      avgLightness: homepage?.avgLightness ?? null,
      imageryDensity: homepage?.imageryDensity ?? null,
      lifestyleImageCount: homepage?.lifestyleImageCount ?? 0,
      copySample: homepage?.copySample ?? "",
    },
    catalog: {
      productCount: catalog.productCount,
      types: catalog.types,
      collections: catalog.collections,
      imageCoverage: catalog.imageCoverage,
    },
    category: catalog.category,
    tone,
    templateAssignment,
    trustStatements: extractTrustStatements(brand?.slogan ?? null, homepage?.copySample ?? ""),
  };

  const up = await supabase.from("brand_profiles").upsert(
    {
      shop_id: shop.data.id,
      profile,
      confidence: overall,
      theme_name: profile.theme.name,
      theme_version: profile.theme.version,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "shop_id" }
  );
  if (up.error) throw new Error(`brand-profile: save failed: ${up.error.message}`);

  // Every assignment is explainable (spec Part 2): the full payload goes
  // to telemetry as well as the profile row.
  const { trackOverhaulEvent } = await import("./overhaul-events.server");
  trackOverhaulEvent(shopDomain, "template_assigned", {
    template: templateAssignment.template,
    scores: templateAssignment.scores,
    signals: templateAssignment.signals,
    confidence: overall,
    theme_name: profile.theme.name,
  });

  return profile;
}

export async function getBrandProfile(shopDomain: string): Promise<BrandProfile | null> {
  const { data } = await supabase
    .from("brand_profiles")
    .select("profile, shops!inner(shop_domain)")
    .eq("shops.shop_domain", shopDomain)
    .maybeSingle();
  return (data?.profile as BrandProfile) ?? null;
}
