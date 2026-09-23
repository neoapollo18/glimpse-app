// Check-the-matches simulator (Overhaul Part 5 / E2).
//
// POST {criteria: {axisKey: value}} -> what the matrix serves for that
// answer path, each product with the rule criteria that fired ("why"),
// plus the unmapped-products drawer data (in-scope products no rule
// reaches). Deterministic and DB-only — no LLM calls, so the panel can
// re-query on every answer change.
//
// ai-mode shops get mode:"ai" with rule hits only where they exist
// (hybrid curation); the client explains that AI ranking happens at
// serve time and points at the storefront preview for end-to-end checks.

import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { supabase, getChatAssistantConfig } from "../lib/supabase.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await supabase.from("shops").select("id").eq("shop_domain", session.shop).single();
  if (shop.error) return json({ ok: false, error: "Shop not found" }, { status: 404 });

  let criteria: Record<string, string> = {};
  try {
    const body = await request.json();
    if (body?.criteria && typeof body.criteria === "object") {
      for (const [k, v] of Object.entries(body.criteria)) {
        if (typeof v === "string" && v) criteria[k] = v;
      }
    }
  } catch {
    return json({ ok: false, error: "Bad request" }, { status: 400 });
  }

  const [config, rulesRes] = await Promise.all([
    getChatAssistantConfig(session.shop),
    supabase
      .from("recommendation_rules")
      .select("id, criteria, product_id, variant_id, rank, quantity")
      .eq("shop_id", shop.data.id)
      .limit(2000),
  ]);
  if (rulesRes.error) return json({ ok: false, error: rulesRes.error.message }, { status: 500 });
  const rules = rulesRes.data ?? [];

  // A rule fires when EVERY criteria pair matches the shopper's answers.
  const fired = rules
    .filter((r) => {
      const entries = Object.entries((r.criteria as Record<string, string>) ?? {});
      return entries.length > 0 && entries.every(([k, v]) => criteria[k] === v);
    })
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        Object.keys(b.criteria as object).length - Object.keys(a.criteria as object).length
    );

  // Resolve targets -> product cards (variant targets resolve the parent).
  const variantIds = [...new Set(fired.map((r) => r.variant_id).filter(Boolean))] as string[];
  const variants = variantIds.length
    ? (
        await supabase
          .from("product_variants")
          .select("id, product_id, variant_title, price, image_url")
          .in("id", variantIds)
      ).data ?? []
    : [];
  const vById = new Map(variants.map((v) => [v.id, v]));
  const productIds = [
    ...new Set([
      ...fired.map((r) => r.product_id).filter(Boolean),
      ...variants.map((v) => v.product_id),
    ]),
  ] as string[];
  const products = productIds.length
    ? (
        await supabase
          .from("products")
          .select("id, product_name, handle, image_url, price, status")
          .in("id", productIds)
      ).data ?? []
    : [];
  const pById = new Map(products.map((p) => [p.id, p]));

  const seen = new Set<string>();
  const matches: any[] = [];
  for (const r of fired) {
    const v = r.variant_id ? vById.get(r.variant_id) : null;
    const pid = (r.product_id ?? v?.product_id) as string | null;
    const p = pid ? pById.get(pid) : null;
    if (!p || seen.has(p.id)) continue;
    seen.add(p.id);
    matches.push({
      productId: p.id,
      name: p.product_name,
      variantTitle: v?.variant_title ?? null,
      imageUrl: v?.image_url ?? p.image_url,
      price: v?.price ?? p.price,
      rank: r.rank,
      quantity: r.quantity ?? 1,
      why: Object.entries((r.criteria as Record<string, string>) ?? {}).map(
        ([k, val]) => `${k.replace(/_/g, " ")}: ${String(val).replace(/_/g, " ")}`
      ),
      // Raw fired criteria so the client can render answer LABELS in the
      // "Why: matched ..." line (v2 Check matches).
      whyCriteria: (r.criteria as Record<string, string>) ?? {},
      ruleId: r.id,
    });
    if (matches.length >= Math.max(2, config.num_recommendations)) break;
  }

  // Unmapped drawer: in-scope products that NO rule targets at all.
  const scoped =
    config.product_scope === "selected" && config.selected_product_ids?.length
      ? new Set(config.selected_product_ids as string[])
      : null;
  const targeted = new Set<string>();
  for (const r of rules) {
    const pid = r.product_id ?? (r.variant_id ? vById.get(r.variant_id)?.product_id : null);
    if (pid) targeted.add(pid as string);
  }
  // Variant targets outside the fired set weren't fetched — resolve the rest.
  const otherVariantIds = [
    ...new Set(rules.map((r) => r.variant_id).filter((v) => v && !vById.has(v as string))),
  ] as string[];
  for (let i = 0; i < otherVariantIds.length; i += 200) {
    const vs =
      (
        await supabase
          .from("product_variants")
          .select("id, product_id")
          .in("id", otherVariantIds.slice(i, i + 200))
      ).data ?? [];
    for (const v of vs) targeted.add(v.product_id as string);
  }
  const allProducts =
    (
      await supabase
        .from("products")
        .select("id, product_name, status")
        .eq("shop_id", shop.data.id)
        .or("status.is.null,status.eq.active")
        .limit(2000)
    ).data ?? [];
  const unmapped = allProducts
    .filter((p) => (!scoped || scoped.has(p.id)) && !targeted.has(p.id))
    .map((p) => ({ productId: p.id, name: p.product_name }));

  return json({
    ok: true,
    mode: config.recommendation_mode,
    matches,
    unmapped: rules.length > 0 ? unmapped.slice(0, 100) : [],
    unmappedTotal: rules.length > 0 ? unmapped.length : 0,
    priorityProductIds: config.priority_product_ids ?? [],
  });
};
