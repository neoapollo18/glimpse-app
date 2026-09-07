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
