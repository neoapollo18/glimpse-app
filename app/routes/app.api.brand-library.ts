// Brand library endpoint (Overhaul v2 Part 4.5 — the Studio image picker;
// V3-CONTRACTS §9 — index status + reindex).
//
// GET  ?filter=products|lifestyle|banners|logos&search=<term>
//      -> { ok, images: [{ id, url, role, width, height, ratio, source,
//           productIds }] }
//      Filter chips map to roles: products -> packshot/swatch/texture/
//      on-model, lifestyle -> lifestyle/hero, banners -> banner,
//      logos -> logo. Search matches filename OR url.
// GET  ?intent=status
//      -> { ok: true, status, error, imageCount, indexedAt }
//      status: null (never attempted) | pending | building | ready | failed
//
// POST multipart form, field "image" (File) -> uploads via the existing
//      reference-images storage bucket, indexes it tagged source:'upload',
//      and returns { ok, image }. Uploads are allowed HERE only (post-
//      Reveal picker footer); onboarding surfaces never render upload UI.
// POST form intent=reindex -> re-runs buildBrandLibrary with the session's
//      admin GraphQL (same adapter as app.api.catalog-sync.ts) and returns
//      { ok, status, library: { status, imageCount, taggedPct, ms, error } }.
//      Lightly rate-limited: one in-flight build per shop in this process,
//      and 409 while shops.library_index_status is `building`
//      (form field force=1 overrides a DB `building` that this process is
//      not running, i.e. one left behind by a crashed build).
//
// Feature-detects the brand_library table (migration 075) and the 080
// status columns: before they run GET list returns an empty list, status
// reads as null, and POST upload returns a friendly error.

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { shopNeedsBilling } from "../lib/billing-gate.server";
import {
  addUploadedImage,
  buildBrandLibrary,
  getLibraryStatus,
  listLibrary,
  type AdminGraphqlFn,
  type LibraryFilter,
} from "../lib/brand-library.server";
import { trackOverhaulEvent } from "../lib/overhaul-events.server";

const FILTERS: LibraryFilter[] = ["products", "lifestyle", "banners", "logos"];
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_CONTENT_TYPES = /^image\/(png|jpe?g|webp|gif|avif)$/i;
const REINDEX_TIME_BOX_MS = 25_000;

/** Shops with a reindex running in this process (light rate limit). */
const reindexInFlight = new Set<string>();

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);

  if (url.searchParams.get("intent") === "status") {
    const status = await getLibraryStatus(session.shop);
    return json({ ok: true, ...status });
  }

  const rawFilter = url.searchParams.get("filter");
  const filter = FILTERS.includes(rawFilter as LibraryFilter)
    ? (rawFilter as LibraryFilter)
    : undefined;
  const search = url.searchParams.get("search") ?? undefined;

  const images = await listLibrary(session.shop, filter, search);
  return json({
    ok: true,
    images: images.map((img) => ({
      id: img.id,
      url: img.url,
      role: img.role,
      width: img.width,
      height: img.height,
      ratio: img.ratio,
      source: img.source,
      productIds: img.productIds,
    })),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  if (request.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, { status: 405 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "reindex") {
    const shopDomain = session.shop;
    // Resource routes bypass app.tsx's billing gate; reindex drives Admin
    // API + image work, so mirror app.api.catalog-sync.ts.
    if (await shopNeedsBilling(shopDomain, session.accessToken ?? "")) {
      return json(
        { ok: false, error: "Your Gleame subscription isn't active. Visit Billing to continue." },
        { status: 402 }
      );
    }

    // Claim the in-process lock BEFORE any await (two concurrent POSTs
    // used to both pass the has() check). A DB row stuck on `building`
    // with no in-process run behind it is an orphan from a redeploy or a
    // crash - proceed and overwrite it rather than 409 forever.
    if (reindexInFlight.has(shopDomain)) {
      return json(
        { ok: false, status: "building", error: "Indexing is already running for this store." },
        { status: 409 }
      );
    }
    reindexInFlight.add(shopDomain);
    try {
      const current = await getLibraryStatus(shopDomain);
      if (current.status === "building") {
        console.warn(`[brand-library] ${shopDomain}: status was 'building' with no run in this process - treating as stale and re-indexing`);
      }
      const adminGraphql: AdminGraphqlFn = async (query, variables) => {
        const res = await admin.graphql(query, variables ? { variables } : undefined);
        const body = (await res.json()) as { data?: any; errors?: Array<{ message?: string }> };
        if (body.errors?.length) {
          throw new Error(`brand-library graphql: ${body.errors[0]?.message ?? "error"}`);
        }
        return body.data;
      };
      const built = await buildBrandLibrary(shopDomain, {
        admin: adminGraphql,
        timeBoxMs: REINDEX_TIME_BOX_MS,
      });
      const library = {
        status: built.status,
        imageCount: built.imageCount,
        taggedPct: built.taggedPct,
        ms: built.ms,
        error: built.error,
      };
      trackOverhaulEvent(shopDomain, "library_built", {
        status: built.status,
        error: built.error,
        image_count: built.imageCount,
        tagged_pct: built.taggedPct,
        ms: built.ms,
        source: "reindex",
      });
      return json({ ok: built.status === "ready", status: built.status, library });
    } catch (err) {
      // buildBrandLibrary never throws; this guards the plumbing around it.
      console.warn(`[brand-library] reindex failed for ${shopDomain}:`, err);
      return json(
        {
          ok: false,
          status: "failed",
          error: err instanceof Error ? err.message : "Reindex failed",
        },
        { status: 500 }
      );
    } finally {
      reindexInFlight.delete(shopDomain);
    }
  }

  const file = formData.get("image");
  if (!(file instanceof File) || file.size === 0) {
    return json({ ok: false, error: "Missing image file" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return json({ ok: false, error: "Image too large (max 10 MB)" }, { status: 413 });
  }
  const contentType = file.type || "image/jpeg";
  if (!ALLOWED_CONTENT_TYPES.test(contentType)) {
    return json({ ok: false, error: "Unsupported image type" }, { status: 415 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await addUploadedImage(session.shop, buffer, file.name || "upload.jpg", contentType);
  if (!result.ok) {
    return json({ ok: false, error: result.error }, { status: 500 });
  }
  return json({
    ok: true,
    image: {
      id: result.image.id,
      url: result.image.url,
      role: result.image.role,
      width: result.image.width,
      height: result.image.height,
      ratio: result.image.ratio,
      source: result.image.source,
      productIds: result.image.productIds,
    },
  });
};
