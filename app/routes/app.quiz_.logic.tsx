import { redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";

// The standalone recommendation-logic page was replaced by Quiz Studio's
// Logic step. Semantics change to note: the studio saves generated logic to
// the DRAFT (goes live at publish) instead of writing live immediately.
// Preserve the incoming query (shop/host/embedded are load-bearing in the
// embedded admin) while forcing the studio deep-link params.
const target = (request: Request) => {
  const url = new URL(request.url);
  url.searchParams.set("open", "studio");
  url.searchParams.set("step", "logic");
  return `/app?${url.searchParams.toString()}`;
};
export const loader = ({ request }: LoaderFunctionArgs) => redirect(target(request));
export const action = ({ request }: ActionFunctionArgs) => redirect(target(request));
