import { useState } from "react";
import { Button, Text } from "@shopify/polaris";
import { TEMPLATE_IDS, TEMPLATES, type TemplateId } from "../../lib/quiz-templates";

// V2-SPEC 2.4: full-screen template chooser inside the Studio (Shopify
// theme-library pattern). Each card is a LIVE render of THIS merchant's
// actual quiz in that template: the preview document with the widget's
// template/preset override query params (contract owned by the widget
// package), scaled down like the wireframe's .scaled pattern. Never stock
// screenshots. Ineligible templates dim with a reason chip and a Fix
// images link into the Images rail.

const CARD_RENDER_HEIGHT = 280;
const SCALE = 0.52;

export function TemplateOverlay({
  previewToken,
  currentTemplate,
  eligible,
  busy,
  onUse,
  onFixImages,
  onClose,
}: {
  previewToken: string | null;
  currentTemplate: string | null;
  /** Eligible template ids from the brand profile's templateAssignment;
   * absent profile = everything eligible. */
  eligible: TemplateId[];
  busy: boolean;
  onUse: (template: TemplateId) => void;
  onFixImages: () => void;
  onClose: () => void;
}) {
  const [pending, setPending] = useState<TemplateId | null>(null);

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100%", background: "#fff" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          padding: "18px 24px",
          borderBottom: "1px solid #E1E3E5",
          position: "sticky",
          top: 0,
          background: "#fff",
          zIndex: 2,
        }}
      >
        <div>
          <Text as="h2" variant="headingMd">
            Choose a template
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            Built for your kind of store. Switching never loses your content.
          </Text>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            marginLeft: "auto",
            width: 32,
            height: 32,
            borderRadius: 8,
            border: "1px solid #E1E3E5",
            background: "#fff",
            color: "#6D7175",
            cursor: "pointer",
            fontSize: 14,
          }}
        >
          ✕
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 22,
          padding: 24,
          maxWidth: 1280,
          margin: "0 auto",
          width: "100%",
          boxSizing: "border-box",
        }}
      >
        {TEMPLATE_IDS.map((id) => {
          const def = TEMPLATES[id];
          const isCurrent = currentTemplate === id;
          const isEligible = eligible.includes(id);
          const firstPreset = def.presets[0]?.id ?? "";
          return (
            <div
              key={id}
              style={{
                border: isCurrent ? "2px solid #4A3AFF" : "1px solid #E1E3E5",
                borderRadius: 13,
                overflow: "hidden",
                position: "relative",
                background: "#fff",
              }}
            >
              {isCurrent && (
                <span
                  style={{
                    position: "absolute",
                    top: 12,
                    left: 12,
                    zIndex: 2,
                    background: "#4A3AFF",
                    color: "#fff",
                    fontSize: 11,
                    fontWeight: 700,
                    borderRadius: 999,
                    padding: "4px 11px",
                  }}
                >
                  Current
                </span>
              )}
              {!isEligible && (
                <span
                  style={{
                    position: "absolute",
                    top: 12,
                    left: 12,
                    zIndex: 2,
                    background: "#fff",
                    border: "1px solid #E1E3E5",
                    color: "#9A6700",
                    fontSize: 11.5,
                    fontWeight: 600,
                    borderRadius: 999,
                    padding: "4px 11px",
                    boxShadow: "0 1px 2px rgba(20,22,26,.08)",
                  }}
                >
                  {def.ineligibleReason}
                </span>
              )}
              <div
                style={{
                  height: CARD_RENDER_HEIGHT,
                  overflow: "hidden",
                  position: "relative",
                  borderBottom: "1px solid #E1E3E5",
                  opacity: isEligible ? 1 : 0.4,
                  background: def.presets[0]?.tokens.colorBg ?? "#f6f6f7",
                }}
              >
                {previewToken ? (
                  <iframe
                    title={`${def.name} preview`}
                    // Live render of the merchant's own quiz in this
                    // template (widget contract: template/preset override
                    // params on the preview URL).
                    src={`/quiz-preview.html?token=${encodeURIComponent(previewToken)}&template=${id}&preset=${encodeURIComponent(firstPreset)}`}
                    style={{
                      width: `${Math.round(100 / SCALE)}%`,
                      height: CARD_RENDER_HEIGHT / SCALE,
                      transform: `scale(${SCALE})`,
                      transformOrigin: "top left",
                      border: 0,
                      pointerEvents: "none",
                      display: "block",
                    }}
                  />
                ) : (
                  <div style={{ padding: 24, color: "#6D7175", fontSize: 13 }}>Preview unavailable</div>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px" }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <Text as="h3" variant="headingSm">
                    {def.name}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {def.whoFor}
                  </Text>
                </div>
                {isCurrent ? (
                  <Button onClick={onClose}>Keep</Button>
                ) : isEligible ? (
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
                ) : (
                  <Button variant="plain" onClick={onFixImages}>
                    Fix images
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
