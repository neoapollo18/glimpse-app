// The old Settings page (translations and billing shortcuts, an affiliate
// placeholder, theme troubleshooting) was orphaned: nothing linked to it,
// and its "Refer and earn" item was promotion that couldn't be dismissed
// (Built for Shopify 4.3.6). Old bookmarks land on the home page, with the
// embedded-admin params carried over so App Bridge doesn't re-bootstrap.

import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return redirect(`/app${new URL(request.url).search}`);
};
