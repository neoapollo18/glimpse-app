import { useMemo, useState } from "react";
import { Button, Text } from "@shopify/polaris";
import {
  LOOKS,
  LOOK_IDS,
  TEMPLATE_IDS,
  TEMPLATES,
  isVisualQuestion,
  type LookId,
  type TemplateId,
} from "../../lib/quiz-templates";
import type { StudioFlow } from "./types";

// V3-SPEC Part 7: the Templates gallery is a top-level rail item that
// opens full-screen inside the Studio. Every card is a THREE-SCREEN STRIP
// (intro · the first visual question · results) rendered live from this
// merchant's own quiz by the preview document, with the chosen Look
// applied, so Look and Template read as independent. Never stock
// screenshots. Ineligible templates dim with their reason chip and a link
// into the Images rail.

const SCALE = 0.4;
const MINI_HEIGHT = 236;
const STRIP_GAP = 8;

const GALLERY_CSS = `
  .gq-gal { display: flex; flex-direction: column; min-height: 100%; background: #fff; }
  .gq-gal-head { display: flex; align-items: center; gap: 20px; padding: 18px 28px; border-bottom: 1px solid #E1E3E5; position: sticky; top: 0; background: rgba(255,255,255,.96); backdrop-filter: blur(6px); z-index: 2; }
  .gq-gal-looks { display: inline-flex; gap: 2px; padding: 3px; border: 1px solid #E1E3E5; border-radius: 999px; background: #F6F6F7; margin-left: auto; }
  .gq-gal-look { border: 0; border-radius: 999px; padding: 6px 14px; font-size: 12.5px; font-weight: 600; color: #6D7175; background: transparent; cursor: pointer; transition: background 120ms ease, color 120ms ease; }
  .gq-gal-look:hover { color: #202223; }
  .gq-gal-look[data-on="true"] { background: #1A1C1E; color: #fff; }
  .gq-gal-close { width: 32px; height: 32px; border-radius: 8px; border: 1px solid #E1E3E5; background: #fff; color: #6D7175; cursor: pointer; font-size: 14px; transition: background 120ms ease; }
  .gq-gal-close:hover { background: #F6F6F7; }
  .gq-gal-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; padding: 24px 28px 40px; max-width: 1240px; margin: 0 auto; width: 100%; box-sizing: border-box; }
  .gq-gcard { position: relative; border: 1px solid #E1E3E5; border-radius: 14px; background: #fff; overflow: hidden; transition: border-color 150ms ease, box-shadow 150ms ease, opacity 150ms ease; }
  .gq-gcard[data-current="true"] { border-color: #1A1C1E; box-shadow: 0 0 0 1px #1A1C1E; }
  .gq-gcard[data-ineligible="true"] .gq-strip, .gq-gcard[data-ineligible="true"] .gq-meta-text { opacity: .4; }
  .gq-gcard[data-span="true"] { grid-column: 1 / -1; max-width: 610px; }
  .gq-chip { position: absolute; top: 12px; left: 12px; z-index: 3; font-size: 11px; font-weight: 700; border-radius: 999px; padding: 4px 11px; letter-spacing: .02em; }
  .gq-chip[data-kind="current"] { background: #1A1C1E; color: #fff; }
  .gq-chip[data-kind="reason"] { background: #FFF4D6; color: #7A5A00; border: 1px solid #F1D48A; }
  .gq-strip { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: ${STRIP_GAP}px; padding: 12px 12px 0; background: #F6F6F7; border-bottom: 1px solid #E1E3E5; }
  .gq-mini { position: relative; height: ${MINI_HEIGHT + 22}px; }
  .gq-mini-frame { height: ${MINI_HEIGHT}px; overflow: hidden; border-radius: 8px; border: 1px solid #E1E3E5; background: #fff; position: relative; }
  .gq-mini-frame iframe { position: absolute; top: 0; left: 0; border: 0; pointer-events: none; display: block; transform-origin: top left; }
  .gq-mini-lbl { display: block; text-align: center; font-size: 10px; font-weight: 700; letter-spacing: .12em; color: #8A8F98; padding-top: 6px; }
  .gq-meta { display: flex; align-items: flex-start; gap: 14px; padding: 14px 16px 16px; }
  .gq-meta-text { min-width: 0; flex: 1; }
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
  currentLook,
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
  /** The saved/derived Look; the switcher starts here. */
  currentLook: LookId;
  eligible: TemplateId[];
  flow: StudioFlow | null;
  busy: boolean;
  /** `look` is the switcher's value when it differs from currentLook, else null. */
  onUse: (template: TemplateId, look: LookId | null) => void;
  onKeep: (look: LookId | null) => void;
  onFixImages: () => void;
  onClose: () => void;
}) {
  const [look, setLook] = useState<LookId>(currentLook);
  const [pending, setPending] = useState<TemplateId | null>(null);
  const lookDelta: LookId | null = look !== currentLook ? look : null;

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
      ? `/quiz-preview.html?token=${encodeURIComponent(previewToken)}&template=${id}&look=${look}&step=${step}`
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
            Switching never loses your content.
          </Text>
        </div>
        <div className="gq-gal-looks" role="radiogroup" aria-label="Look">
          {LOOK_IDS.map((id) => (
            <button
              key={id}
              role="radio"
              aria-checked={look === id}
              className="gq-gal-look"
              data-on={look === id}
              title={LOOKS[id].tagline}
              onClick={() => setLook(id)}
            >
              {LOOKS[id].name}
            </button>
          ))}
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
          return (
            <div
              key={id}
              className="gq-gcard"
              data-current={isCurrent}
              data-ineligible={!isEligible}
              data-span={id === "t5"}
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
                  <Text as="h3" variant="headingSm">
                    {def.name}
                  </Text>
                  <div className="gq-meta-q">“{def.shopperQuestion}”</div>
                  <div className="gq-meta-shape">
                    {def.questionRangeLabel} · {def.resultsShapeLabel}
                  </div>
                </div>
                {isCurrent ? (
                  <Button disabled={busy} loading={busy && pending === id} onClick={() => {
                    setPending(id);
                    onKeep(lookDelta);
                  }}>
                    Keep
                  </Button>
                ) : isEligible ? (
                  <Button
                    variant="primary"
                    loading={busy && pending === id}
                    disabled={busy}
                    onClick={() => {
                      setPending(id);
                      onUse(id, lookDelta);
                    }}
                  >
                    Use this template
                  </Button>
                ) : (
                  <button className="gq-fix" onClick={onFixImages}>
                    Fix images →
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
