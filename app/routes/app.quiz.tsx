import { redirect, type LoaderFunctionArgs } from "@remix-run/node";

// The quiz hub folded into the admin home (/app), which now hosts the
// Quiz Studio modal, surface toggle, and theme deep link directly. Studio
// deep links pass through: /app/quiz?open=studio&step=logic → /app?....
export const loader = ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const qs = url.searchParams.toString();
  return redirect(qs ? `/app?${qs}` : "/app");
};
export const action = ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const qs = url.searchParams.toString();
  return redirect(qs ? `/app?${qs}` : "/app");
};
