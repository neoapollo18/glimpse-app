import { type LoaderFunctionArgs } from "@remix-run/node";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Serves the storefront embed JS from /public/skin-analysis-embed.js.
 * Mirrors the existing /widget-embed.js pattern (app/routes/widget-embed[.]js.ts).
 *
 * Cached for 1 hour publicly. Cross-origin so any merchant storefront can
 * load it directly via <script src="https://gleame.app/skin-analysis-embed.js">.
 */
export const loader = async (_args: LoaderFunctionArgs) => {
  try {
    const embedPath = join(process.cwd(), "public", "skin-analysis-embed.js");
    const content = readFileSync(embedPath, "utf-8");
    return new Response(content, {
      status: 200,
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  } catch (error) {
    console.error("Error serving skin-analysis-embed.js:", error);
    return new Response("Embed script not found", { status: 404 });
  }
};

export const action = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }
  return new Response("Method not allowed", { status: 405 });
};
