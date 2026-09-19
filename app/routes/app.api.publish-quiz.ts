// Publish / preview endpoint (Overhaul Part 4).
//
// intents:
//   preview-link — mint the tokenized on-store preview URL (app proxy,
//                  7-day shareable token). Fires store_preview_opened is
//                  the widget's job; this only mints.
//   publish      — one-click publish: page + optional nav link + surface
//                  ON. Returns the live URL. Fires publish_completed.
//   unpublish    — surface OFF + nav link removal (page left in place).

import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { storePreviewUrl } from "../lib/app-proxy.server";
import { publishQuiz, unpublishQuiz } from "../lib/publish.server";
import { trackOverhaulEvent } from "../lib/overhaul-events.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  const adminGraphql = async (query: string, variables?: Record<string, unknown>) => {
    const res = await admin.graphql(query, variables ? { variables } : undefined);
    const body = (await res.json()) as { data?: any; errors?: Array<{ message?: string }> };
    if (body.errors?.length) throw new Error(body.errors[0]?.message ?? "graphql error");
    return body.data;
  };

  if (intent === "preview-link") {
    const draftId = String(form.get("draftId") ?? "live");
    return json({ ok: true, url: storePreviewUrl(session.shop, draftId) });
  }

  if (intent === "publish") {
    const result = await publishQuiz(session.shop, adminGraphql, {
      pageTitle: form.get("pageTitle") ? String(form.get("pageTitle")) : undefined,
      addToMenu: form.get("addToMenu") !== "false",
    });
    if (result.ok) {
      trackOverhaulEvent(session.shop, "publish_completed", {
        path: result.path,
        nav_link_added: result.navLinkAdded,
      });
    }
    return json(result, { status: result.ok ? 200 : 422 });
  }

  if (intent === "unpublish") {
    const result = await unpublishQuiz(session.shop, adminGraphql);
    return json(result, { status: result.ok ? 200 : 422 });
  }

  return json({ ok: false, error: "Unknown intent" }, { status: 400 });
};
