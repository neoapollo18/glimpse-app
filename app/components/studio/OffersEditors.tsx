import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher } from "@remix-run/react";
import { useAppBridge } from "@shopify/app-bridge-react";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Checkbox,
  Divider,
  Icon,
  InlineStack,
  Select,
  Spinner,
  Text,
  TextField,
} from "@shopify/polaris";
import { XSmallIcon } from "@shopify/polaris-icons";
import type { StudioActionData } from "../../routes/studio";
import type { QuizOffers, CrossSellItem, OffersPatch } from "../../lib/quiz-offers.server";
import type { StudioFlow } from "./types";
import { CopyField, EditorHeader, str, useSettingsAutosave } from "./SettingsEditors";

// Studio "Sell more" editors (migration 086). Offers live in their own
// table (quiz_offers), saved through the save-offers intent — never the
// quiz settings autosave — so version history and the AI copilot can't
// desync a Shopify discount Gleame manages. The bundle BUTTON itself is
// still a quiz setting (quiz_bundle_*) and keeps the copy autosave.

const DISCOUNT_SCOPE = "write_discounts";

export type OfferCatalogItem = {
  productId: string;
  handle: string;
  title: string;
  imageUrl: string | null;
  price: number | null;
  productType: string | null;
};

/** Debounced save-offers: merges field patches, one request in flight,
 * reloads the preview after each successful save (the preview's config
 * reads offers server-side). */
function useOffersAutosave(onSaved: (offers: QuizOffers) => void, onPreviewReload: () => void) {
  const fetcher = useFetcher<StudioActionData>();
  const pending = useRef<OffersPatch>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    if (fetcher.state !== "idle") return false;
    if (Object.keys(pending.current).length === 0) return false;
    const fd = new FormData();
    fd.append("intent", "save-offers");
    fd.append("patch", JSON.stringify(pending.current));
    pending.current = {};
    fetcher.submit(fd, { method: "POST", action: "/studio" });
    return true;
  };

  const schedule = (patch: OffersPatch, immediate = false) => {
    pending.current = { ...pending.current, ...patch };
    setSaveState("saving");
    setError(null);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(submit, immediate ? 0 : 600);
  };

  const processed = useRef<StudioActionData | null>(null);
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data || processed.current === fetcher.data) return;
    processed.current = fetcher.data;
    if (fetcher.data.offers) onSaved(fetcher.data.offers);
    if (fetcher.data.ok) onPreviewReload();
    else setError(fetcher.data.error ?? "Saving failed");
    if (!submit()) setSaveState(fetcher.data.ok ? "saved" : "idle");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

  useEffect(() => {
    if (saveState !== "saved") return;
    const t = setTimeout(() => setSaveState("idle"), 2000);
    return () => clearTimeout(t);
  }, [saveState]);

  // Unmount inside the debounce window: deliver, fire-and-forget.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (Object.keys(pending.current).length > 0) {
        const fd = new FormData();
        fd.append("intent", "save-offers");
        fd.append("patch", JSON.stringify(pending.current));
        pending.current = {};
        import("./studio-data").then(({ postStudioAction }) => postStudioAction(fd)).catch(() => {});
      }
    },
    [],
  );

  return { schedule, saveState, error, clearError: () => setError(null), busy: fetcher.state !== "idle" };
}

function SaveStateLine({ state }: { state: "idle" | "saving" | "saved" }) {
  if (state === "saving") {
    return (
      <InlineStack gap="100" blockAlign="center">
        <Spinner size="small" />
        <Text as="span" variant="bodySm" tone="subdued">
          Saving…
        </Text>
      </InlineStack>
    );
  }
  if (state === "saved") {
    return (
      <Text as="span" variant="bodySm" tone="subdued">
        Saved
      </Text>
    );
  }
  return null;
}

// ---------------------------------------------------------------------
// Bundle & discount
// ---------------------------------------------------------------------

