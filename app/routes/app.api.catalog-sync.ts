import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { shopNeedsBilling } from "../lib/billing-gate.server";
import { findShopByDomain } from "../lib/supabase.server";
import { enableCatalogSync, syncCatalogPage } from "../lib/catalog-sync.server";

// Chunked catalog-sync resource route (admin-authenticated). Extracted from
// the quiz-builder action so every surface that syncs (dashboard onboarding,
// Quiz Studio wizard + top-bar chip) shares one endpoint and quiz-builder
// can become a redirect stub. Driven page-by-page by use-catalog-sync.ts:
// each response's nextCursor is immediately resubmitted until null.

export const loader = async (_args: LoaderFunctionArgs) => {
  return new Response("Method Not Allowed", { status: 405 });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  let session, admin;
  try {
    ({ session, admin } = await authenticate.admin(request));
  } catch (err) {
    if (err instanceof Response) {
      return json({ ok: false, error: "Session expired. Please reload." }, { status: 401 });
    }
    throw err;
  }
  const shopDomain = session.shop;
  // Resource routes never run app.tsx's loader, so its billing gate does
  // not cover them; without this an unsubscribed shop can drive paid work.
  if (await shopNeedsBilling(shopDomain, session.accessToken ?? "")) {
    return json({ ok: false, error: "Your Gleame subscription isn't active. Visit Billing to continue." }, { status: 402 });
  }
  const shop = await findShopByDomain(shopDomain);
  if (!shop) return json({ ok: false, error: "Shop not found" }, { status: 404 });

  const formData = await request.formData();
  const intent = "sync-catalog";
  try {
    const cursor = (formData.get("cursor") as string) || null;
    if (!cursor) {
      const enabled = await enableCatalogSync(shopDomain);
      if (!enabled.ok) return json({ ok: false, error: enabled.error, intent });
    }
    const page = await syncCatalogPage(admin, shopDomain, cursor);
    // Per-page errors are WARNINGS, not terminal: ok:false made the client
    // stop the whole chain on one bad product, leaving a partial catalog
    // with sync marked enabled (so no sync affordance anywhere). Keep
    // paging; surface the messages for logging/UI.
    if (page.errors.length) {
      console.warn(`[catalog-sync] ${shopDomain} page warnings:`, page.errors.slice(0, 5).join("; "));
    }

    // Full sync complete -> build the brand library (V2-SPEC Part 4.1).
    // Awaited but time-boxed; a library failure never fails the sync.
    let library: { imageCount: number; taggedPct: number; ms: number } | undefined;
    if (page.nextCursor === null) {
      try {
        const { buildBrandLibrary } = await import("../lib/brand-library.server");
        const adminGraphql = async (query: string, variables?: Record<string, unknown>) => {
          const res = await admin.graphql(query, variables ? { variables } : undefined);
          const body = (await res.json()) as { data?: any; errors?: Array<{ message?: string }> };
          if (body.errors?.length) {
            throw new Error(`brand-library graphql: ${body.errors[0]?.message ?? "error"}`);
          }
          return body.data;
        };
        library = await buildBrandLibrary(shopDomain, { admin: adminGraphql, timeBoxMs: 25_000 });
        const { trackOverhaulEvent } = await import("../lib/overhaul-events.server");
        trackOverhaulEvent(shopDomain, "library_built", {
          image_count: library.imageCount,
          tagged_pct: library.taggedPct,
          ms: library.ms,
        });
      } catch (err) {
        console.warn(`[catalog-sync] brand library build failed for ${shopDomain}:`, err);
      }
    }

    return json({
      ok: true,
      warning: page.errors.length ? page.errors.slice(0, 3).join("; ") : undefined,
      intent,
      nextCursor: page.nextCursor,
      synced: page.synced,
      total: page.total,
      library,
    });
  } catch (err) {
    console.error("[catalog-sync] failed:", err);
    return json(
      { ok: false, error: err instanceof Error ? err.message : "Sync failed", intent },
      { status: 500 },
    );
  }
};
