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
    return json({
      ok: page.errors.length === 0,
      error: page.errors.length ? page.errors.slice(0, 3).join("; ") : undefined,
      intent,
      nextCursor: page.nextCursor,
      synced: page.synced,
      total: page.total,
    });
  } catch (err) {
    console.error("[catalog-sync] failed:", err);
    return json(
      { ok: false, error: err instanceof Error ? err.message : "Sync failed", intent },
      { status: 500 },
    );
  }
};
