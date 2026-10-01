import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { shopNeedsBilling } from "../lib/billing-gate.server";
import { findShopByDomain } from "../lib/supabase.server";
import {
  clearCatalogSyncCursor,
  enableCatalogSync,
  isCatalogSyncEnabled,
  isStaleCursorError,
  revertCatalogSyncEnable,
  syncCatalogPage,
} from "../lib/catalog-sync.server";

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
      // App Bridge re-bounces the session token when this header survives
      // the JSON conversion; dropping it leaves the client stuck on 401.
      const headers: Record<string, string> = {};
      const retry = err.headers.get("X-Shopify-Retry-Invalid-Session-Request");
      if (retry) headers["X-Shopify-Retry-Invalid-Session-Request"] = retry;
      return json({ ok: false, error: "Session expired. Please reload." }, { status: 401, headers });
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
  // True only when THIS request flipped catalog_sync_enabled on. If the
  // first page then fails, the flag is reverted: a shop whose first sync
  // never wrote a product must look "never synced", not "synced, 0
  // products" (that state had no re-sync affordance anywhere).
  let enabledHere = false;
  try {
    let cursor = (formData.get("cursor") as string) || null;
    if (!cursor) {
      if (!(await isCatalogSyncEnabled(shopDomain))) {
        const enabled = await enableCatalogSync(shopDomain);
        if (!enabled.ok) return json({ ok: false, error: enabled.error, intent }, { status: 403 });
        enabledHere = true;
      }
      // A sync has started: the library will be built on the final page.
      // `pending` lets Studio/onboarding tell "queued" from "never
      // attempted" (V3-CONTRACTS §9). Best-effort; never blocks the sync.
      try {
        const { setLibraryIndexStatus } = await import("../lib/brand-library.server");
        await setLibraryIndexStatus(shopDomain, "pending");
      } catch (err) {
        console.warn(`[catalog-sync] library status (pending) failed for ${shopDomain}:`, err);
      }
    }

    let restarted = false;
    let page: Awaited<ReturnType<typeof syncCatalogPage>>;
    try {
      page = await syncCatalogPage(admin, shopDomain, cursor);
    } catch (err) {
      // A persisted cursor Shopify no longer accepts would otherwise fail
      // every resume forever: drop it and start the catalog over.
      if (!cursor || !isStaleCursorError(err)) throw err;
      console.warn(`[catalog-sync] ${shopDomain}: stale resume cursor, restarting from page 1:`, err);
      await clearCatalogSyncCursor(shopDomain);
      cursor = null;
      restarted = true;
      page = await syncCatalogPage(admin, shopDomain, null);
    }
    // Per-page errors are WARNINGS, not terminal: ok:false made the client
    // stop the whole chain on one bad product, leaving a partial catalog
    // with sync marked enabled (so no sync affordance anywhere). Keep
    // paging; surface the messages for logging/UI.
    if (page.errors.length) {
      console.warn(`[catalog-sync] ${shopDomain} page warnings:`, page.errors.slice(0, 5).join("; "));
    }

    // Full sync complete -> build the brand library (V2-SPEC Part 4.1,
    // V3-CONTRACTS §9). Awaited but time-boxed; buildBrandLibrary writes
    // shops.library_index_status (building -> ready|failed) itself. A
    // library failure never fails the sync: the response carries
    // library.status/error and the route still returns ok:true.
    let library:
      | { status: "ready" | "failed"; imageCount: number; taggedPct: number; ms: number; error: string | null }
      | undefined;
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
        const built = await buildBrandLibrary(shopDomain, { admin: adminGraphql, timeBoxMs: 25_000 });
        library = {
          status: built.status,
          imageCount: built.imageCount,
          taggedPct: built.taggedPct,
          ms: built.ms,
          error: built.error,
        };
        const { trackOverhaulEvent } = await import("../lib/overhaul-events.server");
        trackOverhaulEvent(shopDomain, "library_built", {
          status: built.status,
          error: built.error,
          image_count: built.imageCount,
          tagged_pct: built.taggedPct,
          ms: built.ms,
          source: "catalog_sync",
        });
      } catch (err) {
        // buildBrandLibrary never throws (it persists `failed` itself);
        // this catches the dynamic import / event plumbing only.
        console.warn(`[catalog-sync] brand library build failed for ${shopDomain}:`, err);
        library = {
          status: "failed",
          imageCount: 0,
          taggedPct: 0,
          ms: 0,
          error: err instanceof Error ? err.message : "library build failed",
        };
      }
    }

    return json({
      ok: true,
      warning: page.errors.length ? page.errors.slice(0, 3).join("; ") : undefined,
      intent,
      nextCursor: page.nextCursor,
      synced: page.synced,
      total: page.total,
      restarted: restarted || undefined,
      library,
    });
  } catch (err) {
    console.error("[catalog-sync] failed:", err);
    if (enabledHere) {
      // Nothing was synced: undo the enable + the `pending` library status
      // so the next visit starts the sync again instead of trusting an
      // empty catalog. Both best-effort.
      await revertCatalogSyncEnable(shopDomain);
      try {
        const { supabase } = await import("../lib/supabase.server");
        await supabase
          .from("shops")
          .update({ library_index_status: null, library_index_error: null })
          .eq("shop_domain", shopDomain);
      } catch (statusErr) {
        console.warn(`[catalog-sync] library status revert failed for ${shopDomain}:`, statusErr);
      }
    }
    return json(
      { ok: false, error: err instanceof Error ? err.message : "Sync failed", intent },
      { status: 500 },
    );
  }
};
