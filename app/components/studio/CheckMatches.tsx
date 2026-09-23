// Check the matches (Overhaul Part 5 / E2) — spot-checking replaces the
// fill-in-the-blanks Logic flow. Left: pick an answer path. Right: the
// live results for that path, each with a one-line "why" naming the rule
// that fired, and Pin / Boost / Exclude writing the existing rules
// format through the normal locked save (version history = undo). The
// old guidance editors survive underneath as "Advanced: edit matching
// notes" — present for power users, demanded of no one.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Banner, BlockStack, Button, Card, InlineStack, Text } from "@shopify/polaris";
import type { StudioLoaderData } from "../../routes/studio";
import type { StudioFlow } from "./types";

interface MatchRow {
  productId: string;
  name: string;
  variantTitle: string | null;
  imageUrl: string | null;
  price: number | null;
  why: string[];
  quantity: number;
}

export function CheckMatches({
  data,
  chatBusy,
  advanced,
}: {
  data: StudioLoaderData;
  chatBusy: boolean;
  advanced?: React.ReactNode;
}) {
  const flow = (data.draft?.flow ?? { axes: [], questions: [], rules: [] }) as StudioFlow;
  const axisByKey = useMemo(
    () => new Map((flow.axes ?? []).map((a: any) => [a.key, a])),
    [flow.axes]
  );
  const questions = (flow.questions ?? []).filter((q: any) => (q.prompt ?? "").trim() !== "");

  const [criteria, setCriteria] = useState<Record<string, string>>({});
  const [state, setState] = useState<{
    loading: boolean;
    mode: string | null;
    matches: MatchRow[];
    unmapped: Array<{ productId: string; name: string }>;
    unmappedTotal: number;
    priority: string[];
    error: string | null;
  }>({ loading: false, mode: null, matches: [], unmapped: [], unmappedTotal: 0, priority: [], error: null });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const reqSeq = useRef(0);

  const refresh = useCallback(
    async (c: Record<string, string>) => {
      const seq = ++reqSeq.current;
      setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const res = await fetch("/app/api/match-check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ criteria: c }),
        });
        const body = await res.json();
        if (seq !== reqSeq.current) return;
        if (!body.ok) throw new Error(body.error ?? "Check failed");
        setState({
          loading: false,
          mode: body.mode,
          matches: body.matches,
          unmapped: body.unmapped,
          unmappedTotal: body.unmappedTotal,
          priority: body.priorityProductIds ?? [],
          error: null,
        });
      } catch (e) {
        if (seq !== reqSeq.current) return;
        setState((s) => ({ ...s, loading: false, error: (e as Error).message }));
      }
    },
    []
  );

  useEffect(() => {
    void refresh(criteria);
  }, [criteria, refresh]);

  const act = useCallback(
    async (action: "pin" | "boost" | "exclude", productId: string) => {
      const res = await fetch("/app/api/match-actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, productId, criteria }),
      });
      const body = await res.json();
      if (body.ok) {
        setToast(
          action === "pin"
            ? "Pinned for this path — undo any time from version history."
            : action === "boost"
              ? "Boosted everywhere."
              : "Removed for this path. AI-ranked picks may still surface it."
        );
        void refresh(criteria);
      } else {
        setToast(body.error ?? "That didn't save");
      }
      setTimeout(() => setToast(null), 4000);
    },
    [criteria, refresh]
  );

  const money = (n: number | null) => (n == null ? "" : `$${Number(n).toFixed(2)}`);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 380px) 1fr", gap: 20, padding: 20, alignItems: "start" }}>
      <Card>
        <BlockStack gap="300">
          <Text as="h3" variant="headingMd">
            Play through and tell us if the matches look right
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            Pick answers; the results update live. Pin, boost or exclude straight from the cards.
          </Text>
          {questions.map((q: any) => {
            const axis = axisByKey.get(q.axisKey) as any;
            return (
              <BlockStack key={q.axisKey} gap="100">
                <Text as="p" variant="bodySm" fontWeight="semibold">
                  {q.prompt}
                </Text>
                <InlineStack gap="100" wrap>
                  {(axis?.values ?? []).map((v: any) => {
                    const on = criteria[q.axisKey] === v.value;
                    return (
                      <button
                        key={v.value}
                        type="button"
                        disabled={chatBusy}
                        onClick={() =>
                          setCriteria((prev) => {
                            const next = { ...prev };
                            if (on) delete next[q.axisKey];
                            else next[q.axisKey] = v.value;
                            return next;
                          })
                        }
                        style={{
                          border: on ? "1px solid #1a1a1a" : "1px solid #E1E3E5",
                          background: on ? "#F1F1F1" : "#fff",
                          borderRadius: 999,
                          padding: "4px 12px",
                          fontSize: 12,
                          fontWeight: on ? 600 : 400,
                          cursor: "pointer",
                        }}
                      >
                        {v.label}
                      </button>
                    );
                  })}
                </InlineStack>
              </BlockStack>
            );
          })}
          {questions.length === 0 && (
            <Banner tone="info">No questions yet — build the quiz first.</Banner>
          )}
        </BlockStack>
      </Card>

      <BlockStack gap="300">
        {toast && <Banner onDismiss={() => setToast(null)}>{toast}</Banner>}
        {state.error && <Banner tone="critical">{state.error}</Banner>}
        {state.mode === "ai" && state.matches.length === 0 && (
          <Banner tone="info">
            This quiz ranks with AI at serve time, so exact picks depend on the whole answer set.
            Curate here — Pin and Boost still apply — and spot-check end results on the store
            preview.
          </Banner>
        )}
        {state.matches.map((m) => (
          <Card key={m.productId}>
            <InlineStack gap="400" blockAlign="center" wrap={false}>
              {m.imageUrl ? (
                <img
                  src={m.imageUrl}
                  alt=""
                  style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 8, flexShrink: 0 }}
                />
              ) : (
                <div style={{ width: 56, height: 56, borderRadius: 8, background: "#f1f1f1", flexShrink: 0 }} />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <Text as="p" variant="bodyMd" fontWeight="semibold">
                  {m.name}
                  {m.variantTitle ? ` · ${m.variantTitle}` : ""}
                  {m.quantity > 1 ? ` × ${m.quantity}` : ""}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {money(m.price)}
                  {m.why.length ? ` — Why: matched ${m.why.join(", ")}` : ""}
                  {state.priority.includes(m.productId) ? " · Boosted" : ""}
                </Text>
              </div>
              <InlineStack gap="100">
                <Button size="slim" onClick={() => act("pin", m.productId)} disabled={chatBusy}>
                  Pin
                </Button>
                <Button size="slim" onClick={() => act("boost", m.productId)} disabled={chatBusy}>
                  Boost
                </Button>
                <Button size="slim" tone="critical" variant="plain" onClick={() => act("exclude", m.productId)} disabled={chatBusy}>
                  Exclude
                </Button>
              </InlineStack>
            </InlineStack>
          </Card>
        ))}
        {!state.loading && state.matches.length === 0 && state.mode && state.mode !== "ai" && (
          <Banner tone="warning">
            No rule fires for this path yet — shoppers here get the fallback ordering. Pin a
            product below to curate it.
          </Banner>
        )}

        {state.unmappedTotal > 0 && (
          <Card>
            <BlockStack gap="200">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h4" variant="headingSm">
                  {state.unmappedTotal} products no path reaches
                </Text>
                <Button variant="plain" size="slim" onClick={() => setDrawerOpen((o) => !o)}>
                  {drawerOpen ? "Hide" : "Show"}
                </Button>
              </InlineStack>
              {drawerOpen &&
                state.unmapped.map((p) => (
                  <InlineStack key={p.productId} align="space-between" blockAlign="center">
                    <Text as="p" variant="bodySm">
                      {p.name}
                    </Text>
                    <Button
                      size="slim"
                      onClick={() => act("pin", p.productId)}
                      disabled={chatBusy || Object.keys(criteria).length === 0}
                    >
                      Attach to this path
                    </Button>
                  </InlineStack>
                ))}
              {drawerOpen && Object.keys(criteria).length === 0 && (
                <Text as="p" variant="bodySm" tone="subdued">
                  Pick at least one answer on the left to attach products to that path.
                </Text>
              )}
            </BlockStack>
          </Card>
        )}

        {advanced && (
          <details style={{ marginTop: 8 }}>
            <summary style={{ cursor: "pointer", fontSize: 13, color: "#6D7175", padding: "6px 0" }}>
              Advanced: edit matching notes
            </summary>
            <div style={{ marginTop: 12 }}>{advanced}</div>
          </details>
        )}
      </BlockStack>
    </div>
  );
}
