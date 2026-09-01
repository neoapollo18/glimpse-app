import { redirect, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

// The Mantle-era trial/plan flow died with Mantle. Plan selection now
// lives on /app/billing (Shopify-native flex subscription), so old links
// and the app.tsx gate's welcome target land there. NOTE: this must NOT
// redirect to /app — when the gate is armed, /app would bounce back here
// and loop; /app/billing is gate-exempt.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return redirect("/app/billing");
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  return redirect("/app/billing");
};
