/**
 * One-click publish (Overhaul Part 4 / D2).
 *
 * publishQuiz, in order:
 *   0. Preconditions (questions exist; for a template quiz, templates are
 *      not paused and migration 081 has run), all before any Shopify write.
 *   1. Page: pageCreate "Find My Match". Since 2026-10-22 (Shopify App
 *      Review) Gleame never writes a script into the page: the quiz shows
 *      through the Gleame Quiz app block on the page's theme template. When
 *      the live theme has a `find-my-match` page template, the page is put
 *      on it. The live theme is read (read_themes, optional scope) to learn
 *      whether the block is there; if not, the Publish sheet sends the
 *      merchant to the theme editor to add it, then publishes again.
 *      Idempotent: an existing page with our handle is reused, not
 *      duplicated (and re-published if the merchant hid it). Pages
 *      published before 2026-10-22 mount the quiz through quiz-embed.js in
 *      their body; they are left exactly as they are and keep working.
 *   2. Nav: optional "Add to my main menu": menuUpdate appends a PAGE
 *      item to the shop's main menu (write_online_store_navigation), only
 *      once the quiz shows on the page, so the menu never links to an
 *      empty page.
 *   3. Surface: flips the quiz storefront switch ON (and, for a template
 *      quiz, stamps the template live in the same write).
 *
 * unpublishQuiz flips the surface off and removes the nav link; the page
 * is left in place (unpublished pages 404 shoppers anyway once the
 * surface is off — the widget renders nothing).
 *
 * Uninstall cleanup caveat: Shopify revokes API tokens at uninstall, so
 * the uninstalled webhook cannot reliably delete the page/nav item. The
 * spec's "webhook removes the nav link" is best-effort only; unpublish
 * is the reliable cleanup path.
 */

import { supabase, getChatAssistantConfig, getRecommendationCounts } from "./supabase.server";
import { setQuizSurfaceEnabled } from "./quiz-draft.server";
import { isTemplateId } from "./quiz-templates";
import { templateLivePatch, TEMPLATES_NEED_MIGRATION_ERROR } from "./template-live.server";
import { isMissingColumnError } from "./brand-library-status";
import type { AdminGraphql } from "./brand-profile.server";
import { QUIZ_BLOCK_HANDLE, QUIZ_PAGE_TEMPLATE } from "./theme-extension";

const PAGE_HANDLE = "find-my-match";
/** "find-my-match": the page template suffix the setup guide has merchants create. */
const QUIZ_TEMPLATE_SUFFIX = QUIZ_PAGE_TEMPLATE.replace(/^page\./, "");

export interface PublishResult {
  ok: boolean;
  error?: string;
  liveUrl?: string;
  pageId?: string;
  navLinkAdded?: boolean;
  path?: "one-click";
  /** The storefront now serves this quiz's template (template shops). */
  templateLive?: boolean;
  /** The quiz shows on the page: the Gleame Quiz block is on the page's
   * theme template, or the page body mounts it (pages published before
   * 2026-10-22). When false the page exists but is empty until the merchant
   * adds the block, and no menu link was added. */
  quizOnPage?: boolean;
  /** Theme template the page uses, e.g. "page.find-my-match"; null when it
   * uses the default page template. The block deep link targets it. */
  pageTemplate?: string | null;
  /** Whether the live theme could be read (read_themes). When false,
   * quizOnPage relies on the admin's own report of the block's placements. */
  themeRead?: boolean;
  /** Optional access scopes the shop hasn't granted yet (toml
   * optional_scopes). The Publish sheet requests them via App Bridge and
   * retries. */
  missingScopes?: string[];
  /** Scopes the installation actually holds, reported on access-denied so
   * a failed publish says what Shopify granted (diagnostics). */
  grantedScopes?: string[];
}

export const PUBLISH_PAGE_SCOPE = "write_online_store_pages";
export const PUBLISH_NAV_SCOPE = "write_online_store_navigation";
export const PUBLISH_THEME_SCOPE = "read_themes";

/** Admin API "Access denied ... Required access: ..." for a scope the shop
 * hasn't granted. */
function isAccessDenied(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  return /access denied|required access|requires? .*scope|not approved to access/i.test(msg);
}

