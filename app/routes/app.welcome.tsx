import { redirect, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

// MANTLE SHUTDOWN: the trial/plan-selection flow this page hosted ran
// entirely on Mantle's API. Billing enforcement is off while the
// Shopify-native replacement is built (billing-gate.server.ts), so this
// page has nothing to sell — send merchants to the app. The pre-Mantle
// version lives in git history for the copy when the new billing page
// is built.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return redirect("/app");
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  return redirect("/app");
};
