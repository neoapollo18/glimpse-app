import { redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";

// The Quiz Builder page was replaced by Quiz Studio (the full-screen
// takeover editor hosted by the quiz hub). Catalog sync moved to
// /app/api/catalog-sync; everything else lives in /studio.
// Preserve the incoming query (shop/host/embedded are load-bearing in the
// embedded admin) while forcing the studio deep-link params.
const target = (request: Request) => {
  const url = new URL(request.url);
  url.searchParams.set("open", "studio");
  url.searchParams.set("step", "build");
  return `/app?${url.searchParams.toString()}`;
};
export const loader = ({ request }: LoaderFunctionArgs) => redirect(target(request));
export const action = ({ request }: ActionFunctionArgs) => redirect(target(request));
