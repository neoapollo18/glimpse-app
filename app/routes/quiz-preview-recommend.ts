import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import jwt from "jsonwebtoken";
import { findShopByDomain, getChatAssistantConfig, supabase, type MultiCriteria } from "../lib/supabase.server";
import { checkRateLimit } from "../lib/rate-limiter.server";
import { computeQuizRecommendations } from "../lib/quiz-recommend.server";

// Real recommendations for the Studio preview. The preview document
// (quiz-preview.html) used to answer every answer path with one canned
// sample (the first products by id), so merchants saw "the same product
// every time" and couldn't check their logic. This runs the storefront
// pipeline (computeQuizRecommendations) on the merchant's actual answers.
//
// Auth: the same short-lived preview JWT the preview document carries
// (?token=, minted by the Studio loader). Unlike the storefront endpoint it
// skips the `enabled` and billing gates (merchants test before turning the
// quiz on) and is rate-limited per shop, since the ai/hybrid path spends
// LLM tokens.

const ID_RE = /^[a-z_][a-z0-9_]{0,63}$/;
const PROTO_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, { status: 405 });
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) return json({ error: "Preview unavailable" }, { status: 503 });

  const token = new URL(request.url).searchParams.get("token") ?? "";
  let shopDomain: string;
  try {
    const decoded = jwt.verify(token, secret, { algorithms: ["HS256"] }) as Record<string, unknown>;
    if (typeof decoded.shopId !== "string" || typeof decoded.shopDomain !== "string") {
      return json({ error: "Invalid preview token" }, { status: 401 });
    }
    shopDomain = decoded.shopDomain;
  } catch {
    return json({ error: "Invalid or expired preview token" }, { status: 401 });
  }

  const limit = checkRateLimit(`quiz-preview-recommend:${shopDomain}:minute`, 30, 60_000);
  if (!limit.allowed) return json({ error: "Too many requests" }, { status: 429 });

  let raw: unknown = null;
  try {
    raw = ((await request.json()) as { criteria?: unknown })?.criteria ?? null;
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }
  // Same criteria validation as the storefront endpoint.
  const criteria: MultiCriteria = Object.create(null);
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (Object.keys(criteria).length >= 32) break;
      if (!ID_RE.test(k) || PROTO_KEYS.has(k)) continue;
      if (typeof v === "string" && ID_RE.test(v)) criteria[k] = v;
      else if (Array.isArray(v)) {
        const values = [...new Set(v.filter((x): x is string => typeof x === "string" && ID_RE.test(x)))].slice(0, 16);
        if (values.length > 0) criteria[k] = values;
      }
    }
  }

  const shop = await findShopByDomain(shopDomain);
  if (!shop) return json({ error: "Unknown shop" }, { status: 403 });
  const chatConfig = await getChatAssistantConfig(shop.shop_domain);

  try {
    const result = await computeQuizRecommendations({
      verifiedShop: shop,
      verifiedDomain: shop.shop_domain,
      chatConfig,
      criteria,
      clientIP: `preview:${shop.id}`,
    });
    // /products/<handle>.js lookalikes for the picks (the preview widget
    // reads product images/prices from this map instead of the storefront).
    const productJson = await previewProductJson(shop.id, result.matches);
    return json({ ...result, productJson });
  } catch (e) {
    console.error("[quiz-preview-recommend]", e);
    return json({ error: "Recommendation failed" }, { status: 500 });
  }
};

async function previewProductJson(
  shopId: string,
  matches: Array<{ productId: string; productHandle: string; variantId: string | null }>,
): Promise<Record<string, unknown>> {
  const gids = [...new Set(matches.map((m) => m.productId).filter(Boolean))];
  if (gids.length === 0) return {};
  const { data: products } = await supabase
    .from("products")
    .select("id, shopify_id, image_url, price")
    .eq("shop_id", shopId)
    .in("shopify_id", gids);
  const byGid = new Map((products ?? []).map((p: any) => [p.shopify_id as string, p]));
  const variantGids = [...new Set(matches.map((m) => m.variantId).filter((v): v is string => Boolean(v)))];
  const productIds = (products ?? []).map((p: any) => p.id as string);
  const { data: variants } =
    variantGids.length && productIds.length
      ? await supabase
          .from("product_variants")
          .select("shopify_variant_id, product_id, image_url, price")
          .in("shopify_variant_id", variantGids)
          .in("product_id", productIds)
      : { data: [] as any[] };
  const variantByGid = new Map((variants ?? []).map((v: any) => [v.shopify_variant_id as string, v]));
  // Synced catalog prices are dollars; the widget's formatMoney takes cents.
  const cents = (price: unknown): number | null =>
    typeof price === "number" && Number.isFinite(price) ? Math.round(price * 100) : null;

  const out: Record<string, unknown> = {};
  for (const m of matches) {
    const p = byGid.get(m.productId);
    if (!p || !m.productHandle || out[m.productHandle]) continue;
    const v = m.variantId ? variantByGid.get(m.variantId) : null;
    const image = (v?.image_url as string | null) ?? (p.image_url as string | null) ?? null;
    const price = cents(v?.price ?? p.price);
    out[m.productHandle] = {
      handle: m.productHandle,
      featured_image: image,
      images: image ? [image] : [],
      price,
      variants: [{ id: 0, price, featured_image: null }],
    };
  }
  return out;
}
