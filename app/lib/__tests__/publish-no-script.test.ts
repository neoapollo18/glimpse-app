import { describe, it, expect, beforeEach, vi } from "vitest";

// One-click Publish (2026-10-22, Shopify App Review): Gleame never writes a
// script into the merchant's page. The page goes on the find-my-match theme
// template when the live theme has it, the quiz shows through the Gleame
// Quiz app block, and the menu link waits until the block is on the page.
// Pages published earlier (quiz-embed.js in the body) are left untouched.

const m = vi.hoisted(() => ({
  setQuizSurfaceEnabled: vi.fn(),
}));

vi.mock("../supabase.server", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({ single: async () => ({ data: { id: "shop-1" }, error: null }) }),
      }),
    }),
  },
  getChatAssistantConfig: async () => ({ quiz_template: null }),
  getRecommendationCounts: async () => ({ questions: 3 }),
}));
vi.mock("../quiz-draft.server", () => ({ setQuizSurfaceEnabled: m.setQuizSurfaceEnabled }));
vi.mock("../template-live.server", () => ({
  templateLivePatch: () => ({ ok: true }),
  TEMPLATES_NEED_MIGRATION_ERROR: "migration",
}));

import { publishQuiz, templateHasQuizBlock } from "../publish.server";

const BLOCK = "shopify://apps/gleame/blocks/gleame-quiz/0d1f7c1e-aaaa-bbbb-cccc-1234567890ab";
const templateWithBlock = JSON.stringify({
  sections: {
    main: { type: "main-page", settings: {} },
    apps: { type: "_blocks", blocks: { q: { type: BLOCK, settings: {} } }, block_order: ["q"] },
  },
  order: ["main", "apps"],
});
const templateWithoutBlock = JSON.stringify({ sections: { main: { type: "main-page" } }, order: ["main"] });

type Page = { id: string; handle: string; title: string; isPublished: boolean; body: string; templateSuffix: string | null };

/** A fake Admin API: pages, the live theme's page templates, the main menu. */
function fakeAdmin(opts: {
  page?: Page | null;
  templates?: Record<string, string> | "denied";
  menuItems?: Array<Record<string, unknown>>;
}) {
  const calls: Array<{ query: string; variables?: any }> = [];
  const graphql = async (query: string, variables?: Record<string, unknown>) => {
    calls.push({ query, variables });
    if (query.includes("GleamePages")) return { pages: { nodes: opts.page ? [opts.page] : [] } };
    if (query.includes("GleameQuizTemplates")) {
      if (opts.templates === "denied") throw new Error("Access denied for themes field. Required access: `read_themes`");
      const all = opts.templates ?? {};
      const wanted: string[] = (variables as any).filenames;
      return {
        themes: {
          nodes: [
            {
              files: {
                nodes: wanted.filter((f) => f in all).map((f) => ({ filename: f, body: { content: all[f] } })),
              },
            },
          ],
        },
      };
    }
    if (query.includes("GleamePageCreate")) return { pageCreate: { page: { id: "gid://shopify/Page/9", handle: "find-my-match" }, userErrors: [] } };
    if (query.includes("GleamePageUpdate")) return { pageUpdate: { page: { id: (variables as any).id, handle: "find-my-match" }, userErrors: [] } };
    if (query.includes("GleameMenus")) return { menus: { nodes: [{ id: "menu-1", handle: "main-menu", title: "Main menu", items: opts.menuItems ?? [] }] } };
    if (query.includes("GleameMenuUpdate")) return { menuUpdate: { menu: { id: "menu-1" }, userErrors: [] } };
    throw new Error(`unexpected query: ${query.slice(0, 60)}`);
  };
  const named = (name: string) => calls.filter((c) => c.query.includes(name));
  return { graphql, calls, named };
}

beforeEach(() => {
  m.setQuizSurfaceEnabled.mockReset();
  m.setQuizSurfaceEnabled.mockResolvedValue({ ok: true });
});

