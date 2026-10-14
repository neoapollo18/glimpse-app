// Answers to the done-for-you setup popup (components/SetupOfferModal).

import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { getSetupOfferContact, recordSetupOffer } from "../lib/setup-offer.server";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const field = (form: FormData, name: string, max: number) => String(form.get(name) ?? "").trim().slice(0, max);

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = form.get("intent");
  const source = field(form, "source", 40);

  if (intent === "dismiss") {
    await recordSetupOffer(session.shop, "setup_offer_dismissed", { source });
    return json({ ok: true });
  }
  if (intent !== "request") {
    return json({ ok: false, error: "Unknown intent" }, { status: 400 });
  }

  const email = field(form, "email", 200);
  if (!EMAIL_RE.test(email)) {
    return json({ ok: false, error: "Enter an email we can reach you at." }, { status: 400 });
  }
  const contact = await getSetupOfferContact(admin);
  const result = await recordSetupOffer(session.shop, "setup_offer_requested", {
    email,
    phone: field(form, "phone", 40),
    notes: field(form, "notes", 1000),
    shopName: contact.shopName,
    ownerName: contact.ownerName,
    source,
  });
  if (!result.ok) return json({ ok: false, error: result.error }, { status: 500 });
  return json({ ok: true, requested: true });
};
