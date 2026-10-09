import { useEffect, useState } from "react";
import { Badge, Banner, BlockStack, Button, Checkbox, InlineStack, Select, Text, TextField } from "@shopify/polaris";
import type { StudioActionData } from "../../routes/studio";
import type { IntegrationStatus } from "../../lib/integrations.server";
import { postStudioAction } from "./studio-data";

// Studio "Integrations" (migration 086). Klaviyo first: quiz leads join a
// list, and two metrics land on the profile for flows ("Gleame Quiz Lead",
// "Gleame Quiz Results"). The key is sent once, encrypted server-side, and
// never comes back to the browser (only its last 4 characters).

type KList = { id: string; name: string; optInProcess: string | null };

async function post(fields: Record<string, string>): Promise<StudioActionData | null> {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const res = await postStudioAction(fd);
  return (await res.json().catch(() => null)) as StudioActionData | null;
}

export function IntegrationsEditor({
  status: initialStatus,
  leadEnabled,
  collectPhone,
  onOpenLead,
}: {
  status: IntegrationStatus | null;
  leadEnabled: boolean;
  collectPhone: boolean;
  onOpenLead: () => void;
}) {
  const [status, setStatus] = useState<IntegrationStatus | null>(initialStatus);
  const [lists, setLists] = useState<KList[] | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const connected = Boolean(status?.connected);

  // Lists for the picker once connected (the key never leaves the server).
  useEffect(() => {
    if (!connected || lists) return;
    let cancelled = false;
    void post({ intent: "klaviyo-lists" }).then((body) => {
      if (cancelled) return;
      if (body?.ok && body.klaviyoLists) setLists(body.klaviyoLists);
      else if (body?.error) setError(body.error);
    });
    return () => {
      cancelled = true;
    };
  }, [connected, lists]);

  const run = async (label: string, fields: Record<string, string>, ok?: (b: StudioActionData) => void) => {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      const body = await post(fields);
      if (!body?.ok) {
        setError(body?.error ?? "Something went wrong");
        return;
      }
      if (body.klaviyo) setStatus(body.klaviyo);
      if (body.klaviyoLists) setLists(body.klaviyoLists);
      ok?.(body);
    } finally {
      setBusy(null);
    }
  };

  const saveSettings = (patch: { enabled?: boolean; settings?: Record<string, unknown> }) =>
    run("save", { intent: "klaviyo-save", patch: JSON.stringify(patch) });

  if (!status) {
    return (
      <BlockStack gap="300">
        <Text as="h3" variant="headingMd">
          Integrations
        </Text>
        <Banner tone="warning">Integrations are still being set up on our side. Try again in a few minutes.</Banner>
      </BlockStack>
    );
  }

  const selectedList = lists?.find((l) => l.id === status.settings.listId) ?? null;

  return (
    <BlockStack gap="400">
      <Text as="h3" variant="headingMd">
        Integrations
      </Text>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h4" variant="headingSm">
            Klaviyo
          </Text>
          {connected ? (
            <Badge tone={status.enabled ? "success" : undefined}>{status.enabled ? "Connected" : "Paused"}</Badge>
          ) : (
            <Badge>Not connected</Badge>
          )}
        </InlineStack>
        <Text as="p" variant="bodySm" tone="subdued">
          Send quiz emails straight to a Klaviyo list, with the shopper&rsquo;s answers and matches on their profile,
          so your flows can follow up with the exact products the quiz picked.
        </Text>
        {!leadEnabled && (
          <Banner tone="info">
            <BlockStack gap="100">
              <Text as="p">Klaviyo receives the emails your quiz collects. Email capture is off right now.</Text>
              <div>
                <Button variant="plain" onClick={onOpenLead}>
                  Open Email capture
                </Button>
              </div>
            </BlockStack>
          </Banner>
        )}
        {error && (
          <Banner tone="critical" onDismiss={() => setError(null)}>
            {error}
          </Banner>
        )}
        {notice && (
          <Banner tone="success" onDismiss={() => setNotice(null)}>
            {notice}
          </Banner>
        )}

        {!connected && (
          <BlockStack gap="200">
            {!status.encryptionReady && (
              <Banner tone="warning">Klaviyo connections aren&rsquo;t switched on for this installation yet.</Banner>
            )}
            <TextField
              label="Klaviyo private API key"
              type="password"
              value={apiKey}
              onChange={setApiKey}
              autoComplete="off"
              placeholder="pk_…"
              disabled={!status.encryptionReady || !status.available}
              helpText="In Klaviyo: Settings → Account → API keys → Create Private API Key. Give it Lists, Profiles, Subscriptions and Events access (full access or custom)."
            />
            <InlineStack align="end">
              <Button
                variant="primary"
                loading={busy === "connect"}
                disabled={!apiKey.trim() || !status.encryptionReady || !status.available}
                onClick={() =>
                  void run("connect", { intent: "klaviyo-connect", apiKey: apiKey.trim() }, () => {
                    setApiKey("");
                    setNotice("Klaviyo connected. Pick the list quiz signups should join.");
                  })
                }
              >
                Connect Klaviyo
              </Button>
            </InlineStack>
          </BlockStack>
        )}

        {connected && (
          <BlockStack gap="300">
            <Text as="p" variant="bodySm" tone="subdued">
              Key ending in <strong>{status.keyHint ?? "????"}</strong>
            </Text>
            <Select
              label="Add quiz signups to"
              options={[
                { label: lists ? "Choose a list…" : "Loading lists…", value: "" },
                ...(lists ?? []).map((l) => ({
                  label: l.optInProcess === "double_opt_in" ? `${l.name} (double opt-in)` : l.name,
                  value: l.id,
                })),
              ]}
              value={status.settings.listId ?? ""}
              disabled={!lists || busy !== null}
              onChange={(listId) => {
                const list = lists?.find((l) => l.id === listId);
                void saveSettings({ settings: { listId: listId || null, listName: list?.name ?? null } });
              }}
              helpText={
                !selectedList
                  ? "Without a list, Gleame still records the quiz events on each profile but doesn't subscribe anyone."
                  : selectedList.optInProcess === "double_opt_in"
                    ? "Double opt-in: Klaviyo emails a confirmation before they count as subscribed."
                    : "We recommend a double opt-in list: anyone can type any address into a public form, and double opt-in has the owner confirm. People who unsubscribed are never re-subscribed either way."
              }
            />
            <Checkbox
              label="Send quiz leads (subscribe + “Gleame Quiz Lead” event)"
              checked={status.settings.sendLeads}
              disabled={busy !== null}
              onChange={(v) => void saveSettings({ settings: { sendLeads: v } })}
            />
            <Checkbox
              label="Send their matches (“Gleame Quiz Results” event)"
              checked={status.settings.sendResults}
              disabled={busy !== null}
              onChange={(v) => void saveSettings({ settings: { sendResults: v } })}
              helpText="Includes product names, links, images and prices. Use it to trigger a “your matches” email flow."
            />
            {collectPhone && (
              <Checkbox
                label="Also subscribe phone numbers to SMS"
                checked={status.settings.smsConsent}
                disabled={busy !== null}
                onChange={(v) => void saveSettings({ settings: { smsConsent: v } })}
                helpText="Only turn this on if your Email capture consent note covers text messages, and SMS is set up in Klaviyo."
              />
            )}
            {status.lastError && (
              <Banner tone="warning" title="Last sync problem">
                <Text as="p" variant="bodySm">
                  {status.lastError}
                </Text>
              </Banner>
            )}
            {status.lastSuccessAt && !status.lastError && (
              <Text as="p" variant="bodySm" tone="subdued">
                Last sent {new Date(status.lastSuccessAt).toLocaleString()}
              </Text>
            )}
            <InlineStack align="space-between">
              <Button
                variant="plain"
                onClick={() => void saveSettings({ enabled: !status.enabled })}
                disabled={busy !== null}
              >
                {status.enabled ? "Pause sending" : "Resume sending"}
              </Button>
              <Button
                variant="plain"
                tone="critical"
                loading={busy === "disconnect"}
                onClick={() =>
                  void run("disconnect", { intent: "klaviyo-disconnect" }, () => {
                    setLists(null);
                    setNotice("Klaviyo disconnected. The key was deleted from Gleame.");
                  })
                }
              >
                Disconnect
              </Button>
            </InlineStack>
          </BlockStack>
        )}
      </BlockStack>
    </BlockStack>
  );
}
