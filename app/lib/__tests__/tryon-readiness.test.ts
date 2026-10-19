import { describe, it, expect } from "vitest";
import { resolveTryonPrompt, tryonReady } from "../tryon-readiness";
import { coerceReferenceImageUrlList, parseReferenceImageUrls } from "../reference-images";

// The prompt resolution moved out of transformCandidateImage so the quiz's
// per-match `tryon` flag reads the same rules. `reference` is the
// pre-extraction code verbatim (minus the log line): the shared resolver
// must return what the transform used to compute, for every combination.
function reference(args: { product: any; variant: any; quantity?: number; multiSetFallbackPrompt?: string | null }) {
  const { product, variant } = args;
  const source = variant || product;
  const quantity = Math.max(1, Math.round(args.quantity ?? 1));
  const firstNonEmpty = (...lists: string[][]) => lists.find((l) => l.length > 0) ?? [];
  let multiSetPrompt = quantity >= 2 ? (variant?.multi_set_prompt || product.multi_set_prompt || null) : null;
  let multiSetRefs: string[] = [];
  if (multiSetPrompt) {
    multiSetRefs = firstNonEmpty(
      coerceReferenceImageUrlList(variant?.multi_set_reference_urls),
      coerceReferenceImageUrlList(product.multi_set_reference_urls),
    );
    if (multiSetRefs.length === 0) multiSetPrompt = null;
  }
  if (!multiSetPrompt && quantity >= 2 && args.multiSetFallbackPrompt) multiSetPrompt = args.multiSetFallbackPrompt;
  const prompt = multiSetPrompt
    ? multiSetPrompt.replace(/\{count\}/g, String(quantity))
    : source.transformation_prompt || product.transformation_prompt;
  const referenceUrls =
    multiSetRefs.length > 0
      ? multiSetRefs
      : variant
        ? firstNonEmpty(parseReferenceImageUrls(variant), parseReferenceImageUrls(product))
        : parseReferenceImageUrls(product);
  return { prompt, referenceUrls };
}

const REF = (n: string) => `https://cdn.example.com/${n}.jpg`;
const productShapes = [
  { id: "p", transformation_prompt: "P base", reference_image_urls: [REF("p1")] },
  { id: "p", transformation_prompt: null, reference_image_url: REF("p-legacy") },
  { id: "p", transformation_prompt: "", multi_set_prompt: "P {count} sets", multi_set_reference_urls: [REF("pm")] },
  { id: "p", transformation_prompt: "P base", multi_set_prompt: "P {count} sets" },
];
const variantShapes = [
  null,
  { id: "v", transformation_prompt: "V base", reference_image_urls: [REF("v1")] },
  { id: "v", transformation_prompt: null },
  { id: "v", transformation_prompt: "", multi_set_prompt: "V {count} sets", multi_set_reference_urls: [REF("vm")] },
];

describe("resolveTryonPrompt", () => {
  it("returns exactly what transformCandidateImage computed before the extraction", () => {
    for (const product of productShapes) {
      for (const variant of variantShapes) {
        for (const quantity of [undefined, 1, 2, 3]) {
          for (const multiSetFallbackPrompt of [null, "Shop {count} sets"]) {
            const args = { product, variant, quantity, multiSetFallbackPrompt };
            const got = resolveTryonPrompt(args);
            const want = reference(args);
            expect({ prompt: got.prompt, referenceUrls: got.referenceUrls }, JSON.stringify(args)).toEqual(want);
          }
        }
      }
    }
  });

  it("flags a multi-set prompt skipped for lack of multi-set refs", () => {
    const r = resolveTryonPrompt({ product: productShapes[3], variant: null, quantity: 2 });
    expect(r.multiSetWithoutRefs).toBe(true);
    expect(r.prompt).toBe("P base");
  });
});

describe("tryonReady", () => {
  it("is false for a product nobody set up (the App Review store)", () => {
    expect(tryonReady({ product: { transformation_prompt: null }, variant: null })).toBe(false);
    expect(tryonReady({ product: { transformation_prompt: null }, variant: { transformation_prompt: "" } })).toBe(false);
    expect(tryonReady({ product: { transformation_prompt: "  \n " }, variant: null })).toBe(false);
  });

  it("variant prompt, else the product's", () => {
    expect(tryonReady({ product: { transformation_prompt: null }, variant: { transformation_prompt: "V" } })).toBe(true);
    expect(tryonReady({ product: { transformation_prompt: "P" }, variant: { transformation_prompt: null } })).toBe(true);
    // A partial card goes out without its variant: product level only.
    expect(tryonReady({ product: { transformation_prompt: null }, variant: null })).toBe(false);
  });

  it("2+ sets: the multi-set prompt (with its refs) or the shop-wide fallback", () => {
    const bare = { transformation_prompt: null };
    expect(tryonReady({ product: bare, variant: null, quantity: 2, multiSetFallbackPrompt: "Shop {count}" })).toBe(true);
    expect(tryonReady({ product: bare, variant: null, quantity: 1, multiSetFallbackPrompt: "Shop {count}" })).toBe(false);
    expect(
      tryonReady({ product: { ...bare, multi_set_prompt: "M", multi_set_reference_urls: [REF("m")] }, variant: null, quantity: 2 }),
    ).toBe(true);
    // Without its refs the multi-set prompt is skipped, leaving nothing.
    expect(tryonReady({ product: { ...bare, multi_set_prompt: "M" }, variant: null, quantity: 2 })).toBe(false);
  });
});
