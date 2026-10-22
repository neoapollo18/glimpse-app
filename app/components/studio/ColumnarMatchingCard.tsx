import { useEffect, useMemo, useState } from "react";
import { useFetcher } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  Checkbox,
  Collapsible,
  Divider,
  InlineStack,
  RangeSlider,
  Text,
  TextField,
} from "@shopify/polaris";
import type { StudioActionData } from "../../routes/studio";
import type { ColumnarStudioView } from "../../lib/columnar/engine.server";
import { hiddenOptionsLog } from "../../lib/columnar/pipeline";

// Columnar matching (Glamnetic recommendation logic v3): exact length,
// shape and finish from a product pool synced from one collection, with
// answer options the pool can't fill hidden in the quiz. Shown only for a
// shop whose spec exists. Saves through its own intents (save-columnar,
// sync-columnar-pool) with an explicit Save, like the Matching settings
// above: these change what every shopper is recommended.

const timeOf = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "never");

export function ColumnarMatchingCard({
  initial,
  chatBusy,
  onPreviewReload,
}: {
  initial: ColumnarStudioView;
  chatBusy: boolean;
  onPreviewReload: () => void;
}) {
  const saveFetcher = useFetcher<StudioActionData>();
  const syncFetcher = useFetcher<StudioActionData>();
  const [view, setView] = useState(initial);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [threshold, setThreshold] = useState(initial.threshold);
  const [vibes, setVibes] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(initial.vibes.map((v) => [v.id, v.enabled])),
  );
  const [collectionHandle, setCollectionHandle] = useState(initial.pool.collectionHandle ?? "");
  // Each banner sits under the control that caused it (the card is taller
  // than the panel, so a bottom banner would land off screen).
  const [message, setMessage] = useState<{
    where: "settings" | "pool";
    tone: "success" | "critical";
    text: string;
  } | null>(null);
  const [showExcluded, setShowExcluded] = useState(false);
  const [showHidden, setShowHidden] = useState(false);

  const saved = useMemo(
    () => ({ enabled: view.enabled, threshold: view.threshold, vibes: Object.fromEntries(view.vibes.map((v) => [v.id, v.enabled])) }),
    [view],
  );
  const dirty =
    enabled !== saved.enabled ||
    threshold !== saved.threshold ||
    view.vibes.some((v) => vibes[v.id] !== saved.vibes[v.id]);

  const saving = saveFetcher.state !== "idle";
  const syncing = syncFetcher.state !== "idle";
  const disabled = chatBusy || saving || syncing;

  useEffect(() => {
    const d = saveFetcher.data;
    if (saveFetcher.state !== "idle" || !d || d.intent !== "save-columnar") return;
    if (d.ok) {
      if (d.columnar) setView(d.columnar);
      setMessage({ where: "settings", tone: "success", text: d.message ?? "Saved" });
      onPreviewReload();
    } else {
      setMessage({ where: "settings", tone: "critical", text: d.error ?? "Saving failed" });
    }
    // onPreviewReload is stable enough for a once-per-response effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveFetcher.state, saveFetcher.data]);

  useEffect(() => {
    const d = syncFetcher.data;
    if (syncFetcher.state !== "idle" || !d || d.intent !== "sync-columnar-pool") return;
    if (d.ok) {
      if (d.columnar) setView((prev) => ({ ...d.columnar!, enabled: prev.enabled, threshold: prev.threshold, vibes: prev.vibes }));
      setMessage({ where: "pool", tone: "success", text: d.message ?? "Pool synced" });
      onPreviewReload();
    } else {
      setMessage({ where: "pool", tone: "critical", text: d.error ?? "Sync failed" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncFetcher.state, syncFetcher.data]);

  const save = () => {
    const patch: Record<string, unknown> = {};
    if (enabled !== saved.enabled) patch.enabled = enabled;
    if (threshold !== saved.threshold) patch.threshold = threshold;
    const changedVibes = Object.fromEntries(view.vibes.filter((v) => vibes[v.id] !== saved.vibes[v.id]).map((v) => [v.id, vibes[v.id]]));
    if (Object.keys(changedVibes).length) patch.vibes = changedVibes;
    if (Object.keys(patch).length === 0) return;
    setMessage(null);
    const fd = new FormData();
    fd.append("intent", "save-columnar");
    fd.append("patch", JSON.stringify(patch));
    saveFetcher.submit(fd, { method: "POST", action: "/studio" });
  };

  const sync = () => {
    setMessage(null);
    const fd = new FormData();
    fd.append("intent", "sync-columnar-pool");
    fd.append("collectionHandle", collectionHandle.trim());
    syncFetcher.submit(fd, { method: "POST", action: "/studio" });
  };

  // Recomputed from the pool rows as the slider moves, so the merchant sees
  // what a threshold hides before saving it.
  const hidden = useMemo(
    () => hiddenOptionsLog({ axes: view.axes, threshold }, view.rows),
    [view.axes, view.rows, threshold],
  );
  const label = (id: string) => view.labels[id] ?? id;
  const hiddenCount = hidden.reduce((n, e) => n + e.hidden.length, 0);
  const pool = view.pool;
  // The server refuses to switch on with nothing matchable; say why here
  // instead of offering a toggle that can't save.
  const nothingToMatch = !view.enabled && pool.eligibleCount === 0;
  const banner = (where: "settings" | "pool") =>
    message?.where === where ? (
      <Banner tone={message.tone} onDismiss={() => setMessage(null)}>
        {message.text}
      </Banner>
    ) : null;

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h3" variant="headingSm">
            Columnar matching
          </Text>
          <Badge tone={view.enabled ? "success" : undefined}>{view.enabled ? "On" : "Off"}</Badge>
        </InlineStack>
        <Text as="p" variant="bodySm" tone="subdued">
          Every match has exactly the length, shape and finish the shopper picked and one of their colors, from your
          product pool. Vibe and drama decide the order. While on, this replaces the ranking above.
        </Text>
        {view.error && (
          <Banner tone="critical">The product pool couldn&rsquo;t be loaded: {view.error}</Banner>
        )}
        <Checkbox
          label="Use columnar matching"
          checked={enabled}
          onChange={(v) => {
            setEnabled(v);
            setMessage(null);
          }}
          disabled={disabled || !view.configured || nothingToMatch}
          helpText={nothingToMatch ? "Sync a pool with products that can be matched first." : undefined}
        />
        <RangeSlider
          label={`Hide answer options with fewer than ${threshold} sets`}
          value={threshold}
          min={1}
          max={20}
          step={1}
          output
          onChange={(v) => {
            setThreshold(v as number);
            setMessage(null);
          }}
          disabled={disabled}
          helpText={`Length, shape and finish options. Every option also needs ${view.fullMatchMin ?? 3} sets that match all of the shopper's answers. A question left with one option or none is skipped.`}
        />
        {view.vibes.length > 0 && (
          <BlockStack gap="100">
            <Text as="p" variant="bodySm" fontWeight="semibold">
              Vibe tiles
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Turn a tile off to retire it, for example a holiday vibe once its collection sells through.
            </Text>
            {view.vibes.map((v) => (
              <Checkbox
                key={v.id}
                label={v.label}
                checked={vibes[v.id] !== false}
                onChange={(on) => {
                  setVibes((prev) => ({ ...prev, [v.id]: on }));
                  setMessage(null);
                }}
                disabled={disabled}
              />
            ))}
          </BlockStack>
        )}
        {dirty && (
          <InlineStack align="end">
            <Button variant="primary" loading={saving} disabled={chatBusy || syncing} onClick={save}>
              Save columnar matching
            </Button>
          </InlineStack>
        )}
        {banner("settings")}

        <Divider />
        <BlockStack gap="200">
          <Text as="p" variant="bodySm" fontWeight="semibold">
            Product pool
          </Text>
          <Text as="p" variant="bodySm">
            {pool.source === "collection" && pool.collectionHandle
              ? `Collection ${pool.collectionHandle}`
              : "Imported list"}{" "}
            · {pool.handleCount} products · {pool.eligibleCount} can be matched
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            Last synced {timeOf(pool.syncedAt)}
          </Text>
          <TextField
            label="Collection handle"
            value={collectionHandle}
            onChange={setCollectionHandle}
            autoComplete="off"
            disabled={disabled}
            placeholder="shop-all-nails"
            helpText={
              pool.source === "collection"
                ? "Studio refreshes the pool from this collection when it's over an hour old."
                : "Syncing switches the pool from the imported list to this collection."
            }
          />
          <InlineStack>
            <Button onClick={sync} loading={syncing} disabled={chatBusy || saving || !collectionHandle.trim()}>
              Sync from collection
            </Button>
          </InlineStack>
          {banner("pool")}
          {pool.excluded.length > 0 && (
            <BlockStack gap="100">
              <InlineStack>
                <Button variant="plain" disclosure={showExcluded ? "up" : "down"} onClick={() => setShowExcluded((s) => !s)}>
                  {`${pool.excluded.length} product${pool.excluded.length === 1 ? "" : "s"} can't be matched`}
                </Button>
              </InlineStack>
              <Collapsible open={showExcluded} id="columnar-excluded">
                <BlockStack gap="100">
                  {pool.excluded.map((e) => (
                    <Text as="p" variant="bodySm" key={e.handle} breakWord>
                      <Text as="span" variant="bodySm" fontWeight="medium">
                        {e.title}
                      </Text>{" "}
                      <Text as="span" variant="bodySm" tone="subdued">
                        {e.reasons.join(", ")}
                      </Text>
                    </Text>
                  ))}
                </BlockStack>
              </Collapsible>
            </BlockStack>
          )}
        </BlockStack>

        {view.rows.length > 0 && (
          <>
            <Divider />
            <BlockStack gap="100">
              <InlineStack>
                <Button variant="plain" disclosure={showHidden ? "up" : "down"} onClick={() => setShowHidden((s) => !s)}>
                  {`Hidden answer options (${hiddenCount})`}
                </Button>
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">
                What shoppers won&rsquo;t see on each length path at this threshold, with how many sets each has.
              </Text>
              <Collapsible open={showHidden} id="columnar-hidden">
                <BlockStack gap="150">
                  {hidden.map((e) => (
                    <BlockStack gap="0" key={`${e.path.join(">")}:${e.question}`}>
                      <Text as="p" variant="bodySm" fontWeight="medium">
                        {e.path.map(label).join(" · ")} · {e.question === "shape" ? "Shape" : "Finish"}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {e.hidden.length
                          ? e.hidden.map((h) => `${label(h.id)} (${h.count})`).join(", ")
                          : "Nothing hidden"}
                        {e.skipped ? (e.autoAnswer ? `. Skipped, answered ${label(e.autoAnswer)}` : ". Question skipped") : ""}
                      </Text>
                    </BlockStack>
                  ))}
                </BlockStack>
              </Collapsible>
            </BlockStack>
          </>
        )}
      </BlockStack>
    </Card>
  );
}