const PAGES_QUERY = `#graphql
  query GleamePages($query: String!) {
    pages(first: 5, query: $query) { nodes { id handle title isPublished body templateSuffix } }
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

const PAGE_UPDATE = `#graphql
  mutation GleamePageUpdate($id: ID!, $page: PageUpdateInput!) {
    pageUpdate(id: $id, page: $page) {
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

const THEME_TEMPLATES_QUERY = `#graphql
  query GleameQuizTemplates($filenames: [String!]) {
    themes(first: 1, roles: [MAIN]) {
      nodes {
        files(filenames: $filenames, first: 5) {
          nodes {
            filename
            body {
              ... on OnlineStoreThemeFileBodyText { content }
            }
          }
        }
      }
    }
  }
`;

/** An app block entry for the quiz block, e.g.
 * "shopify://apps/gleame/blocks/gleame-quiz/<uuid>". */
const QUIZ_BLOCK_TYPE = new RegExp(`/blocks/${QUIZ_BLOCK_HANDLE}/`);

/** Whether a JSON template holds the quiz block, enabled, in an enabled
 * section. Walks nested blocks too (Horizon-style themes nest them). An
 * unparseable template falls back to a plain text search. */
export function templateHasQuizBlock(content: string): boolean {
  let json: unknown;
  try {
    // JSON templates legally open with a /* comment */ block.
    json = JSON.parse(content.replace(/^\s*\/\*[\s\S]*?\*\//, ""));
  } catch {
    return QUIZ_BLOCK_TYPE.test(content);
  }
  const visit = (node: unknown): boolean => {
    if (!node || typeof node !== "object") return false;
    const n = node as Record<string, unknown>;
    if (n.disabled === true) return false;
    if (typeof n.type === "string" && QUIZ_BLOCK_TYPE.test(n.type)) return true;
    for (const key of ["sections", "blocks"]) {
      const children = n[key];
      if (children && typeof children === "object") {
        for (const child of Object.values(children as Record<string, unknown>)) if (visit(child)) return true;
      }
    }
    return false;
  };
  return visit(json);
}

/** The live theme's page templates for `suffixes` ("" = the default page
 * template), each mapped to whether it holds the quiz block; a template
 * missing from the theme is missing from the map. null when the theme
 * can't be read (read_themes not granted, or the read failed). */
async function readPageTemplates(
  adminGraphql: AdminGraphql,
  suffixes: string[]
): Promise<Map<string, boolean> | null> {
  const filenames = suffixes.map((s) => (s ? `templates/page.${s}.json` : "templates/page.json"));
  try {
    const data = await adminGraphql(THEME_TEMPLATES_QUERY, { filenames });
    const theme = data?.themes?.nodes?.[0];
    if (!theme) return null;
    const out = new Map<string, boolean>();
    for (const file of theme.files?.nodes ?? []) {
      const m = /^templates\/page(?:\.(.+))?\.json$/.exec(String(file?.filename ?? ""));
      if (!m) continue;
      const content = file?.body?.content;
      out.set(m[1] ?? "", typeof content === "string" && templateHasQuizBlock(content));
    }
    return out;
  } catch (e) {
    console.warn(`[publish] theme templates unreadable: ${(e as Error).message}`);
    return null;
  }
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
  opts: {
    pageTitle?: string;
    addToMenu?: boolean;
    /** Templates the admin reports the quiz block on (App Bridge
     * app.extensions()), e.g. ["page.find-my-match"]. Used only when the
     * theme can't be read. */
    blockTemplates?: string[];
  } = {}
): Promise<PublishResult> {
  const pageTitle = (opts.pageTitle ?? "Find My Match").trim() || "Find My Match";
  const addToMenu = opts.addToMenu !== false;

  // 0. Preconditions, checked BEFORE any Shopify write so a refused publish
  // never leaves a stray page or menu link behind. The UI checks these too;
  // this is the authoritative copy (the endpoint is reachable directly).
  const shopRow = await supabase.from("shops").select("id").eq("shop_domain", shopDomain).single();
  if (shopRow.error || !shopRow.data) return { ok: false, error: shopRow.error?.message ?? "Shop not found" };
  const [counts, cfg] = await Promise.all([
    getRecommendationCounts(shopRow.data.id).catch(() => null),
    getChatAssistantConfig(shopDomain, { throwOnError: true }).catch((e: Error) => e),
  ]);
  if (!counts) return { ok: false, error: "Couldn't read your quiz. Please try again." };
  if (counts.questions === 0) return { ok: false, error: "Your quiz has no questions yet." };
  if (cfg instanceof Error) return { ok: false, error: `Couldn't read your quiz settings: ${cfg.message}` };
  if (isTemplateId(cfg.quiz_template)) {
    // Step 3's go-live rule (setQuizSurfaceEnabled -> templateLivePatch),
    // applied here first so a refusal can't strand a page + menu link.
    const gate = templateLivePatch(cfg, true);
    if (!gate.ok) return { ok: false, error: gate.error };
    // Step 3 also WRITES template_live_at; the typed read above maps a
    // missing column to null, so probe it (migration 081 not run yet).
    const probe = await supabase.from("chat_assistant_config").select("template_live_at").limit(1);
    if (probe.error && isMissingColumnError(probe.error)) {
      console.error(`[publish] template_live_at missing (migration 081 not run?); refusing template publish for ${shopDomain}`);
      return { ok: false, error: TEMPLATES_NEED_MIGRATION_ERROR };
    }
  }

  // 1. Page (reuse ours if it already exists — republish must not stack
  // duplicate pages). Nothing is ever written into the page body.
  let pageId: string | null = null;
  let handle = PAGE_HANDLE;
  let pageTemplate: string | null = null;
  let quizOnPage = false;
  let themeRead = false;
  try {
    const existing = await adminGraphql(PAGES_QUERY, { query: `handle:${PAGE_HANDLE}` });
    const hit = existing?.pages?.nodes?.find((p: any) => p.handle === PAGE_HANDLE);
    const body = typeof hit?.body === "string" ? hit.body : "";
    // Published before 2026-10-22: the body mounts the quiz through
    // quiz-embed.js. Left as it is (it works); never moved onto a template,
    // where the block would mount a second quiz.
    const embedMounted = body.includes("gleame-quiz-root");
    // A template the merchant (or an earlier publish) chose is kept.
    const chosenSuffix = typeof hit?.templateSuffix === "string" ? hit.templateSuffix.trim() : "";
    const templates = await readPageTemplates(
      adminGraphql,
      [...new Set(["", QUIZ_TEMPLATE_SUFFIX, chosenSuffix])]
    );
    themeRead = templates !== null;
    // A chosen template the live theme doesn't have renders as the default
    // page template, so it counts as none.
    const keptSuffix = chosenSuffix && (!templates || templates.has(chosenSuffix)) ? chosenSuffix : "";
    // Our template goes on a page without one, once the theme has it (an
    // unreadable theme: once the admin reports the block on it).
    const hint = opts.blockTemplates ?? [];
    const themeHasOurs = templates ? templates.has(QUIZ_TEMPLATE_SUFFIX) : hint.includes(QUIZ_PAGE_TEMPLATE);
    const assignSuffix = !keptSuffix && !embedMounted && themeHasOurs ? QUIZ_TEMPLATE_SUFFIX : "";
    const suffix = keptSuffix || assignSuffix;
    const templateName = suffix ? `page.${suffix}` : "page";
    pageTemplate = suffix ? templateName : null;
    const blockOnTemplate = templates ? templates.get(suffix) === true : hint.includes(templateName);
    quizOnPage = embedMounted || blockOnTemplate;

    if (hit) {
      pageId = hit.id;
      // Republish after the merchant hid the page must bring it back;
      // otherwise "Open the live page" 404s.
      const page: Record<string, unknown> = {};
      if (hit.isPublished === false) page.isPublished = true;
      if (assignSuffix) page.templateSuffix = assignSuffix;
      if (Object.keys(page).length > 0) {
        const updated = await adminGraphql(PAGE_UPDATE, { id: hit.id, page });
        const errs = updated?.pageUpdate?.userErrors;
        if (errs?.length) return { ok: false, error: `Page: ${errs[0].message}` };
      }
    } else {
      const page: Record<string, unknown> = { title: pageTitle, handle: PAGE_HANDLE, isPublished: true };
      if (assignSuffix) page.templateSuffix = assignSuffix;
      const created = await adminGraphql(PAGE_CREATE, { page });
      const errs = created?.pageCreate?.userErrors;
      if (errs?.length) return { ok: false, error: `Page: ${errs[0].message}` };
      pageId = created?.pageCreate?.page?.id ?? null;
      handle = created?.pageCreate?.page?.handle ?? PAGE_HANDLE;
    }
  } catch (e) {
    if (isAccessDenied(e)) {
      let grantedScopes: string[] | undefined;
      try {
        const inst = await adminGraphql(`query { currentAppInstallation { accessScopes { handle } } }`);
        grantedScopes = (inst?.currentAppInstallation?.accessScopes ?? []).map((a: any) => String(a.handle));
      } catch {
        /* diagnostics only */
      }
      console.warn(`[publish] ${shopDomain}: page access denied; granted scopes:`, grantedScopes ?? "unknown");
      return {
        ok: false,
        error: "Gleame needs permission to create the Find My Match page in your Online Store.",
        missingScopes: [PUBLISH_PAGE_SCOPE],
        grantedScopes,
      };
    }
    return { ok: false, error: `Page: ${(e as Error).message}` };
  }
  if (!pageId) return { ok: false, error: "Page: no id returned" };

  // 2. Nav link (best-effort — a menu failure must not fail the publish).
  // Only once the quiz shows on the page: a menu link to an empty page is
  // the dead end App Review flags. The Publish sheet's Finish publishes
  // again after the block is added, which adds the link then.
  let navLinkAdded = false;
  if (addToMenu && quizOnPage) {
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

  // 3. Storefront switch ON. For a template quiz this is also the moment
  // the template goes live (setQuizSurfaceEnabled stamps template_live_at
  // in the same write).
  const surface = await setQuizSurfaceEnabled(shopRow.data.id, true);
  if (!surface.ok) return { ok: false, error: surface.error };

  return {
    ok: true,
    liveUrl: `https://${shopDomain}/pages/${handle}`,
    pageId,
    navLinkAdded,
    quizOnPage,
    pageTemplate,
    themeRead,
    path: "one-click",
    templateLive: Boolean(surface.templateLive),
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
