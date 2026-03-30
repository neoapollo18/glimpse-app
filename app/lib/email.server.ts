import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

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
    await resend.emails.send({
      from: "Gleame <onboarding@resend.dev>",
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
  } catch (error) {
    console.error("Error sending onboarding email:", error);
  }
}
