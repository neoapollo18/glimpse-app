// Gleame's theme app extension, as the admin refers to it (client-safe).
//
// The extension ships one app block: blocks/gleame-quiz.liquid, a full-page
// section. The Studio setup guide has merchants create a `find-my-match`
// page template and add the block there; one-click Publish creates the page,
// puts it on that template and links to the theme editor to add the block.
// (Pages published before 2026-10-22 mount the quiz through quiz-embed.js
// in their body instead.)

/** The quiz app block's handle (its Liquid filename). */
export const QUIZ_BLOCK_HANDLE = "gleame-quiz";

/** The page template the setup guide asks merchants to create. */
export const QUIZ_PAGE_TEMPLATE = "page.find-my-match";

/**
 * Theme editor deep link that adds the quiz block to `template`. Shopify
 * keys app block deep links by the app's api_key (the toml client_id); the
 * extension-uuid form is deprecated. Without an api key the link still opens
 * the editor on that template, just without adding the block.
 */
export function addQuizBlockUrl(shopDomain: string, apiKey: string, template: string = QUIZ_PAGE_TEMPLATE): string {
  const handle = shopDomain.replace(".myshopify.com", "");
  const base = `https://admin.shopify.com/store/${handle}/themes/current/editor?template=${encodeURIComponent(template)}`;
  return apiKey
    ? `${base}&addAppBlockId=${encodeURIComponent(apiKey)}/${QUIZ_BLOCK_HANDLE}&target=newAppsSection`
    : base;
}

/** One activation of the quiz block in the published theme. */
export interface QuizBlockPlacement {
  /** Template the block sits on, e.g. "page.find-my-match" or "index". */
  template: string;
}

export type QuizBlockStatus =
  | { state: "active"; placements: QuizBlockPlacement[] }
  | { state: "inactive" }
  | { state: "unknown" };

/**
 * Reads the quiz block's status out of App Bridge's `shopify.app.extensions()`
 * result (published theme only). Activation targets look like
 * `template--page.find-my-match/<section>/<block>`.
 */
export function quizBlockStatusFrom(extensions: unknown): QuizBlockStatus {
  if (!Array.isArray(extensions)) return { state: "unknown" };
  for (const ext of extensions as Array<Record<string, unknown>>) {
    if (ext?.type !== "theme_app_extension" || !Array.isArray(ext.activations)) continue;
    for (const block of ext.activations as Array<Record<string, unknown>>) {
      if (block?.handle !== QUIZ_BLOCK_HANDLE) continue;
      if (block.status !== "active") return { state: "inactive" };
      const placements: QuizBlockPlacement[] = [];
      const seen = new Set<string>();
      for (const a of Array.isArray(block.activations) ? (block.activations as Array<Record<string, unknown>>) : []) {
        const m = /^template--([^/]+)/.exec(String(a?.target ?? ""));
        const template = m ? m[1] : String(a?.target ?? "");
        if (template && !seen.has(template)) {
          seen.add(template);
          placements.push({ template });
        }
      }
      return { state: "active", placements };
    }
  }
  return { state: "unknown" };
}

/** Merchant-facing name for a template handle ("page.find-my-match" -> "page template find-my-match"). */
export function templateLabel(template: string): string {
  if (template === "index") return "home page";
  const [type, ...suffix] = template.split(".");
  const kind = type === "page" ? "page" : type;
  return suffix.length ? `${kind} template "${suffix.join(".")}"` : `default ${kind} template`;
}
