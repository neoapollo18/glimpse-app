import { useEffect, useRef, useState } from "react";
import { useFetcher, useRevalidator } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  InlineStack,
  Modal,
  Text,
} from "@shopify/polaris";
import type { StudioLoaderData, StudioActionData } from "../../routes/studio";
import type { DraftProblem } from "./draft-problems";
import { isQuestionServable } from "../../lib/option-visibility";

// The LIVE step (internal step id is still "publish"). With save-to-live
// editing there is nothing to publish: config edits are already on the
// store. This screen owns the two deliberate actions left:
//   1. the storefront surface toggle (intent=set-live), and
//   2. restoring a version from history (intent=restore, writes live).
// The checklist reframes draft-problems as "hidden from shoppers":
// getRecommendationFlow filters incomplete questions out of the storefront,
// so problems never block anything — they just don't serve.

const MODE_LABELS: Record<string, string> = {
  matrix: "Rules only",
  ai: "AI",
  hybrid: "Rules + AI",
};

export function PublishStep({
  data,
  problems,
  onFix,
}: {
  data: StudioLoaderData;
  problems: DraftProblem[];
  onFix: (slideId: string) => void;
}) {
  const fetcher = useFetcher<StudioActionData>();
  const revalidator = useRevalidator();
  const [confirmingRestore, setConfirmingRestore] = useState<string | null>(null);
  const [confirmingStartOver, setConfirmingStartOver] = useState(false);
  const processedRef = useRef<StudioActionData | null>(null);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (processedRef.current === fetcher.data) return;
    processedRef.current = fetcher.data;
    if (
      fetcher.data.ok &&
      (fetcher.data.intent === "set-live" || fetcher.data.intent === "restore" || fetcher.data.intent === "start-over")
    ) {
      setConfirmingRestore(null);
      setConfirmingStartOver(false);
      // These all change server state the loader owns.
      revalidator.revalidate();
    }
    // Errors render in the card banner, which an open modal would cover.
    if (fetcher.data && !fetcher.data.ok) setConfirmingStartOver(false);
  }, [fetcher.state, fetcher.data, revalidator]);

  const flow = data.draft?.flow;
  const settings = (data.draft?.settings ?? {}) as Record<string, unknown>;
  const questionCount = flow?.questions.length ?? 0;
  const ruleCount = flow?.rules.length ?? 0;
  const mode = String(settings.recommendation_mode ?? "matrix");
  const hasGuidance = String(settings.ai_guidance ?? "").trim() !== "";
  const logicReady = ruleCount > 0 || (mode !== "matrix" && hasGuidance);
  const surfaceOn = data.quizSurfaceEnabled !== false;
  const toggling = fetcher.state !== "idle" && fetcher.formData?.get("intent") === "set-live";
  // Same predicate the storefront serve filter uses (option-visibility.ts),
  // so "currently showing" is exactly what serves.
  const servableCount = (flow?.questions ?? []).filter((q) =>
    isQuestionServable(q as Parameters<typeof isQuestionServable>[0]),
  ).length;
  // Matrix mode with zero rules recommends from the generic fallback pool —
  // the old publish gate blocked that state; the Live toggle is its new home
  // (server-enforced in the set-live action; this mirrors it in the UI).
  const matrixWithoutRules = mode === "matrix" && ruleCount === 0;

  const setLive = (enabled: boolean) => {
    const fd = new FormData();
    fd.append("intent", "set-live");
    fd.append("enabled", String(enabled));
    fetcher.submit(fd, { method: "POST", action: "/studio" });
  };

  return (
    <div style={{ flex: 1, overflowY: "auto" }}>
      <div style={{ maxWidth: 560, margin: "0 auto", padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h3" variant="headingMd">
                Storefront
              </Text>
              <Badge tone={surfaceOn ? "success" : "info"}>{surfaceOn ? "On" : "Off"}</Badge>
            </InlineStack>
            <Text as="p" variant="bodySm" tone="subdued">
              Your edits save to {data.shopDomain} as you make them. Shoppers
              see the quiz only while it's turned on here (and the Gleame Quiz
              section is added to your theme).
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              {questionCount} {questionCount === 1 ? "question" : "questions"}
              {ruleCount > 0 ? ` · ${ruleCount} ${ruleCount === 1 ? "rule" : "rules"}` : ""} ·{" "}
              {MODE_LABELS[mode] ?? mode} matching
            </Text>
            {fetcher.data && !fetcher.data.ok && fetcher.data.error && (
              <Banner tone="critical">{fetcher.data.error}</Banner>
            )}
            <InlineStack gap="200">
              {surfaceOn ? (
                <Button loading={toggling} onClick={() => setLive(false)}>
                  Turn off for shoppers
                </Button>
              ) : (
                <Button
                  variant="primary"
                  loading={toggling}
                  disabled={questionCount === 0 || matrixWithoutRules}
                  onClick={() => setLive(true)}
                >
                  Turn on for shoppers
                </Button>
              )}
              {questionCount > 0 && (
                <Button
                  tone="critical"
                  variant="secondary"
                  disabled={surfaceOn}
                  onClick={() => setConfirmingStartOver(true)}
                >
                  Start over
                </Button>
              )}
            </InlineStack>
            {questionCount > 0 && surfaceOn && (
              <Text as="p" variant="bodySm" tone="subdued">
                To start over, turn the quiz off for shoppers first.
              </Text>
            )}
            <Modal
              open={confirmingStartOver}
              onClose={() => setConfirmingStartOver(false)}
              title="Start over from scratch?"
              primaryAction={{
                content: "Start over",
                destructive: true,
                loading: fetcher.state !== "idle" && fetcher.formData?.get("intent") === "start-over",
                onAction: () => {
                  const fd = new FormData();
                  fd.append("intent", "start-over");
                  fetcher.submit(fd, { method: "POST", action: "/studio" });
                },
              }}
              secondaryActions={[{ content: "Keep my quiz", onAction: () => setConfirmingStartOver(false) }]}
            >
              <Modal.Section>
                <Text as="p">
                  This clears every question and rule so you can generate or
                  build a fresh quiz. Your current quiz is saved to version
                  history first, so you can restore it any time. Styling and
                  copy settings are kept.
                </Text>
              </Modal.Section>
            </Modal>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="200">
            <Text as="h3" variant="headingMd">
              What shoppers see
            </Text>
            <ChecklistRow
              ok={questionCount > 0}
              label={questionCount > 0 ? "Quiz has questions" : "Quiz has no questions yet"}
            />
            {problems.length === 0 ? (
              <ChecklistRow ok label="Every question is complete and showing" />
            ) : (
              <>
                <Text as="p" variant="bodySm" tone="subdued">
                  Incomplete questions are automatically hidden from shoppers
                  until you finish them ({servableCount} of {questionCount}{" "}
                  currently showing):
                </Text>
                {problems.map((p, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ color: "#B98900" }}>!</span>
                    <span style={{ flex: 1, fontSize: 13 }}>{p.message}</span>
                    <Button size="slim" onClick={() => onFix(p.slideId)}>
                      Fix
                    </Button>
                  </div>
                ))}
              </>
            )}
            <ChecklistRow
              ok={logicReady}
              warn={!logicReady}
              label={
                logicReady
                  ? "Recommendation logic is set up"
                  : "No recommendation logic yet. Shoppers still get results, but generic ones."
              }
            />
            <ChecklistRow
              ok={data.catalog.syncEnabled}
              warn={!data.catalog.syncEnabled}
              label={data.catalog.syncEnabled ? "Catalog is synced" : "Catalog isn't synced (top bar)"}
            />
          </BlockStack>
        </Card>

        {data.versions.length > 0 && (
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingMd">
                Version history
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                A snapshot is saved automatically as you edit. Restoring makes
                that version your quiz again (what's there now is snapshotted
                first, so a restore is always reversible). The on/off switch
                above isn't affected.
              </Text>
              {data.versions
                .filter((v: any) => v != null)
                .map((v: any) => (
                  <InlineStack key={v.id} align="space-between" blockAlign="center">
                    <InlineStack gap="200" blockAlign="center">
                      <Badge tone={v.status === "published" ? "success" : "info"}>
                        {v.status === "published" ? "Published (legacy)" : "Snapshot"}
                      </Badge>
                      <Text as="span" variant="bodySm">
                        {v.label ||
                          (v.createdBy === "ai"
                            ? "Generated by Gleame"
                            : v.createdBy === "system"
                              ? "Auto-snapshot"
                              : "Saved manually")}{" "}
                        · {new Date(v.createdAt).toLocaleString()}
                      </Text>
                    </InlineStack>
                    <Button size="slim" onClick={() => setConfirmingRestore(v.id)}>
                      Restore
                    </Button>
                  </InlineStack>
                ))}
              <Modal
                open={confirmingRestore !== null}
                onClose={() => setConfirmingRestore(null)}
                title="Restore this version?"
                primaryAction={{
                  content: "Restore",
                  loading: fetcher.state !== "idle" && fetcher.formData?.get("intent") === "restore",
                  onAction: () => {
                    if (!confirmingRestore) return;
                    const fd = new FormData();
                    fd.append("intent", "restore");
                    fd.append("versionId", confirmingRestore);
                    fetcher.submit(fd, { method: "POST", action: "/studio" });
                  },
                }}
                secondaryActions={[{ content: "Cancel", onAction: () => setConfirmingRestore(null) }]}
              >
                <Modal.Section>
                  <Text as="p">
                    This version replaces your current quiz configuration.
                    Your current setup is snapshotted first, so you can restore
                    it back from this list. If the quiz is turned on, shoppers
                    see the restored version right away.
                  </Text>
                </Modal.Section>
              </Modal>
            </BlockStack>
          </Card>
        )}
      </div>
    </div>
  );
}

function ChecklistRow({ ok, warn, label }: { ok: boolean; warn?: boolean; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ color: ok ? "#008060" : warn ? "#B98900" : "#D82C0D" }}>
        {ok ? "✓" : warn ? "!" : "✕"}
      </span>
      <span style={{ fontSize: 13 }}>{label}</span>
    </div>
  );
}
