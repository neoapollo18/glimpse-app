import { randomInt } from "node:crypto";
import { supabase } from "./supabase.server";
import type { AdminGraphql } from "./brand-profile.server";

// ---------------------------------------------------------------------
// Studio Offers (migration 086): the results cross-sell row and the bundle
// discount. One quiz_offers row per shop; a missing row (or a missing
// table, before the migration runs) reads as everything off.
//
// Deliberately NOT part of the quiz_* settings on chat_assistant_config:
// those flow through version snapshots, restores and the AI copilot, and
// a restore must never desync the widget from a Shopify discount Gleame
// manages. Offers save through their own Studio intents only.
// ---------------------------------------------------------------------

export type CrossSellSource = "manual" | "shopify" | "both";
export type BundleDiscountMode = "off" | "code" | "managed";
export type BundleDiscountType = "percentage" | "fixed_amount";

export interface CrossSellItem {
  /** Shopify numeric product id, as a string. */
  productId: string;
  handle: string;
  /** Display snapshot for the Studio; the widget reads live price/stock. */
  title: string;
  imageUrl: string | null;
  /** Only show when the shopper picked this answer. Null = always. */
  when: { axisKey: string; axisValue: string } | null;
}

export interface QuizOffers {
  crossSellEnabled: boolean;
  crossSellSource: CrossSellSource;
  crossSellTitle: string | null;
  crossSellSubtext: string | null;
  crossSellItems: CrossSellItem[];
  crossSellMax: number;
  bundleDiscountMode: BundleDiscountMode;
  bundleDiscountType: BundleDiscountType;
  bundleDiscountValue: number | null;
  bundleDiscountMinQty: number | null;
  bundleDiscountCode: string | null;
  bundleDiscountShopifyId: string | null;
  bundleDiscountSyncedAt: string | null;
  bundleDiscountNote: string | null;
}

export const OFFERS_DEFAULTS: QuizOffers = {
  crossSellEnabled: false,
  crossSellSource: "manual",
  crossSellTitle: null,
  crossSellSubtext: null,
  crossSellItems: [],
  crossSellMax: 3,
  bundleDiscountMode: "off",
  bundleDiscountType: "percentage",
  bundleDiscountValue: null,
  bundleDiscountMinQty: null,
  bundleDiscountCode: null,
  bundleDiscountShopifyId: null,
  bundleDiscountSyncedAt: null,
  bundleDiscountNote: null,
};

export const CROSS_SELL_TITLE_DEFAULT = "Complete the look";
export const BUNDLE_NOTE_DEFAULT = "Bundle savings applied at checkout";
export const MAX_CROSS_SELL_ITEMS = 12;
export const DISCOUNT_SCOPE = "write_discounts";

const SOURCES: readonly CrossSellSource[] = ["manual", "shopify", "both"];
const MODES: readonly BundleDiscountMode[] = ["off", "code", "managed"];
const TYPES: readonly BundleDiscountType[] = ["percentage", "fixed_amount"];
const KEY_RE = /^[a-z_][a-z0-9_]*$/;
const HANDLE_RE = /^[a-z0-9][a-z0-9_-]{0,254}$/i;
// Shopify codes: letters, digits, dashes, underscores (no spaces, which a
// /discount/{code} URL would mangle).
const CODE_RE = /^[A-Za-z0-9_-]{3,64}$/;

function strOrNull(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

function intIn(v: unknown, min: number, max: number): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

function normalizeItem(raw: unknown): CrossSellItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const productId = typeof r.productId === "string" || typeof r.productId === "number" ? String(r.productId) : "";
  const handle = typeof r.handle === "string" ? r.handle.trim() : "";
  if (!/^\d{1,20}$/.test(productId) || !HANDLE_RE.test(handle)) return null;
  const imageUrl = typeof r.imageUrl === "string" && /^https:\/\//.test(r.imageUrl) ? r.imageUrl.slice(0, 1000) : null;
  let when: CrossSellItem["when"] = null;
  if (r.when && typeof r.when === "object") {
    const w = r.when as Record<string, unknown>;
    if (typeof w.axisKey === "string" && typeof w.axisValue === "string" && KEY_RE.test(w.axisKey) && KEY_RE.test(w.axisValue)) {
      when = { axisKey: w.axisKey, axisValue: w.axisValue };
    }
  }
  return {
    productId,
    handle,
    title: strOrNull(r.title, 255) ?? handle,
    imageUrl,
    when,
  };
}

