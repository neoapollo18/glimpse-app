import { redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";

// The standalone questions editor was replaced by Quiz Studio's Build step
// (slide tree + live preview + branching). Patch-merge editing logic lives
// on in app/lib/question-axis.server.ts consumers and the studio appliers.
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
