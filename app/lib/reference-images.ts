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
  const fromJson = coerceReferenceUrlArray(row.reference_image_urls);
  if (fromJson.length > 0) return fromJson.slice(0, MAX_REFERENCE_IMAGES);
  if (row.reference_image_url) return [row.reference_image_url];
  return [];
}
