/**
 * Brand-library index status: pure helpers (V3-CONTRACTS §9, spec 4.6).
 *
 * No Supabase import on purpose: brand-library.server.ts (the DB side)
 * imports from here, and app/lib/__tests__/brand-library-status.test.ts
 * exercises these without a database or env.
 *
 * Lifecycle (shops.library_index_status, migration 080):
 *   NULL      never attempted (pre-080 rows, or sync never ran)
 *   pending   a catalog sync started and will build the library on its
 *             final page
 *   building  buildBrandLibrary is running
 *   ready     built; library_indexed_at set; >= 1 image indexed
 *   failed    threw, timed out before indexing anything, or found nothing;
 *             library_index_error carries a short reason
 */

export type LibraryIndexStatus = "pending" | "building" | "ready" | "failed";

export interface LibraryStatus {
  status: LibraryIndexStatus | null;
  error: string | null;
  imageCount: number;
  indexedAt: string | null;
}

export const LIBRARY_INDEX_STATUSES: readonly LibraryIndexStatus[] = [
  "pending",
  "building",
  "ready",
  "failed",
];

export function isLibraryIndexStatus(value: unknown): value is LibraryIndexStatus {
  return typeof value === "string" && (LIBRARY_INDEX_STATUSES as readonly string[]).includes(value);
}

/** Max length persisted in shops.library_index_error. */
export const LIBRARY_ERROR_MAX_LENGTH = 300;

export const TIMED_OUT_BEFORE_ANY_IMAGE = "timed out before indexing any images";
export const NO_IMAGES_FOUND =
  "no images found in product media, variants, collections, brand assets or homepage";

/**
 * Short, single-line, bounded error text for the shops column. Accepts an
 * Error, a string, or anything else (stringified). Empty input → a
 * generic reason so `failed` never lands with a null explanation.
 */
export function truncateIndexError(err: unknown, max: number = LIBRARY_ERROR_MAX_LENGTH): string {
  let msg: string;
  if (err instanceof Error) msg = err.message;
  else if (typeof err === "string") msg = err;
  else if (err == null) msg = "";
  else {
    try {
      msg = JSON.stringify(err);
    } catch {
      msg = String(err);
    }
  }
  msg = msg.replace(/\s+/g, " ").trim();
  if (!msg) msg = "unknown error";
  if (msg.length <= max) return msg;
  return `${msg.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * Postgres/PostgREST "unknown column" detection, so writes to the 080
 * columns degrade to a one-time warning before the migration has run.
 *   42703    Postgres undefined_column
 *   PGRST204 PostgREST "Could not find the '<col>' column of '<table>' in
 *            the schema cache"
 */
export function isMissingColumnError(
  err: { code?: string | null; message?: string | null } | null | undefined
): boolean {
  if (!err) return false;
  if (err.code === "42703" || err.code === "PGRST204") return true;
  const msg = err.message ?? "";
  return (
    /column "?[\w.]+"? (of relation "?\w+"? )?does not exist/i.test(msg) ||
    /Could not find the '[^']+' column of '[^']+' in the schema cache/i.test(msg)
  );
}

export interface BuildOutcomeInput {
  /** Images actually written to brand_library. */
  imageCount: number;
  /** The time-box cut the build short (sources were skipped). */
  timedOut?: boolean;
  /** A thrown error, or a write-side failure message, if any. */
  error?: unknown;
}

/**
 * Terminal status for a finished (or aborted) build:
 *   - any error → failed with that message
 *   - time-box hit before a single image → failed ("timed out ...")
 *   - zero images with no error → failed ("no images found ...") so the
 *     Images rail shows the retry banner instead of a silent empty picker
 *   - otherwise ready (a partial, time-boxed library still counts)
 */
export function resolveBuildOutcome(
  input: BuildOutcomeInput
): { status: "ready" | "failed"; error: string | null } {
  if (input.error != null && input.error !== "") {
    return { status: "failed", error: truncateIndexError(input.error) };
  }
  if (input.imageCount >= 1) return { status: "ready", error: null };
  if (input.timedOut) return { status: "failed", error: TIMED_OUT_BEFORE_ANY_IMAGE };
  return { status: "failed", error: NO_IMAGES_FOUND };
}

/**
 * The shops-row patch for a status transition. `ready` stamps
 * library_indexed_at; every non-failed transition clears the error.
 */
export function libraryStatusPatch(
  status: LibraryIndexStatus,
  error?: unknown,
  now: Date = new Date()
): {
  library_index_status: LibraryIndexStatus;
  library_index_error: string | null;
  library_indexed_at?: string;
} {
  if (status === "failed") {
    return {
      library_index_status: "failed",
      library_index_error: truncateIndexError(error),
    };
  }
  const patch: {
    library_index_status: LibraryIndexStatus;
    library_index_error: string | null;
    library_indexed_at?: string;
  } = { library_index_status: status, library_index_error: null };
  if (status === "ready") patch.library_indexed_at = now.toISOString();
  return patch;
}

/** Normalise a shops row's raw columns into the contract shape. */
export function parseLibraryStatusRow(
  row: Record<string, unknown> | null | undefined,
  imageCount: number = 0
): LibraryStatus {
  const out: LibraryStatus = { status: null, error: null, imageCount, indexedAt: null };
  if (!row) return out;
  if (isLibraryIndexStatus(row.library_index_status)) out.status = row.library_index_status;
  out.error = typeof row.library_index_error === "string" ? row.library_index_error : null;
  out.indexedAt = typeof row.library_indexed_at === "string" ? row.library_indexed_at : null;
  return out;
}
