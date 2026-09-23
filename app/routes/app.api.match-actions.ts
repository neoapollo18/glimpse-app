// Pin / Boost / Exclude actions for Check matches (V2-SPEC Part 6).
//
// All actions write the EXISTING rules format through the normal locked
// save path (auto-snapshot = version-history safety net):
//   pin     — rank-1 rule targeting the product for the current answer
//             path (always show for this path).
//   boost   — append to priority_product_ids (raise priority everywhere).
//   exclude — remove rules targeting the product for this path and drop
//             it from priority_product_ids. Honest limit: an ai-ranked
//             pick with no rule can resurface; true negative rules need
//             engine support (client shows this caveat).
//   undo    — v2 Undo toast: restores the product's rules and priority
//             membership to the snapshot the previous action returned.
//
// Every pin/boost/exclude returns an `undo` payload (the product's rules
// + priority membership BEFORE the action) and emits matches_action.

import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { supabase } from "../lib/supabase.server";
import { captureLiveConfig, saveLiveQuizConfig } from "../lib/quiz-draft.server";
import { withShopSaveLock } from "../lib/shop-save-lock.server";
import { trackOverhaulEvent } from "../lib/overhaul-events.server";

interface UndoPayload {
  productId: string;
  rulesBefore: Array<{
    criteria: Record<string, string>;
    variantId: string | null;
    rank: number;
    quantity: number;
  }>;
  priorityHad: boolean;
}

/** Client round-trips the undo payload; re-validate every field before it
 * touches the rules array. */
function parseUndo(raw: unknown, productId: string): UndoPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.productId !== productId) return null;
  if (!Array.isArray(o.rulesBefore) || o.rulesBefore.length > 50) return null;
  const rulesBefore: UndoPayload["rulesBefore"] = [];
  for (const r of o.rulesBefore) {
    if (!r || typeof r !== "object") return null;
    const rr = r as Record<string, unknown>;
    const criteria: Record<string, string> = {};
    if (!rr.criteria || typeof rr.criteria !== "object") return null;
    for (const [k, v] of Object.entries(rr.criteria as Record<string, unknown>)) {
      if (typeof v !== "string" || !/^[a-z0-9_:-]+$/i.test(k)) return null;
      criteria[k] = v;
    }
    rulesBefore.push({
      criteria,
      variantId: typeof rr.variantId === "string" ? rr.variantId : null,
      rank: Number.isFinite(Number(rr.rank)) ? Number(rr.rank) : 1,
      quantity: Number.isFinite(Number(rr.quantity)) ? Math.max(1, Number(rr.quantity)) : 1,
    });
  }
  return { productId, rulesBefore, priorityHad: o.priorityHad === true };
}

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
  if (!productId || !["pin", "boost", "exclude", "undo"].includes(kind)) {
    return json({ ok: false, error: "Bad request" }, { status: 400 });
  }
  if (kind === "pin" && Object.keys(criteria).length === 0) {
    return json({ ok: false, error: "Pick at least one answer to pin against" }, { status: 400 });
  }
  const undoInput = kind === "undo" ? parseUndo(body?.undo, productId) : null;
  if (kind === "undo" && !undoInput) {
    return json({ ok: false, error: "Nothing to undo" }, { status: 400 });
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

    // Snapshot for the Undo toast: this product's rules + priority state.
    const priorityNow = (settings.priority_product_ids as string[]) ?? [];
    const undo: UndoPayload = {
      productId,
      rulesBefore: (flow.rules ?? [])
        .filter((r: any) => r.productId === productId)
        .map((r: any) => ({
          criteria: { ...(r.criteria ?? {}) },
          variantId: r.variantId ?? null,
          rank: r.rank ?? 1,
          quantity: r.quantity ?? 1,
        })),
      priorityHad: priorityNow.includes(productId),
    };

    if (kind === "pin") {
      // Replace an existing pin for this exact path+product, then rank 1.
      flow.rules = (flow.rules ?? []).filter(
        (r: any) => !(r.productId === productId && sameCriteria(r.criteria ?? {}))
      );
      flow.rules.push({ criteria, productId, variantId: null, rank: 1, quantity: 1 } as any);
    } else if (kind === "boost") {
      const ids = new Set(priorityNow);
      ids.add(productId);
      settings.priority_product_ids = [...ids];
    } else if (kind === "exclude") {
      flow.rules = (flow.rules ?? []).filter((r: any) => {
        const targets = r.productId === productId;
        return !(targets && (Object.keys(criteria).length === 0 || sameCriteria(r.criteria ?? {})));
      });
      settings.priority_product_ids = priorityNow.filter((id) => id !== productId);
    } else {
      // undo: restore this product's rules and priority membership.
      flow.rules = [
        ...(flow.rules ?? []).filter((r: any) => r.productId !== productId),
        ...undoInput!.rulesBefore.map((r) => ({
          criteria: r.criteria,
          productId,
          variantId: r.variantId,
          rank: r.rank,
          quantity: r.quantity,
        })),
      ] as typeof flow.rules;
      const ids = new Set(priorityNow.filter((id) => id !== productId));
      if (undoInput!.priorityHad) ids.add(productId);
      settings.priority_product_ids = [...ids];
    }

    const saved = await saveLiveQuizConfig(shop.data.id, draft, {
      snapshotLabel: `before ${kind}`,
      preWriteConfig: live,
    });
    return saved.ok ? { ...saved, undo } : saved;
  });

  if (result.ok && kind !== "undo") {
    trackOverhaulEvent(session.shop, "matches_action", { action: kind });
  }
  return json(result, { status: result.ok ? 200 : 422 });
};
