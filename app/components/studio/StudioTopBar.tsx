import { useEffect, useState } from "react";
import { Badge, Button, Popover, Box, BlockStack, Text, ProgressBar, Tooltip } from "@shopify/polaris";
import { useCatalogSync } from "../../lib/use-catalog-sync";
import type { StudioTab } from "../../routes/studio";

// V2-SPEC 2.1 top bar (56px): inline-editable quiz name left; centered
// segmented tabs Build / Check matches / Live; right side "View on my
// store" (secondary) + "Publish" (primary, opens the publish sheet).
//
// V3-SPEC 6.4: while the QUIZ_TEMPLATES_LIVE=off emergency kill is set, a
// template quiz cannot reach the storefront, so "View on my store" is
// hidden and a grey `Preview only` chip sits next to the quiz name.
// Otherwise templates go live per shop through Publish (migration 081).
// Legacy shops unchanged.
// V3-SPEC Part 1: no manual sync button exists; the only affordance left
// is resuming a sync that was interrupted mid-catalog.

const PREVIEW_ONLY_TIP =
  "Template quizzes are paused on storefronts right now. While paused, shoppers see the classic quiz layout.";

const TEMPLATE_PENDING_TIP =
  "Your quiz is on, but shoppers still see your previous quiz layout. Open the Live tab to put this template live.";

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
  previewOnly,
  templatePending,
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
  /** Template quiz while the QUIZ_TEMPLATES_LIVE=off kill is set (spec 6.4). */
  previewOnly?: boolean;
  /** Template quiz that is on but not put live yet: the canvas shows the
   * template while shoppers get the classic layout (spec 6.4). */
  templatePending?: boolean;
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
        {previewOnly && (
          <span style={{ flexShrink: 0 }}>
            <Tooltip content={PREVIEW_ONLY_TIP}>
              <Badge tone="new">Preview only</Badge>
            </Tooltip>
          </span>
        )}
        {!previewOnly && templatePending && (
          <button
            onClick={() => onTabChange("live")}
            style={{ border: 0, background: "transparent", padding: 0, cursor: "pointer", flexShrink: 0 }}
          >
            <Tooltip content={TEMPLATE_PENDING_TIP}>
              <Badge tone="attention">Template not live</Badge>
            </Tooltip>
          </button>
        )}
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
            the one place a merchant can nudge indexing along. Sync itself
            runs at install; there is no manual sync button. */}
        {catalog.cursor != null ? (
          <Popover
            active={syncOpen}
            onClose={() => setSyncOpen(false)}
            activator={
              <button
                onClick={() => setSyncOpen((v) => !v)}
                style={{ border: 0, background: "transparent", padding: 0, cursor: "pointer", flexShrink: 0 }}
              >
                <Badge tone="attention">Sync incomplete</Badge>
              </button>
            }
          >
            <Box padding="300" width="280px">
              <BlockStack gap="200">
                <Text as="p" variant="bodySm">
                  Your catalog sync stopped partway. Resume to finish indexing
                  the rest of your products; nothing already configured is
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
                    Resume
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
        ) : (
          (!catalog.syncEnabled || !catalog.productCount) && (
            <span style={{ flexShrink: 0 }}>
              <Tooltip content="Gleame indexes your catalog automatically after install. Check back shortly.">
                <Badge tone="attention">Catalog not synced</Badge>
              </Tooltip>
            </span>
          )
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
        {!previewOnly && (
          <Button onClick={onViewStore} loading={viewStoreBusy} disabled={!hasDraft}>
            View on my store
          </Button>
        )}
        {/* Spec 6.4: while templates aren't live on storefronts the publish
            action is hidden for template quizzes (the Preview only chip
            explains); legacy quizzes keep publishing. */}
        {!previewOnly && (
          <Button variant="primary" onClick={onPublishClick}>
            Publish
          </Button>
        )}
      </div>
    </>
  );
}
