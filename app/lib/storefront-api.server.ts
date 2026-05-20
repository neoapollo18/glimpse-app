/**
 * Shared building blocks for the public storefront API routes.
 *
 * Every storefront endpoint (analyze-skin, project-skin, transform-image,
 * report-skin-analysis, etc.) needs the same CORS headers and the same
 * permissive-but-careful image-type check. Each route used to declare its
 * own copy; centralizing here keeps drift out of the surface that talks to
 * untrusted callers.
 *
 * Auth/rate-limit chain extraction is deliberately NOT done here yet — only
 * two callers share the full chain today (analyze-skin, project-skin), and
 * transform-image's chain returns 403-instead-of-404 on unknown-shop, which
 * would force the helper to be pluggable. Revisit when transform-image is
 * touched.
 */

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
