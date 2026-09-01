import { useRef, type MutableRefObject } from "react";

// The live preview: the REAL storefront quiz (gleame-quiz.js) rendered in a
// phone bezel, fed by /quiz-preview.html (draft-first). Bezel styles are the
// established ones from the old quiz-builder page. The token is pinned to
// the first value so routine loader revalidations never hard-reload the
// iframe; intentional reloads bump `nonce` (key remount).

export function PreviewCanvas({
  iframeRef,
  previewToken,
  nonce,
}: {
  iframeRef: MutableRefObject<HTMLIFrameElement | null>;
  previewToken: string | null;
  nonce: number;
}) {
  const stableTokenRef = useRef(previewToken);

  if (!stableTokenRef.current) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ color: "#6D7175" }}>Preview unavailable</span>
      </div>
    );
  }

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        minHeight: 0,
      }}
    >
      <div style={{ fontSize: 12, color: "#6D7175", marginBottom: 8 }}>Mobile preview</div>
      <ScaledBezel>
        <iframe
          key={nonce}
          ref={iframeRef}
          title="Quiz preview"
          src={`/quiz-preview.html?token=${encodeURIComponent(stableTokenRef.current)}&v=${nonce}`}
          style={{ width: "100%", height: "100%", border: 0 }}
        />
      </ScaledBezel>
    </div>
  );
}

/** 390x720 phone bezel that scales down (never up) to fit short canvases. */
function ScaledBezel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        containerType: "size",
      }}
    >
      <div
        style={{
          width: 390,
          height: 720,
          border: "10px solid #1a1a1a",
          borderRadius: 36,
          overflow: "hidden",
          background: "#fff",
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
          transform: "scale(min(1, calc((100cqh - 20px) / 740)))",
          transformOrigin: "center",
          flexShrink: 0,
        }}
      >
        {children}
      </div>
    </div>
  );
}
