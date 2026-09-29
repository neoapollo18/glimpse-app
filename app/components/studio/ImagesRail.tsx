import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Banner, Button, Spinner, Text, Tooltip } from "@shopify/polaris";
import { isSlotUnresolved, type StudioLibraryStatus, type StudioSlot } from "./types";

// V3-SPEC 4.4-4.6: the Images rail lists EVERY image slot the current
// template declares (quiz-templates declareSlots, resolved by the studio
// loader), grouped by screen in rail order, unresolved rows first with an
// amber dot. A row is a 52 px thumb (the resolved image, or a dashed
// placeholder that echoes the widget's own ImageSlot), the slot label, a
// source chip, and Choose / Change into the brand-library picker.
//
// Library-not-built is an INFRA state, never a content problem (4.6): one
// retry banner when indexing failed, a quiet line while it runs. There is
// no "needs a hero image" lock anywhere.

export interface SlotTheme {
  bg: string;
  border: string;
  ink: string;
}

const KIND_GLYPH: Record<StudioSlot["kind"], string> = {
  hero: "▭",
  lifestyle: "▭",
  product: "◫",
  variant: "◫",
  swatch: "●",
  icon: "✦",
  logo: "Aa",
  thumb: "◫",
};

/** Picker filter chip pre-selected for a slot kind (spec 4.5). */
export function filterForKind(kind: StudioSlot["kind"]): string {
  if (kind === "hero" || kind === "lifestyle") return "lifestyle";
  if (kind === "logo") return "logos";
  return "products";
}

function SlotThumb({ slot, theme }: { slot: StudioSlot; theme: SlotTheme }) {
  const round = slot.key === "founder";
  if (slot.url) {
    return (
      <img
        src={slot.url}
        alt=""
        style={{
          width: 52,
          height: 52,
          borderRadius: round ? "50%" : 8,
          objectFit: "cover",
          flexShrink: 0,
          border: "1px solid rgba(0,0,0,.06)",
        }}
      />
    );
  }
  const auto = slot.source === "auto";
  return (
    <div
      aria-hidden
      style={{
        width: 52,
        height: 52,
        borderRadius: round ? "50%" : 8,
        flexShrink: 0,
        boxSizing: "border-box",
        background: auto ? "#F1F3F5" : theme.bg,
        border: auto ? "1px solid #E1E3E5" : `1.5px dashed ${theme.border}`,
        color: auto ? "#9A9EAB" : theme.ink,
        opacity: auto ? 1 : 0.7,
        display: "grid",
        placeItems: "center",
        fontSize: slot.kind === "logo" ? 11 : 16,
        fontWeight: slot.kind === "logo" ? 700 : 400,
      }}
    >
      {KIND_GLYPH[slot.kind]}
    </div>
  );
}

function SourceChip({ slot }: { slot: StudioSlot }) {
  const unresolved = isSlotUnresolved(slot);
  const merchant = slot.source === "merchant";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: 11,
        lineHeight: "16px",
        color: unresolved ? "#7A5A00" : merchant ? "#0B6B3A" : "#6D7175",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        maxWidth: "100%",
      }}
      title={slot.sourceLabel}
    >
      {unresolved && (
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#E3A008", flexShrink: 0 }} />
      )}
      {slot.sourceLabel}
    </span>
  );
}

