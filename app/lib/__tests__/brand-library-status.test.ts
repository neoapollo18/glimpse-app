import { describe, it, expect } from "vitest";
import {
  LIBRARY_ERROR_MAX_LENGTH,
  NO_IMAGES_FOUND,
  TIMED_OUT_BEFORE_ANY_IMAGE,
  isLibraryIndexStatus,
  isMissingColumnError,
  libraryStatusPatch,
  parseLibraryStatusRow,
  resolveBuildOutcome,
  truncateIndexError,
} from "../brand-library-status";

describe("truncateIndexError", () => {
  it("takes an Error's message", () => {
    expect(truncateIndexError(new Error("graphql: throttled"))).toBe("graphql: throttled");
  });

  it("collapses whitespace and trims", () => {
    expect(truncateIndexError("  products load\n  failed:   boom \n")).toBe("products load failed: boom");
  });

  it("never returns an empty reason", () => {
    expect(truncateIndexError("")).toBe("unknown error");
    expect(truncateIndexError(null)).toBe("unknown error");
    expect(truncateIndexError(undefined)).toBe("unknown error");
    expect(truncateIndexError("   ")).toBe("unknown error");
  });

  it("stringifies non-error objects", () => {
    expect(truncateIndexError({ code: "PGRST301" })).toBe('{"code":"PGRST301"}');
    expect(truncateIndexError(42)).toBe("42");
  });

  it("bounds the length with an ellipsis", () => {
    const long = "x".repeat(LIBRARY_ERROR_MAX_LENGTH + 500);
    const out = truncateIndexError(long);
    expect(out.length).toBe(LIBRARY_ERROR_MAX_LENGTH);
    expect(out.endsWith("…")).toBe(true);
    expect(truncateIndexError("short", 10)).toBe("short");
    expect(truncateIndexError("0123456789abc", 10)).toBe("012345678…");
  });
});

describe("isMissingColumnError", () => {
  it("matches the Postgres and PostgREST codes", () => {
    expect(isMissingColumnError({ code: "42703", message: "" })).toBe(true);
    expect(isMissingColumnError({ code: "PGRST204", message: "" })).toBe(true);
  });

  it("matches the message shapes when the code is absent", () => {
    expect(
      isMissingColumnError({
        message: "Could not find the 'library_index_status' column of 'shops' in the schema cache",
      })
    ).toBe(true);
    expect(
      isMissingColumnError({ message: 'column "library_index_status" of relation "shops" does not exist' })
    ).toBe(true);
    expect(isMissingColumnError({ message: "column shops.library_indexed_at does not exist" })).toBe(true);
  });

  it("does not match unrelated errors, missing tables, or nothing", () => {
    expect(isMissingColumnError(null)).toBe(false);
    expect(isMissingColumnError(undefined)).toBe(false);
    expect(isMissingColumnError({ code: "42P01", message: 'relation "brand_library" does not exist' })).toBe(false);
    expect(isMissingColumnError({ code: "PGRST205", message: "Could not find the table 'public.brand_library'" })).toBe(
      false
    );
    expect(isMissingColumnError({ code: "23505", message: "duplicate key value" })).toBe(false);
  });
});

describe("resolveBuildOutcome", () => {
  it("is ready when at least one image was indexed, even if time-boxed", () => {
    expect(resolveBuildOutcome({ imageCount: 1 })).toEqual({ status: "ready", error: null });
    expect(resolveBuildOutcome({ imageCount: 37, timedOut: true })).toEqual({ status: "ready", error: null });
  });

  it("fails with the timeout reason when the time-box hit before any image", () => {
    expect(resolveBuildOutcome({ imageCount: 0, timedOut: true })).toEqual({
      status: "failed",
      error: TIMED_OUT_BEFORE_ANY_IMAGE,
    });
  });

  it("fails with a no-images reason when nothing was found and nothing timed out", () => {
    expect(resolveBuildOutcome({ imageCount: 0 })).toEqual({ status: "failed", error: NO_IMAGES_FOUND });
  });

  it("fails with the thrown error's short message regardless of counts", () => {
    expect(resolveBuildOutcome({ imageCount: 12, error: new Error("upsert exploded") })).toEqual({
      status: "failed",
      error: "upsert exploded",
    });
    expect(resolveBuildOutcome({ imageCount: 0, timedOut: true, error: "brand_library write failed: x" })).toEqual({
      status: "failed",
      error: "brand_library write failed: x",
    });
  });

  it("treats null/empty error as no error", () => {
    expect(resolveBuildOutcome({ imageCount: 2, error: null })).toEqual({ status: "ready", error: null });
    expect(resolveBuildOutcome({ imageCount: 2, error: "" })).toEqual({ status: "ready", error: null });
  });
});

describe("libraryStatusPatch", () => {
  const now = new Date("2026-09-28T12:00:00.000Z");

  it("pending and building clear the error and do not stamp indexed_at", () => {
    expect(libraryStatusPatch("pending", undefined, now)).toEqual({
      library_index_status: "pending",
      library_index_error: null,
    });
    expect(libraryStatusPatch("building", "stale text ignored", now)).toEqual({
      library_index_status: "building",
      library_index_error: null,
    });
  });

  it("ready clears the error and stamps indexed_at", () => {
    expect(libraryStatusPatch("ready", undefined, now)).toEqual({
      library_index_status: "ready",
      library_index_error: null,
      library_indexed_at: "2026-09-28T12:00:00.000Z",
    });
  });

  it("failed persists a truncated reason and leaves indexed_at alone", () => {
    const patch = libraryStatusPatch("failed", new Error("  boom\n\nbang  "), now);
    expect(patch).toEqual({ library_index_status: "failed", library_index_error: "boom bang" });
    expect("library_indexed_at" in patch).toBe(false);
    expect(libraryStatusPatch("failed", undefined, now).library_index_error).toBe("unknown error");
  });
});

describe("parseLibraryStatusRow / isLibraryIndexStatus", () => {
  it("returns the never-attempted shape for a missing row", () => {
    expect(parseLibraryStatusRow(null)).toEqual({ status: null, error: null, imageCount: 0, indexedAt: null });
    expect(parseLibraryStatusRow(undefined, 5)).toEqual({ status: null, error: null, imageCount: 5, indexedAt: null });
  });

  it("returns status null when the 080 columns are absent from the row", () => {
    expect(parseLibraryStatusRow({ id: "abc" }, 3)).toEqual({
      status: null,
      error: null,
      imageCount: 3,
      indexedAt: null,
    });
  });

  it("passes through valid rows and rejects unknown status strings", () => {
    expect(
      parseLibraryStatusRow(
        {
          id: "abc",
          library_index_status: "failed",
          library_index_error: "timed out before indexing any images",
          library_indexed_at: "2026-09-27T10:00:00+00:00",
        },
        0
      )
    ).toEqual({
      status: "failed",
      error: "timed out before indexing any images",
      imageCount: 0,
      indexedAt: "2026-09-27T10:00:00+00:00",
    });
    expect(parseLibraryStatusRow({ id: "abc", library_index_status: "bogus" }).status).toBeNull();
    expect(isLibraryIndexStatus("ready")).toBe(true);
    expect(isLibraryIndexStatus("READY")).toBe(false);
    expect(isLibraryIndexStatus(null)).toBe(false);
  });
});
