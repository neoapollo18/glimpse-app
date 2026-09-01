import { useState } from "react";
import { Badge, Button, Popover, Box, BlockStack, Text, ProgressBar } from "@shopify/polaris";
import { useCatalogSync } from "../../lib/use-catalog-sync";
import type { StudioStep } from "../../routes/studio";

const STEPS: Array<{ id: StudioStep; label: string }> = [
  { id: "build", label: "Build" },
  { id: "logic", label: "Logic" },
  { id: "publish", label: "Publish" },
];

export function StudioTopBar({
  step,
  onStepChange,
  hasDraft,
  publishing,
  problemCount,
  catalog,
  onPublishClick,
}: {
  step: StudioStep;
  onStepChange: (s: StudioStep) => void;
  hasDraft: boolean;
  publishing?: boolean;
  problemCount: number;
  catalog: { syncEnabled: boolean; cursor: string | null; productCount: number | null };
  onPublishClick: () => void;
}) {
  const [syncOpen, setSyncOpen] = useState(false);
  const sync = useCatalogSync();

  return (
    <>
      <div className="studio-topbar-left">
        {publishing ? (
          <Badge tone="attention">Publishing…</Badge>
        ) : (
          <Badge tone={hasDraft ? "attention" : "info"}>{hasDraft ? "Draft in progress" : "No draft"}</Badge>
        )}
        {problemCount > 0 && (
          <button
            onClick={onPublishClick}
            style={{ border: 0, background: "transparent", padding: 0, cursor: "pointer" }}
            title="See what needs fixing on the Publish step"
          >
            <Badge tone="critical">Needs attention</Badge>
          </button>
        )}
        {!catalog.syncEnabled && (
          <Popover
            active={syncOpen}
            onClose={() => setSyncOpen(false)}
            activator={
              <button
                onClick={() => setSyncOpen((v) => !v)}
                style={{ border: 0, background: "transparent", padding: 0, cursor: "pointer" }}
              >
                <Badge tone="attention">Catalog not synced</Badge>
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
        <Button variant="plain" url="/app/assistant/quiz">
          Design &amp; text
        </Button>
        <Button variant="primary" onClick={onPublishClick}>
          Publish
        </Button>
      </div>
    </>
  );
}
