import { useEffect, useRef, useState } from "react";
import { STUDIO_TOAST_EVENT, type StudioToastDetail } from "./toast";

/** The Studio's in-page toast (one slot, 6s, optional Undo), for shops not
 * on App Bridge toasts. See toast.ts. */
export function StudioToastHost() {
  const [toast, setToast] = useState<StudioToastDetail | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const onToast = (e: Event) => {
      const detail = (e as CustomEvent<StudioToastDetail>).detail;
      if (!detail?.message) return;
      setToast(detail);
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setToast(null), 6000);
    };
    window.addEventListener(STUDIO_TOAST_EVENT, onToast);
    return () => {
      window.removeEventListener(STUDIO_TOAST_EVENT, onToast);
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
    };
  }, []);

  if (!toast) return null;
  return (
    <div
      role="status"
      style={{
        position: "fixed",
        bottom: 16,
        left: 16,
        background: "#141519",
        color: "#fff",
        borderRadius: 10,
        padding: "10px 14px",
        fontSize: 12.5,
        display: "flex",
        gap: 14,
        alignItems: "center",
        zIndex: 70,
        boxShadow: "0 8px 24px rgba(20,22,26,.25)",
      }}
    >
      <span>{toast.message}</span>
      {toast.undo && (
        <button
          onClick={() => {
            toast.undo?.();
            setToast(null);
          }}
          style={{
            border: 0,
            background: "transparent",
            color: "#fff",
            textDecoration: "underline",
            fontWeight: 600,
            cursor: "pointer",
            fontSize: 12.5,
          }}
        >
          Undo
        </button>
      )}
    </div>
  );
}
