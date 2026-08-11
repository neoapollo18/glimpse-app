/**
 * Shared reference-image helpers (safe for client + server bundles).
 * Do not import Supabase or other server-only code here.
 */

export const MAX_REFERENCE_IMAGES = 5;

function coerceReferenceUrlArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((u): u is string => typeof u === "string" && u.trim().length > 0)
    .map((s) => s.trim());
}

/**
 * Normalize a raw jsonb value holding a URL array (e.g. multi_set_reference_urls).
 */
export function coerceReferenceImageUrlList(raw: unknown): string[] {
  return coerceReferenceUrlArray(raw).slice(0, MAX_REFERENCE_IMAGES);
}

/**
 * Normalize reference URLs from a DB row (JSON array and/or legacy single column).
 */
export function parseReferenceImageUrls(
  row:
    | {
        reference_image_url?: string | null;
        reference_image_urls?: unknown;
      }
    | null
    | undefined
): string[] {
  if (!row) return [];
  const fromJson = coerceReferenceImageUrlList(row.reference_image_urls);
  if (fromJson.length > 0) return fromJson;
  if (row.reference_image_url) return [row.reference_image_url];
  return [];
}
