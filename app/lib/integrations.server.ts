import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { supabase, type QuizLeadAnswer, type QuizLeadProduct } from "./supabase.server";
import {
  createEvent,
  getMarketingBlocks,
  listKlaviyoLists,
  looksLikeKlaviyoPrivateKey,
  subscribeProfile,
  type KlaviyoList,
} from "./klaviyo.server";

// ---------------------------------------------------------------------
// Per-shop third-party integrations (migration 086, shop_integrations).
// Klaviyo is the first provider: quiz leads subscribe to a merchant-chosen
// list, and two metrics land on the profile for flows:
//   "Gleame Quiz Lead"     — email/phone left on the lead step (answers,
//                            discount code revealed)
//   "Gleame Quiz Results"  — the matches that lead was shown
// Secrets are AES-256-GCM encrypted with INTEGRATIONS_ENCRYPTION_KEY and
// never leave the server; Studio payloads carry only key_hint.
// ---------------------------------------------------------------------

export const KLAVIYO_LEAD_METRIC = "Gleame Quiz Lead";
export const KLAVIYO_RESULTS_METRIC = "Gleame Quiz Results";
const KLAVIYO_SOURCE = "Gleame Quiz";

export interface KlaviyoSettings {
  listId: string | null;
  listName: string | null;
  /** Subscribe + "Gleame Quiz Lead" on lead submit. */
  sendLeads: boolean;
  /** "Gleame Quiz Results" once the lead's results load. */
  sendResults: boolean;
  /** Also subscribe the phone to SMS marketing. Off unless the merchant's
   * lead consent text covers SMS. */
  smsConsent: boolean;
}

export const KLAVIYO_SETTINGS_DEFAULTS: KlaviyoSettings = {
  listId: null,
  listName: null,
  sendLeads: true,
  sendResults: true,
  smsConsent: false,
};

export interface IntegrationStatus {
  connected: boolean;
  enabled: boolean;
  keyHint: string | null;
  settings: KlaviyoSettings;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  /** False when INTEGRATIONS_ENCRYPTION_KEY isn't configured: connecting
   * is refused rather than storing a key unencrypted. */
  encryptionReady: boolean;
  /** False when the shop_integrations table is missing (migration 086). */
  available: boolean;
}

// ---- Encryption -------------------------------------------------------

function encryptionKey(): Buffer | null {
  const raw = process.env.INTEGRATIONS_ENCRYPTION_KEY ?? "";
  if (raw.length < 32) return null;
  return createHash("sha256").update(raw).digest();
}

export function integrationsEncryptionReady(): boolean {
  return encryptionKey() !== null;
}

