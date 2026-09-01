import { useEffect, useRef, useState } from "react";
import { useFetcher } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  InlineStack,
  Text,
} from "@shopify/polaris";
import type { StudioLoaderData, StudioActionData } from "../../routes/studio";
import type { DraftProblem } from "./draft-problems";

// The Publish step: an inline canvas panel (never a nested modal — the
// studio IS the takeover). Checklist problems link back to the offending
// slide in Build; publish itself reuses publishQuizDraft (locked, validated,
// snapshot-first).

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
  const [published, setPublished] = useState(false);
  const processedRef = useRef<StudioActionData | null>(null);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (processedRef.current === fetcher.data) return;
    processedRef.current = fetcher.data;
    if (fetcher.data.intent === "publish" && fetcher.data.ok) setPublished(true);
  }, [fetcher.state, fetcher.data]);

  const flow = data.draft?.flow;
  const settings = (data.draft?.settings ?? {}) as Record<string, unknown>;
  const questionCount = flow?.questions.length ?? 0;
  const ruleCount = flow?.rules.length ?? 0;
  const mode = String(settings.recommendation_mode ?? "matrix");
  const hasGuidance = String(settings.ai_guidance ?? "").trim() !== "";
  const logicReady = ruleCount > 0 || (mode !== "matrix" && hasGuidance);
  const lastPublished = data.versions.find((v: any) => v?.status === "published")?.publishedAt ?? null;
  const publishing = fetcher.state !== "idle" && fetcher.formData?.get("intent") === "publish";
  const blocked = problems.length > 0 || questionCount === 0 || !data.hasDraft;

  if (published) {
    return (
      <div style={{ flex: 1, overflowY: "auto" }}>
        <div style={{ maxWidth: 560, margin: "0 auto", padding: 48, textAlign: "center" }}>
          <BlockStack gap="400">
            <div style={{ fontSize: 44 }}>✓</div>
            <Text as="h2" variant="headingLg">
              Your quiz is live
            </Text>
            <Text as="p" tone="subdued">
              Shoppers see the new quiz right away. If you haven't yet, add the
              Gleame Quiz section to your theme so it has a home on your
              storefront.
            </Text>
            <InlineStack gap="300" align="center">
              <Button variant="primary" url="/app">
                Finish setup
              </Button>
              <Button onClick={() => setPublished(false)}>Keep editing</Button>
            </InlineStack>
          </BlockStack>
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflowY: "auto" }}>
      <div style={{ maxWidth: 560, margin: "0 auto", padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
        <Card>
          <BlockStack gap="200">
            <Text as="h3" variant="headingMd">
              Ready to publish
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              {questionCount} {questionCount === 1 ? "question" : "questions"}
              {ruleCount > 0 ? ` · ${ruleCount} ${ruleCount === 1 ? "rule" : "rules"}` : ""} ·{" "}
              {MODE_LABELS[mode] ?? mode} matching
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Publishing to {data.shopDomain}
              {lastPublished ? ` · last published ${new Date(lastPublished).toLocaleString()}` : ""}
            </Text>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="200">
            <Text as="h3" variant="headingMd">
              Checklist
            </Text>
            <ChecklistRow ok={questionCount > 0} label={questionCount > 0 ? "Quiz has questions" : "Quiz has no questions yet"} />
            {problems.length === 0 ? (
              <ChecklistRow ok label="Every question is complete" />
            ) : (
              problems.map((p, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ color: "#D82C0D" }}>✕</span>
                  <span style={{ flex: 1, fontSize: 13 }}>{p.message}</span>
                  <Button size="slim" onClick={() => onFix(p.slideId)}>
                    Fix
                  </Button>
                </div>
              ))
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

        <Card>
          <BlockStack gap="300">
            <Text as="p" variant="bodySm">
              This replaces your live quiz configuration for {data.shopDomain}{" "}
              with the current draft. The existing live config is archived
              first, so you can restore it from version history at any time.
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Heads up: any changes made outside the studio since this draft
              was created are replaced too.
            </Text>
            {fetcher.data && !fetcher.data.ok && fetcher.data.error && (
              <Banner tone="critical">{fetcher.data.error}</Banner>
            )}
            <InlineStack gap="200">
              <Button
                variant="primary"
                loading={publishing}
                disabled={blocked}
                onClick={() => {
                  const fd = new FormData();
                  fd.append("intent", "publish");
                  fetcher.submit(fd, { method: "POST", action: "/studio" });
                }}
              >
                Publish quiz
              </Button>
              {data.hasDraft && (
                <Button
                  tone="critical"
                  variant="secondary"
                  loading={fetcher.state !== "idle" && fetcher.formData?.get("intent") === "discard-draft"}
                  onClick={() => {
                    const fd = new FormData();
                    fd.append("intent", "discard-draft");
                    fetcher.submit(fd, { method: "POST", action: "/studio" });
                  }}
                >
                  Discard draft
                </Button>
              )}
            </InlineStack>
          </BlockStack>
        </Card>

        {data.versions.length > 0 && (
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingMd">
                Version history
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Restoring a version replaces your current draft (never your
                live quiz directly).
              </Text>
              {data.versions
                .filter((v: any) => v != null)
                .map((v: any) => (
                  <InlineStack key={v.id} align="space-between" blockAlign="center">
                    <InlineStack gap="200" blockAlign="center">
                      <Badge
                        tone={v.status === "draft" ? "attention" : v.status === "published" ? "success" : "info"}
                      >
                        {v.status === "draft" ? "Draft" : v.status === "published" ? "Published" : "Archived"}
                      </Badge>
                      <Text as="span" variant="bodySm">
                        {v.label ||
                          (v.createdBy === "ai"
                            ? "Generated by Gleame"
                            : v.createdBy === "system"
                              ? "Auto-archived at publish"
                              : "Saved manually")}{" "}
                        · {new Date(v.createdAt).toLocaleString()}
                      </Text>
                    </InlineStack>
                    {v.status !== "draft" && (
                      <Button
                        size="slim"
                        onClick={() => {
                          const fd = new FormData();
                          fd.append("intent", "restore");
                          fd.append("versionId", v.id);
                          fetcher.submit(fd, { method: "POST", action: "/studio" });
                        }}
                        loading={fetcher.state !== "idle" && fetcher.formData?.get("versionId") === v.id}
                      >
                        Restore to draft
                      </Button>
                    )}
                  </InlineStack>
                ))}
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
