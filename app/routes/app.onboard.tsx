// Overhaul install flow (Part 3): M1 Scope -> M2 Build -> M3 Reveal.
//
// The one-sentence goal: within 5 minutes of install a merchant sees a
// finished, good-looking quiz in their own fonts and colors, built from
// their catalog — and publishes in one more click. Exactly one question
// (scope) before the build; goals/attribution move to after publish.
//
// Gated: only shops with overhaul_enabled (or OVERHAUL_ONBOARDING=true)
// land here (app._index redirects); everyone else keeps the wizard.

import { useCallback, useEffect, useRef, useState } from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import jwt from "jsonwebtoken";
import { authenticate } from "../shopify.server";
import { supabase } from "../lib/supabase.server";
import { useCatalogSync } from "../lib/use-catalog-sync";
import { TEMPLATE_IDS, TEMPLATES, type TemplateId } from "../lib/quiz-templates";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await supabase
    .from("shops")
    .select("id, overhaul_enabled, catalog_product_count")
    .eq("shop_domain", session.shop)
    .single();
  if (shop.error) throw new Response("Shop not found", { status: 404 });
  const flagOn = process.env.OVERHAUL_ONBOARDING === "true" || shop.data.overhaul_enabled;
  if (!flagOn) return redirect("/app");

  const secret = process.env.SHOPIFY_API_SECRET ?? "";
  const previewToken = secret
    ? jwt.sign({ shopId: shop.data.id, shopDomain: session.shop }, secret, { expiresIn: "2h" })
    : "";

  return json({
    shopDomain: session.shop,
    previewToken,
    templates: TEMPLATE_IDS.map((id) => ({
      id,
      name: TEMPLATES[id].name,
      ineligibleReason: TEMPLATES[id].ineligibleReason,
      presets: TEMPLATES[id].presets.map((p) => ({
        id: p.id,
        label: p.label,
        bg: p.tokens.colorBg,
        accent: p.tokens.colorAccent,
      })),
    })),
  });
};

// ---------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------

type ScopeChip = {
  kind: "all" | "collection" | "type" | "tag" | "freetext";
  label: string;
  detail: string;
  productIds: string[] | null;
  count: number;
};

type Stage = { key: string; label: string; detail: string; state: "pending" | "active" | "done" | "retry" };

const STAGE_DEFS: Array<[string, string]> = [
  ["catalog", "Reading your catalog…"],
  ["theme", "Learning your theme…"],
  ["questions", "Writing your questions…"],
  ["matching", "Matching answers to products…"],
  ["styling", "Styling it like your store…"],
];

const MIN_STAGE_MS = 1200;

function post(url: string, fields: Record<string, string>): Promise<any> {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fetch(url, { method: "POST", body: fd }).then((r) => r.json());
}

function fireEvent(event: string, properties: Record<string, unknown> = {}) {
  void post("/app/api/overhaul-event", { event, properties: JSON.stringify(properties) }).catch(() => {});
}

