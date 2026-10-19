// Onboarding screen 1 of 3 — Confirm scope (V3-SPEC Part 6.1, contract §10).
//
// One card, no wizard. On mount the screen makes sure the store has been
// read: catalog sync starts AUTOMATICALLY when it never ran (spinner,
// "Reading your store…"), then (only when no sync ran this visit) gives a
// brand-library index that is genuinely building ≤ 10 s, then makes sure
// a Brand Profile exists (extract capped at 20 s; presets otherwise).
// Then: `{N} products in {M} collections` · store type → template (each
// template carries its own design) with an inline Change, and one CTA:
// Build my quiz.
//
// Shops that already have a quiz never see this: the loader sends them to
// the Studio. Nothing here writes quiz content; template choices go
// through /app/api/quiz-template (eligibility enforced server-side).

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
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
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { ensureShopExists, supabase } from "../lib/supabase.server";
import { shopHasRealQuiz } from "../lib/quiz-draft.server";
import { useCatalogSync } from "../lib/use-catalog-sync";
import { writeScopeHandoff, type ScopeChip } from "../lib/onboarding-scope";
import { getSetupOfferContact, shouldOfferSetup } from "../lib/setup-offer.server";
import { SetupOfferCard } from "../components/SetupOfferModal";
import { introDone, introPathChosen } from "../lib/onboarding-intro.server";
import { loadPreviewProducts } from "../lib/onboarding-preview.server";
import { isTemplateId } from "../lib/quiz-templates";
import { ART_CSS, BrandLockup, ProductMosaic, TemplateMini } from "../components/onboarding/OnboardingArt";

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
  if (formAction?.includes("/app/api/setup-offer")) return false;
  return defaultShouldRevalidate;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  // A first-ever document load (deep link straight here) can arrive before
  // app.tsx's loader has created the shops row.
  await ensureShopExists(session.shop);
  const shop = await supabase
    .from("shops")
    .select("id, catalog_sync_enabled, catalog_sync_cursor, catalog_last_synced_at, catalog_product_count")
    .eq("shop_domain", session.shop)
    .single();
  if (shop.error || !shop.data) throw new Response("Shop not found", { status: 404 });

  // Existing quiz (real, non-blank content) = never onboard again. Every
  // live merchant exits here.
  if (await shopHasRealQuiz(shop.data.id).catch(() => false)) return redirect(studioUrl(request));
  // New installs see the welcome intro first (it sends them back here).
  if (!(await introDone(shop.data.id))) return redirect(`/app/onboarding/welcome${new URL(request.url).search}`);

  const syncEnabled = shop.data.catalog_sync_enabled === true;
  const syncCursor = (shop.data.catalog_sync_cursor as string | null) ?? null;
  const lastSyncedAt = (shop.data.catalog_last_synced_at as string | null) ?? null;
  const productCount = Number(shop.data.catalog_product_count ?? 0) || 0;
  // New installs land here first: the done-for-you setup offer sits as a
  // dismissible card under the screen until the merchant answers it.
  // Not again for a merchant who just chose a path on the intro's last slide.
  const pathChosen = await introPathChosen(shop.data.id).catch(() => null);
  const showSetupOffer =
    (pathChosen === null || pathChosen === "skip") && (await shouldOfferSetup(shop.data.id).catch(() => false));
  const [setupEmail, preview] = await Promise.all([
    showSetupOffer ? getSetupOfferContact(admin).then((c) => c.email) : Promise.resolve(""),
    // The catalog row shows a few of the store's own products.
    loadPreviewProducts(shop.data.id, admin, 4),
  ]);
  return json({
    shopDomain: session.shop,
    setupOffer: { show: showSetupOffer, email: setupEmail },
    preview,
    // Never synced, a sync stopped mid-catalog, or sync is "enabled" but no
    // page ever landed (a first page that failed used to leave exactly that
    // state): start (resume) it.
    syncNeeded: !syncEnabled || syncCursor !== null || lastSyncedAt === null || productCount <= 0,
    syncCursor: syncEnabled && lastSyncedAt !== null ? syncCursor : null,
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
  eligible: string[];
  templates: Array<{
    id: string;
    name: string;
    styleName: string;
    styleTagline: string;
    shopperQuestion: string;
    questionRangeLabel: string;
    ineligibleReason: string;
  }>;
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

const INDEX_BUDGET_MS = 10_000;
const INDEX_POLL_MS = 2_000;
const PROFILE_GET_TIMEOUT_MS = 10_000;
const PROFILE_EXTRACT_TIMEOUT_MS = 20_000;
// A quiz needs real choices; the generator still copes below this, but the
// merchant should know the result will be thin.
const SMALL_CATALOG = 5;

function post(url: string, fields: Record<string, string>, signal?: AbortSignal): Promise<any> {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fetch(url, { method: "POST", body: fd, signal }).then((r) => r.json());
}

function fireEvent(event: string, properties: Record<string, unknown> = {}) {
  void post("/app/api/overhaul-event", { event, properties: JSON.stringify(properties) }).catch(() => {});
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Wait for a brand-library index that is building RIGHT NOW (another
 * tab's sync reached its last page; the build is time-boxed at 25 s).
 * Only called when no sync ran this visit: a sync here already awaited
 * its own library build. Every other state proceeds at once: ready and
 * failed are terminal; null means never attempted; `pending` with no sync
 * in flight is a sync that never reached its last page (stale). Budget
 * ≤ 10 s, then proceed anyway. */
async function waitForLibraryIndex(): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < INDEX_BUDGET_MS) {
    try {
      const d = await fetch("/app/api/brand-library?intent=status", {
        signal: AbortSignal.timeout(INDEX_BUDGET_MS),
      }).then((r) => r.json());
      if (d?.status !== "building") return;
    } catch {
      return;
    }
    await sleep(INDEX_POLL_MS);
  }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default function OnboardingScope() {
  const { setupOffer } = useLoaderData<typeof loader>();
  return (
    <OnboardingScopeScreen
      footer={setupOffer.show ? <SetupOfferCard defaultEmail={setupOffer.email} source="onboarding" /> : null}
    />
  );
}

function OnboardingScopeScreen({ footer }: { footer: ReactNode }) {
  const { shopDomain, syncNeeded, syncCursor, preview } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  // Every state of the screen: admin title, the content, then the setup
  // offer card (never a popup) at the bottom.
  const page = (children: ReactNode) => (
    <Page narrowWidth>
      <TitleBar title="Set up your quiz" />
      {children}
      {footer && <div style={{ paddingBottom: 48 }}>{footer}</div>}
    </Page>
  );

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

  // Template (each template carries its own design)
  const [template, setTemplate] = useState<string>("t5");
  const [templateOpen, setTemplateOpen] = useState(false);
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
    onError: (message) => {
      // A sync failure is not a dead end: whatever is already synced still
      // feeds the profile and the quiz. Surface it, keep going.
      setPrepNote(message);
      syncFinished.current?.();
    },
  });

  // Runs the whole chain; re-runnable ("Re-read my store" after a 0-product
  // read re-syncs from page 1 and then repeats the rest).
  const prepare = useCallback(
    async (opts: { sync: boolean; cursor: string | null }) => {
      setLoadError(null);
      setOptions(null);
      try {
        if (opts.sync) {
          setPrep("sync");
          setPrepNote(null);
          await new Promise<void>((resolve) => {
            syncFinished.current = resolve;
            sync.start(opts.cursor ?? undefined);
          });
          syncFinished.current = null;
        }
        if (!syncedThisVisit.current) {
          // A sync this visit already awaited the library build on its last
          // page; otherwise give an in-flight build a short, capped wait.
          setPrep("index");
          await waitForLibraryIndex();
        }

        setPrep("profile");
        let hasProfile = false;
        try {
          const g = await fetch("/app/api/brand-profile", { signal: AbortSignal.timeout(PROFILE_GET_TIMEOUT_MS) }).then((r) => r.json());
          hasProfile = Boolean(g?.profile);
        } catch {
          hasProfile = false;
        }
        // Missing, or stale because the catalog just changed under it. The
        // extract reads the theme + homepage; past 20 s we go on with
        // presets (a timeout here is "no profile", not a failure).
        if (!hasProfile || syncedThisVisit.current) {
          try {
            await post("/app/api/brand-profile", { intent: "extract" }, AbortSignal.timeout(PROFILE_EXTRACT_TIMEOUT_MS));
          } catch {
            /* preset fallbacks downstream */
          }
        }

        setPrep("options");
        const d: ScopeOptions = await fetch("/app/api/scope-options").then((r) => r.json());
        if (!d.ok) throw new Error(d.error || "Couldn't read your store");
        setOptions(d);
        setTemplate(d.template);
        setSelected(0);
        setPrep("ready");
      } catch (e) {
        setLoadError((e as Error).message);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void prepare({ sync: syncNeeded, cursor: syncCursor });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "Re-read my store": a full sync from page 1, then the rest of the chain.
  const reread = useCallback(() => {
    void prepare({ sync: true, cursor: null });
  }, [prepare]);

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

  // --- Template persistence (server enforces eligibility) ---
  const persistChoice = useCallback(
    async (patch: { template: string }) => {
      const prevTemplate = template;
      setTemplate(patch.template);
      setChoiceError(null);
      setSaving(true);
      try {
        const d = await post("/app/api/quiz-template", {
          intent: "set",
          template: patch.template,
          source: "onboarding",
        });
        if (!d.ok) throw new Error(d.error || "Couldn't save that choice");
      } catch (e) {
        setTemplate(prevTemplate);
        setChoiceError((e as Error).message);
      } finally {
        setSaving(false);
      }
    },
    [template],
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
    });
    fireEvent("scope_selected", { kind: currentChip.kind, count: currentChip.count, template });
    navigate("/app/onboarding/build");
  };

  // Skip auto-generate: seed a one-question starter and open the Studio
  // (app.api.quiz-start-manual). The template pick above is already saved.
  const [manualBusy, setManualBusy] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);
  const startManual = async () => {
    setManualBusy(true);
    setManualError(null);
    try {
      const d = await post("/app/api/quiz-start-manual", {});
      if (!d?.ok) throw new Error(d?.error || "Couldn't start your quiz");
      fireEvent("scope_selected", { kind: "manual", template });
      navigate("/app?open=studio");
    } catch (e) {
      setManualError((e as Error).message);
      setManualBusy(false);
    }
  };

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  if (loadError) {
    return page(
      <div style={{ paddingTop: 48, paddingBottom: 16 }}>
        <Card>
          <BlockStack gap="400">
            <Text as="h1" variant="headingLg">
              We couldn't read your store
            </Text>
            <Banner tone="critical">{loadError}</Banner>
            <InlineStack gap="300">
              <Button variant="primary" onClick={() => window.location.reload()}>
                Try again
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>
      </div>,
    );
  }

  if (prep !== "ready" || !options) {
    const syncLine =
      prep === "sync" && sync.progress && sync.progress.done > 0
        ? `${plural(sync.progress.done, "product")} so far`
        : null;
    return page(
      <div style={{ paddingTop: 96, paddingBottom: 16 }}>
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
            {/* A sync failure doesn't stop the chain, but it is an error. */}
            {prepNote && (
              <Text as="p" variant="bodySm" tone="critical" alignment="center">
                {prepNote}
              </Text>
            )}
          </BlockStack>
        </Card>
      </div>,
    );
  }

  // Nothing to build from: no synced ACTIVE products. No Build CTA here (the
  // generator would refuse or produce an empty quiz); say why and offer a
  // re-read from page 1.
  if (options.productCount === 0) {
    return page(
      <>
        <style>{SCOPE_CSS}</style>
        <div className="gq-ob">
          <Card padding="600">
            <BlockStack gap="500">
              <BlockStack gap="200">
                <Text as="h1" variant="headingXl">
                  We didn't find any products to build from
                </Text>
                <Text as="p" tone="subdued">
                  {prepNote
                    ? "Reading your store stopped before any products were saved, so there is nothing for a quiz to recommend yet."
                    : "Your store has no products with the status Active, so there is nothing for a quiz to recommend yet. Draft and archived products are left out on purpose."}
                </Text>
              </BlockStack>
              {prepNote && <Banner tone="critical">{prepNote}</Banner>}
              <BlockStack gap="200">
                <Text as="p">
                  {prepNote
                    ? "Try reading your store again. The message above says where it stopped."
                    : "In Shopify, open Products and set the ones you sell to Active, then come back and read your store again."}
                </Text>
              </BlockStack>
              <InlineStack gap="300" blockAlign="center">
                <Button variant="primary" onClick={reread}>
                  Re-read my store
                </Button>
                <Text as="span" variant="bodySm" tone="subdued">
                  Reads every active product again · nothing goes live
                </Text>
              </InlineStack>
            </BlockStack>
          </Card>
          <p className="gq-ob-foot">{shopDomain}</p>
        </div>
      </>,
    );
  }

  const tplDef = options.templates.find((t) => t.id === template) ?? options.templates[options.templates.length - 1];
  const scopeIsAll = !currentChip || currentChip.kind === "all";
  // Proof of the read: a few of the store's own product names.
  const names = preview.map((p) => p.name).slice(0, 3);
  const catalogDetail =
    scopeIsAll && names.length > 0
      ? `${names.join(", ")}${options.productCount > names.length ? ` and ${options.productCount - names.length} more` : ""}`
      : null;

  // One banner at a time (Built for Shopify 4.3.4), most urgent first: a
  // failed template save, then a partial sync, then the thin-catalog note.
  const notice: { tone: "critical" | "info"; text: string } | null = choiceError
    ? { tone: "critical", text: choiceError }
    : prepNote
      ? { tone: "critical", text: `${prepNote.replace(/[.\s]+$/, "")}. The quiz is built from what did sync.` }
      : options.productCount < SMALL_CATALOG
        ? {
            tone: "info",
            text: `Only ${plural(options.productCount, "active product")} to choose from. The quiz will be short and every answer will land on the same few products. Add more active products in Shopify for a richer quiz, or build now and come back later.`,
          }
        : null;

  return page(
    <>
      <style>{ART_CSS + SCOPE_CSS}</style>
      <div className="gs">
        {/* Rounded at every width, like the intro's card: one piece. */}
        <Card padding="0" roundedAbove="xs">
          <div className="gs-main">
            <div className="gs-top">
              <BrandLockup size={26} />
              <span className="gs-shop">{shopDomain}</span>
            </div>
            <span className="gs-eyebrow">One last check</span>
            <h1 className="gs-h1">Ready to build your quiz</h1>
            <p className="gs-lede">
              We read your store. Check this looks right, then we'll write the whole quiz from your catalog.
            </p>

            <div className="gs-rows">
              {/* Row 1: scope, shown with the store's own products */}
              <div className="gs-row">
                <ProductMosaic products={preview} size={64} />
                <div className="gs-body">
                  <span className="gs-k">Products</span>
                  <p className="gs-v">
                    {scopeIsAll ? (
                      <>
                        {plural(options.productCount, "product")}
                        {options.collectionCount > 0 && (
                          <span className="gs-v-soft">
                            {" in "}
                            {plural(options.collectionCount, "collection")}
                          </span>
                        )}
                      </>
                    ) : (
                      <>
                        {plural(currentChip!.count, "product")}
                        <span className="gs-v-soft">
                          {" of "}
                          {options.productCount} · {currentChip!.label}
                        </span>
                      </>
                    )}
                  </p>
                  {catalogDetail && <p className="gs-d">{catalogDetail}</p>}
                </div>
                <div className="gs-act">
                  <Button variant="plain" onClick={() => setScopeOpen((v) => !v)}>
                    {scopeOpen ? "Done" : "Change scope"}
                  </Button>
                </div>
                {scopeOpen && (
                  <div className="gs-expand">
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
                                ? `Only ${plural(freeState.result.count, "product")} match. A quiz needs more to choose from. `
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

              {/* Row 2: store type to template, shown as the template's own style */}
              <div className="gs-row">
                <TemplateMini id={isTemplateId(tplDef.id) ? tplDef.id : "t5"} size={64} />
                <div className="gs-body">
                  <span className="gs-k">Template</span>
                  <p className="gs-v">
                    {tplDef.name}
                    <span className="gs-v-soft"> · {tplDef.styleName} style</span>
                  </p>
                  <p className="gs-d">
                    {options.storeType ? `Picked for: ${options.storeType}` : tplDef.questionRangeLabel}
                  </p>
                </div>
                <div className="gs-act">
                  <Button variant="plain" onClick={() => setTemplateOpen((v) => !v)}>
                    {templateOpen ? "Done" : "Change"}
                  </Button>
                </div>
                {templateOpen && (
                  <div className="gs-expand gs-expand--tpl">
                    <ChoiceList
                      title="Template"
                      titleHidden
                      selected={[template]}
                      onChange={(v) => v[0] && v[0] !== template && persistChoice({ template: v[0] })}
                      disabled={saving}
                      choices={options.templates.map((t) => {
                        const ok = options.eligible.includes(t.id);
                        // The description lives in the label so it lines up
                        // with the title, not under the thumbnail.
                        return {
                          value: t.id,
                          label: (
                            <span className={`gs-tpl-opt${ok ? "" : " is-off"}`}>
                              <TemplateMini id={isTemplateId(t.id) ? t.id : "t5"} size={40} />
                              <span className="gs-tpl-text">
                                <span className="gs-tpl-t">
                                  <b>{t.name}</b> · {t.shopperQuestion}
                                </span>
                                <span className="gs-tpl-d">
                                  {ok
                                    ? `${t.styleTagline} · ${t.questionRangeLabel}`
                                    : t.ineligibleReason || "Not available for this store"}
                                </span>
                              </span>
                            </span>
                          ),
                          disabled: !ok,
                        };
                      })}
                    />
                  </div>
                )}
              </div>
            </div>

            {notice && (
              <div className="gs-notice">
                <Banner tone={notice.tone}>{notice.text}</Banner>
              </div>
            )}

            <div className="gs-cta">
              <Button
                variant="primary"
                size="large"
                onClick={startBuild}
                disabled={!currentChip || freeState.resolving || saving}
              >
                Build my quiz
              </Button>
              <span className="gs-meta">
                About a minute or two
                <i aria-hidden />
                Nothing goes live
              </span>
            </div>
          </div>

          {/* The quieter way in: a one-question starter, edited by hand */}
          <div className="gs-alt">
            <Button variant="plain" onClick={() => void startManual()} loading={manualBusy} disabled={saving}>
              Skip and set it up myself
            </Button>
            <span className="gs-alt-d">Start from one simple question and edit everything in the Studio.</span>
          </div>
        </Card>
        {manualError && (
          <div className="gs-notice">
            <Banner tone="critical">{manualError}</Banner>
          </div>
        )}
      </div>
    </>,
  );
}

// Polaris Card and controls; type and spacing match the welcome intro.
// Black, white and warm greys only (no AI purple); text holds WCAG AA.
const SCOPE_CSS = `
  .gq-ob { padding-top: 48px; padding-bottom: 48px; }
  .gq-ob-foot { text-align: center; margin: 20px 0 0; font-size: 12px; color: var(--p-color-text-secondary, #8a8a8a); }

  .gs { --gs-ink: #141414; --gs-muted: #6B6862; --gs-line: #E8E6E1; --gs-sand: #F5F4F1; padding: 40px 0 48px; }
  .gs-main { padding: 24px 32px 28px; }
  .gs-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 32px; }
  .gs-shop { min-width: 0; font-size: 12px; color: var(--gs-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .gs-eyebrow { display: flex; align-items: center; gap: 12px; font-size: 11px; font-weight: 600; letter-spacing: .2em; text-transform: uppercase; color: var(--gs-muted); }
  .gs-eyebrow::before { content: ""; width: 24px; height: 1.5px; background: var(--gs-ink); flex: none; }
  .gs-h1 { margin: 14px 0 0; font-size: 32px; line-height: 1.08; letter-spacing: -0.03em; font-weight: 700; color: var(--gs-ink); }
  .gs-lede { margin: 10px 0 0; font-size: 15px; line-height: 1.55; color: #4D4A45; max-width: 34em; text-wrap: pretty; }

  .gs-rows { margin-top: 28px; border-top: 1px solid var(--gs-line); }
  .gs-row { display: grid; grid-template-columns: 64px minmax(0, 1fr) auto; column-gap: 18px; align-items: center; padding: 18px 0; border-bottom: 1px solid var(--gs-line); }
  .gs-body { min-width: 0; }
  .gs-k { display: block; font-size: 10.5px; font-weight: 600; letter-spacing: .16em; text-transform: uppercase; color: var(--gs-muted); }
  .gs-v { margin: 4px 0 0; font-size: 15px; line-height: 20px; font-weight: 650; letter-spacing: -0.01em; color: var(--gs-ink); }
  .gs-v-soft { font-weight: 450; color: #4D4A45; }
  .gs-d { margin: 2px 0 0; font-size: 13px; line-height: 18px; color: var(--gs-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .gs-act { align-self: center; }
  .gs-expand { grid-column: 2 / -1; margin-top: 16px; padding: 14px; border-radius: 10px; background: var(--gs-sand); }
  .gs-expand--tpl { padding: 14px 16px; }
  .gs-expand--tpl fieldset > ul { row-gap: 14px; }
  /* Each radio sits on its specimen's center line (40px tile, 20px radio). */
  .gs .gs-expand--tpl .Polaris-Choice { align-items: flex-start; }
  .gs .gs-expand--tpl .Polaris-Choice__Control { margin-top: 10px; }
  .gs-tpl-opt { display: flex; align-items: flex-start; gap: 12px; }
  .gs-tpl-text { display: grid; gap: 2px; padding-top: 1px; }
  .gs-tpl-t { font-size: 13.5px; line-height: 20px; text-wrap: pretty; }
  .gs-tpl-t b { font-weight: 650; }
  .gs-tpl-d { font-size: 12.5px; line-height: 17px; color: var(--gs-muted); }
  /* Not for this store: dimmed specimen, quiet text, an empty ring (not a
     filled grey dot that reads as half-picked). */
  .gs-tpl-opt.is-off .oa-tpl { opacity: .45; filter: grayscale(1); }
  .gs-tpl-opt.is-off .gs-tpl-t, .gs-tpl-opt.is-off .gs-tpl-d { color: #7D7973; }
  .gs .gs-expand--tpl .Polaris-RadioButton__Input:disabled + .Polaris-RadioButton__Backdrop,
  .gs .gs-expand--tpl .Polaris-RadioButton__ChoiceLabel:hover .Polaris-RadioButton__Input:disabled + .Polaris-RadioButton__Backdrop {
    background: transparent; border: var(--p-border-width-0165, 1.5px) solid #D6D3CC; }
  .gs .gs-expand--tpl .Polaris-RadioButton__Input:disabled + .Polaris-RadioButton__Backdrop::before { opacity: 0; }

  .gs-notice { margin-top: 20px; }
  .gs-cta { display: flex; align-items: center; flex-wrap: wrap; gap: 12px 18px; margin-top: 28px; }
  .gs-meta { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 4px 10px; font-size: 12.5px; color: var(--gs-muted); }
  .gs-meta i { width: 3px; height: 3px; border-radius: 50%; background: #D6D3CC; }

  .gs-alt { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 16px 32px 18px; background: var(--gs-sand); border-top: 1px solid var(--gs-line); }
  .gs-alt-d { font-size: 13px; color: var(--gs-muted); }

  @media (max-width: 489px) {
    .gs { padding-left: 16px; padding-right: 16px; }
  }
  @media (max-width: 640px) {
    .gs { padding-top: 16px; }
    .gs-main { padding: 18px 16px 22px; }
    .gs-top { margin-bottom: 24px; }
    .gs-h1 { font-size: 28px; }
    .gs-row { grid-template-columns: 64px minmax(0, 1fr); column-gap: 14px; align-items: start; }
    .gs-d { white-space: normal; text-wrap: pretty; }
    .gs-act { grid-column: 2; justify-self: start; margin-top: 6px; }
    .gs-expand { grid-column: 1 / -1; }
    .gs-alt { padding: 14px 16px; }
  }
`;
