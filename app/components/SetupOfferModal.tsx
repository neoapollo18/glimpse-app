// "Want us to set it up for you?" popup. Loaders decide whether to mount
// it (lib/setup-offer.server.ts); any answer, including closing it, is
// recorded so it never comes back for that shop.

import { useState } from "react";
import { useFetcher } from "@remix-run/react";
import { Banner, BlockStack, List, Modal, Text, TextField } from "@shopify/polaris";

const ACTION = "/app/api/setup-offer";

export function SetupOfferModal({ defaultEmail, source }: { defaultEmail: string; source: string }) {
  const fetcher = useFetcher<{ ok: boolean; error?: string; requested?: boolean }>();
  const [open, setOpen] = useState(true);
  const [email, setEmail] = useState(defaultEmail);
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");

  const requested = fetcher.data?.requested === true;
  const sending = fetcher.state !== "idle";

  const close = () => {
    if (!requested && !sending) {
      fetcher.submit({ intent: "dismiss", source }, { method: "POST", action: ACTION });
    }
    setOpen(false);
  };
  const request = () => {
    fetcher.submit({ intent: "request", source, email, phone, notes }, { method: "POST", action: ACTION });
  };

  if (requested) {
    return (
      <Modal open={open} onClose={() => setOpen(false)} title="You're on the list" primaryAction={{ content: "Done", onAction: () => setOpen(false) }}>
        <Modal.Section>
          <Text as="p" variant="bodyMd">
            Thanks! We'll reach out at <b>{email}</b> to get your quiz built. Feel free to look around in the
            meantime.
          </Text>
        </Modal.Section>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Want us to set up your quiz for you?"
      primaryAction={{ content: "Set it up for me", onAction: request, loading: sending, disabled: !email.trim() }}
      secondaryActions={[{ content: "No thanks, I'll do it myself", onAction: close, disabled: sending }]}
    >
      <Modal.Section>
        <BlockStack gap="400">
          <Text as="p" variant="bodyMd">
            Our team will set up Gleame on your store for free, so you don't have to.
          </Text>
          <List>
            <List.Item>We build your quiz questions and product matches from your catalog</List.Item>
            <List.Item>We style it to fit your brand and theme</List.Item>
            <List.Item>We put it live on your store and check it works</List.Item>
          </List>
          <Text as="p" variant="bodyMd">
            Tell us where to reach you and we'll take it from there.
          </Text>
          {fetcher.data?.error && <Banner tone="critical">{fetcher.data.error}</Banner>}
          <TextField label="Email" type="email" autoComplete="email" value={email} onChange={setEmail} />
          <TextField label="Phone (optional)" type="tel" autoComplete="tel" value={phone} onChange={setPhone} />
          <TextField
            label="Anything we should know? (optional)"
            autoComplete="off"
            multiline={3}
            value={notes}
            onChange={setNotes}
            placeholder="Which products the quiz should cover, a launch date, your theme…"
          />
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
