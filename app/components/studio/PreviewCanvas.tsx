import { useEffect, useRef, useState, type MutableRefObject } from "react";

// The live preview: the REAL storefront quiz (gleame-quiz.js) fed by
// /quiz-preview.html (draft-first), in a phone bezel or a desktop browser
// frame. Scale-to-fit is measured in JS (ResizeObserver) — cq units inside
// a transform string are not valid CSS and the browser silently dropped
// the earlier attempt, letting the bezel overflow short canvases.

type Device = "mobile" | "desktop";

const FRAMES: Record<Device, { width: number; height: number }> = {
  mobile: { width: 390, height: 720 },
  desktop: { width: 1100, height: 700 },
};

export function PreviewCanvas({
  iframeRef,
  previewToken,
  nonce,
}: {
  iframeRef: MutableRefObject<HTMLIFrameElement | null>;
  previewToken: string | null;
  nonce: number;
}) {
  // Pin the token so routine revalidations never remount the iframe, but
  // adopt the freshest one on intentional reloads (nonce bumps) so a
  // long-lived studio tab doesn't outlive the 12h JWT.
  const stableTokenRef = useRef(previewToken);
  const lastNonceRef = useRef(nonce);
  if (nonce !== lastNonceRef.current) {
    lastNonceRef.current = nonce;
    if (previewToken) stableTokenRef.current = previewToken;
  }

  const [device, setDevice] = useState<Device>("mobile");
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [stage, setStage] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setStage({ width: rect.width, height: rect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (!stableTokenRef.current) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ color: "#6D7175" }}>Preview unavailable</span>
      </div>
    );
  }

  const frame = FRAMES[device];
  const isMobile = device === "mobile";
  const chrome = isMobile ? 20 : 32; // bezel border / browser bar allowance
  const scale =
    stage.width > 0
      ? Math.min(
          1,
          (stage.height - 8) / (frame.height + chrome),
          (stage.width - 16) / (frame.width + chrome),
        )
      : 1;

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "16px 24px 24px",
        minHeight: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 4,
          background: "#EBEBEB",
          borderRadius: 999,
          padding: 3,
          marginBottom: 12,
          flexShrink: 0,
        }}
      >
        {(["mobile", "desktop"] as const).map((d) => (
          <button
            key={d}
            onClick={() => setDevice(d)}
            style={{
              border: 0,
              borderRadius: 999,
              padding: "4px 14px",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              background: device === d ? "#fff" : "transparent",
              color: device === d ? "#202223" : "#6D7175",
              boxShadow: device === d ? "0 1px 2px rgba(0,0,0,0.12)" : undefined,
            }}
          >
            {d === "mobile" ? "Mobile" : "Desktop"}
          </button>
        ))}
      </div>
      <div
        ref={stageRef}
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: frame.width,
            border: isMobile ? "10px solid #1a1a1a" : "1px solid #D6D9DC",
            borderRadius: isMobile ? 36 : 12,
            overflow: "hidden",
            background: "#fff",
            boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
            transform: `scale(${scale})`,
            transformOrigin: "center",
            flexShrink: 0,
          }}
        >
          {!isMobile && (
            <div
              style={{
                display: "flex",
                gap: 6,
                alignItems: "center",
                padding: "10px 14px",
                borderBottom: "1px solid #EBEBEB",
                background: "#F6F6F7",
              }}
            >
              {["#FF5F57", "#FEBC2E", "#28C840"].map((c) => (
                <span key={c} style={{ width: 10, height: 10, borderRadius: "50%", background: c }} />
              ))}
            </div>
          )}
          <iframe
            key={nonce}
            ref={iframeRef}
            title="Quiz preview"
            src={`/quiz-preview.html?token=${encodeURIComponent(stableTokenRef.current)}&v=${nonce}`}
            style={{ width: "100%", height: frame.height, border: 0, display: "block" }}
          />
        </div>
      </div>
    </div>
  );
}