/** Typed, defensive read of a quiz_offers row (null = defaults). */
export function mapOffersRow(row: Record<string, unknown> | null | undefined): QuizOffers {
  if (!row) return { ...OFFERS_DEFAULTS, crossSellItems: [] };
  const items: CrossSellItem[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(row.cross_sell_items) ? row.cross_sell_items : []) {
    const item = normalizeItem(raw);
    if (!item || seen.has(item.productId)) continue;
    seen.add(item.productId);
    items.push(item);
    if (items.length >= MAX_CROSS_SELL_ITEMS) break;
  }
  const value = row.bundle_discount_value == null ? null : Number(row.bundle_discount_value);
  return {
    crossSellEnabled: row.cross_sell_enabled === true,
    crossSellSource: SOURCES.includes(row.cross_sell_source as CrossSellSource)
      ? (row.cross_sell_source as CrossSellSource)
      : "manual",
    crossSellTitle: strOrNull(row.cross_sell_title, 120),
    crossSellSubtext: strOrNull(row.cross_sell_subtext, 200),
    crossSellItems: items,
    crossSellMax: intIn(row.cross_sell_max, 1, 6) ?? OFFERS_DEFAULTS.crossSellMax,
    bundleDiscountMode: MODES.includes(row.bundle_discount_mode as BundleDiscountMode)
      ? (row.bundle_discount_mode as BundleDiscountMode)
      : "off",
    bundleDiscountType: TYPES.includes(row.bundle_discount_type as BundleDiscountType)
      ? (row.bundle_discount_type as BundleDiscountType)
      : "percentage",
    bundleDiscountValue: value != null && Number.isFinite(value) && value > 0 ? value : null,
    bundleDiscountMinQty: intIn(row.bundle_discount_min_qty, 2, 20),
    bundleDiscountCode: typeof row.bundle_discount_code === "string" && CODE_RE.test(row.bundle_discount_code)
      ? row.bundle_discount_code
      : null,
    bundleDiscountShopifyId: strOrNull(row.bundle_discount_shopify_id, 200),
    bundleDiscountSyncedAt: typeof row.bundle_discount_synced_at === "string" ? row.bundle_discount_synced_at : null,
    bundleDiscountNote: strOrNull(row.bundle_discount_note, 120),
  };
}

let warnedMissingTable = false;

export async function getQuizOffers(shopId: string): Promise<QuizOffers> {
  const { data, error } = await supabase.from("quiz_offers").select("*").eq("shop_id", shopId).maybeSingle();
  if (error) {
    // Un-run migration 086 (or a transient error): offers read as off,
    // never as a 500 on the storefront config.
    if (!warnedMissingTable) {
      warnedMissingTable = true;
      console.warn(`[offers] quiz_offers read failed (migration 086 not run?): ${error.message}`);
    }
    return { ...OFFERS_DEFAULTS, crossSellItems: [] };
  }
  return mapOffersRow(data as Record<string, unknown> | null);
}

// ---------------------------------------------------------------------
// Studio save
// ---------------------------------------------------------------------

/** Fields the Studio may write. Managed-discount bookkeeping (Shopify id,
 * sync time, the generated code) is written only by the sync below. */
export type OffersPatch = Partial<
  Pick<
    QuizOffers,
    | "crossSellEnabled"
    | "crossSellSource"
    | "crossSellTitle"
    | "crossSellSubtext"
    | "crossSellItems"
    | "crossSellMax"
    | "bundleDiscountMode"
    | "bundleDiscountType"
    | "bundleDiscountValue"
    | "bundleDiscountMinQty"
    | "bundleDiscountCode"
    | "bundleDiscountNote"
  >
>;

