import { type LoaderFunctionArgs } from "@remix-run/node";
import { readFileSync } from "fs";
import { join } from "path";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    // Read the widget file from the public directory
    const widgetPath = join(process.cwd(), "public", "widget-embed.js");
    const widgetContent = readFileSync(widgetPath, "utf-8");

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