export function encryptSecret(plain: string): string {
  const key = encryptionKey();
  if (!key) throw new Error("INTEGRATIONS_ENCRYPTION_KEY is not configured");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${data.toString("base64")}`;
}

export function decryptSecret(enc: string): string {
  const key = encryptionKey();
  if (!key) throw new Error("INTEGRATIONS_ENCRYPTION_KEY is not configured");
  const [v, ivB64, tagB64, dataB64] = enc.split(":");
  if (v !== "v1" || !ivB64 || !tagB64 || !dataB64) throw new Error("Unrecognized secret format");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}

// ---- Lead tokens (results callback) ----------------------------------
//
// The lead POST hands the widget `${leadId}.${hmac}`; the results callback
// presents it to attach matches. The widget never re-sends the email, so a
// stranger can't fire "Gleame Quiz Results" (and the merchant's flows) at
// an arbitrary inbox.

function tokenSecret(): string {
  return process.env.SHOPIFY_API_SECRET || process.env.INTEGRATIONS_ENCRYPTION_KEY || "";
}

export function signLeadToken(shopId: string, leadId: string): string | null {
  const secret = tokenSecret();
  if (!secret) return null;
  const sig = createHmac("sha256", secret).update(`lead:${shopId}:${leadId}`).digest("base64url");
  return `${leadId}.${sig}`;
}

export function verifyLeadToken(shopId: string, token: string): string | null {
  const secret = tokenSecret();
  if (!secret || typeof token !== "string" || token.length > 200) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const leadId = token.slice(0, dot);
  if (!/^[0-9a-f-]{36}$/i.test(leadId)) return null;
  const expected = createHmac("sha256", secret).update(`lead:${shopId}:${leadId}`).digest("base64url");
  const got = token.slice(dot + 1);
  const a = Buffer.from(expected);
  const b = Buffer.from(got);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return leadId;
}

// ---- Rows ---------------------------------------------------------------

function mapSettings(raw: unknown): KlaviyoSettings {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    listId: typeof r.listId === "string" && /^[A-Za-z0-9]{1,32}$/.test(r.listId) ? r.listId : null,
    listName: typeof r.listName === "string" ? r.listName.slice(0, 200) : null,
    sendLeads: r.sendLeads !== false,
    sendResults: r.sendResults !== false,
    smsConsent: r.smsConsent === true,
  };
}

const EMPTY_STATUS = (available: boolean): IntegrationStatus => ({
  connected: false,
  enabled: false,
  keyHint: null,
  settings: { ...KLAVIYO_SETTINGS_DEFAULTS },
  lastSuccessAt: null,
  lastError: null,
  lastErrorAt: null,
  encryptionReady: integrationsEncryptionReady(),
  available,
});

/** Status for when the integrations store can't be read at all. */
export function unavailableIntegrationStatus(): IntegrationStatus {
  return EMPTY_STATUS(false);
}

async function readKlaviyoRow(shopId: string): Promise<{ row: Record<string, any> | null; available: boolean }> {
  const { data, error } = await supabase
    .from("shop_integrations")
    .select("*")
    .eq("shop_id", shopId)
    .eq("provider", "klaviyo")
    .maybeSingle();
  if (error) return { row: null, available: false };
  return { row: data as Record<string, any> | null, available: true };
}

function statusFromRow(row: Record<string, any> | null, available: boolean): IntegrationStatus {
  if (!row) return EMPTY_STATUS(available);
  return {
    connected: Boolean(row.credentials_encrypted),
    enabled: row.enabled === true,
    keyHint: typeof row.key_hint === "string" ? row.key_hint : null,
    settings: mapSettings(row.settings),
    lastSuccessAt: row.last_success_at ?? null,
    lastError: row.last_error ?? null,
    lastErrorAt: row.last_error_at ?? null,
    encryptionReady: integrationsEncryptionReady(),
    available,
  };
}

/** Studio-safe status: never includes the key. */
export async function getKlaviyoStatus(shopId: string): Promise<IntegrationStatus> {
  const { row, available } = await readKlaviyoRow(shopId);
  return statusFromRow(row, available);
}

/** Server-only: status plus the decrypted key (null when unusable). */
async function getKlaviyoConnection(shopId: string): Promise<{ status: IntegrationStatus; apiKey: string | null }> {
  const { row, available } = await readKlaviyoRow(shopId);
  const status = statusFromRow(row, available);
  if (!row?.credentials_encrypted || !status.encryptionReady) return { status, apiKey: null };
  try {
    return { status, apiKey: decryptSecret(row.credentials_encrypted) };
  } catch (e) {
    console.error(`[integrations] klaviyo key decrypt failed for shop ${shopId}: ${(e as Error).message}`);
    return { status, apiKey: null };
  }
}

export async function connectKlaviyo(
  shopId: string,
  apiKeyRaw: string,
): Promise<{ ok: true; status: IntegrationStatus; lists: KlaviyoList[] } | { ok: false; error: string }> {
  const apiKey = apiKeyRaw.trim();
  if (!looksLikeKlaviyoPrivateKey(apiKey)) {
    return { ok: false, error: "That doesn't look like a Klaviyo private API key. It starts with pk_ (Settings → API keys in Klaviyo)." };
  }
  if (!integrationsEncryptionReady()) {
    return { ok: false, error: "Integrations aren't switched on for this Gleame installation yet. Contact support." };
  }
  const listed = await listKlaviyoLists(apiKey);
  if (!listed.ok) return { ok: false, error: listed.error };
  const existing = await readKlaviyoRow(shopId);
  if (!existing.available) return { ok: false, error: "Integrations are still being set up on our side. Try again in a few minutes." };
  // Keep the list choice when the merchant re-connects with a fresh key.
  const settings = existing.row ? mapSettings(existing.row.settings) : { ...KLAVIYO_SETTINGS_DEFAULTS };
  if (settings.listId && !listed.lists.some((l) => l.id === settings.listId)) {
    settings.listId = null;
    settings.listName = null;
  }
  const { data, error } = await supabase
    .from("shop_integrations")
    .upsert(
      {
        shop_id: shopId,
        provider: "klaviyo",
        enabled: true,
        credentials_encrypted: encryptSecret(apiKey),
        key_hint: apiKey.slice(-4),
        settings,
        last_error: null,
        last_error_at: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "shop_id,provider" },
    )
    .select("*")
    .single();
  if (error || !data) return { ok: false, error: `Saving the connection failed: ${error?.message ?? "no row"}` };
  return { ok: true, status: statusFromRow(data, true), lists: listed.lists };
}

export async function getKlaviyoLists(
  shopId: string,
): Promise<{ ok: true; lists: KlaviyoList[] } | { ok: false; error: string }> {
  const { apiKey } = await getKlaviyoConnection(shopId);
  if (!apiKey) return { ok: false, error: "Klaviyo isn't connected." };
  const listed = await listKlaviyoLists(apiKey);
  return listed.ok ? listed : { ok: false, error: listed.error };
}

export async function saveKlaviyoSettings(
  shopId: string,
  patch: { enabled?: boolean; settings?: Partial<KlaviyoSettings> },
): Promise<{ ok: true; status: IntegrationStatus } | { ok: false; error: string }> {
  const { row, available } = await readKlaviyoRow(shopId);
  if (!available) return { ok: false, error: "Integrations are still being set up on our side." };
  if (!row?.credentials_encrypted) return { ok: false, error: "Connect Klaviyo first." };
  const next = { ...mapSettings(row.settings), ...(patch.settings ?? {}) };
  const settings = mapSettings(next);
  const update: Record<string, unknown> = { settings, updated_at: new Date().toISOString() };
  if (typeof patch.enabled === "boolean") update.enabled = patch.enabled;
  const { data, error } = await supabase
    .from("shop_integrations")
    .update(update)
    .eq("id", row.id)
    .select("*");
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: "The Klaviyo connection was removed. Reconnect it." };
  return { ok: true, status: statusFromRow(data[0], true) };
}

export async function disconnectKlaviyo(shopId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("shop_integrations").delete().eq("shop_id", shopId).eq("provider", "klaviyo");
  return error ? { ok: false, error: error.message } : { ok: true };
}

async function recordResult(shopId: string, error: string | null): Promise<void> {
  const now = new Date().toISOString();
  await supabase
    .from("shop_integrations")
    .update(error ? { last_error: error.slice(0, 500), last_error_at: now } : { last_success_at: now })
    .eq("shop_id", shopId)
    .eq("provider", "klaviyo")
    .then(({ error: e }) => {
      if (e) console.warn(`[integrations] could not record klaviyo result for ${shopId}: ${e.message}`);
    });
}

// ---- Storefront fan-out (never throws; callers fire and forget) --------

function answersObject(answers: QuizLeadAnswer[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of answers.slice(0, 40)) out[a.question.slice(0, 200)] = a.answer.slice(0, 500);
  return out;
}

export async function sendLeadToKlaviyo(
  shopId: string,
  lead: { leadId: string; email: string | null; phone: string | null; answers: QuizLeadAnswer[]; discountCode: string | null },
): Promise<void> {
  try {
    const { status, apiKey } = await getKlaviyoConnection(shopId);
    if (!apiKey || !status.enabled || !status.settings.sendLeads) return;
    const errors: string[] = [];
    if (status.settings.listId && (lead.email || (lead.phone && status.settings.smsConsent))) {
      // Never lift an opt-out: check first, and fail CLOSED (no subscribe)
      // when the state can't be read.
      const blocks = await getMarketingBlocks(apiKey, { email: lead.email, phone: lead.phone });
      if (!blocks.ok) {
        errors.push(`consent check (not subscribed): ${blocks.error}`);
      } else {
        const email = blocks.emailBlocked ? null : lead.email;
        const smsConsent = status.settings.smsConsent && !blocks.smsBlocked;
        if (email || (lead.phone && smsConsent)) {
          const sub = await subscribeProfile(apiKey, {
            email,
            phone: lead.phone,
            listId: status.settings.listId,
            smsConsent,
            source: KLAVIYO_SOURCE,
          });
          if (!sub.ok) errors.push(`subscribe: ${sub.error}`);
        }
      }
    }
    const ev = await createEvent(apiKey, {
      metric: KLAVIYO_LEAD_METRIC,
      email: lead.email,
      phone: lead.phone,
      uniqueId: `gleame-lead-${lead.leadId}-${Date.now()}`,
      properties: {
        answers: answersObject(lead.answers),
        ...(lead.discountCode ? { discount_code: lead.discountCode } : {}),
        source: KLAVIYO_SOURCE,
      },
    });
    if (!ev.ok) errors.push(`event: ${ev.error}`);
    await recordResult(shopId, errors.length ? errors.join("; ") : null);
  } catch (e) {
    console.error(`[integrations] klaviyo lead sync failed for shop ${shopId}:`, e);
    await recordResult(shopId, (e as Error).message ?? "unknown error").catch(() => {});
  }
}

export async function sendResultsToKlaviyo(
  shopId: string,
  lead: { leadId: string; email: string | null; phone: string | null; answers: QuizLeadAnswer[] },
  products: QuizLeadProduct[],
): Promise<void> {
  try {
    const { status, apiKey } = await getKlaviyoConnection(shopId);
    if (!apiKey || !status.enabled || !status.settings.sendResults) return;
    if (!lead.email && !lead.phone) return;
    const top = products[0] ?? null;
    const ev = await createEvent(apiKey, {
      metric: KLAVIYO_RESULTS_METRIC,
      email: lead.email,
      phone: lead.phone,
      // Same matches re-reported (refresh, back-nav) dedupe in Klaviyo.
      uniqueId: `gleame-results-${lead.leadId}-${createHash("sha1")
        .update(products.map((p) => p.productId ?? p.title).join("|"))
        .digest("hex")
        .slice(0, 12)}`,
      properties: {
        answers: answersObject(lead.answers),
        products,
        product_names: products.map((p) => p.title),
        ...(top
          ? { top_product_name: top.title, top_product_url: top.url, top_product_image: top.imageUrl, top_product_price: top.price }
          : {}),
        source: KLAVIYO_SOURCE,
      },
    });
    await recordResult(shopId, ev.ok ? null : `results event: ${ev.error}`);
  } catch (e) {
    console.error(`[integrations] klaviyo results sync failed for shop ${shopId}:`, e);
    await recordResult(shopId, (e as Error).message ?? "unknown error").catch(() => {});
  }
}