export default function Onboard() {
  const data = useLoaderData<typeof loader>();
  const [screen, setScreen] = useState<"scope" | "build" | "reveal">("scope");
  const [chips, setChips] = useState<ScopeChip[] | null>(null);
  const [selected, setSelected] = useState(0);
  const [freeText, setFreeText] = useState("");
  const [freeState, setFreeState] = useState<{ resolving: boolean; result: ScopeChip | null; narrow: boolean }>({
    resolving: false,
    result: null,
    narrow: false,
  });
  const [stages, setStages] = useState<Stage[]>(
    STAGE_DEFS.map(([key, label]) => ({ key, label, detail: "", state: "pending" }))
  );
  const [buildError, setBuildError] = useState<string | null>(null);
  const [assignment, setAssignment] = useState<{ template: TemplateId; chip: string } | null>(null);
  const [activeTemplate, setActiveTemplate] = useState<TemplateId | null>(null);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const [publishState, setPublishState] = useState<{ busy: boolean; liveUrl: string | null; error: string | null }>({
    busy: false,
    liveUrl: null,
    error: null,
  });
  const [previewNonce, setPreviewNonce] = useState(0);
  // Bridge the fetcher-driven sync hook into an awaitable for the staged
  // build sequence.
  const syncResolveRef = useRef<(() => void) | null>(null);
  const syncRejectRef = useRef<((e: Error) => void) | null>(null);
  const sync = useCatalogSync({
    onComplete: () => {
      syncResolveRef.current?.();
      syncResolveRef.current = null;
    },
  });
  useEffect(() => {
    if (sync.syncError && syncRejectRef.current) {
      syncRejectRef.current(new Error(sync.syncError));
      syncRejectRef.current = null;
    }
  }, [sync.syncError]);
  const startedRef = useRef(false);

  // M1 data: chips (skeleton <= 3s while sync warms the first page).
  useEffect(() => {
    fireEvent("install_completed", {});
    fetch("/app/api/scope-options")
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) throw new Error(d.error);
        setChips(d.chips);
        if (d.skipScreen) startBuild(d.chips?.[0] ?? { kind: "all", label: "Everything", detail: "", productIds: null, count: 0 });
      })
      .catch(() => setChips([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setStage = useCallback((key: string, patch: Partial<Stage>) => {
    setStages((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  }, []);

  /** Sequenced stage runner: each stage shows >= MIN_STAGE_MS even when
   * its real work finished instantly — fast builds still read as work. */
  const stageDone = useCallback(
    async (key: string, detail: string, startedAt: number) => {
      const wait = Math.max(0, MIN_STAGE_MS - (Date.now() - startedAt));
      if (wait) await new Promise((r) => setTimeout(r, wait));
      setStage(key, { state: "done", detail });
    },
    [setStage]
  );

  const startBuild = useCallback(
    async (chip: ScopeChip) => {
      if (startedRef.current) return;
      startedRef.current = true;
      setScreen("build");
      fireEvent("scope_selected", { kind: chip.kind, count: chip.count });

      try {
        // Stage 1 — catalog sync (real progress from the sync loop).
        let t0 = Date.now();
        setStage("catalog", { state: "active" });
        await new Promise<void>((resolve, reject) => {
          syncResolveRef.current = resolve;
          syncRejectRef.current = reject;
          sync.start();
        });
        await stageDone("catalog", `${sync.syncedCount || "All"} products`, t0);

        // Stage 2 — brand extraction.
        t0 = Date.now();
        setStage("theme", { state: "active" });
        let profile: any = null;
        try {
          const ex = await post("/app/api/brand-profile", { intent: "extract" });
          if (ex.ok) profile = ex.profile;
        } catch {
          /* preset fallback below */
        }
        const themeDetail = profile
          ? `${/serif/i.test(profile.tokens.fontHeading) && !/sans-serif/i.test(profile.tokens.fontHeading) ? "Serif headings" : "Clean sans headings"} · ${profile.confidence} confidence`
          : "Styled with a neutral preset";
        await stageDone("theme", themeDetail, t0);

        // Stages 3+4 — generation (SSE phases map onto the two rows).
        t0 = Date.now();
        setStage("questions", { state: "active" });
        const fd = new FormData();
        fd.append("category", profile?.category ?? "");
        fd.append("brandVoice", profile?.tone ?? "");
        fd.append("quizLength", "standard");
        fd.append("modePreference", "auto");
        fd.append("scopeKind", chip.kind);
        fd.append("scopeLabel", chip.label);
        fd.append("scopeProductIds", JSON.stringify(chip.productIds));
        if (profile?.tokens?.colorAccent) fd.append("accentColor", profile.tokens.colorAccent);
        const res = await fetch("/app/api/quiz-generate", { method: "POST", body: fd });
        if (!res.ok || !res.body) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error ?? `Generation failed (${res.status})`);
        }
        let matchingStarted = false;
        let genSummary: any = null;
        let genError: string | null = null;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const events = buf.split("\n\n");
          buf = events.pop() ?? "";
          for (const raw of events) {
            const line = raw.split("\n").find((l) => l.startsWith("data:"));
            if (!line) continue;
            let evt: any;
            try {
              evt = JSON.parse(line.slice(5));
            } catch {
              continue;
            }
            if (evt.type === "progress" && /saving/i.test(String(evt.phase ?? "")) && !matchingStarted) {
              matchingStarted = true;
              await stageDone("questions", "Questions drafted", t0);
              t0 = Date.now();
              setStage("matching", { state: "active" });
            }
            if (evt.type === "result") genSummary = evt.summary;
            if (evt.type === "error") genError = evt.error;
          }
        }
        if (genError) throw new Error(genError);
        if (!matchingStarted) {
          await stageDone("questions", "Questions drafted", t0);
          t0 = Date.now();
          setStage("matching", { state: "active" });
        }
        await stageDone(
          "matching",
          genSummary ? `${genSummary.questions} questions · ${genSummary.rules || "AI"} matching` : "Answers mapped",
          t0
        );

        // Stage 5 — template assignment.
        t0 = Date.now();
        setStage("styling", { state: "active" });
        const tpl: TemplateId = profile?.templateAssignment?.template ?? "t2";
        await post("/app/api/quiz-template", { intent: "set", template: tpl });
        setActiveTemplate(tpl);
        setAssignment({
          template: tpl,
          chip: profile
            ? `Matched to your theme · ${profile.confidence === "low" ? "neutral preset" : "your fonts & palette"}`
            : "Styled with a neutral preset — tap to match your brand",
        });
        await stageDone("styling", TEMPLATES[tpl].name, t0);

        setScreen("reveal");
        setPreviewNonce((n) => n + 1);
        fireEvent("reveal_viewed", { template: tpl });
      } catch (e) {
        setBuildError((e as Error).message);
      }
    },
    [setStage, stageDone, sync]
  );

  const resolveFreeText = useCallback(async () => {
    if (!freeText.trim()) return;
    setFreeState({ resolving: true, result: null, narrow: false });
    const d = await post("/app/api/scope-options", { intent: "resolve-freetext", query: freeText });
    if (!d.ok) {
      setFreeState({ resolving: false, result: null, narrow: false });
      return;
    }
    const chip: ScopeChip = {
      kind: "freetext",
      label: d.label,
      detail: `${d.count} products`,
      productIds: d.productIds,
      count: d.count,
    };
    setFreeState({ resolving: false, result: chip, narrow: d.count < 5 });
  }, [freeText]);

  const switchTemplate = useCallback(
    async (tpl: TemplateId, preset?: string) => {
      if (switching) return;
      setSwitching(true);
      const r = await post("/app/api/quiz-template", {
        intent: "set",
        template: tpl,
        ...(preset ? { preset } : {}),
      });
      if (r.ok) {
        setActiveTemplate(tpl);
        if (preset) setActivePreset(preset);
        setPreviewNonce((n) => n + 1);
      }
      setSwitching(false);
    },
    [switching]
  );

  const openStorePreview = useCallback(async () => {
    const r = await post("/app/api/publish-quiz", { intent: "preview-link", draftId: "live" });
    if (r.ok) {
      fireEvent("store_preview_opened", {});
      window.open(r.url, "_blank");
    }
  }, []);

  const publish = useCallback(async () => {
    setPublishState({ busy: true, liveUrl: null, error: null });
    const r = await post("/app/api/publish-quiz", { intent: "publish" });
    setPublishState({ busy: false, liveUrl: r.ok ? r.liveUrl : null, error: r.ok ? null : r.error });
  }, []);

  // ------------------------------------------------------------------
  const S = styles;
  const currentChip: ScopeChip | null =
    freeState.result && selected === -1 ? freeState.result : chips?.[selected] ?? null;

  return (
    <div style={S.page}>
      <style>{`@keyframes gq-onboard-spin { to { transform: rotate(360deg); } }`}</style>
      {screen === "scope" && (
        <div style={S.card}>
          <h1 style={S.h1}>What should this quiz help shoppers find?</h1>
          <p style={S.sub}>We'll build it from your catalog — you can change everything after.</p>
          <div style={S.chipWrap}>
            {chips === null &&
              [0, 1, 2].map((i) => <div key={i} style={{ ...S.chip, opacity: 0.35, width: 160 }}>&nbsp;</div>)}
            {(chips ?? []).map((c, i) => (
              <button
                key={`${c.kind}-${c.label}`}
                type="button"
                style={{ ...S.chip, ...(selected === i ? S.chipOn : {}) }}
                onClick={() => setSelected(i)}
              >
                <strong>{c.label}</strong>
                <span style={S.chipDetail}>{c.detail}</span>
              </button>
            ))}
            {chips !== null && (
              <button
                type="button"
                style={{ ...S.chip, ...(selected === -1 ? S.chipOn : {}) }}
                onClick={() => setSelected(-1)}
              >
                <strong>Something else…</strong>
              </button>
            )}
          </div>
          {selected === -1 && (
            <div style={{ marginTop: 16 }}>
              <input
                style={S.input}
                placeholder="e.g. only lip products"
                value={freeText}
                onChange={(e) => setFreeText(e.target.value)}
                onBlur={resolveFreeText}
                onKeyDown={(e) => e.key === "Enter" && resolveFreeText()}
              />
              {freeState.resolving && <p style={S.note}>Finding those products…</p>}
              {freeState.result && freeState.narrow && (
                <p style={S.note}>
                  That's only {freeState.result.count} products — include your whole catalog too?{" "}
                  <button type="button" style={S.link} onClick={() => setSelected(0)}>
                    Yes, include everything
                  </button>
                </p>
              )}
              {freeState.result && !freeState.narrow && (
                <p style={S.note}>{freeState.result.count} products matched.</p>
              )}
            </div>
          )}
          <button
            type="button"
            style={{ ...S.cta, opacity: currentChip && !freeState.resolving ? 1 : 0.5 }}
            disabled={!currentChip || freeState.resolving}
            onClick={() => currentChip && startBuild(currentChip)}
          >
            Build my quiz
          </button>
        </div>
      )}

      {screen === "build" && (
        <div style={S.card}>
          <div style={S.stageList}>
            {stages.map((s) => (
              <div key={s.key} style={S.stageRow}>
                <span style={S.stageIcon}>
                  {s.state === "done" ? "✓" : s.state === "active" ? <Spinner /> : "○"}
                </span>
                <span style={{ opacity: s.state === "pending" ? 0.4 : 1 }}>
                  <strong>{s.label}</strong>
                  {s.detail && <span style={S.stageDetail}> {s.detail}</span>}
                </span>
              </div>
            ))}
          </div>
          {!buildError && (
            <p style={S.note}>This takes about a minute. Nothing goes live until you publish.</p>
          )}
          {buildError && (
            <div style={S.errorCard}>
              <p style={{ margin: 0 }}>We couldn't finish building. {buildError}</p>
              <button
                type="button"
                style={S.cta}
                onClick={() => {
                  startedRef.current = false;
                  setBuildError(null);
                  setStages(STAGE_DEFS.map(([key, label]) => ({ key, label, detail: "", state: "pending" })));
                  currentChip && startBuild(currentChip);
                }}
              >
                Try again
              </button>
            </div>
          )}
        </div>
      )}

      {screen === "reveal" && (
        <div style={S.revealWrap}>
          <div style={S.revealTop}>
            <h1 style={{ ...S.h1, margin: 0, fontSize: 22 }}>Your quiz is ready. Here it is on your store.</h1>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" style={S.secondaryBtn} onClick={openStorePreview}>
                Preview on my store
              </button>
              <button type="button" style={S.cta2} disabled={publishState.busy} onClick={publish}>
                {publishState.busy ? "Publishing…" : "Publish"}
              </button>
            </div>
          </div>
          <div style={S.styleBar}>
            {assignment && <span style={S.matchChip}>{assignment.chip}</span>}
            {data.templates.map((t) => (
              <button
                key={t.id}
                type="button"
                style={{
                  ...S.tplChip,
                  ...(activeTemplate === t.id ? S.tplChipOn : {}),
                }}
                disabled={switching}
                onClick={() => switchTemplate(t.id as TemplateId)}
              >
                {t.name}
              </button>
            ))}
            <span style={{ width: 12 }} />
            {activeTemplate &&
              data.templates
                .find((t) => t.id === activeTemplate)!
                .presets.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    title={p.label}
                    style={{
                      ...S.swatch,
                      background: `linear-gradient(135deg, ${p.bg} 60%, ${p.accent} 60%)`,
                      outline: activePreset === p.id ? "2px solid #16161a" : "1px solid #d9d6d2",
                    }}
                    disabled={switching}
                    onClick={() => switchTemplate(activeTemplate, p.id)}
                  />
                ))}
          </div>
          {publishState.liveUrl && (
            <div style={S.successBar}>
              Live at{" "}
              <a href={publishState.liveUrl} target="_blank" rel="noreferrer">
                {publishState.liveUrl.replace(/^https:\/\//, "")}
              </a>{" "}
              — added to your store.
            </div>
          )}
          {publishState.error && <div style={S.errorCard}>{publishState.error}</div>}
          <iframe
            key={previewNonce}
            title="Quiz preview"
            style={S.previewFrame}
            src={`/quiz-preview.html?token=${encodeURIComponent(data.previewToken)}&n=${previewNonce}`}
          />
          <p style={{ ...S.note, textAlign: "center" }}>
            <a href="/app?open=studio" style={S.link} onClick={() => fireEvent("studio_opened", { source: "reveal" })}>
              Edit in Quiz Studio
            </a>
          </p>
        </div>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <span
      style={{
        display: "inline-block",
        width: 12,
        height: 12,
        border: "2px solid #d9d6d2",
        borderTopColor: "#16161a",
        borderRadius: "50%",
        animation: "gq-onboard-spin 0.8s linear infinite",
      }}
    />
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "#faf9f7",
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "center",
    padding: "48px 20px",
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    color: "#16161a",
  },
  card: { width: "100%", maxWidth: 640, background: "#fff", borderRadius: 16, padding: 32, boxShadow: "0 1px 2px rgba(22,22,26,.05), 0 12px 32px rgba(22,22,26,.07)" },
  h1: { fontSize: 26, margin: "0 0 8px", fontWeight: 700 },
  sub: { margin: "0 0 24px", color: "#6b6b74", fontSize: 15 },
  chipWrap: { display: "flex", flexWrap: "wrap", gap: 10 },
  chip: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2, padding: "12px 16px", borderRadius: 12, border: "1px solid #e3e0dc", background: "#fff", cursor: "pointer", fontSize: 14, textAlign: "left" },
  chipOn: { borderColor: "#16161a", boxShadow: "0 0 0 1px #16161a" },
  chipDetail: { fontSize: 12, color: "#9c9ca4" },
  input: { width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #e3e0dc", fontSize: 14 },
  note: { fontSize: 13, color: "#6b6b74", marginTop: 14 },
  link: { color: "#16161a", textDecoration: "underline", background: "none", border: 0, cursor: "pointer", padding: 0, fontSize: 13 },
  cta: { marginTop: 24, padding: "13px 28px", borderRadius: 12, background: "#16161a", color: "#fff", border: 0, fontSize: 15, fontWeight: 700, cursor: "pointer" },
  cta2: { padding: "10px 22px", borderRadius: 10, background: "#16161a", color: "#fff", border: 0, fontSize: 14, fontWeight: 700, cursor: "pointer" },
  secondaryBtn: { padding: "10px 22px", borderRadius: 10, background: "#fff", color: "#16161a", border: "1px solid #16161a", fontSize: 14, fontWeight: 600, cursor: "pointer" },
  stageList: { display: "flex", flexDirection: "column", gap: 16, padding: "8px 0" },
  stageRow: { display: "flex", alignItems: "center", gap: 12, fontSize: 15 },
  stageIcon: { width: 20, textAlign: "center", color: "#117a5b" },
  stageDetail: { color: "#6b6b74", fontWeight: 400, marginLeft: 6, fontSize: 13 },
  errorCard: { marginTop: 16, padding: 16, borderRadius: 12, background: "#fdf1f0", border: "1px solid #f2c6c2", fontSize: 14 },
  revealWrap: { width: "100%", maxWidth: 1100, display: "flex", flexDirection: "column", gap: 14 },
  revealTop: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" },
  styleBar: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  matchChip: { fontSize: 12.5, padding: "6px 12px", borderRadius: 999, background: "#eef4f1", color: "#1d5c48", fontWeight: 600 },
  tplChip: { fontSize: 13, padding: "7px 14px", borderRadius: 999, border: "1px solid #e3e0dc", background: "#fff", cursor: "pointer" },
  tplChipOn: { borderColor: "#16161a", boxShadow: "0 0 0 1px #16161a", fontWeight: 700 },
  swatch: { width: 26, height: 26, borderRadius: "50%", border: 0, cursor: "pointer" },
  previewFrame: { width: "100%", height: "68vh", border: "1px solid #e3e0dc", borderRadius: 14, background: "#fff" },
  successBar: { padding: "12px 16px", borderRadius: 10, background: "#eef7f0", border: "1px solid #bfe3c8", fontSize: 14 },
};
