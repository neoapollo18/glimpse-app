// ---------------------------------------------------------------------
// Retired features (2026-10-15, at Shopify App Review's request).
//
// The product-page try-on widgets (Gleame Banner / Button / Embedded /
// Horizontal / Legacy, plus the standalone /widget-embed.js and
// /api/widget-embed scripts) and the chat assistant embed are no longer
// app features. Their code stays in the repo, switched off here:
//   - the theme blocks are left out of deploys (extensions/glimpse-widget/.shopifyignore)
//   - their storefront endpoints answer with a quiet "retired" response,
//     never an error page, so a stale theme or a pasted script tag can't
//     break a store
//   - their admin UI and analytics are commented out
// The quiz (including its own try-on step, /api/storefront/quiz-tryon) is
// NOT affected. Flip a flag (and restore the blocks) to bring one back.
// ---------------------------------------------------------------------

export const TRYON_WIDGETS_RETIRED = true;
export const CHAT_ASSISTANT_RETIRED = true;

// The Quiz settings page (/app/assistant, formerly "AI Assistant") moved
// into Studio on 2026-10-15: its recommendation settings are Studio's
// Matching panel and the camera hint sits on Photo & try-on. The route now
// opens Studio there; its code is kept.
export const QUIZ_SETTINGS_PAGE_RETIRED = true;

const RETIRED_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Requested-With",
};

/** JSON answer for a retired storefront API. 410 tells old widget code the
 * feature is gone (they treat any non-2xx as "unavailable" and stay quiet). */
export function retiredJson(): Response {
  return new Response(JSON.stringify({ error: "This feature is no longer available", retired: true }), {
    status: 410,
    headers: { ...RETIRED_CORS, "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" },
  });
}

export function retiredPreflight(): Response {
  return new Response(null, { status: 204, headers: RETIRED_CORS });
}

/** A valid, empty script for retired embed URLs: a theme that still has the
 * script tag loads it without a console error and renders nothing. */
export function retiredScript(): Response {
  return new Response("/* Gleame try-on widgets are retired; this script intentionally does nothing. */\n", {
    status: 200,
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