export function validateOffersPatch(
  raw: unknown,
): { ok: true; patch: OffersPatch } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "Malformed offers" };
  const r = raw as Record<string, unknown>;
  const patch: OffersPatch = {};
  const has = (k: string) => Object.prototype.hasOwnProperty.call(r, k);

  if (has("crossSellEnabled")) {
    if (typeof r.crossSellEnabled !== "boolean") return { ok: false, error: "crossSellEnabled must be true or false" };
    patch.crossSellEnabled = r.crossSellEnabled;
  }
  if (has("crossSellSource")) {
    if (!SOURCES.includes(r.crossSellSource as CrossSellSource)) {
      return { ok: false, error: `crossSellSource must be one of ${SOURCES.join(", ")}` };
    }
    patch.crossSellSource = r.crossSellSource as CrossSellSource;
  }
  if (has("crossSellTitle")) patch.crossSellTitle = strOrNull(r.crossSellTitle, 120);
  if (has("crossSellSubtext")) patch.crossSellSubtext = strOrNull(r.crossSellSubtext, 200);
  if (has("crossSellItems")) {
    if (!Array.isArray(r.crossSellItems)) return { ok: false, error: "crossSellItems must be a list" };
    if (r.crossSellItems.length > MAX_CROSS_SELL_ITEMS) {
      return { ok: false, error: `Pick up to ${MAX_CROSS_SELL_ITEMS} add-on products` };
    }
    const items: CrossSellItem[] = [];
    const seen = new Set<string>();
    for (const rawItem of r.crossSellItems) {
      const item = normalizeItem(rawItem);
      if (!item) return { ok: false, error: "An add-on product is missing its id or handle" };
      if (seen.has(item.productId)) continue;
      seen.add(item.productId);
      items.push(item);
    }
    patch.crossSellItems = items;
  }
  if (has("crossSellMax")) {
    const n = intIn(r.crossSellMax, 1, 6);
    if (n == null) return { ok: false, error: "Show between 1 and 6 add-ons" };
    patch.crossSellMax = n;
  }
  if (has("bundleDiscountMode")) {
    if (!MODES.includes(r.bundleDiscountMode as BundleDiscountMode)) {
      return { ok: false, error: `bundleDiscountMode must be one of ${MODES.join(", ")}` };
    }
    patch.bundleDiscountMode = r.bundleDiscountMode as BundleDiscountMode;
  }
  if (has("bundleDiscountType")) {
    if (!TYPES.includes(r.bundleDiscountType as BundleDiscountType)) {
      return { ok: false, error: "Discount type must be a percentage or a fixed amount" };
    }
    patch.bundleDiscountType = r.bundleDiscountType as BundleDiscountType;
  }
  if (has("bundleDiscountValue")) {
    if (r.bundleDiscountValue == null || r.bundleDiscountValue === "") {
      patch.bundleDiscountValue = null;
    } else {
      const n = Number(r.bundleDiscountValue);
      if (!Number.isFinite(n) || n <= 0) return { ok: false, error: "Discount amount must be more than 0" };
      patch.bundleDiscountValue = Math.round(n * 100) / 100;
    }
  }
  if (has("bundleDiscountMinQty")) {
    if (r.bundleDiscountMinQty == null || r.bundleDiscountMinQty === "") {
      patch.bundleDiscountMinQty = null;
    } else {
      const n = intIn(r.bundleDiscountMinQty, 2, 20);
      if (n == null) return { ok: false, error: "Minimum items must be a whole number from 2 to 20" };
      patch.bundleDiscountMinQty = n;
    }
  }
  if (has("bundleDiscountCode")) {
    const code = typeof r.bundleDiscountCode === "string" ? r.bundleDiscountCode.trim() : "";
    if (code && !CODE_RE.test(code)) {
      return { ok: false, error: "Discount codes use letters, numbers, dashes and underscores (3-64 characters)" };
    }
    patch.bundleDiscountCode = code || null;
  }
  if (has("bundleDiscountNote")) patch.bundleDiscountNote = strOrNull(r.bundleDiscountNote, 120);

  // Cross-field: the percentage is a whole percent the widget can show.
  const type = patch.bundleDiscountType;
  const value = patch.bundleDiscountValue;
  if (type === "percentage" && value != null && (value < 1 || value > 90)) {
    return { ok: false, error: "A bundle percentage must be between 1% and 90%" };
  }
  if (type === "fixed_amount" && value != null && value > 10000) {
    return { ok: false, error: "That fixed discount is too large" };
  }
  return { ok: true, patch };
}

