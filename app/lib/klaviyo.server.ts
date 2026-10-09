// ---------------------------------------------------------------------
// Klaviyo REST client (server-side, merchant PRIVATE API key).
//
// Verified against developers.klaviyo.com on 2026-10-09:
//   - Base https://a.klaviyo.com, header `Authorization: Klaviyo-API-Key pk_…`
//   - `revision` header required; 2026-07-15 is the newest GA revision.
//     Revisions are stable 1 year, deprecated 1 more, retired at 2 years:
//     bump KLAVIYO_REVISION before 2028-07.
//   - Subscribe: POST /api/profile-subscription-bulk-create-jobs → 202
//     (scopes lists:write, profiles:write, subscriptions:write). Async job.
//     Consent only accepts "SUBSCRIBED"; phone must be E.164.
//   - Event: POST /api/events → 202 (events:write). Same unique_id for the
//     same profile + metric is deduped by Klaviyo.
//   - Lists: GET /api/lists, cursor pages of max 10 (lists:read).
//   - Profiles: GET /api/profiles?filter=equals(email,"…") with
//     additional-fields[profile]=subscriptions (profiles:read).
// Not wired on purpose: Klaviyo's profile deletion
// (POST /api/data-privacy-deletion-jobs). A quiz lead forwarded to
// Klaviyo becomes a profile in the MERCHANT's account, often one that
// already existed; Shopify's customers/redact removes Gleame's copy
// (quiz_leads), and the merchant owns their Klaviyo data.
// Only call the subscribe endpoint for a shopper who actually opted in on
// the lead step: it lifts earlier unsubscribes/suppressions.
// ---------------------------------------------------------------------

export const KLAVIYO_REVISION = "2026-07-15";
const BASE = "https://a.klaviyo.com";
const TIMEOUT_MS = 8000;

/** Private keys start with pk_; anything else is a user paste error. */
export function looksLikeKlaviyoPrivateKey(key: string): boolean {
  return /^pk_[A-Za-z0-9]{20,}$/.test(key.trim());
}

type KlaviyoResponse = { status: number; body: any };

async function klaviyoFetch(
  apiKey: string,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<KlaviyoResponse> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Klaviyo-API-Key ${apiKey}`,
      revision: KLAVIYO_REVISION,
      accept: "application/vnd.api+json",
      ...(body !== undefined ? { "content-type": "application/vnd.api+json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  let parsed: any = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text.slice(0, 300) };
    }
  }
  return { status: res.status, body: parsed };
}

/** Readable message from a Klaviyo error body ({errors:[{detail,title}]}). */
export function klaviyoErrorMessage(res: KlaviyoResponse): string {
  const first = res.body?.errors?.[0];
  const detail = (first?.detail || first?.title || "").toString().trim();
  if (res.status === 401) return "Klaviyo rejected the API key. Check that it's a private key (pk_…) that hasn't been revoked.";
  if (res.status === 403) {
    return `This Klaviyo key is missing a permission${detail ? ` (${detail})` : ""}. Create a private key with Lists, Profiles, Subscriptions and Events access.`;
  }
  if (res.status === 429) return "Klaviyo is rate limiting requests right now. Try again in a minute.";
  return detail ? `Klaviyo error ${res.status}: ${detail}` : `Klaviyo error ${res.status}`;
}

export interface KlaviyoList {
  id: string;
  name: string;
  /** "single_opt_in" | "double_opt_in" (Klaviyo's opt_in_process). */
  optInProcess: string | null;
}

/** Validates the key (lists:read) and returns up to 100 lists for the
 * Studio picker. Klaviyo pages lists 10 at a time. */
export async function listKlaviyoLists(
  apiKey: string,
): Promise<{ ok: true; lists: KlaviyoList[] } | { ok: false; error: string; status?: number }> {
  const lists: KlaviyoList[] = [];
  let path: string | null = "/api/lists?fields[list]=name,opt_in_process";
  for (let page = 0; path && page < 10; page++) {
    let res: KlaviyoResponse;
    try {
      res = await klaviyoFetch(apiKey, "GET", path);
    } catch (e) {
      return { ok: false, error: `Couldn't reach Klaviyo: ${(e as Error).message}` };
    }
    if (res.status !== 200) return { ok: false, error: klaviyoErrorMessage(res), status: res.status };
    for (const item of res.body?.data ?? []) {
      if (typeof item?.id !== "string") continue;
      lists.push({
        id: item.id,
        name: String(item.attributes?.name ?? item.id),
        optInProcess: typeof item.attributes?.opt_in_process === "string" ? item.attributes.opt_in_process : null,
      });
    }
    const next: unknown = res.body?.links?.next;
    path = typeof next === "string" && next.startsWith(BASE) ? next.slice(BASE.length) : null;
  }
  return { ok: true, lists };
}

