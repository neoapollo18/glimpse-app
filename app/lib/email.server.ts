import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

// Resend's shared test sender (onboarding@resend.dev) only delivers to the
// Resend account owner's own address — set EMAIL_FROM to a sender on a
// verified gleame.ai domain for real delivery.
const EMAIL_FROM = process.env.EMAIL_FROM || "Gleame <onboarding@resend.dev>";

/**
 * Send an email notification when a merchant completes onboarding.
 * Fails silently if Resend is not configured.
 */
export async function sendOnboardingCompleteEmail(
  shopDomain: string,
  goals: string[],
  attribution: string[]
): Promise<void> {
  if (!resend) {
    console.warn("RESEND_API_KEY not set — skipping onboarding email");
    return;
  }

  const goalsText = goals.length > 0 ? goals.join(", ") : "None selected";
  const attributionText =
    attribution.length > 0 ? attribution.join(", ") : "Not provided";

  try {
    // Resend's SDK resolves with { error } on API failures instead of
    // throwing — check it explicitly or delivery failures vanish.
    const { error } = await resend.emails.send({
      from: EMAIL_FROM,
      to: "aaron@gleame.ai",
      subject: `New merchant onboarded: ${shopDomain}`,
      html: `
        <h2>New Merchant Onboarded</h2>
        <p><strong>Shop:</strong> ${shopDomain}</p>
        <p><strong>Goals:</strong> ${goalsText}</p>
        <p><strong>How they heard about us:</strong> ${attributionText}</p>
        <p><strong>Completed at:</strong> ${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })}</p>
      `,
    });
    if (error) {
      console.error(
        `[email] FAILED to send onboarding notification for ${shopDomain} (from: ${EMAIL_FROM}):`,
        JSON.stringify(error)
      );
    }
  } catch (error) {
    console.error(
      `[email] FAILED to send onboarding notification for ${shopDomain} (from: ${EMAIL_FROM}):`,
      error
    );
  }
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * A merchant said yes to the free done-for-you setup popup. Always goes
 * to tangaaron18@gmail.com, plus the team inbox (SETUP_OFFER_EMAIL,
 * default aaron@gleame.ai). Returns false on
 * any delivery failure so the caller can log it; the request is also
 * recorded in analytics_events, so a lost email is recoverable.
 */
export async function sendSetupRequestEmail(req: {
  shopDomain: string;
  shopName: string;
  ownerName: string;
  email: string;
  phone: string;
  notes: string;
  source: string;
}): Promise<boolean> {
  if (!resend) {
    console.warn("RESEND_API_KEY not set — skipping setup request email");
    return false;
  }
  const storeHandle = req.shopDomain.replace(".myshopify.com", "");
  const row = (label: string, value: string) =>
    value ? `<p><strong>${label}:</strong> ${escapeHtml(value)}</p>` : "";
  try {
    const { error } = await resend.emails.send({
      from: EMAIL_FROM,
      to: [...new Set(["tangaaron18@gmail.com", process.env.SETUP_OFFER_EMAIL || "aaron@gleame.ai"])],
      replyTo: req.email,
      subject: `Setup request: ${req.shopName || req.shopDomain}`,
      html: `
        <h2>A merchant wants us to set up Gleame</h2>
        ${row("Store", req.shopName)}
        ${row("Shop", req.shopDomain)}
        ${row("Owner", req.ownerName)}
        ${row("Email", req.email)}
        ${row("Phone", req.phone)}
        ${row("Notes", req.notes)}
        ${row("Asked from", req.source)}
        <p><a href="https://admin.shopify.com/store/${encodeURIComponent(storeHandle)}">Open their Shopify admin</a> (staff access needed) · reply to this email to reach them.</p>
        <p><strong>Requested at:</strong> ${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })}</p>
      `,
    });
    if (error) {
      console.error(`[email] FAILED to send setup request for ${req.shopDomain} (from: ${EMAIL_FROM}):`, JSON.stringify(error));
      return false;
    }
    return true;
  } catch (error) {
    console.error(`[email] FAILED to send setup request for ${req.shopDomain} (from: ${EMAIL_FROM}):`, error);
    return false;
  }
}