export function BundleEditor({
  settings,
  offers: initialOffers,
  chatBusy,
  onPreviewUpdate,
  onPreviewReload,
}: {
  settings: Record<string, unknown>;
  offers: QuizOffers | null;
  chatBusy: boolean;
  onPreviewUpdate: (p: { flow?: unknown; config?: unknown }) => void;
  onPreviewReload: () => void;
}) {
  const shopify = useAppBridge();
  const copy = useSettingsAutosave(onPreviewUpdate);
  const [values, setValues] = useState<Record<string, string>>(() => ({
    quiz_bundle_label: str(settings, "quiz_bundle_label"),
  }));
  const [bundleEnabled, setBundleEnabled] = useState<boolean>(settings.quiz_bundle_enabled === true);
  const [bundleSize, setBundleSize] = useState<string>(() => {
    const n = Number(settings.quiz_bundle_size);
    return Number.isInteger(n) && n > 0 ? String(n) : "";
  });

  const [offers, setOffers] = useState<QuizOffers | null>(initialOffers);
  // Discount form: edited locally, saved by the Save button (it can touch
  // Shopify, so no keystroke autosave).
  const [mode, setMode] = useState(initialOffers?.bundleDiscountMode ?? "off");
  const [type, setType] = useState(initialOffers?.bundleDiscountType ?? "percentage");
  const [value, setValue] = useState(initialOffers?.bundleDiscountValue != null ? String(initialOffers.bundleDiscountValue) : "");
  const [minQty, setMinQty] = useState(initialOffers?.bundleDiscountMinQty != null ? String(initialOffers.bundleDiscountMinQty) : "");
  const [code, setCode] = useState(
    initialOffers?.bundleDiscountMode === "code" ? initialOffers.bundleDiscountCode ?? "" : "",
  );
  const [note, setNote] = useState(initialOffers?.bundleDiscountNote ?? "");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "critical" | "warning"; text: string } | null>(null);

  const setCopyValue = (key: string, v: string) => {
    setValues((prev) => ({ ...prev, [key]: v }));
    copy.schedule("copy", key, v);
  };
  const touch = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setDirty(true);
    setMessage(null);
  };

  const bundleSizeNum = Number(bundleSize) > 0 ? Math.floor(Number(bundleSize)) : 0;
  const defaultMin = bundleSizeNum >= 2 ? bundleSizeNum : 2;

  const post = async (fd: FormData): Promise<StudioActionData | null> => {
    const { postStudioAction } = await import("./studio-data");
    const res = await postStudioAction(fd);
    return (await res.json().catch(() => null)) as StudioActionData | null;
  };

  const ensureDiscountScope = async (): Promise<string | null> => {
    if (!shopify?.scopes) return null; // not embedded: let the server decide
    try {
      const { granted } = await shopify.scopes.query();
      if (granted.includes(DISCOUNT_SCOPE)) return null;
      const res = await shopify.scopes.request([DISCOUNT_SCOPE]);
      return res.result === "granted-all"
        ? null
        : "Gleame needs permission to create discounts. Approve it to let Gleame manage the bundle discount, or use your own code instead.";
    } catch (e) {
      return `Shopify couldn't ask for discount access (${(e as Error)?.message || "unknown error"}). Reload the app and try again.`;
    }
  };

  const saveDiscount = async () => {
    setBusy(true);
    setMessage(null);
    try {
      if (mode === "managed") {
        const scopeError = await ensureDiscountScope();
        if (scopeError) {
          setMessage({ tone: "warning", text: scopeError });
          return;
        }
      }
      const patch: OffersPatch = {
        bundleDiscountMode: mode,
        bundleDiscountType: type,
        bundleDiscountValue: value.trim() === "" ? null : Number(value),
        bundleDiscountMinQty: minQty.trim() === "" ? null : Number(minQty),
        bundleDiscountNote: note.trim() || null,
        ...(mode === "code" ? { bundleDiscountCode: code.trim() || null } : {}),
      };
      const fd = new FormData();
      fd.append("intent", "save-offers");
      fd.append("patch", JSON.stringify(patch));
      // The server may resolve fields (the threshold Shopify enforces):
      // mirror what was actually saved back into the form.
      const adopt = (o: QuizOffers | undefined) => {
        if (!o) return;
        setOffers(o);
        setMinQty(o.bundleDiscountMinQty != null ? String(o.bundleDiscountMinQty) : "");
      };
      let body = await post(fd);
      adopt(body?.offers);
      if (!body?.ok) {
        setMessage({ tone: "critical", text: body?.error ?? "Saving the discount failed" });
        return;
      }
      // First managed save: create the discount in Shopify now.
      if (mode === "managed" && !body.offers?.bundleDiscountShopifyId) {
        const sfd = new FormData();
        sfd.append("intent", "sync-bundle-discount");
        body = await post(sfd);
        adopt(body?.offers);
        if (!body?.ok) {
          setMessage({ tone: "critical", text: body?.error ?? "Creating the Shopify discount failed" });
          return;
        }
      }
      setDirty(false);
      setMessage({ tone: "success", text: body?.message ?? "Discount saved" });
      onPreviewReload();
    } finally {
      setBusy(false);
    }
  };

  const disabled = chatBusy;
  const managedLive = offers?.bundleDiscountMode === "managed" && offers.bundleDiscountShopifyId && offers.bundleDiscountCode;

  return (
    <BlockStack gap="400">
      <EditorHeader title="Bundle & discount" saveState={copy.saveState} />
      <Text as="p" variant="bodySm" tone="subdued">
        One button under the results adds the shopper&rsquo;s matches to the cart together. Add a discount to make
        the bundle the obvious buy.
      </Text>
      {copy.error && (
        <Banner tone="critical" onDismiss={copy.clearError}>
          {copy.error}
        </Banner>
      )}
      <Checkbox
        label={'Show an "add all" bundle button'}
        checked={bundleEnabled}
        disabled={disabled}
        onChange={(v) => {
          setBundleEnabled(v);
          copy.schedule("copy", "quiz_bundle_enabled", v);
        }}
        helpText="Only shows when there are 2+ matches."
      />
      {bundleEnabled && (
        <InlineStack gap="200" blockAlign="start">
          <div style={{ flex: 2, minWidth: 160 }}>
            <CopyField
              label="Button label"
              fieldKey="quiz_bundle_label"
              values={values}
              setValue={setCopyValue}
              disabled={disabled}
              helpText="{count} items, {total} price, {discount} the saving (e.g. 20%), {was} the price before it"
            />
          </div>
          <div style={{ flex: 1, minWidth: 100 }}>
            <TextField
              label="Bundle size"
              type="number"
              min={0}
              autoComplete="off"
              value={bundleSize}
              disabled={disabled}
              onChange={(v) => {
                setBundleSize(v);
                copy.schedule("copy", "quiz_bundle_size", Math.max(0, Math.floor(Number(v) || 0)));
              }}
              helpText="Shoppers pick this many; blank = all matches"
            />
          </div>
        </InlineStack>
      )}

      <Divider />
      <InlineStack align="space-between" blockAlign="center">
        <Text as="h4" variant="headingSm">
          Bundle discount
        </Text>
        {managedLive ? <Badge tone="success">{`Live: ${offers!.bundleDiscountCode}`}</Badge> : null}
      </InlineStack>
      {!bundleEnabled && (
        <Text as="p" variant="bodySm" tone="subdued">
          Turn on the bundle button above to offer a bundle discount.
        </Text>
      )}
      {!initialOffers && (
        <Banner tone="warning">Offers are still being set up on our side. Try again in a few minutes.</Banner>
      )}
      <Select
        label="Discount"
        disabled={disabled || !bundleEnabled || !initialOffers}
        options={[
          { label: "No discount (full price)", value: "off" },
          { label: "Gleame creates it in Shopify", value: "managed" },
          { label: "Use my own Shopify discount code", value: "code" },
        ]}
        value={mode}
        onChange={touch((v: string) => setMode(v as QuizOffers["bundleDiscountMode"]))}
        helpText={
          mode === "managed"
            ? "Gleame creates one discount code in your Shopify admin and keeps it in sync with what you set here. It's applied to the cart automatically when shoppers add the bundle. Like any code, Shopify honors it on any cart that meets the minimum, so it's limited to one use per customer."
            : mode === "code"
              ? "Create the code in Shopify first (Discounts → Amount off products, with a minimum quantity). The quiz applies it when shoppers add the bundle."
              : "The bundle adds at full price."
        }
      />
      {mode !== "off" && bundleEnabled && (
        <>
          {mode === "code" && (
            <TextField
              label="Your discount code"
              value={code}
              onChange={touch(setCode)}
              disabled={disabled}
              autoComplete="off"
              placeholder="BUNDLE20"
            />
          )}
          <InlineStack gap="200" blockAlign="start" wrap={false}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Select
                label={mode === "code" ? "It takes off (for the label)" : "Takes off"}
                options={[
                  { label: "Percent", value: "percentage" },
                  { label: "Fixed amount", value: "fixed_amount" },
                ]}
                value={type}
                onChange={touch((v: string) => setType(v as QuizOffers["bundleDiscountType"]))}
                disabled={disabled}
              />
            </div>
            <div style={{ width: 96, flexShrink: 0 }}>
              <TextField
                label="Amount"
                type="number"
                min={0}
                value={value}
                onChange={touch(setValue)}
                suffix={type === "percentage" ? "%" : undefined}
                disabled={disabled}
                autoComplete="off"
              />
            </div>
          </InlineStack>
          <TextField
            label="Minimum items"
            type="number"
            min={2}
            max={20}
            value={minQty}
            placeholder={String(defaultMin)}
            onChange={touch(setMinQty)}
            disabled={disabled}
            autoComplete="off"
            helpText={
              mode === "managed"
                ? `Shopify only applies the discount when the cart has at least this many items. Blank uses the bundle size (${defaultMin}) when you save; change it here if you change the bundle size later.`
                : `The quiz applies your code once the bundle has at least this many items. Blank = ${defaultMin}.`
            }
          />
          <TextField
            label="Note under the button"
            value={note}
            onChange={touch(setNote)}
            disabled={disabled}
            placeholder="Bundle savings applied at checkout"
            autoComplete="off"
          />
        </>
      )}
      {message && (
        <Banner tone={message.tone} onDismiss={() => setMessage(null)}>
          {message.text}
        </Banner>
      )}
      {bundleEnabled && initialOffers && (dirty || (mode === "managed" && !managedLive)) && (
        <InlineStack align="end">
          <Button variant="primary" loading={busy} disabled={disabled} onClick={() => void saveDiscount()}>
            {mode === "managed" && !offers?.bundleDiscountShopifyId ? "Create discount in Shopify" : "Save discount"}
          </Button>
        </InlineStack>
      )}
    </BlockStack>
  );
}

