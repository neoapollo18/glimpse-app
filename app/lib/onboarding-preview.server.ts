// A few of the merchant's own products for the onboarding illustrations
// (the welcome slide's quiz preview, the goals cards, the scope screen's
// catalog row). Read-only, and never a reason for a screen to fail: any
// error is "no preview", and the screens draw their designed fallback.
//
// Synced rows first (products table, scoped by shop_id). A brand-new
// install reaches the welcome slide before its first sync page lands, so
// when nothing with an image is synced yet, the same few products are read
// straight from the Admin API (read_products is already granted).

import { supabase } from "./supabase.server";
import type { PreviewProduct } from "../components/onboarding/OnboardingArt";

const PREVIEW_QUERY = `#graphql
  query GleameOnboardingPreview($first: Int!) {
    products(first: $first, sortKey: UPDATED_AT, reverse: true, query: "status:active") {
      nodes {
        title
        featuredImage {
          url(transform: { maxWidth: 480 })
        }
      }
    }
  }
`;

type AdminLike = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

const clean = (rows: Array<{ name: unknown; imageUrl: unknown }>, limit: number): PreviewProduct[] =>
  rows
    .map((r) => ({ name: String(r.name ?? "").trim(), imageUrl: String(r.imageUrl ?? "").trim() }))
    .filter((r) => r.name && /^https:\/\//.test(r.imageUrl))
    .slice(0, limit);

export async function loadPreviewProducts(
  shopId: string,
  admin: AdminLike | null,
  limit = 8,
): Promise<PreviewProduct[]> {
  let synced: PreviewProduct[] = [];
  try {
    const { data } = await supabase
      .from("products")
      .select("product_name, image_url")
      .eq("shop_id", shopId)
      .not("image_url", "is", null)
      .or("status.is.null,status.eq.active")
      .limit(limit);
    synced = clean((data ?? []).map((r) => ({ name: r.product_name, imageUrl: r.image_url })), limit);
  } catch {
    synced = [];
  }
  if (synced.length >= 2 || !admin) return synced;
  try {
    const res = await admin.graphql(PREVIEW_QUERY, { variables: { first: limit } });
    const nodes = ((await res.json()) as any)?.data?.products?.nodes ?? [];
    const live = clean(
      nodes.map((n: any) => ({ name: n?.title, imageUrl: n?.featuredImage?.url })),
      limit,
    );
    return live.length > synced.length ? live : synced;
  } catch {
    return synced;
  }
}
