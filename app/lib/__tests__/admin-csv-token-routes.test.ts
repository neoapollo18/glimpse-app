import { describe, it, expect, beforeAll, vi } from "vitest";

// Just enough of the supabase-js chain for an export with no uploads.
vi.mock("../supabase.server", () => {
  const chain: any = {
    select: () => chain,
    order: () => chain,
    not: () => chain,
    then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
  };
  return {
    supabase: { from: () => chain },
    updateShopMonthlySessions: vi.fn(),
    uploadReferenceImage: vi.fn(),
    appendProductReferenceImage: vi.fn(),
    removeProductReferenceImageByUrl: vi.fn(),
    appendVariantReferenceImage: vi.fn(),
    removeVariantReferenceImageByUrl: vi.fn(),
    updateProductAiModel: vi.fn(),
  };
});
vi.mock("../../shopify.server", () => ({ authenticate: { admin: vi.fn() } }));
vi.mock("../../db.server", () => ({ default: {} }));

import { ADMIN_ALLOWED_SHOPS, mintAdminToken, verifyAdminToken } from "../admin-auth.server";
import { action as adminAction } from "../../routes/admin";
import { loader as skinUploadsCsv } from "../../routes/admin.skin-uploads[.]csv";

const SHOP = ADMIN_ALLOWED_SHOPS[0];

beforeAll(() => {
  process.env.SHOPIFY_API_SECRET = "shpss_test_secret";
});

function postAdmin(fields: Record<string, string>) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  const request = new Request("https://app.example/admin?_data=routes/admin", { method: "POST", body });
  return adminAction({ request, params: {}, context: {} } as any);
}

function getCsv(token: string) {
  const request = new Request(`https://app.example/admin/skin-uploads.csv?token=${encodeURIComponent(token)}`);
  return skinUploadsCsv({ request, params: {}, context: {} } as any) as Promise<Response>;
}

describe("founders CSV token routes", () => {
  it("the open page swaps its action token for a fresh csv token", async () => {
    const res = await postAdmin({ action: "mint-csv-token", adminToken: mintAdminToken(SHOP) });
    expect(res.status).toBe(200);
    const data: any = await res.json();
    expect(data.success).toBe(true);
    expect(verifyAdminToken(data.csvToken, "csv")).toBe(SHOP);
    expect(verifyAdminToken(data.csvToken)).toBe(null);
  });

  it("a csv token from a URL can't drive founders actions", async () => {
    const csv = mintAdminToken(SHOP, "csv");
    for (const action of ["mint-csv-token", "update-ai-model", "update-vto-enabled"]) {
      const res = await postAdmin({ action, adminToken: csv });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ success: false, error: "Forbidden" });
    }
  });

  it("the export accepts only the csv token", async () => {
    expect((await getCsv(mintAdminToken(SHOP))).status).toBe(403);
    const ok = await getCsv(mintAdminToken(SHOP, "csv"));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(await ok.text()).toContain("name,shop_domain,uploaded_at,photo_url,storage_path");
  });
});
