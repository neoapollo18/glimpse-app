// Unit test for the pure brand-library tagging heuristic (V2-SPEC 4.1,
// Q9 defaults: source + ratio + filename keywords + position; no ML,
// no face detection). Run: npx tsx scripts/test-brand-library-tagging.mts
//
// brand-library.server.ts transitively imports supabase.server, which
// requires env vars at module init — stub them BEFORE the dynamic import.
// No network or DB calls happen: tagLibraryImage is pure.

process.env.SUPABASE_URL ||= "https://stub.supabase.co";
process.env.SUPABASE_API_KEY ||= "stub-key-for-pure-unit-test";

const { tagLibraryImage, filenameFromUrl } = await import("../app/lib/brand-library.server");

type Case = {
  name: string;
  input: Parameters<typeof tagLibraryImage>[0];
  role: string;
  heroCandidate?: boolean;
  ratio?: number | null;
};

const cases: Case[] = [
  // --- source + position defaults ---
  {
    name: "product media position 1 is a packshot",
    input: { source: "product_media", filename: "rose-quartz-polish_1024x1024.jpg", width: 1024, height: 1024, position: 1 },
    role: "packshot",
    heroCandidate: false,
  },
  {
    name: "product media beyond image 1 leans lifestyle",
    input: { source: "product_media", filename: "img_2049.jpg", width: 2000, height: 1333, position: 3 },
    role: "lifestyle",
    heroCandidate: true,
  },
  {
    name: "ultra-wide product media becomes a banner",
    input: { source: "product_media", filename: "img_0001.jpg", width: 2400, height: 800, position: 2 },
    role: "banner",
    ratio: 3,
  },
  {
    name: "variant image is a swatch by construction",
    input: { source: "variant_image", filename: "espresso.jpg" },
    role: "swatch",
    heroCandidate: false,
  },
  {
    name: "collection image is a banner",
    input: { source: "collection_banner", filename: "summer-collection.jpg", width: 1600, height: 900 },
    role: "banner",
  },
  // --- brand API: logo vs cover ---
  {
    name: "small square brand asset is a logo",
    input: { source: "brand_api", filename: "mark.png", width: 300, height: 300 },
    role: "logo",
    heroCandidate: false,
  },
  {
    name: "wide brand cover is a hero",
    input: { source: "brand_api", filename: "cover.jpg", width: 1800, height: 900 },
    role: "hero",
    heroCandidate: true,
  },
  // --- homepage ---
  {
    name: "homepage og:image without dimensions is a hero",
    input: { source: "homepage", filename: "og-share.jpg" },
    role: "hero",
    heroCandidate: false,
    ratio: null,
  },
  {
    name: "ultra-wide homepage image is a banner",
    input: { source: "homepage", filename: "slide-1.jpg", width: 2880, height: 1000 },
    role: "banner",
    heroCandidate: true,
  },
  // --- uploads ---
  {
    name: "keywordless upload stays unknown",
    input: { source: "upload", filename: "IMG_5521.HEIC.jpg", width: 3024, height: 4032 },
    role: "unknown",
  },
  // --- filename keywords beat source defaults ---
  {
    name: "filename 'logo' wins over any source",
    input: { source: "product_media", filename: "brand-logo-final.png", width: 500, height: 500, position: 2 },
    role: "logo",
  },
  {
    name: "filename 'swatch' tags a swatch even at position 2",
    input: { source: "product_media", filename: "swatch-crimson.jpg", width: 600, height: 600, position: 2 },
    role: "swatch",
    heroCandidate: false,
  },
  {
    name: "filename 'lifestyle' tags lifestyle on an upload",
    input: { source: "upload", filename: "lifestyle-shoot-04.jpg", width: 2400, height: 1600 },
    role: "lifestyle",
    heroCandidate: true,
  },
  {
    name: "filename 'model' tags on-model",
    input: { source: "product_media", filename: "on-model_side.jpg", width: 1200, height: 1800, position: 4 },
    role: "on-model",
    heroCandidate: true,
  },
  {
    name: "filename 'macro' tags texture",
    input: { source: "product_media", filename: "gel-macro-detail.jpg", width: 900, height: 900, position: 5 },
    role: "texture",
  },
  // --- hero candidacy edges ---
  {
    name: "square 1300px image is never a hero candidate",
    input: { source: "product_media", filename: "flatlay.jpg", width: 1300, height: 1300, position: 2 },
    role: "lifestyle",
    heroCandidate: false,
  },
  {
    name: "portrait 1200x1600 lifestyle is a hero candidate",
    input: { source: "product_media", filename: "campaign-look.jpg", width: 1200, height: 1600, position: 2 },
    role: "lifestyle",
    heroCandidate: true,
  },
  {
    name: "wide but sub-1200px image is not a hero candidate",
    input: { source: "homepage", filename: "promo.jpg", width: 1100, height: 620 },
    role: "hero",
    heroCandidate: false,
  },
];

let pass = 0;
let fail = 0;
for (const c of cases) {
  const got = tagLibraryImage(c.input);
  const problems: string[] = [];
  if (got.role !== c.role) problems.push(`role: expected ${c.role}, got ${got.role}`);
  if (c.heroCandidate !== undefined && got.heroCandidate !== c.heroCandidate) {
    problems.push(`heroCandidate: expected ${c.heroCandidate}, got ${got.heroCandidate}`);
  }
  if (c.ratio !== undefined && got.ratio !== c.ratio) {
    problems.push(`ratio: expected ${c.ratio}, got ${got.ratio}`);
  }
  if (problems.length === 0) {
    pass++;
    console.log(`  ok   ${c.name}`);
  } else {
    fail++;
    console.error(`  FAIL ${c.name}: ${problems.join("; ")}`);
  }
}

// filenameFromUrl sanity (feeds the keyword matching at build time).
const fnCases: Array<[string, string | null]> = [
  ["https://cdn.shopify.com/s/files/1/0000/products/swatch-red_600x.jpg?v=1712345678", "swatch-red_600x.jpg"],
  ["https://cdn.shopify.com/s/files/1/0000/files/Logo%20Final.png", "Logo Final.png"],
  ["not a url", null],
];
for (const [url, expected] of fnCases) {
  const got = filenameFromUrl(url);
  if (got === expected) {
    pass++;
    console.log(`  ok   filenameFromUrl(${url.slice(0, 40)}...)`);
  } else {
    fail++;
    console.error(`  FAIL filenameFromUrl(${url}): expected ${expected}, got ${got}`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
