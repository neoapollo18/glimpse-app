import { useEffect, useState } from "react";
import { Badge, Button, Popover, Box, BlockStack, Text, ProgressBar } from "@shopify/polaris";
import { useCatalogSync } from "../../lib/use-catalog-sync";
import type { StudioTab } from "../../routes/studio";

// V2-SPEC 2.1 top bar (56px): inline-editable quiz name left; centered
// segmented tabs Build / Check matches / Live; right side "View on my
// store" (secondary) + "Publish" (primary, opens the publish sheet).

const TABS: Array<{ id: StudioTab; label: string }> = [
  { id: "build", label: "Build" },
  { id: "matches", label: "Check matches" },
  { id: "live", label: "Live" },
];

export function StudioTopBar({
  tab,
  onTabChange,
  quizName,
  onQuizNameChange,
  hasDraft,
  problemCount,
  catalog,
  onViewStore,
  viewStoreBusy,
  onPublishClick,
}: {
  tab: StudioTab;
  onTabChange: (t: StudioTab) => void;
  quizName: string;
  onQuizNameChange: (name: string) => void;
  hasDraft: boolean;
  problemCount: number;
  catalog: { syncEnabled: boolean; cursor: string | null; productCount: number | null };
  onViewStore: () => void;
  viewStoreBusy: boolean;
  onPublishClick: () => void;
}) {
  const [syncOpen, setSyncOpen] = useState(false);
  const sync = useCatalogSync();
  // Local edit buffer so typing never round-trips through a revalidation;
  // committed on blur/Enter. External changes (chat rename) re-seed it.
  const [name, setName] = useState(quizName);
  useEffect(() => setName(quizName), [quizName]);
  const commit = () => {
    const next = name.trim();
    if (next && next !== quizName) onQuizNameChange(next);
    else setName(quizName);
  };

  return (
    <>
      <div className="studio-topbar-left">
        <span
          aria-hidden
          style={{
            width: 22,
            height: 22,
            borderRadius: 6,
            overflow: "hidden",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <img
            src="/placeholders/gleametransparent.svg"
            alt=""
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        </span>
        {/* One quiz per shop, so the "quiz name" IS the quiz headline the
            storefront shows; there is no separate name column. */}
        <input
          aria-label="Quiz name"
          value={name}
          disabled={!hasDraft}
          onChange={(e) => setName(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setName(quizName);
          }}
          style={{
            border: "1px solid transparent",
            borderRadius: 8,
            padding: "5px 8px",
            fontSize: 13.5,
            fontWeight: 600,
            minWidth: 0,
            flex: 1,
            background: "transparent",
            color: "#202223",
          }}
          onFocus={(e) => (e.target.style.borderColor = "#C9CCCF")}
          onBlurCapture={(e) => (e.target.style.borderColor = "transparent")}
        />
        {problemCount > 0 && (
          <button
            onClick={() => onTabChange("live")}
            style={{ border: 0, background: "transparent", padding: 0, cursor: "pointer", flexShrink: 0 }}
            title="These questions are hidden from shoppers until fixed. See the Live tab."
          >
            <Badge tone="critical">Hidden</Badge>
          </button>
        )}
        {/* A persisted cursor means a sync was interrupted mid-catalog:
            keep the chip (and its Resume-sync button) until it clears. */}
        {(!catalog.syncEnabled || !catalog.productCount || catalog.cursor != null) && (
          <Popover
            active={syncOpen}
            onClose={() => setSyncOpen(false)}
            activator={
              <button
                onClick={() => setSyncOpen((v) => !v)}
                style={{ border: 0, background: "transparent", padding: 0, cursor: "pointer", flexShrink: 0 }}
              >
                <Badge tone="attention">{catalog.cursor ? "Sync incomplete" : "Catalog not synced"}</Badge>
              </button>
            }
          >
            <Box padding="300" width="280px">
              <BlockStack gap="200">
                <Text as="p" variant="bodySm">
                  Gleame builds quizzes and recommendations from your real
                  products. Existing product configuration is never
                  overwritten.
                </Text>
                {sync.progress ? (
                  <BlockStack gap="100">
                    <ProgressBar
                      progress={
                        sync.progress.total
                          ? Math.round((sync.progress.done / sync.progress.total) * 100)
                          : 10
                      }
                      size="small"
                    />
                    <Text as="p" variant="bodySm" tone="subdued">
                      Synced {sync.progress.done}
                      {sync.progress.total ? ` of ${sync.progress.total}` : ""} products…
                    </Text>
                  </BlockStack>
                ) : (
                  <Button
                    variant="primary"
                    size="slim"
                    loading={sync.busy}
                    onClick={() => sync.start(catalog.cursor ?? undefined)}
                  >
                    {catalog.cursor ? "Resume sync" : "Sync catalog"}
                  </Button>
                )}
                {sync.syncError && (
                  <Text as="p" variant="bodySm" tone="critical">
                    {sync.syncError}
                  </Text>
                )}
              </BlockStack>
            </Box>
          </Popover>
        )}
      </div>

      <div className="studio-topbar-center">
        <div
          style={{
            display: "flex",
            gap: 4,
            background: "#F6F6F7",
            borderRadius: 999,
            padding: 4,
          }}
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              className="studio-step-pill"
              data-active={tab === t.id}
              onClick={() => onTabChange(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="studio-topbar-right">
        <Button onClick={onViewStore} loading={viewStoreBusy} disabled={!hasDraft}>
          View on my store
        </Button>
        <Button variant="primary" onClick={onPublishClick}>
          Publish
        </Button>
      </div>
    </>
  );
}
