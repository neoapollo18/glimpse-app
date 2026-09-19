// Self-contained quiz bootstrap for published pages (Overhaul Part 4 / D2).
//
// One-click publish creates a page whose body is just a mount div plus
// <script src=".../quiz-embed.js">. This route serves everything the
// theme-app-extension block would have loaded — quiz CSS + camera CSS
// injected as a <style> tag, then camera JS + quiz JS — so the published
// page works on ANY theme with zero theme writes. The native app block
// remains the richer path (cart token, section settings); merchants can
// switch to it from Placements later.
//
// Cached aggressively; the content only changes on deploy.

import fs from "node:fs";
import path from "node:path";

const ASSETS_DIR = path.join(process.cwd(), "extensions", "glimpse-widget", "assets");

let cached: { body: string; etag: string } | null = null;

function build(): { body: string; etag: string } {
  const read = (name: string) => {
    try {
      return fs.readFileSync(path.join(ASSETS_DIR, name), "utf8");
    } catch (e) {
      console.error(`[quiz-embed] missing asset ${name}:`, e);
      return "";
    }
  };
  const css = (read("gleame-quiz.css") + "\n" + read("gleame-camera.css"))
    .replace(/<\/style>/gi, "<\\/style>");
  const js = read("gleame-camera.js") + "\n;\n" + read("gleame-quiz.js");
  const body = [
    "(function(){",
    "  var s = document.createElement('style');",
    `  s.textContent = ${JSON.stringify(css)};`,
    "  document.head.appendChild(s);",
    "})();",
    js,
  ].join("\n");
  const etag = `"qe-${Buffer.byteLength(body).toString(36)}-${simpleHash(body)}"`;
  return { body, etag };
}

function simpleHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export const loader = async ({ request }: { request: Request }) => {
  if (process.env.NODE_ENV !== "production" || !cached) cached = build();
  if (request.headers.get("If-None-Match") === cached.etag) {
    return new Response(null, { status: 304, headers: { ETag: cached.etag } });
  }
  return new Response(cached.body, {
    status: 200,
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
      ETag: cached.etag,
      "Access-Control-Allow-Origin": "*",
    },
  });
};
