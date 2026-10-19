// v3 (V3-CONTRACTS §10): /app/onboard is a redirect into onboarding (the
// welcome intro, which forwards to the scope screen once it's done).
// The v2 scope→build flow that lived here moved to
// app.onboarding.scope.tsx + app.onboarding.build.tsx.

import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const url = new URL(request.url);
  // Embedded-app params (host, shop, embedded…) must survive the redirect
  // or App Bridge re-bootstraps the frame.
  return redirect(`/app/onboarding/welcome${url.search}`);
};