const ROW_KEY: Record<keyof OffersPatch, string> = {
  crossSellEnabled: "cross_sell_enabled",
  crossSellSource: "cross_sell_source",
  crossSellTitle: "cross_sell_title",
  crossSellSubtext: "cross_sell_subtext",
  crossSellItems: "cross_sell_items",
  crossSellMax: "cross_sell_max",
  bundleDiscountMode: "bundle_discount_mode",
  bundleDiscountType: "bundle_discount_type",
  bundleDiscountValue: "bundle_discount_value",
  bundleDiscountMinQty: "bundle_discount_min_qty",
  bundleDiscountCode: "bundle_discount_code",
  bundleDiscountNote: "bundle_discount_note",
};

export function offersPatchToRow(patch: OffersPatch): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    const col = ROW_KEY[k as keyof OffersPatch];
    if (col) row[col] = v;
  }
  return row;
}

export async function saveQuizOffers(
  shopId: string,
  patch: OffersPatch,
  extra: Record<string, unknown> = {},
): Promise<{ ok: true; offers: QuizOffers } | { ok: false; error: string }> {
  const row = { shop_id: shopId, ...offersPatchToRow(patch), ...extra, updated_at: new Date().toISOString() };
  const { data, error } = await supabase
    .from("quiz_offers")
    .upsert(row, { onConflict: "shop_id" })
    .select("*")
    .single();
  if (error || !data) {
    const msg = error?.message ?? "no row returned";
    return {
      ok: false,
      error: /quiz_offers/.test(msg) && /exist|schema cache/i.test(msg)
        ? "Offers are still being set up on our side. Try again in a few minutes."
        : `Saving offers failed: ${msg}`,
    };
  }
  return { ok: true, offers: mapOffersRow(data as Record<string, unknown>) };
}

// ---------------------------------------------------------------------
// Storefront payload
// ---------------------------------------------------------------------

/** The bundle size the discount threshold defaults to. quiz_bundle_size 0
 * means "bundle every match", so the threshold falls back to 2. */
export function effectiveMinQty(offers: QuizOffers, bundleSize: number): number {
  if (offers.bundleDiscountMinQty != null) return offers.bundleDiscountMinQty;
  return Number.isInteger(bundleSize) && bundleSize >= 2 ? Math.min(bundleSize, 20) : 2;
}

/** Whether the widget should apply a discount when the bundle is added. */
export function bundleDiscountLive(offers: QuizOffers): boolean {
  if (!offers.bundleDiscountCode) return false;
  if (offers.bundleDiscountMode === "code") return true;
  if (offers.bundleDiscountMode === "managed") {
    return Boolean(offers.bundleDiscountShopifyId && offers.bundleDiscountValue);
  }
  return false;
}

export interface PublicOffers {
  crossSell: {
    source: CrossSellSource;
    title: string;
    subtext: string | null;
    max: number;
    items: Array<Pick<CrossSellItem, "productId" | "handle" | "title" | "imageUrl" | "when">>;
  } | null;
  /** The CODE is never in here (public, cached, CORS *): the widget asks
   * /api/storefront/quiz-bundle-discount for it after the bundle add. */
  bundleDiscount: {
    type: BundleDiscountType;
    /** Null in 'code' mode when the merchant didn't say what the code is
     * worth: the widget then shows the note without an amount. */
    value: number | null;
    minQty: number;
    note: string;
  } | null;
}

