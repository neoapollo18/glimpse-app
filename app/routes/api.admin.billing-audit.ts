import { timingSafeEqual } from "node:crypto";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";
import { directGraphql, getActiveSubscription } from "../lib/shopify-billing.server";
import { getShopBillingState } from "../lib/supabase.server";

/**
 * One-shot billing audit (founders only, CRON_SECRET-protected):
 *   GET /api/admin/billing-audit?secret=...
 *
 * Reports every installed shop's active Shopify subscription shape so the
 * Mantle migration can be decided per shop before Sept 30, 2026:
 *   - "flex"  = $0 recurring + usage line → the cron adopts it silently
 *   - "flat"  = fixed recurring price     → keeps charging on its own;
 *               merchant should approve the new flex sub eventually
 *   - "none"  = no active subscription    → normal new-subscribe flow
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const secret = url.searchParams.get("secret");
  const expected = process.env.CRON_SECRET;
  const secretBuf = Buffer.from(secret ?? "");
  const expectedBuf = Buffer.from(expected ?? "");
  const valid =
    Boolean(secret && expected) &&
    secretBuf.length === expectedBuf.length &&
    timingSafeEqual(secretBuf, expectedBuf);
  if (!valid) return json({ error: "Unauthorized" }, { status: 401 });

  const sessions = await prisma.session.findMany({
    where: { isOnline: false, accessToken: { not: "" } },
    select: { shop: true, accessToken: true },
    distinct: ["shop"],
  });

  const shops: Array<Record<string, unknown>> = [];
  const totals = { flex: 0, flat: 0, none: 0, error: 0 };

  for (const { shop, accessToken } of sessions) {
    try {
      const [sub, state] = await Promise.all([
        getActiveSubscription(directGraphql(shop, accessToken)),
        getShopBillingState(shop),
      ]);
      const shape = !sub
        ? "none"
        : sub.usageLineItemId && (sub.recurringPriceUsd ?? 0) === 0
          ? "flex"
          : "flat";
      totals[shape as "flex" | "flat" | "none"]++;
      shops.push({
        shop,
        shape,
        status: sub?.status ?? null,
        name: sub?.name ?? null,
        test: sub?.test ?? null,
        recurringPriceUsd: sub?.recurringPriceUsd ?? null,
        usageCappedUsd: sub?.usageCappedUsd ?? null,
        usageBalanceUsd: sub?.usageBalanceUsd ?? null,
        usageTerms: sub?.usageTerms ?? null,
        currentPeriodEnd: sub?.currentPeriodEnd ?? null,
        appStatus: state?.subscription_status ?? null,
        monthlySessions: state?.monthly_sessions ?? null,
      });
    } catch (e) {
      totals.error++;
      shops.push({ shop, shape: "error", error: e instanceof Error ? e.message : String(e) });
    }
  }

  return json({ totals, shops, timestamp: new Date().toISOString() });
};
