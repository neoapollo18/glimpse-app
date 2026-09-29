// Onboarding screen 1 of 3 — Confirm scope (V3-SPEC Part 6.1, contract §10).
//
// One card, no wizard. On mount the screen makes sure the store has been
// read: catalog sync starts AUTOMATICALLY when it never ran (spinner,
// "Reading your store…"), then it waits for the brand-library index
// (≤ 60 s, proceeds either way), then makes sure a Brand Profile exists.
// Then: `{N} products in {M} collections` · store type → template · theme
// → Look, each with an inline Change, and one CTA: Build my quiz.
//
// Shops that already have a quiz never see this: the loader sends them to
// the Studio. Nothing here writes quiz content; template/look choices go
// through /app/api/quiz-template (eligibility enforced server-side).

import { useCallback, useEffect, useRef, useState } from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import {
  Banner,
  BlockStack,
  Button,
  Card,
  ChoiceList,
  InlineStack,
  Page,
  Spinner,
  Text,
  TextField,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { getRecommendationCounts, supabase } from "../lib/supabase.server";
import { useCatalogSync } from "../lib/use-catalog-sync";
import { writeScopeHandoff, type ScopeChip } from "../lib/onboarding-scope";

/** `/app?open=studio` with the embedded-admin params (host/shop/embedded)
 * carried over, so App Bridge doesn't re-bootstrap the frame. */
function studioUrl(request: Request): string {
  const params = new URL(request.url).searchParams;
  params.delete("retry");
  params.set("open", "studio");
  return `/app?${params.toString()}`;
}

// The auto-sync posts one fetcher page per 8 products; re-running this
// loader for every page is pure waste (same pattern as studio.tsx).
export const shouldRevalidate = ({ formAction, defaultShouldRevalidate }: { formAction?: string; defaultShouldRevalidate: boolean }) => {
  if (formAction?.includes("/app/api/catalog-sync")) return false;
  return defaultShouldRevalidate;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await supabase
    .from("shops")
    .select("id, catalog_sync_enabled, catalog_sync_cursor")
    .eq("shop_domain", session.shop)
    .single();
  if (shop.error || !shop.data) throw new Response("Shop not found", { status: 404 });

  // Existing quiz = never onboard again. Every live merchant exits here.
  const counts = await getRecommendationCounts(shop.data.id).catch(() => null);
  if ((counts?.questions ?? 0) > 0) return redirect(studioUrl(request));

  const syncEnabled = shop.data.catalog_sync_enabled === true;
  const syncCursor = (shop.data.catalog_sync_cursor as string | null) ?? null;
  return json({
    shopDomain: session.shop,
    // Never synced, or a sync stopped mid-catalog: start (resume) it.
    syncNeeded: !syncEnabled || syncCursor !== null,
    syncCursor: syncEnabled ? syncCursor : null,
  });
};

// ---------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------

interface ScopeOptions {
  ok: boolean;
  error?: string;
  chips: ScopeChip[];
  productCount: number;
  collectionCount: number;
  storeType: string | null;
  template: string;
  look: string;
  eligible: string[];
  templates: Array<{ id: string; name: string; shopperQuestion: string; questionRangeLabel: string; ineligibleReason: string }>;
  looks: Array<{ id: string; name: string; tagline: string }>;
  theme: { fontName: string | null; colorCount: number; paletteWord: string | null; accentColor: string | null };
}

type Prep = "sync" | "index" | "profile" | "options" | "ready";

const PREP_LINES: Record<Prep, string> = {
  sync: "Reading your store…",
  index: "Indexing your images…",
  profile: "Learning your theme…",
  options: "Almost there…",
  ready: "",
};

const INDEX_BUDGET_MS = 60_000;
const INDEX_POLL_MS = 2_000;

function post(url: string, fields: Record<string, string>): Promise<any> {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fetch(url, { method: "POST", body: fd }).then((r) => r.json());
}

function fireEvent(event: string, properties: Record<string, unknown> = {}) {
  void post("/app/api/overhaul-event", { event, properties: JSON.stringify(properties) }).catch(() => {});
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Wait for the brand-library index: ready | failed | budget exhausted
 * all proceed. A response without a status field (endpoint predates the
 * status intent) proceeds immediately. */
async function waitForLibraryIndex(): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < INDEX_BUDGET_MS) {
    try {
      const d = await fetch("/app/api/brand-library?intent=status").then((r) => r.json());
      const status = d?.status;
      if (!("status" in (d ?? {}))) return;
      if (status === "ready" || status === "failed") return;
      // null = never attempted (sync never reached its last page, or an
      // older row): nothing to wait for.
      if (status === null || status === undefined) return;
    } catch {
      return;
    }
    await sleep(INDEX_POLL_MS);
  }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default function OnboardingScope() {
  const { shopDomain, syncNeeded, syncCursor } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const [prep, setPrep] = useState<Prep>(syncNeeded ? "sync" : "index");
  const [prepNote, setPrepNote] = useState<string | null>(null);
  const [options, setOptions] = useState<ScopeOptions | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Scope selection
  const [selected, setSelected] = useState(0);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [freeText, setFreeText] = useState("");
  const [freeState, setFreeState] = useState<{ resolving: boolean; result: ScopeChip | null }>({
    resolving: false,
    result: null,
  });

  // Template / Look
  const [template, setTemplate] = useState<string>("t5");
  const [look, setLook] = useState<string>("minimal");
  const [templateOpen, setTemplateOpen] = useState(false);
  const [lookOpen, setLookOpen] = useState(false);
  const [choiceError, setChoiceError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // --- Preparation chain: sync → index → profile → options → ready ---
  const syncedThisVisit = useRef(false);
  const syncFinished = useRef<(() => void) | null>(null);
  const sync = useCatalogSync({
    onComplete: () => {
      syncedThisVisit.current = true;
      syncFinished.current?.();
    },
  });
  useEffect(() => {
    if (sync.syncError) {
      // A sync failure is not a dead end: whatever is already synced still
      // feeds the profile and the quiz. Surface it, keep going.
      setPrepNote(sync.syncError);
      syncFinished.current?.();
    }
  }, [sync.syncError]);

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        if (syncNeeded) {
          setPrep("sync");
          await new Promise<void>((resolve) => {
            syncFinished.current = resolve;
            sync.start(syncCursor ?? undefined);
          });
          syncFinished.current = null;
        }
        setPrep("index");
        await waitForLibraryIndex();

        setPrep("profile");
        let hasProfile = false;
        try {
          const g = await fetch("/app/api/brand-profile").then((r) => r.json());
          hasProfile = Boolean(g?.profile);
        } catch {
          hasProfile = false;
        }
        // Missing, or stale because the catalog just changed under it.
        if (!hasProfile || syncedThisVisit.current) {
          try {
            await post("/app/api/brand-profile", { intent: "extract" });
          } catch {
            /* preset fallbacks downstream */
          }
        }

        setPrep("options");
        const d: ScopeOptions = await fetch("/app/api/scope-options").then((r) => r.json());
        if (!d.ok) throw new Error(d.error || "Couldn't read your store");
        setOptions(d);
        setTemplate(d.template);
        setLook(d.look);
        setPrep("ready");
      } catch (e) {
        setLoadError((e as Error).message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Free-text scope ---
  const resolveFreeText = useCallback(async () => {
    if (!freeText.trim()) return;
    setFreeState({ resolving: true, result: null });
    try {
      const d = await post("/app/api/scope-options", { intent: "resolve-freetext", query: freeText });
      if (!d.ok) throw new Error(d.error);
      setFreeState({
        resolving: false,
        result: { kind: "freetext", label: d.label, detail: `${d.count} products`, productIds: d.productIds, count: d.count },
      });
    } catch {
      setFreeState({ resolving: false, result: null });
    }
  }, [freeText]);

  // --- Template / Look persistence (server enforces eligibility) ---
  const persistChoice = useCallback(
    async (patch: { template?: string; look?: string }) => {
      const prevTemplate = template;
      const prevLook = look;
      if (patch.template) setTemplate(patch.template);
      if (patch.look) setLook(patch.look);
      setChoiceError(null);
      setSaving(true);
      try {
        const d = await post("/app/api/quiz-template", {
          intent: "set",
          ...(patch.template ? { template: patch.template } : {}),
          ...(patch.look ? { look: patch.look } : {}),
          source: "onboarding",
        });
        if (!d.ok) throw new Error(d.error || "Couldn't save that choice");
      } catch (e) {
        setTemplate(prevTemplate);
        setLook(prevLook);
        setChoiceError((e as Error).message);
      } finally {
        setSaving(false);
      }
    },
    [template, look],
  );

  // --- Build ---
  const currentChip: ScopeChip | null =
    selected === -1 ? freeState.result : options?.chips?.[selected] ?? null;

  const startBuild = () => {
    if (!options || !currentChip) return;
    writeScopeHandoff({
      chip: currentChip,
      productCount: options.productCount,
      collectionCount: options.collectionCount,
      accentColor: options.theme.accentColor,
      template,
      look,
    });
    fireEvent("scope_selected", { kind: currentChip.kind, count: currentChip.count, template, look });
    navigate("/app/onboarding/build");
  };

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  if (loadError) {
    return (
      <Page narrowWidth>
        <div style={{ paddingTop: 48 }}>
          <Card>
            <BlockStack gap="400">
              <Text as="h1" variant="headingLg">
                We couldn't read your store
              </Text>
              <Text as="p" tone="subdued">
                {loadError}
              </Text>
              <InlineStack gap="300">
                <Button variant="primary" onClick={() => window.location.reload()}>
                  Try again
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </div>
      </Page>
    );
  }

  if (prep !== "ready" || !options) {
    const syncLine =
      prep === "sync" && sync.progress && sync.progress.done > 0
        ? `${plural(sync.progress.done, "product")} so far`
        : null;
    return (
      <Page narrowWidth>
        <div style={{ paddingTop: 96 }}>
          <Card padding="800">
            <BlockStack gap="400" inlineAlign="center">
              <Spinner size="large" accessibilityLabel="Reading your store" />
              <Text as="p" variant="headingMd" alignment="center">
                {PREP_LINES[prep] || "Reading your store…"}
              </Text>
              {syncLine && (
                <Text as="p" tone="subdued" alignment="center">
                  {syncLine}
                </Text>
              )}
              <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                Usually under a minute. Nothing goes live.
              </Text>
              {prepNote && (
                <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                  {prepNote}
                </Text>
              )}
            </BlockStack>
          </Card>
        </div>
      </Page>
    );
  }

  const tplDef = options.templates.find((t) => t.id === template) ?? options.templates[options.templates.length - 1];
  const lookDef = options.looks.find((l) => l.id === look) ?? options.looks[1];
  const scopeIsAll = !currentChip || currentChip.kind === "all";
  const themeParts: string[] = [];
  if (options.theme.fontName) themeParts.push(`${options.theme.fontName} headings`);
  if (options.theme.paletteWord) themeParts.push(`${options.theme.paletteWord} palette`);

  return (
    <Page narrowWidth>
      <style>{SCOPE_CSS}</style>
      <div className="gq-ob">
        <Card padding="600">
          <BlockStack gap="600">
            <BlockStack gap="200">
              <Text as="h1" variant="headingXl">
                Ready to build your quiz
              </Text>
              <Text as="p" tone="subdued">
                We read your store. Check this looks right, then we'll write the whole quiz from your catalog.
              </Text>
            </BlockStack>

            <div className="gq-ob-rows">
              {/* Row 1 — scope */}
              <div className="gq-ob-row">
                <span className="gq-ob-ic" aria-hidden>
                  {options.productCount}
                </span>
                <div className="gq-ob-body">
                  <Text as="p">
                    {scopeIsAll ? (
                      <>
                        <strong>{plural(options.productCount, "product")}</strong>
                        {options.collectionCount > 0 && (
                          <>
                            {" in "}
                            <strong>{plural(options.collectionCount, "collection")}</strong>
                          </>
                        )}
                      </>
                    ) : (
                      <>
                        <strong>{plural(currentChip!.count, "product")}</strong>
                        {" of "}
                        {options.productCount} · {currentChip!.label}
                      </>
                    )}
                  </Text>
                  {scopeOpen && (
                    <div className="gq-ob-expand">
                      <InlineStack gap="200" wrap>
                        {options.chips.map((c, i) => (
                          <Button
                            key={`${c.kind}-${c.label}`}
                            size="slim"
                            pressed={selected === i}
                            onClick={() => setSelected(i)}
                          >
                            {`${c.label} · ${c.count}`}
                          </Button>
                        ))}
                        <Button size="slim" pressed={selected === -1} onClick={() => setSelected(-1)}>
                          Something else…
                        </Button>
                      </InlineStack>
                      {selected === -1 && (
                        <div style={{ marginTop: 12 }}>
                          <TextField
                            label="Describe the products"
                            labelHidden
                            autoComplete="off"
                            placeholder="e.g. only lip products"
                            value={freeText}
                            onChange={setFreeText}
                            onBlur={resolveFreeText}
                            connectedRight={
                              <Button onClick={resolveFreeText} loading={freeState.resolving}>
                                Find
                              </Button>
                            }
                          />
                          {freeState.result && (
                            <div style={{ marginTop: 8 }}>
                              <Text as="p" variant="bodySm" tone="subdued">
                                {freeState.result.count < 5
                                  ? `Only ${plural(freeState.result.count, "product")} match — a quiz needs more to choose from. `
                                  : `${plural(freeState.result.count, "product")} matched.`}
                                {freeState.result.count < 5 && (
                                  <Button variant="plain" onClick={() => setSelected(0)}>
                                    Use everything instead
                                  </Button>
                                )}
                              </Text>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <Button variant="plain" onClick={() => setScopeOpen((v) => !v)}>
                  {scopeOpen ? "Done" : "Change scope"}
                </Button>
              </div>

              {/* Row 2 — store type → template */}
              <div className="gq-ob-row">
                <span className="gq-ob-ic" aria-hidden>
                  ◐
                </span>
                <div className="gq-ob-body">
                  <Text as="p">
                    {options.storeType ? (
                      <>
                        Looks like a <strong>{options.storeType}</strong> → <strong>{tplDef.name}</strong> template
                      </>
                    ) : (
                      <>
                        We'll use the <strong>{tplDef.name}</strong> template
                      </>
                    )}
                  </Text>
                  {templateOpen && (
                    <div className="gq-ob-expand">
                      <ChoiceList
                        title="Template"
                        titleHidden
                        selected={[template]}
                        onChange={(v) => v[0] && v[0] !== template && persistChoice({ template: v[0] })}
                        disabled={saving}
                        choices={options.templates.map((t) => {
                          const ok = options.eligible.includes(t.id);
                          return {
                            value: t.id,
                            label: `${t.name} · ${t.shopperQuestion}`,
                            helpText: ok ? t.questionRangeLabel : t.ineligibleReason || "Not available for this store",
                            disabled: !ok,
                          };
                        })}
                      />
                    </div>
                  )}
                </div>
                <Button variant="plain" onClick={() => setTemplateOpen((v) => !v)}>
                  {templateOpen ? "Done" : "Change"}
                </Button>
              </div>

              {/* Row 3 — theme → look */}
              <div className="gq-ob-row">
                <span className="gq-ob-ic" aria-hidden>
                  Aa
                </span>
                <div className="gq-ob-body">
                  <Text as="p">
                    {themeParts.length > 0 ? (
                      <>
                        Theme uses{" "}
                        {themeParts.map((part, i) => (
                          <span key={part}>
                            {i > 0 && " · "}
                            <strong>{part}</strong>
                          </span>
                        ))}
                        {" → "}
                        <strong>{lookDef.name}</strong> look
                      </>
                    ) : (
                      <>
                        Theme matched → <strong>{lookDef.name}</strong> look
                      </>
                    )}
                  </Text>
                  {lookOpen && (
                    <div className="gq-ob-expand">
                      <ChoiceList
                        title="Look"
                        titleHidden
                        selected={[look]}
                        onChange={(v) => v[0] && v[0] !== look && persistChoice({ look: v[0] })}
                        disabled={saving}
                        choices={options.looks.map((l) => ({ value: l.id, label: l.name, helpText: l.tagline }))}
                      />
                    </div>
                  )}
                </div>
                <Button variant="plain" onClick={() => setLookOpen((v) => !v)}>
                  {lookOpen ? "Done" : "Change"}
                </Button>
              </div>
            </div>

            {choiceError && <Banner tone="critical">{choiceError}</Banner>}
            {prepNote && (
              <Banner tone="warning">
                {prepNote} — the quiz is built from what did sync.
              </Banner>
            )}

            <InlineStack gap="400" blockAlign="center">
              <Button
                variant="primary"
                size="large"
                onClick={startBuild}
                disabled={!currentChip || freeState.resolving || saving}
              >
                Build my quiz
              </Button>
              <Text as="span" variant="bodySm" tone="subdued">
                About 60 seconds · nothing goes live
              </Text>
            </InlineStack>
          </BlockStack>
        </Card>
        <p className="gq-ob-foot">{shopDomain}</p>
      </div>
    </Page>
  );
}

const SCOPE_CSS = `
  .gq-ob { padding-top: 48px; padding-bottom: 48px; }
  .gq-ob-rows { display: flex; flex-direction: column; }
  .gq-ob-row { display: flex; align-items: flex-start; gap: 14px; padding: 16px 0; border-top: 1px solid var(--p-color-border-secondary, #e3e3e3); }
  .gq-ob-row:last-child { border-bottom: 1px solid var(--p-color-border-secondary, #e3e3e3); }
  .gq-ob-ic { flex: 0 0 34px; height: 34px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; background: var(--p-color-bg-surface-secondary, #f1f1f1); color: var(--p-color-text-secondary, #616161); font-size: 11px; font-weight: 600; letter-spacing: .02em; margin-top: 1px; }
  .gq-ob-body { flex: 1; min-width: 0; padding-top: 7px; }
  .gq-ob-row > .Polaris-Button, .gq-ob-row > button { margin-top: 7px; flex: 0 0 auto; }
  .gq-ob-expand { margin-top: 12px; padding: 14px; border-radius: 10px; background: var(--p-color-bg-surface-secondary, #f7f7f7); }
  .gq-ob-foot { text-align: center; margin: 20px 0 0; font-size: 12px; color: var(--p-color-text-secondary, #8a8a8a); }
`;