describe("publishQuiz never writes a script into the page", () => {
  it("creates an empty page and no menu link when the theme has no quiz template", async () => {
    const admin = fakeAdmin({ templates: { "templates/page.json": templateWithoutBlock } });
    const result = await publishQuiz("shop.myshopify.com", admin.graphql);
    expect(result.ok).toBe(true);
    const created = admin.named("GleamePageCreate")[0].variables.page;
    expect(created.body).toBeUndefined();
    expect(created.templateSuffix).toBeUndefined();
    expect(JSON.stringify(admin.calls)).not.toMatch(/<script|quiz-embed/);
    expect(result.quizOnPage).toBe(false);
    expect(result.pageTemplate).toBeNull();
    expect(result.themeRead).toBe(true);
    // A menu link to an empty page is the dead end App Review flags.
    expect(admin.named("GleameMenuUpdate")).toHaveLength(0);
    expect(result.navLinkAdded).toBe(false);
    // The quiz is switched on so the block shows the moment it's added.
    expect(m.setQuizSurfaceEnabled).toHaveBeenCalledWith("shop-1", true);
  });

  it("puts the page on find-my-match when the theme has it, and links the block there", async () => {
    const admin = fakeAdmin({ templates: { "templates/page.find-my-match.json": templateWithoutBlock } });
    const result = await publishQuiz("shop.myshopify.com", admin.graphql);
    expect(admin.named("GleamePageCreate")[0].variables.page.templateSuffix).toBe("find-my-match");
    expect(result.pageTemplate).toBe("page.find-my-match");
    expect(result.quizOnPage).toBe(false);
    expect(admin.named("GleameMenuUpdate")).toHaveLength(0);
  });

  it("is live, with the menu link, once the block is on the template (Finish)", async () => {
    const admin = fakeAdmin({
      page: { id: "gid://shopify/Page/9", handle: "find-my-match", title: "Find My Match", isPublished: true, body: "", templateSuffix: null },
      templates: { "templates/page.find-my-match.json": templateWithBlock },
    });
    const result = await publishQuiz("shop.myshopify.com", admin.graphql);
    expect(admin.named("GleamePageCreate")).toHaveLength(0);
    expect(admin.named("GleamePageUpdate")[0].variables.page).toEqual({ templateSuffix: "find-my-match" });
    expect(result.quizOnPage).toBe(true);
    expect(result.navLinkAdded).toBe(true);
    const items = admin.named("GleameMenuUpdate")[0].variables.items;
    expect(items).toEqual([{ title: "Find My Match", type: "PAGE", resourceId: "gid://shopify/Page/9" }]);
  });

  it("leaves a page published with quiz-embed.js exactly as it is", async () => {
    const legacyBody =
      '<div id="gleame-quiz-root" data-shop-domain="shop.myshopify.com"></div>\n<script src="https://app.example/quiz-embed.js" defer></script>';
    const admin = fakeAdmin({
      page: { id: "gid://shopify/Page/5", handle: "find-my-match", title: "Find My Match", isPublished: true, body: legacyBody, templateSuffix: null },
      // Even with the block on our template, the page isn't moved there:
      // the block and the body would mount two quizzes.
      templates: { "templates/page.find-my-match.json": templateWithBlock },
    });
    const result = await publishQuiz("shop.myshopify.com", admin.graphql);
    expect(admin.named("GleamePageUpdate")).toHaveLength(0);
    expect(admin.named("GleamePageCreate")).toHaveLength(0);
    expect(result.quizOnPage).toBe(true);
    expect(result.pageTemplate).toBeNull();
  });

  it("re-publishes a hidden page without touching its body", async () => {
    const admin = fakeAdmin({
      page: { id: "gid://shopify/Page/9", handle: "find-my-match", title: "Find My Match", isPublished: false, body: "<p>Hi</p>", templateSuffix: "find-my-match" },
      templates: { "templates/page.find-my-match.json": templateWithBlock },
    });
    const result = await publishQuiz("shop.myshopify.com", admin.graphql);
    expect(admin.named("GleamePageUpdate")[0].variables.page).toEqual({ isPublished: true });
    expect(result.quizOnPage).toBe(true);
  });

  it("without theme access, trusts the admin's report of the block's placement", async () => {
    const page: Page = { id: "gid://shopify/Page/9", handle: "find-my-match", title: "Find My Match", isPublished: true, body: "", templateSuffix: null };
    const before = await publishQuiz("shop.myshopify.com", fakeAdmin({ page, templates: "denied" }).graphql);
    expect(before.ok).toBe(true);
    expect(before.themeRead).toBe(false);
    expect(before.quizOnPage).toBe(false);

    const admin = fakeAdmin({ page, templates: "denied" });
    const after = await publishQuiz("shop.myshopify.com", admin.graphql, { blockTemplates: ["page.find-my-match"] });
    expect(admin.named("GleamePageUpdate")[0].variables.page).toEqual({ templateSuffix: "find-my-match" });
    expect(after.quizOnPage).toBe(true);
    expect(after.navLinkAdded).toBe(true);
  });

  it("treats a chosen template missing from the theme as none", async () => {
    const admin = fakeAdmin({
      page: { id: "gid://shopify/Page/9", handle: "find-my-match", title: "Find My Match", isPublished: true, body: "", templateSuffix: "old-quiz" },
      templates: {},
    });
    const result = await publishQuiz("shop.myshopify.com", admin.graphql);
    expect(result.pageTemplate).toBeNull();
    expect(result.quizOnPage).toBe(false);
  });
});

describe("templateHasQuizBlock", () => {
  it("finds the block in an apps section and in nested blocks", () => {
    expect(templateHasQuizBlock(templateWithBlock)).toBe(true);
    const nested = JSON.stringify({
      sections: { s: { type: "section", blocks: { g: { type: "group", blocks: { q: { type: BLOCK } } } } } },
    });
    expect(templateHasQuizBlock(nested)).toBe(true);
  });

  it("ignores a disabled block or section, and other apps", () => {
    const disabledBlock = JSON.stringify({ sections: { a: { type: "_blocks", blocks: { q: { type: BLOCK, disabled: true } } } } });
    const disabledSection = JSON.stringify({ sections: { a: { type: "_blocks", disabled: true, blocks: { q: { type: BLOCK } } } } });
    const other = JSON.stringify({ sections: { a: { type: "_blocks", blocks: { q: { type: "shopify://apps/x/blocks/gleame-quiz-lite/1" } } } } });
    expect(templateHasQuizBlock(disabledBlock)).toBe(false);
    expect(templateHasQuizBlock(disabledSection)).toBe(false);
    expect(templateHasQuizBlock(other)).toBe(false);
    expect(templateHasQuizBlock(templateWithoutBlock)).toBe(false);
  });

  it("reads templates that open with a comment", () => {
    expect(templateHasQuizBlock(`/*\n * auto-generated\n */\n${templateWithBlock}`)).toBe(true);
  });
});
