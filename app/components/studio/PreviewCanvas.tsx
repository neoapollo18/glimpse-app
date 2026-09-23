import { useRef, useState, type MutableRefObject } from "react";

// V2-SPEC 2.1: the quiz renders FULL-BLEED on the themed canvas. The
// canvas background is the quiz's own background token, the top edge is a
// 32px store-context strip (store logo/name, enough to read as "my store"
// without faking a browser), and the Desktop/Mobile toggle floats at the
// bottom-center. No white card, no browser chrome, no drop shadow.

type Device = "mobile" | "desktop";

export interface CanvasTheme {
  /** Resolved quiz background (brand/preset colorBg); the canvas bg. */
  bg: string;
  /** Resolved quiz ink for the store-context strip text. */
  ink: string;
  /** Heading font stack for the store name in the strip. */
  headingFont: string;
  storeName: string;
  logoUrl: string | null;
}

export function StoreContextStrip({ theme }: { theme: CanvasTheme }) {
  return (
    <div
      style={{
        height: 32,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "0 18px",
        background: theme.bg,
        borderBottom: "1px solid rgba(0,0,0,0.06)",
      }}
    >
      {theme.logoUrl ? (
        <img src={theme.logoUrl} alt="" style={{ maxHeight: 20, maxWidth: 120, display: "block" }} />
      ) : (
        <span
          style={{
            fontFamily: theme.headingFont,
            fontSize: 13,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: theme.ink,
          }}
        >
          {theme.storeName}
        </span>
      )}
    </div>
  );
}

export function DeviceToggle({
  device,
  onChange,
}: {
  device: Device;
  onChange: (d: Device) => void;
}) {
  return (
    <div
      style={{
        position: "absolute",
        bottom: 14,
        left: "50%",
        transform: "translateX(-50%)",
        background: "#141519",
        borderRadius: 999,
        padding: 4,
        display: "flex",
        gap: 2,
        boxShadow: "0 1px 2px rgba(20,22,26,.2), 0 8px 24px rgba(20,22,26,.18)",
        zIndex: 5,
      }}
    >
      {(["desktop", "mobile"] as const).map((d) => (
        <button
          key={d}
          onClick={() => onChange(d)}
          style={{
            border: 0,
            borderRadius: 999,
            padding: "5px 13px",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            background: device === d ? "#3A3D46" : "transparent",
            color: device === d ? "#fff" : "#B9BCC7",
          }}
        >
          {d === "desktop" ? "Desktop" : "Mobile"}
        </button>
      ))}
    </div>
  );
}

export function PreviewCanvas({
  iframeRef,
  previewToken,
  nonce,
  onLoad,
  theme,
}: {
  iframeRef: MutableRefObject<HTMLIFrameElement | null>;
  previewToken: string | null;
  nonce: number;
  onLoad?: () => void;
  theme: CanvasTheme;
}) {
  // Pin the token so routine revalidations never remount the iframe, but
  // adopt the freshest one on intentional reloads (nonce bumps) so a
  // long-lived studio tab doesn't outlive the JWT.
  const stableTokenRef = useRef(previewToken);
  const lastNonceRef = useRef(nonce);
  if (nonce !== lastNonceRef.current) {
    lastNonceRef.current = nonce;
    if (previewToken) stableTokenRef.current = previewToken;
  }

  const [device, setDevice] = useState<Device>("desktop");

  if (!stableTokenRef.current) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ color: "#6D7175" }}>Preview unavailable</span>
      </div>
    );
  }

  const isMobile = device === "mobile";

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        position: "relative",
        background: theme.bg,
      }}
    >
      <StoreContextStrip theme={theme} />
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        <iframe
          key={nonce}
          ref={iframeRef}
          title="Quiz preview"
          src={`/quiz-preview.html?token=${encodeURIComponent(stableTokenRef.current)}&v=${nonce}`}
          onLoad={onLoad}
          style={{
            width: isMobile ? 390 : "100%",
            height: "100%",
            border: 0,
            display: "block",
            // Mobile keeps a whisper of separation from the themed canvas
            // without reintroducing a device bezel.
            boxShadow: isMobile ? "0 0 0 1px rgba(0,0,0,0.07)" : undefined,
            background: theme.bg,
          }}
        />
      </div>
      <DeviceToggle device={device} onChange={setDevice} />
    </div>
  );
}
