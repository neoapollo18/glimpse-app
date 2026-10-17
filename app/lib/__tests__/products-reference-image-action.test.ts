import { describe, it, expect, vi, beforeEach } from "vitest";

// /app/products reference-image branches: the caller owns productId, but
// currentUrl and the file's content type are client-controlled. The bucket is
// shared across shops, so a foreign URL must never reach storage deletion and
// non-image uploads must never reach storage at all.
const SHOP = "attacker.myshopify.com";
const PUBLIC = "https://proj.supabase.co/storage/v1/object/public/reference-images";
const OWN_URL = `${PUBLIC}/${SHOP}/prod-1-1781295019016.webp`;
const VICTIM_URL = `${PUBLIC}/victim.myshopify.com/avatar-1781298000207.jpg`;

const products = vi.hoisted(() => ({
  rows: [] as Array<{ id: string; shop_id: string; reference_image_url: string | null; reference_image_urls: unknown }>,
}));

vi.mock("../../shopify.server", () => ({
  authenticate: { admin: vi.fn(async () => ({ session: { shop: "attacker.myshopify.com" } })) },
}));
vi.mock("../supabase.server", async () => {
  const { parseReferenceImageUrls } = await import("../reference-images");
  // Just the products read the remove branch makes: select/eq/eq/maybeSingle.
  const from = (table: string) => {
    if (table !== "products") throw new Error(`unexpected table ${table}`);
    const filters: Record<string, unknown> = {};
    const chain = {
      select: () => chain,
      eq: (col: string, val: unknown) => {
        filters[col] = val;
        return chain;
      },
      maybeSingle: async () => ({
        data: products.rows.find((r) => r.id === filters.id && r.shop_id === filters.shop_id) ?? null,
        error: null,
      }),
    };
    return chain;
  };
  return {
    supabase: { from },
    parseReferenceImageUrls,
    findShopByDomain: vi.fn(async () => ({ id: "shop-a", shop_domain: "attacker.myshopify.com" })),
    productBelongsToShop: vi.fn(async (productId: string, shopId: string) =>
      products.rows.some((r) => r.id === productId && r.shop_id === shopId)
    ),
    uploadReferenceImage: vi.fn(async () => "https://proj.supabase.co/storage/v1/object/public/reference-images/attacker.myshopify.com/prod-1-2.png"),
    saveProductReferenceImage: vi.fn(async () => {}),
    deleteReferenceImage: vi.fn(async () => {}),
    getConfiguredProductsWithCategory: vi.fn(),
    getCategories: vi.fn(),
    saveProductConfiguration: vi.fn(),
    updateProductConfiguration: vi.fn(),
    deleteProductConfiguration: vi.fn(),
    saveVariantConfiguration: vi.fn(),
    saveFunnelConfiguration: vi.fn(),
  };
});
vi.mock("../shop-currency.server", () => ({ rememberShopCurrency: vi.fn() }));
vi.mock("../prompt-generator.server", () => ({
  generatePromptFromFunnel: vi.fn(),
  validateFunnelResponses: vi.fn(),
}));
vi.mock("@shopify/app-bridge-react", () => ({ TitleBar: () => null }));

import { action } from "../../routes/app.products";
import { deleteReferenceImage, saveProductReferenceImage, uploadReferenceImage } from "../supabase.server";

function post(fields: Record<string, string | File>) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.append(k, v);
  const request = new Request("https://app.example.com/app/products", { method: "POST", body });
  return action({ request, params: {}, context: {} } as any) as Promise<any>;
}

beforeEach(() => {
  vi.clearAllMocks();
  products.rows = [
    { id: "prod-1", shop_id: "shop-a", reference_image_url: OWN_URL, reference_image_urls: [OWN_URL] },
    { id: "prod-legacy", shop_id: "shop-a", reference_image_url: OWN_URL, reference_image_urls: [] },
    { id: "prod-victim", shop_id: "shop-b", reference_image_url: VICTIM_URL, reference_image_urls: [VICTIM_URL] },
  ];
});

describe("remove-reference-image", () => {
  it("deletes the product's own image, scoped to the session shop's folder", async () => {
    const res = await post({ action: "remove-reference-image", productId: "prod-1", currentUrl: OWN_URL });
    expect(res).toEqual({ success: true, message: "Reference image removed.", referenceImageUrl: null });
    expect(deleteReferenceImage).toHaveBeenCalledWith(OWN_URL, SHOP);
    expect(saveProductReferenceImage).toHaveBeenCalledWith("prod-1", null);
  });

  it("still deletes a legacy single-column image", async () => {
    await post({ action: "remove-reference-image", productId: "prod-legacy", currentUrl: OWN_URL });
    expect(deleteReferenceImage).toHaveBeenCalledWith(OWN_URL, SHOP);
  });

  it("never deletes another shop's file passed as currentUrl", async () => {
    const res = await post({ action: "remove-reference-image", productId: "prod-1", currentUrl: VICTIM_URL });
    expect(res).toEqual({ success: true, message: "Reference image removed.", referenceImageUrl: null });
    expect(deleteReferenceImage).not.toHaveBeenCalled();
    expect(saveProductReferenceImage).toHaveBeenCalledWith("prod-1", null);
  });

  it("clears the reference without a storage delete when no URL is sent", async () => {
    await post({ action: "remove-reference-image", productId: "prod-1" });
    expect(deleteReferenceImage).not.toHaveBeenCalled();
    expect(saveProductReferenceImage).toHaveBeenCalledWith("prod-1", null);
  });

  it("rejects another shop's product without touching storage or the row", async () => {
    const res = await post({ action: "remove-reference-image", productId: "prod-victim", currentUrl: VICTIM_URL });
    expect(res).toEqual({ success: false, message: "Product not found for this shop." });
    expect(deleteReferenceImage).not.toHaveBeenCalled();
    expect(saveProductReferenceImage).not.toHaveBeenCalled();
  });
});

describe("upload-reference-image", () => {
  const upload = (file: File) => post({ action: "upload-reference-image", productId: "prod-1", image: file });

  it("uploads images as before", async () => {
    for (const type of ["image/png", "image/jpeg", "image/webp", "image/heic"]) {
      const res = await upload(new File([new Uint8Array([1, 2, 3])], "ref.png", { type }));
      expect(res.success).toBe(true);
      expect(res.message).toBe("Reference image uploaded!");
    }
    expect(uploadReferenceImage).toHaveBeenCalledTimes(4);
  });

  it("rejects non-image and SVG uploads before they reach storage", async () => {
    for (const [name, type] of [
      ["login.html", "text/html"],
      ["x.svg", "image/svg+xml"],
      ["x.bin", "application/octet-stream"],
      ["x", ""],
    ]) {
      const res = await upload(new File(["<svg onload=alert(1)>"], name, { type }));
      expect(res).toEqual({ success: false, message: "Please upload an image file." });
    }
    expect(uploadReferenceImage).not.toHaveBeenCalled();
    expect(saveProductReferenceImage).not.toHaveBeenCalled();
  });
});
