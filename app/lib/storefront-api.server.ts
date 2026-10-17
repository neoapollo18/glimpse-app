/**
 * Shared building blocks for the public storefront API routes.
 *
 * Every storefront endpoint (analyze-skin, project-skin, transform-image,
 * report-skin-analysis, etc.) needs the same CORS headers, the same
 * permissive-but-careful image-type check and the same pre-parse body-size
 * gate. Each route used to declare its own copy; centralizing here keeps
 * drift out of the surface that talks to untrusted callers.
 *
 * Auth/rate-limit chain extraction is deliberately NOT done here yet — only
 * two callers share the full chain today (analyze-skin, project-skin), and
 * transform-image's chain returns 403-instead-of-404 on unknown-shop, which
 * would force the helper to be pluggable. Revisit when transform-image is
 * touched.
 */

import { json } from "@remix-run/node";

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Requested-With",
};

/**
 * Permissive image-type validator used by every storefront upload endpoint.
 * Accepts standard MIME types plus HEIC/HEIF, and falls back to extension
 * sniffing when the browser sent an empty or octet-stream content type
 * (common for iOS drag-drop and some Android browsers).
 */
export function isValidImageFile(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  const heicMimeTypes = ["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"];
  if (heicMimeTypes.includes(file.type.toLowerCase())) return true;
  if (!file.type || file.type === "" || file.type === "application/octet-stream") {
    const ext = file.name?.toLowerCase().split(".").pop();
    const validExtensions = ["jpg", "jpeg", "png", "gif", "webp", "bmp", "heic", "heif", "avif"];
    return validExtensions.includes(ext || "");
  }
  return false;
}

/** Body budget for the small JSON storefront posts (events, recommend, lead
 * results, bundle code, skin reports). Real payloads are a few KB; keepalive
 * beacons can't exceed 64 KB in the browser anyway. */
export const JSON_BODY_LIMIT_BYTES = 64 * 1024;

/**
 * Early 413 for a storefront POST whose declared Content-Length is over the
 * route's budget. formData()/json() buffer the whole body before any of the
 * route's own size checks run, and remix-serve sets no body limit, so this
 * has to happen before parsing. A missing or unreadable Content-Length
 * passes untouched, exactly as before: the check only refuses what the
 * caller itself says is oversized.
 */
export function rejectOversizedBody(
  request: Request,
  maxBytes: number,
  headers: HeadersInit = CORS_HEADERS,
  error = "Request too large",
): Response | null {
  const declared = request.headers.get("content-length");
  if (declared === null) return null;
  const bytes = Number(declared);
  if (!Number.isFinite(bytes) || bytes <= maxBytes) return null;
  return json({ error }, { status: 413, headers });
}
