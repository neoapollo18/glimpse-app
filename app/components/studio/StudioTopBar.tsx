import { useState } from "react";
import { Badge, Button, Popover, Box, BlockStack, Text, ProgressBar } from "@shopify/polaris";
import { useCatalogSync } from "../../lib/use-catalog-sync";
import type { StudioStep } from "../../routes/studio";

// The third step keeps the internal id "publish" (URL param, step routing)
// but is the LIVE step now: surface toggle + version history. Editing
// saves to the store directly; there is no publish action anymore.
const STEPS: Array<{ id: StudioStep; label: string }> = [
  { id: "build", label: "Build" },
  { id: "logic", label: "Check matches" },
  { id: "publish", label: "Live" },
];

export function StudioTopBar({
  step,
  onStepChange,
  hasDraft,
  problemCount,
  catalog,
  onPublishClick,
}: {
  step: StudioStep;
  onStepChange: (s: StudioStep) => void;
  hasDraft: boolean;
  problemCount: number;
  catalog: { syncEnabled: boolean; cursor: string | null; productCount: number | null };
  onPublishClick: () => void;
}) {
  const [syncOpen, setSyncOpen] = useState(false);
  const sync = useCatalogSync();

  return (
    <>
      <div className="studio-topbar-left">
        {/* Rounded tile clips the square logo mark; sized to the badge row
            so the two sit on one visual centerline. */}
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
        <Badge tone="info">{hasDraft ? "Edits save to your store" : "No quiz yet"}</Badge>
        {problemCount > 0 && (
          <button
            onClick={onPublishClick}
            style={{ border: 0, background: "transparent", padding: 0, cursor: "pointer" }}
            title="These questions are hidden from shoppers until fixed — see the Live step"
          >
            <Badge tone="critical">Hidden from shoppers</Badge>
          </button>
        )}
        {/* A persisted cursor means a sync was interrupted mid-catalog:
            syncEnabled and productCount are already set, but only a slice
            of products is in the DB — keep the chip (and its Resume-sync
            button) visible until the cursor clears. */}
        {(!catalog.syncEnabled || !catalog.productCount || catalog.cursor != null) && (
          <Popover
            active={syncOpen}
            onClose={() => setSyncOpen(false)}
            activator={
              <button
                onClick={() => setSyncOpen((v) => !v)}
                style={{ border: 0, background: "transparent", padding: 0, cursor: "pointer" }}
              >
                <Badge tone="attention">{catalog.cursor ? "Catalog sync incomplete" : "Catalog not synced"}</Badge>
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

      {/* Centered in the CANVAS column (same grid as the body), so the
          stepper, device toggle, and preview share one visual axis. */}
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
          {STEPS.map((s) => (
            <button
              key={s.id}
              className="studio-step-pill"
              data-active={step === s.id}
              onClick={() => onStepChange(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="studio-topbar-right">
        <Button variant="primary" onClick={onPublishClick}>
          Live
        </Button>
      </div>
    </>
  );
}
