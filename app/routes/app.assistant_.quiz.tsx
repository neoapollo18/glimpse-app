import { redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";

// The standalone quiz copy & design page is fully absorbed by Quiz Studio:
// Intro / Photo / Results slide editors + the Theme item cover every field
// (copy, images with upload, shade picker, alt audience, colors, radii,
// fonts, layout, animations), edited next to the live preview and published
// with the draft.
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