export function ImagesRail({
  slots,
  library,
  theme,
  busy,
  autoOpenSlotKey,
  onAutoOpenConsumed,
  onBack,
  onSetSlot,
  onRetryIndex,
}: {
  slots: StudioSlot[];
  library: StudioLibraryStatus;
  theme: SlotTheme;
  busy: boolean;
  /** Slot to open the picker for right away (widget `gleame:pick-slot`). */
  autoOpenSlotKey?: string | null;
  onAutoOpenConsumed?: () => void;
  onBack: () => void;
  onSetSlot: (slotKey: string, url: string, source: string, prevUrl: string | null) => void;
  onRetryIndex: () => Promise<void> | void;
}) {
  const [pickerSlot, setPickerSlot] = useState<StudioSlot | null>(null);
  const [retrying, setRetrying] = useState(false);

  // Groups in declaration order (Intro → Q2 · … → Results); within a
  // group unresolved rows sort first, stably.
  const groups = useMemo(() => {
    const order: string[] = [];
    const byGroup = new Map<string, StudioSlot[]>();
    for (const s of slots) {
      if (!byGroup.has(s.screenLabel)) {
        byGroup.set(s.screenLabel, []);
        order.push(s.screenLabel);
      }
      byGroup.get(s.screenLabel)!.push(s);
    }
    return order.map((label) => {
      const rows = byGroup.get(label)!;
      const unresolved = rows.filter((r) => isSlotUnresolved(r));
      const resolved = rows.filter((r) => !isSlotUnresolved(r));
      return { label, rows: [...unresolved, ...resolved] };
    });
  }, [slots]);

  useEffect(() => {
    if (!autoOpenSlotKey) return;
    const target = slots.find((s) => s.key === autoOpenSlotKey);
    if (target) setPickerSlot(target);
    onAutoOpenConsumed?.();
  }, [autoOpenSlotKey, slots, onAutoOpenConsumed]);

  const retry = async () => {
    setRetrying(true);
    try {
      await onRetryIndex();
    } finally {
      setRetrying(false);
    }
  };

  const indexing = library.status === "building" || library.status === "pending";

  return (
    <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12, flex: 1, minHeight: 0 }}>
      <button
        onClick={onBack}
        style={{ border: 0, background: "transparent", color: "#6D7175", fontSize: 12.5, cursor: "pointer", textAlign: "left", padding: 0 }}
      >
        ← Back to screens
      </button>
      <div>
        <Text as="h4" variant="headingSm">
          Images
        </Text>
        <Text as="p" variant="bodySm" tone="subdued">
          Every image this template uses. Unresolved first.
        </Text>
      </div>

      {library.status === "failed" && (
        <Banner
          tone="warning"
          action={{ content: "Retry", onAction: () => void retry(), loading: retrying }}
        >
          We couldn't read your store's images yet — retrying
        </Banner>
      )}
      {indexing && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#6D7175" }}>
          <Spinner size="small" />
          Indexing your store's images…
        </div>
      )}

      <div style={{ overflowY: "auto", flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 14 }}>
        {groups.length === 0 && (
          <Text as="p" variant="bodySm" tone="subdued">
            This template uses no images beyond your product photos.
          </Text>
        )}
        {groups.map((g) => (
          <div key={g.label}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "#8A8F98",
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                padding: "0 0 6px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={g.label}
            >
              {g.label}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {g.rows.map((s) => {
                const unresolved = isSlotUnresolved(s);
                return (
                  <div
                    key={s.key}
                    style={{
                      display: "flex",
                      gap: 10,
                      alignItems: "center",
                      padding: 8,
                      border: `1px solid ${unresolved && !s.optional ? "#F1D48A" : "#E1E3E5"}`,
                      borderRadius: 10,
                      background: "#fff",
                      transition: "border-color 150ms ease",
                    }}
                  >
                    <SlotThumb slot={s} theme={theme} />
                    <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
                      <div
                        style={{ fontSize: 12.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                        title={s.label}
                      >
                        {s.label}
                        {s.optional && (
                          <span style={{ fontWeight: 400, color: "#9A9EAB" }}> · optional</span>
                        )}
                      </div>
                      <SourceChip slot={s} />
                    </div>
                    <Tooltip content={unresolved ? "Pick an image from your brand library" : "Swap this image"}>
                      <button
                        onClick={() => setPickerSlot(s)}
                        disabled={busy}
                        style={{
                          border: 0,
                          background: "transparent",
                          color: "#2C6ECB",
                          fontSize: 12.5,
                          fontWeight: 600,
                          cursor: busy ? "default" : "pointer",
                          flexShrink: 0,
                          padding: "4px 2px",
                        }}
                      >
                        {unresolved ? "Choose" : "Change"}
                      </button>
                    </Tooltip>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {pickerSlot && (
        <BrandLibraryPicker
          slotName={`${pickerSlot.screenLabel} · ${pickerSlot.label}`}
          initialFilter={filterForKind(pickerSlot.kind)}
          onClose={() => setPickerSlot(null)}
          onSelect={(url, source) => {
            onSetSlot(pickerSlot.key, url, source, pickerSlot.url);
            setPickerSlot(null);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Brand library picker (Shopify theme-editor pattern, spec 4.5)
// ---------------------------------------------------------------------

interface LibraryImage {
  id: string;
  url: string;
  role: string | null;
  width: number | null;
  height: number | null;
  ratio: number | null;
  source: string | null;
  productIds: string[] | null;
}

const FILTERS = [
  { id: "", label: "All" },
  { id: "products", label: "Products" },
  { id: "lifestyle", label: "Lifestyle" },
  { id: "banners", label: "Banners" },
  { id: "logos", label: "Logos" },
];

export function BrandLibraryPicker({
  slotName,
  initialFilter,
  onClose,
  onSelect,
}: {
  slotName: string;
  /** Filter chip pre-selected on open (the slot's kind, spec 4.5). */
  initialFilter?: string;
  onClose: () => void;
  onSelect: (url: string, source: string) => void;
}) {
  const [filter, setFilter] = useState(initialFilter ?? "");
  const [search, setSearch] = useState("");
  const [images, setImages] = useState<LibraryImage[]>([]);
  const [status, setStatus] = useState<"loading" | "ok" | "missing" | "error">("loading");
  const [selected, setSelected] = useState<LibraryImage | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const seq = useRef(0);

  const load = useCallback(async (f: string, s: string) => {
    const my = ++seq.current;
    setStatus("loading");
    try {
      const res = await fetch(
        `/app/api/brand-library?filter=${encodeURIComponent(f)}&search=${encodeURIComponent(s)}`
      );
      if (my !== seq.current) return;
      if (res.status === 404) {
        setStatus("missing");
        setImages([]);
        return;
      }
      const body = await res.json().catch(() => null);
      if (!res.ok || !body || !Array.isArray(body.images)) {
        setStatus("error");
        setImages([]);
        return;
      }
      setImages(body.images);
      setStatus("ok");
    } catch {
      if (my === seq.current) setStatus("error");
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(filter, search), search ? 250 : 0);
    return () => clearTimeout(t);
  }, [filter, search, load]);

  const upload = async (file: File) => {
    setUploading(true);
    setUploadError(null);
    try {
      const fd = new FormData();
      fd.append("image", file);
      const res = await fetch("/app/api/brand-library", { method: "POST", body: fd });
      const body = await res.json().catch(() => null);
      if (res.ok && body?.ok !== false) {
        void load(filter, search);
      } else {
        setUploadError(body?.error ?? "Upload failed. Try a smaller JPG or PNG.");
      }
    } catch {
      setUploadError("Upload failed. Check your connection and try again.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(20,22,26,.45)",
        display: "grid",
        placeItems: "center",
        zIndex: 60,
        padding: 24,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          borderRadius: 14,
          width: "100%",
          maxWidth: 820,
          boxShadow: "0 20px 60px rgba(0,0,0,.25)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          maxHeight: "82vh",
        }}
      >
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #E1E3E5", display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ minWidth: 0 }}>
            <Text as="h3" variant="headingSm">
              Your brand library
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Choosing for: {slotName}
            </Text>
          </div>
          <input
            placeholder={`Search ${images.length || ""} images…`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              marginLeft: "auto",
              border: "1px solid #E1E3E5",
              borderRadius: 9,
              padding: "7px 12px",
              fontSize: 13,
              width: 220,
            }}
          />
        </div>
        <div style={{ display: "flex", gap: 8, padding: "12px 20px", borderBottom: "1px solid #E1E3E5" }}>
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              style={{
                fontSize: 12.5,
                fontWeight: 600,
                border: "1px solid " + (filter === f.id ? "#1A1C1E" : "#E1E3E5"),
                borderRadius: 999,
                padding: "6px 13px",
                background: filter === f.id ? "#1A1C1E" : "#fff",
                color: filter === f.id ? "#fff" : "#6D7175",
                cursor: "pointer",
                transition: "background 120ms ease, color 120ms ease",
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 12,
            padding: "18px 20px",
            overflowY: "auto",
            minHeight: 180,
          }}
        >
          {status === "loading" && (
            <div style={{ gridColumn: "1/-1", display: "grid", placeItems: "center", padding: 30 }}>
              <Spinner size="small" />
            </div>
          )}
          {status === "missing" && (
            <div style={{ gridColumn: "1/-1", textAlign: "center", padding: 30, color: "#6D7175", fontSize: 13 }}>
              Your store's images are still being indexed. Check back in a few minutes.
            </div>
          )}
          {status === "error" && (
            <div style={{ gridColumn: "1/-1" }}>
              <Banner tone="warning">Couldn't load your brand library. Try again shortly.</Banner>
            </div>
          )}
          {status === "ok" && images.length === 0 && (
            <div style={{ gridColumn: "1/-1", textAlign: "center", padding: 30, color: "#6D7175", fontSize: 13 }}>
              No images match this filter.
            </div>
          )}
          {status === "ok" &&
            images.map((img) => (
              <figure
                key={img.id}
                onClick={() => setSelected(img)}
                style={{
                  margin: 0,
                  borderRadius: 10,
                  overflow: "hidden",
                  position: "relative",
                  cursor: "pointer",
                  border: selected?.id === img.id ? "2px solid #1A1C1E" : "2px solid transparent",
                  transition: "border-color 120ms ease",
                }}
              >
                <img
                  src={img.url}
                  alt=""
                  loading="lazy"
                  style={{ display: "block", width: "100%", aspectRatio: "1", objectFit: "cover" }}
                />
                <span
                  style={{
                    position: "absolute",
                    bottom: 6,
                    left: 6,
                    background: "rgba(20,22,26,.75)",
                    color: "#fff",
                    fontSize: 10,
                    borderRadius: 6,
                    padding: "2px 7px",
                    textTransform: "capitalize",
                  }}
                >
                  {img.source === "upload" ? "Upload" : img.role || img.source || "Image"}
                </span>
                {selected?.id === img.id && (
                  <span
                    style={{
                      position: "absolute",
                      top: 6,
                      right: 6,
                      width: 20,
                      height: 20,
                      borderRadius: 999,
                      background: "#1A1C1E",
                      color: "#fff",
                      fontSize: 11,
                      display: "grid",
                      placeItems: "center",
                    }}
                  >
                    ✓
                  </span>
                )}
              </figure>
            ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 20px", borderTop: "1px solid #E1E3E5" }}>
          {/* Upload is allowed HERE (post-Reveal) and only when the library
              endpoint exists to receive it. */}
          {status === "ok" && (
            <Button loading={uploading} onClick={() => fileRef.current?.click()}>
              Upload image
            </Button>
          )}
          {uploadError && (
            <Text as="span" variant="bodySm" tone="critical">
              {uploadError}
            </Text>
          )}
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <Button onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!selected}
              onClick={() => selected && onSelect(selected.url, selected.source === "upload" ? "upload" : "library")}
            >
              Select
            </Button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
              e.target.value = "";
            }}
          />
        </div>
      </div>
    </div>
  );
}
