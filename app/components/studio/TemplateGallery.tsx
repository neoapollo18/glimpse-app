import { useMemo, useState } from "react";
import { Button, Text } from "@shopify/polaris";
import {
  TEMPLATE_IDS,
  TEMPLATE_STYLES,
  TEMPLATES,
  isVisualQuestion,
  type TemplateId,
} from "../../lib/quiz-templates";
import type { StudioFlow } from "./types";

// V3-SPEC Part 7: the Templates gallery is a top-level rail item that
// opens full-screen inside the Studio. Every card is a THREE-SCREEN STRIP
// (intro · the first visual question · results) rendered live from this
// merchant's own quiz by the preview document. Every template carries its
// OWN design (TEMPLATE_STYLES), so the gallery is a set of genuinely
// different styles and the merchant picks the one that looks like their
// store. Never stock screenshots. Ineligible templates dim with their
// reason chip and a link into the Images rail.

const SCALE = 0.4;
const MINI_HEIGHT = 236;
const STRIP_GAP = 8;

const GALLERY_CSS = `
  .gq-gal { display: flex; flex-direction: column; min-height: 100%; background: #fff; }
  .gq-gal-head { display: flex; align-items: center; gap: 20px; padding: 18px 28px; border-bottom: 1px solid #E1E3E5; position: sticky; top: 0; background: rgba(255,255,255,.96); backdrop-filter: blur(6px); z-index: 2; }
  .gq-gal-close { margin-left: auto; width: 32px; height: 32px; border-radius: 8px; border: 1px solid #E1E3E5; background: #fff; color: #6D7175; cursor: pointer; font-size: 14px; transition: background 120ms ease; }
  .gq-gal-close:hover { background: #F6F6F7; }
  .gq-gal-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; padding: 24px 28px 40px; max-width: 1240px; margin: 0 auto; width: 100%; box-sizing: border-box; }
  .gq-gcard { position: relative; border: 1px solid #E1E3E5; border-radius: 14px; background: #fff; overflow: hidden; transition: border-color 150ms ease, box-shadow 150ms ease, opacity 150ms ease; }
  .gq-gcard[data-current="true"] { border-color: #1A1C1E; box-shadow: 0 0 0 1px #1A1C1E; }
  .gq-gcard[data-span="true"] { grid-column: 1 / -1; max-width: 610px; }
  .gq-chip { position: absolute; top: 12px; left: 12px; z-index: 3; font-size: 11px; font-weight: 700; border-radius: 999px; padding: 4px 11px; letter-spacing: .02em; }
  .gq-chip[data-kind="current"] { background: #1A1C1E; color: #fff; }
  .gq-chip[data-kind="reason"] { background: #FFF4D6; color: #7A5A00; border: 1px solid #F1D48A; }
  .gq-strip { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: ${STRIP_GAP}px; padding: 12px 12px 0; background: var(--gq-strip-bg, #F6F6F7); border-bottom: 1px solid #E1E3E5; }
  .gq-mini { position: relative; height: ${MINI_HEIGHT + 22}px; }
  .gq-mini-frame { height: ${MINI_HEIGHT}px; overflow: hidden; border-radius: 8px; border: 1px solid #E1E3E5; background: #fff; position: relative; }
  .gq-mini-frame iframe { position: absolute; top: 0; left: 0; border: 0; pointer-events: none; display: block; transform-origin: top left; }
  .gq-mini-lbl { display: block; text-align: center; font-size: 10px; font-weight: 700; letter-spacing: .12em; color: #8A8F98; padding-top: 6px; }
  .gq-meta { display: flex; align-items: flex-start; gap: 14px; padding: 14px 16px 16px; }
  .gq-meta-text { min-width: 0; flex: 1; }
  .gq-meta-name { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .gq-style-pill { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; letter-spacing: .02em; color: #303030; background: #F1F1F1; border-radius: 999px; padding: 3px 9px 3px 4px; }
  .gq-style-dot { width: 13px; height: 13px; border-radius: 999px; box-shadow: inset 0 0 0 1px rgba(0,0,0,.12); }
  .gq-meta-tag { font-size: 12.5px; color: #4A4D52; margin: 6px 0 4px; }
  .gq-meta-q { font-size: 13px; color: #4A4D52; margin: 2px 0 4px; font-style: italic; }
  .gq-meta-shape { font-size: 12px; color: #6D7175; }
  .gq-fix { border: 0; background: none; padding: 0; color: #2C6ECB; font-weight: 600; font-size: 12.5px; cursor: pointer; }
  @media (max-width: 1100px) { .gq-gal-grid { grid-template-columns: 1fr; } .gq-gcard[data-span="true"] { max-width: none; } }
`;

function MiniScreen({
  src,
  label,
  title,
}: {
  src: string | null;
  label: string;
  title: string;
}) {
  return (
    <div className="gq-mini">
      <div className="gq-mini-frame">
        {src ? (
          <MiniFrame src={src} title={title} />
        ) : (
          <div style={{ padding: 12, fontSize: 11, color: "#6D7175" }}>Preview unavailable</div>
        )}
      </div>
      <span className="gq-mini-lbl">{label}</span>
    </div>
  );
}

