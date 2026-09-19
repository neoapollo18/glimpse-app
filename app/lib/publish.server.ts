/**
 * One-click publish (Overhaul Part 4 / D2).
 *
 * publishQuiz, in order:
 *   1. Page — pageCreate "Find My Match" whose body mounts the quiz via
 *      /quiz-embed.js (zero theme writes; works on any theme). Idempotent:
 *      an existing page with our handle is reused, not duplicated.
 *   2. Nav — optional "Add to my main menu": menuUpdate appends a PAGE
 *      item to the shop's main menu (write_online_store_navigation).
 *   3. Surface — flips the quiz storefront switch ON.
 *
 * unpublishQuiz flips the surface off and removes the nav link; the page
 * is left in place (unpublished pages 404 shoppers anyway once the
 * surface is off — the widget renders nothing).
 *
 * Uninstall cleanup caveat: Shopify revokes API tokens at uninstall, so
 * the uninstalled webhook cannot reliably delete the page/nav item. The
 * spec's "webhook removes the nav link" is best-effort only; unpublish
 * is the reliable cleanup path.
 *
 * The theme-editor deep link (addAppBlockId) remains available from the
 * Placements area for merchants who want the native app block instead.
 */

import { supabase } from "./supabase.server";
import { setQuizSurfaceEnabled } from "./quiz-draft.server";
import type { AdminGraphql } from "./brand-profile.server";

const PAGE_HANDLE = "find-my-match";

export interface PublishResult {
  ok: boolean;
  error?: string;
  liveUrl?: string;
  pageId?: string;
  navLinkAdded?: boolean;
  path?: "one-click";
}

const PAGES_QUERY = `#graphql
  query GleamePages($query: String!) {
    pages(first: 5, query: $query) { nodes { id handle title } }
  }
`;

const PAGE_CREATE = `#graphql
  mutation GleamePageCreate($page: PageCreateInput!) {
    pageCreate(page: $page) {
      page { id handle }
      userErrors { field message }
    }
  }
`;

const MENUS_QUERY = `#graphql
  query GleameMenus {
    menus(first: 20) {
      nodes {
        id
        handle
        title
        items {
          id title type url resourceId tags
          items { id title type url resourceId tags }
        }
      }
    }
  }
`;

const MENU_UPDATE = `#graphql
  mutation GleameMenuUpdate($id: ID!, $title: String!, $items: [MenuItemUpdateInput!]!) {
    menuUpdate(id: $id, title: $title, items: $items) {
      menu { id }
      userErrors { field message }
    }
  }
`;

function pageBody(shopDomain: string, appUrl: string): string {
  return [
    `<div id="gleame-quiz-root" data-shop-domain="${shopDomain}"></div>`,
    `<script src="${appUrl}/quiz-embed.js" defer></script>`,
  ].join("\n");
}

/** Strip null/absent fields so MenuItemUpdateInput round-trips cleanly. */
function menuItemInput(item: any): Record<string, unknown> {
  const out: Record<string, unknown> = { title: item.title, type: item.type };
  if (item.id) out.id = item.id;
  if (item.url && item.type === "HTTP") out.url = item.url;
  if (item.resourceId) out.resourceId = item.resourceId;
  if (item.tags?.length) out.tags = item.tags;
  if (item.items?.length) out.items = item.items.map(menuItemInput);
  return out;
}

