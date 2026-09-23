// Brand library endpoint (Overhaul v2 Part 4.5 — the Studio image picker).
//
// GET  ?filter=products|lifestyle|banners|logos&search=<term>
//      -> { ok, images: [{ id, url, role, width, height, ratio, source,
//           productIds }] }
//      Filter chips map to roles: products -> packshot/swatch/texture/
//      on-model, lifestyle -> lifestyle/hero, banners -> banner,
//      logos -> logo. Search matches filename OR url.
//
// POST multipart form, field "image" (File) -> uploads via the existing
//      reference-images storage bucket, indexes it tagged source:'upload',
//      and returns { ok, image }. Uploads are allowed HERE only (post-
//      Reveal picker footer); onboarding surfaces never render upload UI.
//
// Feature-detects the brand_library table (migration 075): before it runs
// GET returns an empty list and POST returns a friendly error.

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import {
  addUploadedImage,
  listLibrary,
  type LibraryFilter,
} from "../lib/brand-library.server";

const FILTERS: LibraryFilter[] = ["products", "lifestyle", "banners", "logos"];
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_CONTENT_TYPES = /^image\/(png|jpe?g|webp|gif|avif)$/i;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
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
  const { session } = await authenticate.admin(request);
  if (request.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, { status: 405 });
  }

  const formData = await request.formData();
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
