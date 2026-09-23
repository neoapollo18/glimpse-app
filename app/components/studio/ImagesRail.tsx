import { useCallback, useEffect, useRef, useState } from "react";
import { Banner, Button, Spinner, Text } from "@shopify/polaris";
import type { StudioFlow } from "./types";

// V2-SPEC 4.4-4.5: the Images rail lists every image slot the CURRENT
// template uses (Hero for t1, question imagery for t3, answer tiles +
// loading screen for t2, Results for all), each with a thumb, its source
// chip, and Change. Change opens the brand-library picker: the merchant's
// own indexed images (GET /app/api/brand-library, built by the library
// package), filterable, with upload allowed here, post-Reveal only. The
// endpoint 404ing degrades to a "still indexing" empty state.

export interface ImageSlot {
  key: string;
  name: string;
  group: string;
  currentUrl: string | null;
  sourceLabel: string;
}

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

export function buildImageSlots(
  template: string | null,
  flow: StudioFlow,
  slots: Record<string, string>
): ImageSlot[] {
  const out: ImageSlot[] = [];
  const src = (key: string, fallback: string) =>
    slots[key] ? "From your brand library" : fallback;

  if (template === "t1") {
    out.push({
      key: "hero",
      name: "Quiz hero",
      group: "Hero",
      currentUrl: slots.hero ?? null,
      sourceLabel: src("hero", "From your homepage (auto)"),
    });
  }
  if (template === "t3") {
    flow.questions.forEach((q, i) => {
      const key = `question:${q.axisKey}`;
      out.push({
        key,
        name: `Q${i + 1} · ${q.prompt.trim() || "Untitled question"}`,
        group: "Question imagery",
        currentUrl: slots[key] ?? null,
        sourceLabel: src(key, "Lifestyle image (auto)"),
      });
    });
  }
  if (template === "t2") {
    flow.questions.forEach((q) => {
      q.options.forEach((o) => {
        const key = `answer:${q.axisKey}:${o.axisValueValue}`;
        out.push({
          key,
          name: `Answer · ${o.label || o.axisValueValue}`,
          group: "Answer tiles",
          currentUrl: slots[key] ?? o.imageUrl ?? null,
          sourceLabel: slots[key]
            ? "From your brand library"
            : o.imageUrl
              ? "Product image (auto)"
              : "Not resolved yet",
        });
      });
    });
    out.push({
      key: "loading",
      name: "Loading screen",
      group: "Loading screen",
      currentUrl: slots.loading ?? null,
      sourceLabel: src("loading", "Brand imagery (auto)"),
    });
  }
  out.push({
    key: "results",
    name: "Results · match cards",
    group: "Results",
    currentUrl: slots.results ?? null,
    sourceLabel: src("results", "Product images (auto)"),
  });
  return out;
}

export function ImagesRail({
  template,
  flow,
  imageSlots,
  onBack,
  onSetSlot,
  busy,
}: {
  template: string | null;
  flow: StudioFlow;
  imageSlots: Record<string, string>;
  onBack: () => void;
  onSetSlot: (slotKey: string, url: string, source: string, prevUrl: string | null) => void;
  busy: boolean;
}) {
  const [pickerSlot, setPickerSlot] = useState<ImageSlot | null>(null);
  const slots = buildImageSlots(template, flow, imageSlots);
  const groups = [...new Set(slots.map((s) => s.group))];

  return (
    <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10, flex: 1, minHeight: 0 }}>
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
          Auto-picked from your store. Change any of them.
        </Text>
      </div>
      {template === "t5" && (
        <Text as="p" variant="bodySm" tone="subdued">
          The Clean template works with zero imagery; only results cards use images.
        </Text>
      )}
      <div style={{ overflowY: "auto", flex: 1, minHeight: 0 }}>
        {groups.map((g) => (
          <div key={g} style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#6D7175", letterSpacing: "0.06em", textTransform: "uppercase", padding: "4px 0" }}>
              {g}
            </div>
            {slots
              .filter((s) => s.group === g)
              .map((s) => (
                <div
                  key={s.key}
                  style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "center",
                    padding: 8,
                    border: "1px solid #E1E3E5",
                    borderRadius: 10,
                    marginBottom: 8,
                    background: "#fff",
                  }}
                >
                  {s.currentUrl ? (
                    <img
                      src={s.currentUrl}
                      alt=""
                      style={{ width: 44, height: 44, borderRadius: 8, objectFit: "cover", flexShrink: 0 }}
                    />
                  ) : (
                    <div
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 8,
                        background: "#F1F3F5",
                        flexShrink: 0,
                        display: "grid",
                        placeItems: "center",
                        color: "#C3C8CF",
                        fontSize: 16,
                      }}
                    >
                      ▦
                    </div>
                  )}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {s.name}
                    </div>
                    <div style={{ fontSize: 11, color: "#6D7175" }}>{s.sourceLabel}</div>
                  </div>
                  <button
                    onClick={() => setPickerSlot(s)}
                    disabled={busy}
                    style={{
                      border: 0,
                      background: "transparent",
                      color: "#4A3AFF",
                      fontSize: 12.5,
                      fontWeight: 600,
                      cursor: "pointer",
                      flexShrink: 0,
                    }}
                  >
                    Change
                  </button>
                </div>
              ))}
          </div>
        ))}
      </div>
      {pickerSlot && (
        <BrandLibraryPicker
          slotName={pickerSlot.name}
          onClose={() => setPickerSlot(null)}
          onSelect={(url, source) => {
            onSetSlot(pickerSlot.key, url, source, pickerSlot.currentUrl);
            setPickerSlot(null);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Brand library picker (Shopify theme-editor pattern)
// ---------------------------------------------------------------------

const FILTERS = [
  { id: "", label: "All" },
  { id: "products", label: "Products" },
  { id: "lifestyle", label: "Lifestyle" },
  { id: "banners", label: "Banners" },
  { id: "logos", label: "Logos" },
];

export function BrandLibraryPicker({
  slotName,
  onClose,
  onSelect,
}: {
  slotName: string;
  onClose: () => void;
  onSelect: (url: string, source: string) => void;
}) {
  const [filter, setFilter] = useState("");
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
        // The library package hasn't landed for this shop yet.
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
          <div>
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
              Library is still indexing. Check back in a few minutes.
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
                  border: selected?.id === img.id ? "2px solid #4A3AFF" : "2px solid transparent",
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
                      background: "#4A3AFF",
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
