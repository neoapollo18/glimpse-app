// Pin / Boost / Exclude actions for Check-the-matches (Part 5 / E2).
//
// All three write the EXISTING rules format through the normal locked
// save path (auto-snapshot = undo via version history):
//   pin     — rank-1 rule targeting the product for the current answer
//             path (always show for this path).
//   boost   — append to priority_product_ids (raise priority everywhere).
//   exclude — remove rules targeting the product for this path and drop
//             it from priority_product_ids. Honest limit: an ai-ranked
//             pick with no rule can resurface; true negative rules need
//             engine support (client shows this caveat).

import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { supabase } from "../lib/supabase.server";
import { captureLiveConfig, saveLiveQuizConfig } from "../lib/quiz-draft.server";
import { withShopSaveLock } from "../lib/shop-save-lock.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await supabase.from("shops").select("id").eq("shop_domain", session.shop).single();
  if (shop.error) return json({ ok: false, error: "Shop not found" }, { status: 404 });

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Bad request" }, { status: 400 });
  }
  const kind = String(body?.action ?? "");
  const productId = String(body?.productId ?? "");
  const criteria: Record<string, string> = {};
  if (body?.criteria && typeof body.criteria === "object") {
    for (const [k, v] of Object.entries(body.criteria)) {
      if (typeof v === "string" && v) criteria[k] = v;
    }
  }
  if (!productId || !["pin", "boost", "exclude"].includes(kind)) {
    return json({ ok: false, error: "Bad request" }, { status: 400 });
  }
  if (kind === "pin" && Object.keys(criteria).length === 0) {
    return json({ ok: false, error: "Pick at least one answer to pin against" }, { status: 400 });
  }

  const result = await withShopSaveLock(shop.data.id, async () => {
    const live = await captureLiveConfig(shop.data.id);
    // Mutate a CLONE; the pristine capture feeds the pre-write snapshot
    // and the changed-keys diff.
    const draft = JSON.parse(JSON.stringify(live)) as typeof live;
    const settings = draft.settings as Record<string, unknown>;
    const flow = draft.flow;
    const sameCriteria = (a: Record<string, string>) => {
      const keys = Object.keys(criteria);
      return (
        Object.keys(a).length === keys.length && keys.every((k) => a[k] === criteria[k])
      );
    };

    if (kind === "pin") {
      // Replace an existing pin for this exact path+product, then rank 1.
      flow.rules = (flow.rules ?? []).filter(
        (r: any) => !(r.productId === productId && sameCriteria(r.criteria ?? {}))
      );
      flow.rules.push({ criteria, productId, variantId: null, rank: 1, quantity: 1 } as any);
    } else if (kind === "boost") {
      const ids = new Set((settings.priority_product_ids as string[]) ?? []);
      ids.add(productId);
      settings.priority_product_ids = [...ids];
    } else {
      flow.rules = (flow.rules ?? []).filter((r: any) => {
        const targets = r.productId === productId;
        return !(targets && (Object.keys(criteria).length === 0 || sameCriteria(r.criteria ?? {})));
      });
      settings.priority_product_ids = ((settings.priority_product_ids as string[]) ?? []).filter(
        (id) => id !== productId
      );
    }

    return saveLiveQuizConfig(shop.data.id, draft, {
      snapshotLabel: `before ${kind}`,
      preWriteConfig: live,
    });
  });

  return json(result, { status: result.ok ? 200 : 422 });
};