export async function publishQuiz(
  shopDomain: string,
  adminGraphql: AdminGraphql,
  opts: { pageTitle?: string; addToMenu?: boolean } = {}
): Promise<PublishResult> {
  const appUrl = (process.env.SHOPIFY_APP_URL ?? "").replace(/\/$/, "");
  const pageTitle = (opts.pageTitle ?? "Find My Match").trim() || "Find My Match";
  const addToMenu = opts.addToMenu !== false;

  // 1. Page (reuse ours if it already exists — republish must not stack
  // duplicate pages).
  let pageId: string | null = null;
  let handle = PAGE_HANDLE;
  try {
    const existing = await adminGraphql(PAGES_QUERY, { query: `handle:${PAGE_HANDLE}` });
    const hit = existing?.pages?.nodes?.find((p: any) => p.handle === PAGE_HANDLE);
    if (hit) {
      pageId = hit.id;
    } else {
      const created = await adminGraphql(PAGE_CREATE, {
        page: {
          title: pageTitle,
          handle: PAGE_HANDLE,
          isPublished: true,
          body: pageBody(shopDomain, appUrl),
        },
      });
      const errs = created?.pageCreate?.userErrors;
      if (errs?.length) return { ok: false, error: `Page: ${errs[0].message}` };
      pageId = created?.pageCreate?.page?.id ?? null;
      handle = created?.pageCreate?.page?.handle ?? PAGE_HANDLE;
    }
  } catch (e) {
    return { ok: false, error: `Page: ${(e as Error).message}` };
  }
  if (!pageId) return { ok: false, error: "Page: no id returned" };

  // 2. Nav link (best-effort — a menu failure must not fail the publish).
  let navLinkAdded = false;
  if (addToMenu) {
    try {
      const menus = await adminGraphql(MENUS_QUERY);
      const nodes = menus?.menus?.nodes ?? [];
      const main =
        nodes.find((m: any) => m.handle === "main-menu") ??
        nodes.find((m: any) => /main/i.test(m.handle ?? "")) ??
        nodes[0];
      if (main) {
        const already = (main.items ?? []).some((i: any) => i.resourceId === pageId);
        if (already) {
          navLinkAdded = true;
        } else {
          const items = (main.items ?? []).map(menuItemInput);
          items.push({ title: pageTitle, type: "PAGE", resourceId: pageId });
          const updated = await adminGraphql(MENU_UPDATE, {
            id: main.id,
            title: main.title,
            items,
          });
          navLinkAdded = !(updated?.menuUpdate?.userErrors?.length);
          if (!navLinkAdded) {
            console.warn(
              `[publish] menuUpdate failed for ${shopDomain}: ${updated?.menuUpdate?.userErrors?.[0]?.message}`
            );
          }
        }
      }
    } catch (e) {
      console.warn(`[publish] nav link failed for ${shopDomain}: ${(e as Error).message}`);
    }
  }

  // 3. Storefront switch ON.
  const surface = await setQuizSurfaceEnabled_byDomain(shopDomain);
  if (!surface.ok) return { ok: false, error: surface.error };

  return {
    ok: true,
    liveUrl: `https://${shopDomain}/pages/${handle}`,
    pageId,
    navLinkAdded,
    path: "one-click",
  };
}

export async function unpublishQuiz(
  shopDomain: string,
  adminGraphql: AdminGraphql,
  opts: { removeNavLink?: boolean } = {}
): Promise<{ ok: boolean; error?: string; navLinkRemoved?: boolean }> {
  const shop = await supabase.from("shops").select("id").eq("shop_domain", shopDomain).single();
  if (shop.error) return { ok: false, error: shop.error.message };
  const off = await setQuizSurfaceEnabled(shop.data.id, false);
  if (!off.ok) return { ok: false, error: off.error };

  let navLinkRemoved = false;
  if (opts.removeNavLink !== false) {
    try {
      const pages = await adminGraphql(PAGES_QUERY, { query: `handle:${PAGE_HANDLE}` });
      const pageId = pages?.pages?.nodes?.find((p: any) => p.handle === PAGE_HANDLE)?.id;
      if (pageId) {
        const menus = await adminGraphql(MENUS_QUERY);
        for (const menu of menus?.menus?.nodes ?? []) {
          const items = (menu.items ?? []).filter((i: any) => i.resourceId !== pageId);
          if (items.length !== (menu.items ?? []).length) {
            await adminGraphql(MENU_UPDATE, {
              id: menu.id,
              title: menu.title,
              items: items.map(menuItemInput),
            });
            navLinkRemoved = true;
          }
        }
      }
    } catch (e) {
      console.warn(`[unpublish] nav cleanup failed for ${shopDomain}: ${(e as Error).message}`);
    }
  }
  return { ok: true, navLinkRemoved };
}

async function setQuizSurfaceEnabled_byDomain(
  shopDomain: string
): Promise<{ ok: boolean; error?: string }> {
  const shop = await supabase.from("shops").select("id").eq("shop_domain", shopDomain).single();
  if (shop.error) return { ok: false, error: shop.error.message };
  return setQuizSurfaceEnabled(shop.data.id, true);
}
