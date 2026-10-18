// Done-for-you setup offer. Loaders decide whether to show it
// (lib/setup-offer.server.ts). It is a dismissible card at the bottom of the
// page, never a popup on load (Built for Shopify 4.3.3: no modal that opens
// by itself); the request form opens only from the card's button. Closing
// the card records a dismissal so it never comes back for that shop.

import { useState } from "react";
import { useFetcher } from "@remix-run/react";
import { Banner, BlockStack, Button, Card, InlineStack, Modal, Text, TextField } from "@shopify/polaris";
import { XSmallIcon } from "@shopify/polaris-icons";

const ACTION = "/app/api/setup-offer";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type OfferResponse = { ok: boolean; error?: string; requested?: boolean };

export function SetupOfferCard({ defaultEmail, source }: { defaultEmail: string; source: string }) {
  const fetcher = useFetcher<OfferResponse>();
  const [hidden, setHidden] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const requested = fetcher.data?.requested === true;

  const dismiss = () => {
    if (!requested) fetcher.submit({ intent: "dismiss", source }, { method: "POST", action: ACTION });
    setHidden(true);
  };

  if (hidden) return null;
  return (
    <>
      <Card>
        <BlockStack gap="200">
          <InlineStack align="space-between" blockAlign="start" gap="200" wrap={false}>
            <Text as="h2" variant="headingSm">
              {requested ? "You're on the list" : "Want us to set up your quiz for you?"}
            </Text>
            <Button icon={XSmallIcon} variant="tertiary" accessibilityLabel="Dismiss" onClick={dismiss} />
          </InlineStack>
          <Text as="p" variant="bodyMd" tone="subdued">
            {requested
              ? "Thanks! We'll reach out to get your quiz built. Feel free to look around in the meantime."
              : "Our team sets up Gleame on your store for free: questions, product matches, styling and launch."}
          </Text>
          {!requested && (
            <InlineStack>
              <Button onClick={() => setModalOpen(true)}>Get free setup help</Button>
            </InlineStack>
          )}
        </BlockStack>
      </Card>
      <SetupOfferModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        fetcher={fetcher}
        defaultEmail={defaultEmail}
        source={source}
      />
    </>
  );
}

/** The request form. Closing it leaves the card in place; only the card's
 * own dismiss records a "no". */
function SetupOfferModal({
  open,
  onClose,
  fetcher,
  defaultEmail,
  source,
}: {
  open: boolean;
  onClose: () => void;
  fetcher: ReturnType<typeof useFetcher<OfferResponse>>;
  defaultEmail: string;
  source: string;
}) {
  const [email, setEmail] = useState(defaultEmail);
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);

  const requested = fetcher.data?.requested === true;
  const sending = fetcher.state !== "idle";

  const request = () => {
    // Same check the server makes, shown on the field itself.
    if (!EMAIL_RE.test(email.trim())) {
      setEmailError("Enter an email we can reach you at.");
      return;
    }
    fetcher.submit({ intent: "request", source, email, phone, notes }, { method: "POST", action: ACTION });
  };

  if (requested) {
    return (
      <Modal open={open} onClose={onClose} title="You're on the list" primaryAction={{ content: "Done", onAction: onClose }}>
        <Modal.Section>
          <Text as="p" variant="bodyMd">
            Thanks! Our setup team has your request and will email you at <b>{email}</b>. Feel free to look
            around in the meantime.
          </Text>
        </Modal.Section>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Free setup by our team"
      primaryAction={{ content: "Request free setup", onAction: request, loading: sending, disabled: !email.trim() }}
      secondaryActions={[{ content: "Not now", onAction: onClose, disabled: sending }]}
    >
      <Modal.Section>
        <BlockStack gap="400">
          <Text as="p" variant="bodyMd">
            We build your quiz from your catalog, style it to your brand and put it live on your store. Free, and
            you can keep editing it after.
          </Text>
          {fetcher.data?.error && <Banner tone="critical">{fetcher.data.error}</Banner>}
          <TextField
            label="Your email"
            helpText="Your request goes to our setup team, and we'll reply here."
            type="email"
            autoComplete="email"
            value={email}
            onChange={(v) => {
              setEmail(v);
              setEmailError(null);
            }}
            error={emailError ?? undefined}
          />
          <TextField label="Phone (optional)" type="tel" autoComplete="tel" value={phone} onChange={setPhone} />
          <TextField
            label="Anything we should know? (optional)"
            autoComplete="off"
            multiline={3}
            value={notes}
            onChange={setNotes}
            placeholder="Products to cover, a launch date…"
          />
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
