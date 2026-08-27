// Shared chunked catalog-sync driver for the two surfaces that run it (the
// onboarding wizard's Connect Catalog step and the Quiz Builder card). Each
// completed page immediately submits the next cursor to the Quiz Builder
// route's sync-catalog action until the catalog is fully synced.

import { useFetcher } from "@remix-run/react";
import { useEffect, useRef, useState } from "react";

export interface CatalogSyncResponse {
  ok: boolean;
  error?: string;
  intent?: string;
  nextCursor?: string | null;
  synced?: number;
  total?: number | null;
}

export function useCatalogSync(options: { onComplete?: () => void } = {}) {
  const fetcher = useFetcher<CatalogSyncResponse>();
  const [progress, setProgress] = useState<{ done: number; total: number | null } | null>(null);
  const [syncDone, setSyncDone] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const doneSoFar = useRef(0);
  const onCompleteRef = useRef(options.onComplete);
  onCompleteRef.current = options.onComplete;

  const submitPage = (cursor?: string) => {
    const fd = new FormData();
    fd.append("intent", "sync-catalog");
    if (cursor) fd.append("cursor", cursor);
    fetcher.submit(fd, { method: "POST", action: "/app/quiz-builder" });
  };

  const start = (resumeCursor?: string) => {
    doneSoFar.current = 0;
    setSyncError(null);
    setSyncDone(false);
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
    doneSoFar.current += data.synced ?? 0;
    setProgress({ done: doneSoFar.current, total: data.total ?? null });
    if (data.nextCursor) {
      submitPage(data.nextCursor);
    } else {
      setProgress(null);
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
    syncedCount: doneSoFar.current,
    busy: fetcher.state !== "idle" || progress !== null,
  };
}