export function buildSubscribeBody(args: {
  email: string | null;
  phone: string | null;
  listId: string;
  smsConsent: boolean;
  source: string;
}): Record<string, unknown> {
  const phone = args.phone ? toE164(args.phone) : null;
  const subscriptions: Record<string, unknown> = {};
  if (args.email) subscriptions.email = { marketing: { consent: "SUBSCRIBED" } };
  if (phone && args.smsConsent) subscriptions.sms = { marketing: { consent: "SUBSCRIBED" } };
  const attributes: Record<string, unknown> = { subscriptions };
  if (args.email) attributes.email = args.email;
  if (phone) attributes.phone_number = phone;
  return {
    data: {
      type: "profile-subscription-bulk-create-job",
      attributes: {
        custom_source: args.source,
        profiles: { data: [{ type: "profile", attributes }] },
      },
      relationships: { list: { data: { type: "list", id: args.listId } } },
    },
  };
}

export function buildEventBody(args: {
  metric: string;
  email: string | null;
  phone: string | null;
  properties: Record<string, unknown>;
  uniqueId: string;
  value?: number | null;
  time?: string;
}): Record<string, unknown> {
  const profile: Record<string, unknown> = {};
  if (args.email) profile.email = args.email;
  const phone = args.phone ? toE164(args.phone) : null;
  if (phone) profile.phone_number = phone;
  return {
    data: {
      type: "event",
      attributes: {
        properties: args.properties,
        time: args.time ?? new Date().toISOString(),
        ...(args.value != null && Number.isFinite(args.value) ? { value: args.value } : {}),
        unique_id: args.uniqueId,
        metric: { data: { type: "metric", attributes: { name: args.metric } } },
        profile: { data: { type: "profile", attributes: profile } },
      },
    },
  };
}

/** The lead endpoint stores digits with an optional leading +; Klaviyo
 * needs E.164 and rejects the WHOLE request on a bad number. Only
 * unambiguous forms convert: an explicit +country number, a 10-digit
 * NANP number (+1), or 11 digits starting with 1. A national number with
 * a trunk 0 (UK 07700…) has no knowable country code: null, and the
 * caller leaves the phone out rather than lose the email too. */
export function toE164(phone: string): string | null {
  const raw = phone.replace(/[^\d+]/g, "");
  if (raw.startsWith("+")) {
    const d = raw.slice(1);
    return /^[1-9]\d{7,14}$/.test(d) ? `+${d}` : null;
  }
  if (/^[2-9]\d{9}$/.test(raw)) return `+1${raw}`;
  if (/^1[2-9]\d{9}$/.test(raw)) return `+${raw}`;
  return null;
}

/**
 * Existing marketing state for a profile, so a quiz signup never lifts an
 * unsubscribe or a suppression (spam report, bounce, manual): Klaviyo's
 * subscribe call DOES lift them, and the lead form is public, so anyone
 * could otherwise re-subscribe an address that opted out. Needs
 * profiles:read. A profile that doesn't exist yet is not blocked.
 */
export async function getMarketingBlocks(
  apiKey: string,
  ident: { email: string | null; phone: string | null },
): Promise<{ ok: true; emailBlocked: boolean; smsBlocked: boolean } | { ok: false; error: string }> {
  const phone = ident.phone ? toE164(ident.phone) : null;
  const filter = ident.email
    ? `equals(email,${JSON.stringify(ident.email)})`
    : phone
      ? `equals(phone_number,${JSON.stringify(phone)})`
      : null;
  if (!filter) return { ok: true, emailBlocked: false, smsBlocked: false };
  let res: KlaviyoResponse;
  try {
    res = await klaviyoFetch(
      apiKey,
      "GET",
      `/api/profiles?filter=${encodeURIComponent(filter)}&additional-fields[profile]=subscriptions&page[size]=1`,
    );
  } catch (e) {
    return { ok: false, error: `Couldn't reach Klaviyo: ${(e as Error).message}` };
  }
  if (res.status !== 200) return { ok: false, error: klaviyoErrorMessage(res) };
  const subs = res.body?.data?.[0]?.attributes?.subscriptions;
  const blocked = (m: any) =>
    Boolean(m) && (m.consent === "UNSUBSCRIBED" || (Array.isArray(m.suppression) && m.suppression.length > 0));
  return { ok: true, emailBlocked: blocked(subs?.email?.marketing), smsBlocked: blocked(subs?.sms?.marketing) };
}

export async function subscribeProfile(
  apiKey: string,
  args: Parameters<typeof buildSubscribeBody>[0],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await klaviyoFetch(apiKey, "POST", "/api/profile-subscription-bulk-create-jobs", buildSubscribeBody(args));
  return res.status === 202 || res.status === 200 ? { ok: true } : { ok: false, error: klaviyoErrorMessage(res) };
}

export async function createEvent(
  apiKey: string,
  args: Parameters<typeof buildEventBody>[0],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await klaviyoFetch(apiKey, "POST", "/api/events", buildEventBody(args));
  return res.status === 202 || res.status === 200 ? { ok: true } : { ok: false, error: klaviyoErrorMessage(res) };
}
