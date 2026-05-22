import { type LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";
import { supabase } from "../lib/supabase.server";

/**
 * Founders-only CSV export of skin-analysis uploads — built for the
 * conference name↔face pairing. One row per uploaded selfie:
 *   name, shop_domain, uploaded_at, photo_url (7-day signed), storage_path
 *
 * The skin-analysis-photos bucket is PRIVATE, so each photo is exposed via a
 * time-limited signed URL (valid 7 days) — long enough to download after the
 * event, short enough not to leak faces forever.
 *
 * Auth mirrors the /admin action gate (admin.tsx): the caller must pass
 * ?shop=<allowlisted myshopify domain> AND that shop must have a real Prisma
 * session. Same posture as the rest of the founders admin.
 *
 * Usage (open in a browser while signed into an allowlisted store):
 *   /admin/skin-uploads.csv?shop=hx5hqt-na.myshopify.com
 *   /admin/skin-uploads.csv?shop=hx5hqt-na.myshopify.com&dataShop=pursuitbeauty.myshopify.com
 * `dataShop` is optional — omit it to export every shop's uploads.
 */

// Keep in sync with ALLOWED_SHOPS in admin.tsx.
const ALLOWED_SHOPS = [
  "testingaaronandevansaas.myshopify.com",
  "hx5hqt-na.myshopify.com",
];

const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

function csvCell(value: unknown): string {
  let s = value == null ? "" : String(value);
  // Neutralize spreadsheet formula injection: a cell starting with = + - @
  // (or tab/CR) is run as a formula by Excel/Sheets. A visitor controls their
  // own name field, so prefix those with a single quote to defuse it.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shopParam = url.searchParams.get("shop");

  // Same gate as the /admin action (admin.tsx:486): allowlisted shop that
  // actually has a session. We avoid authenticate.admin here because it
  // bounces on the Shopify session-token handshake for direct GETs.
  if (!shopParam || !ALLOWED_SHOPS.includes(shopParam)) {
    return new Response("Forbidden", { status: 403 });
  }
  const sessionRecord = await prisma.session.findFirst({ where: { shop: shopParam } });
  if (!sessionRecord) {
    return new Response("Forbidden", { status: 403 });
  }

  const dataShop = url.searchParams.get("dataShop");

  const { data: uploads, error } = await supabase
    .from("skin_analysis_uploads")
    .select("visitor_name, storage_path, created_at, shop_id")
    .order("created_at", { ascending: false });

  if (error) {
    return new Response(`Query failed: ${error.message}`, { status: 500 });
  }

  // Resolve shop_id -> shop_domain for readable rows / optional filtering.
  const shopIds = [...new Set((uploads ?? []).map((u) => u.shop_id))];
  const domainById = new Map<string, string>();
  if (shopIds.length) {
    const { data: shops } = await supabase
      .from("shops")
      .select("id, shop_domain")
      .in("id", shopIds);
    (shops ?? []).forEach((s: { id: string; shop_domain: string }) => {
      domainById.set(s.id, s.shop_domain);
    });
  }

  let rows = uploads ?? [];
  if (dataShop) {
    rows = rows.filter((u) => domainById.get(u.shop_id) === dataShop);
  }

  // Batch-sign every photo path (order preserved → map back by index).
  const paths = rows.map((r) => r.storage_path);
  const signedByPath = new Map<string, string>();
  if (paths.length) {
    const { data: signed } = await supabase.storage
      .from("skin-analysis-photos")
      .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
    (signed ?? []).forEach((entry, i) => {
      if (entry?.signedUrl) signedByPath.set(paths[i], entry.signedUrl);
    });
  }

  const header = ["name", "shop_domain", "uploaded_at", "photo_url", "storage_path"];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        csvCell(r.visitor_name),
        csvCell(domainById.get(r.shop_id) ?? r.shop_id),
        csvCell(r.created_at),
        csvCell(signedByPath.get(r.storage_path)),
        csvCell(r.storage_path),
      ].join(",")
    );
  }
  // BOM so Excel reads UTF-8 names correctly; CRLF line endings for CSV.
  const csv = "﻿" + lines.join("\r\n");

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="skin-analysis-uploads-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
};
