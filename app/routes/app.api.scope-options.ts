// Scope-screen data (Overhaul Part 3 / C1 — the ONLY pre-build question).
//
// GET: chip derivation per spec §Screen 1 —
//   1. "Everything I sell (N)" — always first, always default.
//   2. 2-8 collections covering >=60% of products -> one chip each
//      (fetched live from the Admin API; collections aren't synced).
//   3. else 2-6 product types covering >=60% -> chips from types.
//   4. else top tags by product count, max 6 chips total.
//   Chips carry their resolved gleame product ids so "Build my quiz" needs
//   no second resolution round-trip.
//
// POST intent=resolve-freetext: "only lip products" -> product id set via
// type/tag/collection/title token matching. < 5 products -> the client
// shows the widen-scope prompt.

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { supabase } from "../lib/supabase.server";

interface ScopeChip {
  kind: "all" | "collection" | "type" | "tag";
  label: string;
  detail: string; // "14 products"
  productIds: string[] | null; // null = everything
  count: number;
}

const COLLECTIONS_QUERY = `#graphql
  query GleameScopeCollections {
    collections(first: 20, sortKey: UPDATED_AT, reverse: true) {
      nodes {
        id
        title
        productsCount { count }
        products(first: 250) { nodes { id } }
      }
    }
  }
`;

async function loadProducts(shopId: string) {
  const { data } = await supabase
    .from("products")
    .select("id, shopify_id, product_name, product_type, tags, status")
    .eq("shop_id", shopId)
    .or("status.is.null,status.eq.active")
    .limit(5000);
  return data ?? [];
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = await supabase
    .from("shops")
    .select("id")
    .eq("shop_domain", session.shop)
    .single();
  if (shop.error) return json({ ok: false, error: "Shop not found" }, { status: 404 });

  const products = await loadProducts(shop.data.id);
  const total = products.length;
  const chips: ScopeChip[] = [
    {
      kind: "all",
      label: "Everything I sell",
      detail: `${total} products`,
      productIds: null,
      count: total,
    },
  ];

  const byShopifyNumericId = new Map(
    products.map((p) => [String(p.shopify_id ?? "").split("/").pop(), p.id])
  );

  // Collections (live fetch; tolerate failure — chips degrade to types).
  let collectionChips: ScopeChip[] = [];
  try {
    const res = await admin.graphql(COLLECTIONS_QUERY);
    const body = (await res.json()) as any;
    const nodes = body?.data?.collections?.nodes ?? [];
    collectionChips = nodes
      .map((c: any) => {
        const ids = (c.products?.nodes ?? [])
          .map((p: any) => byShopifyNumericId.get(String(p.id).split("/").pop()))
          .filter(Boolean) as string[];
        return {
          kind: "collection" as const,
          label: c.title,
          detail: `${ids.length} products`,
          productIds: ids,
          count: ids.length,
        };
      })
      .filter((c: ScopeChip) => c.count >= 2)
      .sort((a: ScopeChip, b: ScopeChip) => b.count - a.count)
      .slice(0, 8);
  } catch (e) {
    console.warn(`[scope-options] collections fetch failed for ${session.shop}:`, (e as Error).message);
  }

  const covered = (list: ScopeChip[]) => {
    const ids = new Set(list.flatMap((c) => c.productIds ?? []));
    return total ? ids.size / total : 0;
  };

  if (collectionChips.length >= 2 && covered(collectionChips) >= 0.6) {
    chips.push(...collectionChips);
  } else {
    const typeCounts = new Map<string, string[]>();
    for (const p of products) {
      const t = (p.product_type ?? "").trim();
      if (!t) continue;
      if (!typeCounts.has(t)) typeCounts.set(t, []);
      typeCounts.get(t)!.push(p.id);
    }
    const typeChips: ScopeChip[] = [...typeCounts.entries()]
      .map(([t, ids]) => ({
        kind: "type" as const,
        label: t,
        detail: `${ids.length} products`,
        productIds: ids,
        count: ids.length,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
    if (typeChips.length >= 2 && covered(typeChips) >= 0.6) {
      chips.push(...typeChips);
    } else {
      const tagCounts = new Map<string, string[]>();
      for (const p of products) {
        for (const tag of (p.tags as string[] | null) ?? []) {
          if (!tagCounts.has(tag)) tagCounts.set(tag, []);
          tagCounts.get(tag)!.push(p.id);
        }
      }
      chips.push(
        ...[...tagCounts.entries()]
          .map(([t, ids]) => ({
            kind: "tag" as const,
            label: t,
            detail: `${ids.length} products`,
            productIds: ids,
            count: ids.length,
          }))
          .sort((a, b) => b.count - a.count)
          .slice(0, Math.max(0, 6 - chips.length))
      );
    }
  }

  // < 5 products: the client skips the screen entirely (scope=everything).
  return json({ ok: true, total, skipScreen: total < 5, chips });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  if (form.get("intent") !== "resolve-freetext") {
    return json({ ok: false, error: "Unknown intent" }, { status: 400 });
  }
  const query = String(form.get("query") ?? "").toLowerCase().trim();
  if (!query) return json({ ok: false, error: "Empty query" }, { status: 400 });

  const shop = await supabase.from("shops").select("id").eq("shop_domain", session.shop).single();
  if (shop.error) return json({ ok: false, error: "Shop not found" }, { status: 404 });
  const products = await loadProducts(shop.data.id);

  const terms = query
    .replace(/\bonly\b|\bjust\b|\ball\b|\bmy\b|\bproducts?\b|\bstuff\b/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3);
  const singular = (t: string) => (t.endsWith("s") ? t.slice(0, -1) : t);
  const matches = products.filter((p) => {
    const hay = [p.product_name, p.product_type ?? "", ...((p.tags as string[] | null) ?? [])]
      .join(" ")
      .toLowerCase();
    return terms.some((t) => hay.includes(t) || hay.includes(singular(t)));
  });

  return json({
    ok: true,
    count: matches.length,
    productIds: matches.map((p) => p.id),
    label: query.slice(0, 120),
  });
};
