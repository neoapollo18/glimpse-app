// Brand Profile extraction endpoint (Overhaul Part 1 / A1).
//
// POST intent=extract: (re)runs the extraction pipeline for the session's
// shop using the request-scoped Admin client, upserts brand_profiles, and
// returns the profile + template assignment. Idempotent; safe to re-run
// on demand (Reveal "match my brand", Studio "Reset to my theme") and on
// theme publish. GET returns the stored profile without re-extracting.
//
// Extraction never blocks an install flow — callers fire it in parallel
// with catalog sync and render preset fallbacks until it lands.

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { extractBrandProfile, getBrandProfile } from "../lib/brand-profile.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const profile = await getBrandProfile(session.shop);
  return json({ ok: true, profile });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const form = await request.formData();
  if (form.get("intent") !== "extract") {
    return json({ ok: false, error: "Unknown intent" }, { status: 400 });
  }
  const adminGraphql = async (query: string, variables?: Record<string, unknown>) => {
    const res = await admin.graphql(query, variables ? { variables } : undefined);
    const body = (await res.json()) as { data?: any; errors?: Array<{ message?: string }> };
    if (body.errors?.length) {
      throw new Error(`brand-profile graphql: ${body.errors[0]?.message ?? "error"}`);
    }
    return body.data;
  };
  try {
    const started = Date.now();
    const profile = await extractBrandProfile(session.shop, adminGraphql);
    return json({ ok: true, profile, ms: Date.now() - started });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
};