// ---------------------------------------------------------------------
// Upsell & cross-sell
// ---------------------------------------------------------------------

export function CrossSellEditor({
  offers: initialOffers,
  catalog,
  flow,
  chatBusy,
  onPreviewReload,
}: {
  offers: QuizOffers | null;
  catalog: OfferCatalogItem[] | null;
  flow: StudioFlow;
  chatBusy: boolean;
  onPreviewReload: () => void;
}) {
  // The saved row comes back on every save; the form keeps its own state,
  // so only the setter is needed (it keeps the hook's contract uniform).
  const [, setOffers] = useState<QuizOffers | null>(initialOffers);
  const [enabled, setEnabled] = useState(initialOffers?.crossSellEnabled ?? false);
  const [source, setSource] = useState(initialOffers?.crossSellSource ?? "manual");
  const [title, setTitle] = useState(initialOffers?.crossSellTitle ?? "");
  const [subtext, setSubtext] = useState(initialOffers?.crossSellSubtext ?? "");
  const [max, setMax] = useState(String(initialOffers?.crossSellMax ?? 3));
  const [items, setItems] = useState<CrossSellItem[]>(initialOffers?.crossSellItems ?? []);
  const [query, setQuery] = useState("");
  const save = useOffersAutosave(setOffers, onPreviewReload);

  const answerChoices = useMemo(() => {
    const out: Array<{ label: string; value: string }> = [{ label: "Always", value: "" }];
    for (const q of flow.questions) {
      for (const o of q.options) {
        if (o.selectAll) continue;
        out.push({
          label: `${q.prompt.trim() || q.axisKey}: ${o.label || o.axisValueValue}`.slice(0, 90),
          value: `${q.axisKey}=${o.axisValueValue}`,
        });
      }
    }
    return out;
  }, [flow]);

  const chosen = new Set(items.map((i) => i.productId));
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !catalog) return [];
    return catalog
      .filter((p) => !chosen.has(p.productId))
      .filter((p) => p.title.toLowerCase().includes(q) || (p.productType ?? "").toLowerCase().includes(q))
      .slice(0, 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, catalog, items]);

  const setItemsAndSave = (next: CrossSellItem[]) => {
    setItems(next);
    save.schedule({ crossSellItems: next }, true);
  };

  const disabled = chatBusy || !initialOffers;
  return (
    <BlockStack gap="400">
      <InlineStack align="space-between" blockAlign="center">
        <Text as="h3" variant="headingMd">
          Upsell &amp; cross-sell
        </Text>
        <SaveStateLine state={save.saveState} />
      </InlineStack>
      <Text as="p" variant="bodySm" tone="subdued">
        A &ldquo;complete the look&rdquo; row under the results with one-tap add-ons: glue, top coat, tools, refills.
        Products already in the shopper&rsquo;s matches are skipped.
      </Text>
      {!initialOffers && (
        <Banner tone="warning">Offers are still being set up on our side. Try again in a few minutes.</Banner>
      )}
      {save.error && (
        <Banner tone="critical" onDismiss={save.clearError}>
          {save.error}
        </Banner>
      )}
      <Checkbox
        label="Show add-ons under the results"
        checked={enabled}
        disabled={disabled}
        onChange={(v) => {
          setEnabled(v);
          save.schedule({ crossSellEnabled: v }, true);
        }}
      />
      {enabled && (
        <>
          <Select
            label="Which products"
            options={[
              { label: "Products I pick", value: "manual" },
              { label: "My picks, then Shopify's complementary products", value: "both" },
              { label: "Shopify's complementary products", value: "shopify" },
            ]}
            value={source}
            disabled={disabled}
            onChange={(v) => {
              setSource(v as QuizOffers["crossSellSource"]);
              save.schedule({ crossSellSource: v as QuizOffers["crossSellSource"] }, true);
            }}
            helpText={
              source === "manual"
                ? undefined
                : "Shopify suggests complementary products for the shopper's top match. Set them up in the free Shopify Search & Discovery app (Product recommendations → Complementary products)."
            }
          />
          <TextField
            label="Heading"
            value={title}
            placeholder="Complete the look"
            disabled={disabled}
            autoComplete="off"
            onChange={(v) => {
              setTitle(v);
              save.schedule({ crossSellTitle: v });
            }}
          />
          <TextField
            label="Line under the heading (optional)"
            value={subtext}
            placeholder="Pairs perfectly with your matches."
            disabled={disabled}
            autoComplete="off"
            onChange={(v) => {
              setSubtext(v);
              save.schedule({ crossSellSubtext: v });
            }}
          />
          <Select
            label="Show up to"
            options={["1", "2", "3", "4", "5", "6"].map((n) => ({ label: `${n} add-on${n === "1" ? "" : "s"}`, value: n }))}
            value={max}
            disabled={disabled}
            onChange={(v) => {
              setMax(v);
              save.schedule({ crossSellMax: Number(v) }, true);
            }}
          />
          {source !== "shopify" && (
            <BlockStack gap="200">
              <Text as="h4" variant="headingSm">
                Your add-ons ({items.length}/12)
              </Text>
              {items.length === 0 && (
                <Text as="p" variant="bodySm" tone="subdued">
                  Search your catalog below to add products.
                </Text>
              )}
              {items.map((item, idx) => (
                <div
                  key={item.productId}
                  style={{ border: "1px solid #E1E3E5", borderRadius: 10, padding: 8, display: "flex", flexDirection: "column", gap: 6 }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt="" style={{ width: 32, height: 32, borderRadius: 6, objectFit: "cover", flexShrink: 0 }} />
                    ) : (
                      <span style={{ width: 32, height: 32, borderRadius: 6, background: "#F1F1F1", flexShrink: 0 }} />
                    )}
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.title}
                    </span>
                    <button
                      aria-label={`Remove ${item.title}`}
                      disabled={disabled}
                      onClick={() => setItemsAndSave(items.filter((_, i) => i !== idx))}
                      style={{ border: 0, background: "transparent", cursor: "pointer", padding: 2, display: "inline-flex" }}
                    >
                      <span style={{ width: 16, height: 16, display: "inline-flex" }}>
                        <Icon source={XSmallIcon} tone="subdued" />
                      </span>
                    </button>
                  </div>
                  <Select
                    label="Show"
                    labelInline
                    options={answerChoices}
                    value={item.when ? `${item.when.axisKey}=${item.when.axisValue}` : ""}
                    disabled={disabled}
                    onChange={(v) => {
                      const [axisKey, axisValue] = v ? v.split("=") : [];
                      setItemsAndSave(
                        items.map((it, i) => (i === idx ? { ...it, when: axisKey && axisValue ? { axisKey, axisValue } : null } : it)),
                      );
                    }}
                  />
                </div>
              ))}
              {items.length < 12 && (
                <BlockStack gap="100">
                  <TextField
                    label="Add a product"
                    labelHidden
                    value={query}
                    onChange={setQuery}
                    placeholder={catalog ? "Search your products…" : "Loading your catalog…"}
                    disabled={disabled || !catalog}
                    autoComplete="off"
                  />
                  {matches.map((p) => (
                    <button
                      key={p.productId}
                      className="studio-tree-row"
                      style={{ height: "auto", padding: "6px 8px" }}
                      onClick={() => {
                        setItemsAndSave([
                          ...items,
                          { productId: p.productId, handle: p.handle, title: p.title, imageUrl: p.imageUrl, when: null },
                        ]);
                        setQuery("");
                      }}
                    >
                      {p.imageUrl ? (
                        <img src={p.imageUrl} alt="" style={{ width: 24, height: 24, borderRadius: 4, objectFit: "cover", flexShrink: 0 }} />
                      ) : (
                        <span style={{ width: 24, height: 24, borderRadius: 4, background: "#F1F1F1", flexShrink: 0 }} />
                      )}
                      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.title}</span>
                    </button>
                  ))}
                  {query.trim() && catalog && matches.length === 0 && (
                    <Text as="p" variant="bodySm" tone="subdued">
                      No products match &ldquo;{query.trim()}&rdquo;.
                    </Text>
                  )}
                </BlockStack>
              )}
            </BlockStack>
          )}
        </>
      )}
    </BlockStack>
  );
}