export function publicOffersPayload(
  offers: QuizOffers,
  opts: { bundleEnabled: boolean; bundleSize: number },
): PublicOffers {
  const crossSell =
    offers.crossSellEnabled && (offers.crossSellSource !== "manual" || offers.crossSellItems.length > 0)
      ? {
          source: offers.crossSellSource,
          title: offers.crossSellTitle ?? CROSS_SELL_TITLE_DEFAULT,
          subtext: offers.crossSellSubtext,
          max: offers.crossSellMax,
          items: offers.crossSellItems.map((i) => ({
            productId: i.productId,
            handle: i.handle,
            title: i.title,
            imageUrl: i.imageUrl,
            when: i.when,
          })),
        }
      : null;
  const bundleDiscount =
    opts.bundleEnabled && bundleDiscountLive(offers)
      ? {
          type: offers.bundleDiscountType,
          value: offers.bundleDiscountValue,
          minQty: effectiveMinQty(offers, opts.bundleSize),
          note: offers.bundleDiscountNote ?? BUNDLE_NOTE_DEFAULT,
        }
      : null;
  return { crossSell, bundleDiscount };
}

// ---------------------------------------------------------------------
// Managed Shopify discount ("Let Gleame create the discount")
// ---------------------------------------------------------------------
//
// One basic code discount per shop: X% / X off when the cart holds at
// least N items. Created and updated from the Studio Offers panel (needs
// the optional write_discounts scope); the widget applies the code via
// /discount/{code} right after the bundle add. The minimum is a Shopify
// rule, so a shopper who removes items loses the discount at checkout
// exactly as the merchant would expect.

const DISCOUNT_CREATE = `#graphql
  mutation GleameBundleDiscountCreate($input: DiscountCodeBasicInput!) {
    discountCodeBasicCreate(basicCodeDiscount: $input) {
      codeDiscountNode { id }
      userErrors { field code message }
    }
  }
`;

const DISCOUNT_UPDATE = `#graphql
  mutation GleameBundleDiscountUpdate($id: ID!, $input: DiscountCodeBasicInput!) {
    discountCodeBasicUpdate(id: $id, basicCodeDiscount: $input) {
      codeDiscountNode { id }
      userErrors { field code message }
    }
  }
`;

const DISCOUNT_ACTIVATE = `#graphql
  mutation GleameBundleDiscountActivate($id: ID!) {
    discountCodeActivate(id: $id) {
      codeDiscountNode { id }
      userErrors { field code message }
    }
  }
`;

const DISCOUNT_DEACTIVATE = `#graphql
  mutation GleameBundleDiscountDeactivate($id: ID!) {
    discountCodeDeactivate(id: $id) {
      codeDiscountNode { id }
      userErrors { field code message }
    }
  }
`;

/** Human-readable code, unique enough per shop (Shopify enforces uniqueness
 * and the sync retries once on a collision). No 0/O/1/I. */
export function generateBundleCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let suffix = "";
  for (let i = 0; i < 6; i++) suffix += alphabet[randomInt(alphabet.length)];
  return `QUIZBUNDLE-${suffix}`;
}

export function bundleDiscountTitle(type: BundleDiscountType, value: number, minQty: number): string {
  const amount = type === "percentage" ? `${value}%` : `${value}`;
  return `Gleame quiz bundle: ${amount} off ${minQty}+ items`;
}

/** DiscountCodeBasicInput for the bundle discount. Pure, so it is unit
 * tested without Shopify. */
export function buildBundleDiscountInput(args: {
  code: string;
  type: BundleDiscountType;
  value: number;
  minQty: number;
  startsAt?: string;
  /** Pre-2025-10 schemas only know the (since deprecated)
   * customerSelection field; the sync retries with it when a schema
   * rejects `context`. */
  legacyEligibility?: boolean;
}): Record<string, unknown> {
  const value =
    args.type === "percentage"
      ? { percentage: Math.round(args.value * 100) / 10000 }
      : { discountAmount: { amount: args.value.toFixed(2), appliesOnEachItem: false } };
  return {
    title: bundleDiscountTitle(args.type, args.value, args.minQty),
    code: args.code,
    startsAt: args.startsAt ?? new Date().toISOString(),
    endsAt: null,
    ...(args.legacyEligibility ? { customerSelection: { all: true } } : { context: { all: "ALL" } }),
    customerGets: { value, items: { all: true } },
    minimumRequirement: {
      quantity: { greaterThanOrEqualToQuantity: String(args.minQty) },
    },
    combinesWith: { orderDiscounts: false, productDiscounts: false, shippingDiscounts: true },
    // A code is public once any shopper has seen it, and Shopify applies it
    // to any cart that meets the minimum: one use per customer keeps a
    // leaked code from becoming a standing store-wide sale.
    appliesOncePerCustomer: true,
  };
}

