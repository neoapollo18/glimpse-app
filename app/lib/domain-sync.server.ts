// Domain sync: keeps shops.alternate_domains in step with the shop's
// Shopify primary domain so storefront origin checks (track-event,
// findShopByDomain) recognize custom-domain storefronts. Merchants on a
// custom primary domain (e.g. shop.example.com) were losing analytics
// because nothing ever populated alternate_domains.
//
// Called fire-and-forget from the /app loader: it must NEVER block or
// break an admin load, so every failure is swallowed and logged. A
// module-level throttle keeps it to one GraphQL round-trip per shop per
// 6 hours instead of one per navigation.

import { supabase, findShopByDomain } from "./supabase.server";

type AdminGraphql = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

// shopDomain -> last attempt timestamp. In-memory only: a process restart
// re-syncs once, which is harmless. Recorded up-front (even on failure) so
// a broken shop can't hammer the Admin API on every navigation.
const lastSyncAt = new Map<string, number>();

const PRIMARY_DOMAIN_QUERY = `#graphql
  query GleamePrimaryDomain {
    shop {
      primaryDomain { host }
      url
    }
  }`;

export async function syncShopDomains(admin: AdminGraphql, shopDomain: string): Promise<void> {
  try {
    const now = Date.now();
    const last = lastSyncAt.get(shopDomain);
    if (last && now - last < SYNC_INTERVAL_MS) return;
    lastSyncAt.set(shopDomain, now);

    const response = await admin.graphql(PRIMARY_DOMAIN_QUERY);
    const body = (await response.json()) as {
      data?: { shop?: { primaryDomain?: { host?: string | null } | null; url?: string | null } | null };
      errors?: Array<{ message: string }>;
    };
    if (body.errors?.length) {
      throw new Error(body.errors.map((e) => e.message).join("; "));
    }

    const primaryHost = body.data?.shop?.primaryDomain?.host?.toLowerCase();
    if (!primaryHost || primaryHost === shopDomain.toLowerCase()) return;

    const shop = await findShopByDomain(shopDomain);
    if (!shop) return; // no shops row yet; nothing to attach the domain to

    // alternate_domains is TEXT[] (migration 004); fetch current entries so
    // the merge preserves them without duplicates.
    const { data: row, error: readError } = await supabase
      .from("shops")
      .select("alternate_domains")
      .eq("id", shop.id)
      .single();
    if (readError) throw readError;

    const existing: string[] = row?.alternate_domains ?? [];
    if (existing.some((d) => d?.toLowerCase() === primaryHost)) return;

    // Duplicate-domain hazard: findShopByDomain resolves alternate_domains
    // across ALL shops, so a domain claimed by another shop must not be
    // appended here; it would make origin lookups ambiguous.
    const { data: claimants, error: claimError } = await supabase
      .from("shops")
      .select("id, shop_domain")
      .or(`shop_domain.eq.${primaryHost},alternate_domains.cs.{${primaryHost}}`)
      .neq("id", shop.id)
      .limit(1);
    if (claimError) throw claimError;
    if (claimants && claimants.length > 0) {
      console.warn(
        `[DomainSync] ${primaryHost} already claimed by ${claimants[0].shop_domain}; not adding to ${shopDomain}`,
      );
      return;
    }

    // Verify the write matched a row; Supabase UPDATE on 0 rows succeeds
    // silently.
    const { data: updated, error: updateError } = await supabase
      .from("shops")
      .update({ alternate_domains: [...existing, primaryHost] })
      .eq("id", shop.id)
      .select("id");
    if (updateError) throw updateError;
    if (!updated || updated.length === 0) {
      throw new Error(`update matched 0 rows for shop ${shopDomain}`);
    }

    console.log(`[DomainSync] added ${primaryHost} to alternate_domains for ${shopDomain}`);
  } catch (err) {
    // Fire-and-forget: never let domain sync surface into the admin load.
    console.error(`[DomainSync] failed for ${shopDomain}:`, err);
  }
}