/** Renders the preview document at (1 / SCALE) of the mini's box and
 * scales it down, so the widget lays out at a real viewport width. */
function MiniFrame({ src, title }: { src: string; title: string }) {
  return (
    <iframe
      title={title}
      src={src}
      loading="lazy"
      style={{
        width: `${Math.round(100 / SCALE)}%`,
        height: MINI_HEIGHT / SCALE,
        transform: `scale(${SCALE})`,
      }}
    />
  );
}

export function TemplateGallery({
  previewToken,
  currentTemplate,
  eligible,
  flow,
  busy,
  onUse,
  onKeep,
  onFixImages,
  onClose,
}: {
  previewToken: string | null;
  currentTemplate: TemplateId | null;
  eligible: TemplateId[];
  flow: StudioFlow | null;
  busy: boolean;
  onUse: (template: TemplateId) => void;
  onKeep: () => void;
  onFixImages: () => void;
  onClose: () => void;
}) {
  const [pending, setPending] = useState<TemplateId | null>(null);

  // The question strip shows the first VISUAL question (spec Part 7): it
  // is the screen where templates differ most. Text-only quizzes fall
  // back to Q1.
  const questionStep = useMemo(() => {
    const qs = flow?.questions ?? [];
    const idx = qs.findIndex((q) =>
      isVisualQuestion({
        axisKey: q.axisKey,
        prompt: q.prompt,
        options: q.options.map((o) => ({
          label: o.label,
          axisValueValue: o.axisValueValue,
          imageUrl: o.imageUrl ?? null,
          selectAll: o.selectAll,
          displayMeta: o.displayMeta ?? null,
        })),
      }),
    );
    return `q${(idx >= 0 ? idx : 0) + 1}`;
  }, [flow]);

  const srcFor = (id: TemplateId, step: string) =>
    previewToken
      ? `/quiz-preview.html?token=${encodeURIComponent(previewToken)}&template=${id}&step=${step}`
      : null;

  return (
    <div className="gq-gal">
      <style dangerouslySetInnerHTML={{ __html: GALLERY_CSS }} />
      <div className="gq-gal-head">
        <div>
          <Text as="h2" variant="headingLg">
            What should your quiz do?
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            Each template has its own style. Pick the one that feels like your store; switching never loses your
            content, and your colors can be fine-tuned in Style.
          </Text>
        </div>
        <button className="gq-gal-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>

      <div className="gq-gal-grid">
        {TEMPLATE_IDS.map((id) => {
          const def = TEMPLATES[id];
          const isCurrent = currentTemplate === id;
          // t5 is always eligible: it is where every other template degrades.
          const isEligible = id === "t5" || eligible.includes(id);
          const style = TEMPLATE_STYLES[id];
          return (
            <div
              key={id}
              className="gq-gcard"
              data-current={isCurrent}
              data-ineligible={!isEligible}
              data-span={id === "t5"}
              style={{ ["--gq-strip-bg" as string]: style.tokens.colorBg }}
            >
              {isCurrent && (
                <span className="gq-chip" data-kind="current">
                  Current
                </span>
              )}
              {!isCurrent && !isEligible && def.ineligibleReason && (
                <span className="gq-chip" data-kind="reason">
                  {def.ineligibleReason}
                </span>
              )}
              <div className="gq-strip">
                <MiniScreen src={srcFor(id, "intro")} label="INTRO" title={`${def.name} intro`} />
                <MiniScreen src={srcFor(id, questionStep)} label="QUESTION" title={`${def.name} question`} />
                <MiniScreen src={srcFor(id, "results")} label="RESULTS" title={`${def.name} results`} />
              </div>
              <div className="gq-meta">
                <div className="gq-meta-text">
                  <div className="gq-meta-name">
                    <Text as="h3" variant="headingSm">
                      {def.name}
                    </Text>
                    <span className="gq-style-pill">
                      <span className="gq-style-dot" style={{ background: style.tokens.colorAccent }} />
                      {style.name} style
                    </span>
                  </div>
                  <div className="gq-meta-tag">{style.tagline}</div>
                  <div className="gq-meta-q">“{def.shopperQuestion}”</div>
                  <div className="gq-meta-shape">
                    {def.questionRangeLabel} · {def.resultsShapeLabel}
                  </div>
                </div>
                {isCurrent ? (
                  <Button disabled={busy} loading={busy && pending === id} onClick={() => {
                    setPending(id);
                    onKeep();
                  }}>
                    Keep
                  </Button>
                ) : (
                  // Image gates are advisory: every template can be used.
                  // A thin-imagery warning (chip above) links to Images.
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                    <Button
                      variant="primary"
                      loading={busy && pending === id}
                      disabled={busy}
                      onClick={() => {
                        setPending(id);
                        onUse(id);
                      }}
                    >
                      Use this template
                    </Button>
                    {!isEligible && (
                      <button className="gq-fix" onClick={onFixImages}>
                        Add images →
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
