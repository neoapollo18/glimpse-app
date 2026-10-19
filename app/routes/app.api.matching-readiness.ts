// Studio publish checklist: is matching set up? Read fresh each time the
// Publish sheet opens, because Check matches saves through a plain fetch
// that doesn't revalidate the Studio loader (lib/matching-readiness).

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { findShopByDomain } from "../lib/supabase.server";
import { getMatchingReadiness } from "../lib/matching-readiness.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  let session;
  try {
    ({ session } = await authenticate.admin(request));
  } catch (err) {
    if (err instanceof Response) return json({ ok: false, error: "Session expired. Please reload." }, { status: 401 });
    throw err;
  }
  const shop = await findShopByDomain(session.shop);
  if (!shop) return json({ ok: false, error: "Shop not found" }, { status: 404 });
  const readiness = await getMatchingReadiness(shop.id, session.shop);
  return json({ ok: true, ...readiness });
};
