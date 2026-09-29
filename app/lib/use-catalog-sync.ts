// Shared chunked catalog-sync driver for every surface that runs it (the
// onboarding scope screen, which starts it automatically, and the Studio
// top-bar chip). Each completed page immediately submits the next cursor
// to the /app/api/catalog-sync resource route until the catalog is fully
// synced; the last page also builds the brand library (v3 spec 4.6) and
// reports its summary here.

import { useFetcher } from "@remix-run/react";
import { useEffect, useRef, useState } from "react";

const CATALOG_SYNC_ACTION = "/app/api/catalog-sync";

export interface CatalogSyncResponse {
  ok: boolean;
  error?: string;
  // Per-page non-terminal problems (e.g. one product's upsert failed); the
  // chain keeps paging but consumers should surface these.
  warning?: string;
  intent?: string;
  nextCursor?: string | null;
  synced?: number;
  total?: number | null;
  // Present on the final page only: the brand-library build summary
  // (absent when the build failed - the sync itself still succeeded).
  library?: { imageCount: number; taggedPct: number; ms: number };
}

export function useCatalogSync(options: { onComplete?: () => void } = {}) {
  const fetcher = useFetcher<CatalogSyncResponse>();
  const [progress, setProgress] = useState<{ done: number; total: number | null } | null>(null);
  const [syncDone, setSyncDone] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncWarnings, setSyncWarnings] = useState<string[]>([]);
  const [library, setLibrary] = useState<CatalogSyncResponse["library"] | null>(null);
  const doneSoFar = useRef(0);
  const onCompleteRef = useRef(options.onComplete);
  onCompleteRef.current = options.onComplete;

  const submitPage = (cursor?: string) => {
    const fd = new FormData();
    fd.append("intent", "sync-catalog");
    if (cursor) fd.append("cursor", cursor);
    fetcher.submit(fd, { method: "POST", action: CATALOG_SYNC_ACTION });
  };

  const start = (resumeCursor?: string) => {
    doneSoFar.current = 0;
    setSyncError(null);
    setSyncWarnings([]);
    setSyncDone(false);
    setLibrary(null);
    setProgress({ done: 0, total: null });
    submitPage(resumeCursor);
  };

  useEffect(() => {
    const data = fetcher.data;
    if (fetcher.state !== "idle" || !data) return;
    // Error responses from auth/shop guards omit `intent` — they still must
    // clear the in-flight state or the progress bar wedges forever.
    if (data.ok === false) {
      setSyncError(data.error ?? "Sync failed");
      setProgress(null);
      return;
    }
    if (data.intent !== "sync-catalog") return;
    if (data.warning) {
      const warning = data.warning;
      setSyncWarnings((prev) => (prev.includes(warning) ? prev : [...prev, warning]));
    }
    doneSoFar.current += data.synced ?? 0;
    setProgress({ done: doneSoFar.current, total: data.total ?? null });
    if (data.nextCursor) {
      submitPage(data.nextCursor);
    } else {
      setProgress(null);
      setLibrary(data.library ?? null);
      setSyncDone(true);
      onCompleteRef.current?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

  return {
    start,
    progress,
    syncDone,
    syncError,
    syncWarnings,
    library,
    syncedCount: doneSoFar.current,
    busy: fetcher.state !== "idle" || progress !== null,
  };
}
