import { type LoaderFunctionArgs } from "@remix-run/node";
import { readFileSync } from "fs";
import { join } from "path";
import { TRYON_WIDGETS_RETIRED, retiredScript } from "../lib/retired-features";

// Derive the widget's API origin from the deployed app URL so a host move
// (custom domain, Render rename) doesn't silently break embeds.
const APP_URL = (process.env.SHOPIFY_APP_URL || "https://glimpse-app-charles.onrender.com").replace(/\/+$/, "");

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // Try-on widgets are retired (lib/retired-features.ts): a theme that
  // still carries this script tag gets a valid no-op script.
  if (TRYON_WIDGETS_RETIRED) return retiredScript();
  try {
    // Read the widget file, rewriting its hardcoded SHOPIFY_APP_URL
    // assignment to the env-derived origin. It lives in retired/, not
    // public/: remix-serve serves public/ files statically (immutable cache)
    // before any route runs, which bypassed this loader entirely.
    const widgetPath = join(process.cwd(), "retired", "widget-embed.js");
    const widgetContent = readFileSync(widgetPath, "utf-8").replace(
      /const SHOPIFY_APP_URL = '[^']*';/,
      `const SHOPIFY_APP_URL = '${APP_URL}';`,
    );

    return new Response(widgetContent, {
      status: 200,
      headers: {
        "Content-Type": "application/javascript",
        "Cache-Control": "public, max-age=3600", // Cache for 1 hour
        "Access-Control-Allow-Origin": "*", // Allow cross-origin requests
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  } catch (error) {
    console.error("Error serving widget-embed.js:", error);
    return new Response("Widget not found", { status: 404 });
  }
};

// Handle OPTIONS preflight requests for CORS
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