function isAccessDenied(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  return /access denied|required access|requires? .*scope|not approved to access/i.test(msg);
}

type UserError = { field?: string[] | null; code?: string | null; message: string };

function firstUserError(errors: UserError[] | undefined): UserError | null {
  return errors && errors.length > 0 ? errors[0] : null;
}

export type SyncResult =
  | { ok: true; offers: QuizOffers; message: string }
  | { ok: false; error: string; missingScopes?: string[] };

/**
 * Bring the shop's managed Shopify discount in line with the offer:
 * create it on first use, update it on change, deactivate it when the
 * merchant switches the bundle discount off or to their own code.
 *
 * `pendingPatch` is an unsaved Studio edit: Shopify is changed FIRST and
 * the patch is persisted together with the Shopify id / code / threshold
 * only when that succeeded. A failed sync therefore leaves quiz_offers
 * exactly as it was, so the storefront can never advertise "Save 30%"
 * while Shopify still applies 20%.
 */
export async function syncManagedBundleDiscount(
  shopId: string,
  adminGraphql: AdminGraphql,
  opts: { bundleSize: number; pendingPatch?: OffersPatch },
): Promise<SyncResult> {
  const pendingPatch = opts.pendingPatch ?? {};
  const offers: QuizOffers = { ...(await getQuizOffers(shopId)), ...pendingPatch };

  // Off or merchant's own code: a managed discount left active would keep
  // working for anyone who has the code. Deactivate it (kept for history
  // and a later re-enable, never deleted).
  if (offers.bundleDiscountMode !== "managed") {
    if (!offers.bundleDiscountShopifyId) {
      if (Object.keys(pendingPatch).length === 0) return { ok: true, offers, message: "Nothing to sync" };
      const saved = await saveQuizOffers(shopId, pendingPatch);
      return saved.ok ? { ok: true, offers: saved.offers, message: "Saved" } : { ok: false, error: saved.error };
    }
    try {
      const data = await adminGraphql(DISCOUNT_DEACTIVATE, { id: offers.bundleDiscountShopifyId });
      const err = firstUserError(data?.discountCodeDeactivate?.userErrors);
      // An already-deleted discount is fine: forget it.
      if (err && !/not exist|not found/i.test(err.message)) return { ok: false, error: err.message };
    } catch (e) {
      if (isAccessDenied(e)) return { ok: false, error: "Gleame needs permission to manage discounts.", missingScopes: [DISCOUNT_SCOPE] };
      return { ok: false, error: `Couldn't turn off the Shopify discount: ${(e as Error).message}` };
    }
    // The generated code goes with it, so 'code' mode can never serve a
    // QUIZBUNDLE- code that now points at a deactivated discount.
    const saved = await saveQuizOffers(shopId, pendingPatch, {
      bundle_discount_shopify_id: null,
      bundle_discount_synced_at: new Date().toISOString(),
      ...(offers.bundleDiscountCode && /^QUIZBUNDLE-/.test(offers.bundleDiscountCode)
        ? { bundle_discount_code: null }
        : {}),
    });
    if (!saved.ok) return { ok: false, error: saved.error };
    return { ok: true, offers: saved.offers, message: "Gleame's bundle discount is turned off in Shopify" };
  }

  if (!offers.bundleDiscountValue) {
    return { ok: false, error: "Set the discount amount first." };
  }
  const minQty = effectiveMinQty(offers, opts.bundleSize);
  // Managed codes are always Gleame-generated: a merchant-typed code in
  // 'code' mode refers to THEIR discount, never ours.
  const reuseCode =
    offers.bundleDiscountShopifyId && offers.bundleDiscountCode && /^QUIZBUNDLE-/.test(offers.bundleDiscountCode)
      ? offers.bundleDiscountCode
      : null;

  // The app's pinned API version decides the schema: 2025-10+ takes
  // `context`, older ones only `customerSelection`. Try the current field,
  // fall back once on a schema rejection of it.
  const withEligibilityFallback = async (
    run: (legacyEligibility: boolean) => Promise<any>,
  ): Promise<any> => {
    try {
      return await run(false);
    } catch (e) {
      if (/\bcontext\b/i.test((e as Error).message ?? "")) return run(true);
      throw e;
    }
  };
  const inputFor = (code: string, legacyEligibility: boolean) =>
    buildBundleDiscountInput({
      code,
      type: offers.bundleDiscountType,
      value: offers.bundleDiscountValue!,
      minQty,
      legacyEligibility,
    });

  const create = async (code: string) => {
    const data = await withEligibilityFallback((legacy) =>
      adminGraphql(DISCOUNT_CREATE, { input: inputFor(code, legacy) }),
    );
    const payload = data?.discountCodeBasicCreate;
    return { id: payload?.codeDiscountNode?.id as string | undefined, error: firstUserError(payload?.userErrors) };
  };

  try {
    let id: string | null = null;
    let code = reuseCode ?? generateBundleCode();
    if (offers.bundleDiscountShopifyId && reuseCode) {
      const data = await withEligibilityFallback((legacy) =>
        adminGraphql(DISCOUNT_UPDATE, { id: offers.bundleDiscountShopifyId, input: inputFor(code, legacy) }),
      );
      const err = firstUserError(data?.discountCodeBasicUpdate?.userErrors);
      if (!err) {
        id = data?.discountCodeBasicUpdate?.codeDiscountNode?.id ?? offers.bundleDiscountShopifyId;
        // Re-enable if someone expired it in Shopify admin. Best-effort:
        // an already-active discount may answer with a userError, and the
        // update itself already succeeded.
        try {
          const act = await adminGraphql(DISCOUNT_ACTIVATE, { id });
          const actErr = firstUserError(act?.discountCodeActivate?.userErrors);
          if (actErr) console.warn(`[offers] discountCodeActivate for ${id}: ${actErr.message}`);
        } catch (e) {
          console.warn(`[offers] discountCodeActivate for ${id} failed: ${(e as Error).message}`);
        }
      } else if (!/not exist|not found/i.test(err.message)) {
        return { ok: false, error: err.message };
      }
      // Deleted in Shopify admin since the last sync: fall through and
      // create a fresh one.
    }
    if (!id) {
      let created = await create(code);
      if (created.error && (/taken|unique|already/i.test(created.error.message) || /TAKEN|DUPLICATE/.test(created.error.code ?? ""))) {
        code = generateBundleCode();
        created = await create(code);
      }
      if (created.error || !created.id) {
        return { ok: false, error: created.error?.message ?? "Shopify didn't create the discount." };
      }
      id = created.id;
    }
    // The threshold Shopify now enforces is stored explicitly, so the
    // widget's "Bundle N+ to save" always matches checkout (a later bundle
    // size change shows in the editor and syncs on the next save).
    const saved = await saveQuizOffers(shopId, { ...pendingPatch, bundleDiscountMinQty: minQty }, {
      bundle_discount_code: code,
      bundle_discount_shopify_id: id,
      bundle_discount_synced_at: new Date().toISOString(),
    });
    if (!saved.ok) {
      return { ok: false, error: `The discount exists in Shopify (${code}) but saving it here failed: ${saved.error}` };
    }
    return { ok: true, offers: saved.offers, message: `Discount ${code} is live in Shopify` };
  } catch (e) {
    if (isAccessDenied(e)) {
      return { ok: false, error: "Gleame needs permission to manage discounts.", missingScopes: [DISCOUNT_SCOPE] };
    }
    return { ok: false, error: `Shopify discount sync failed: ${(e as Error).message}` };
  }
}
