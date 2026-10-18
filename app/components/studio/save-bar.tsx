import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { SaveBar } from "@shopify/app-bridge-react";
import { Modal, Text } from "@shopify/polaris";
import type { StudioActionData } from "../../routes/studio";
import { postStudioAction } from "./studio-data";

// Studio save bar, a per-shop opt-in (lib/studio-admin-bars.server, Built
// for Shopify 4.1.5). Off (the default), every editor saves as it always
// has and nothing here is used. On, an editor with unsaved edits registers
// them here instead of saving; there is ONE admin save bar whose Save saves
// every registered editor and whose Discard drops them all, and a slide or
// tab switch that would lose them asks first. The preview keeps up with
// typing through a dry run of the unsaved edits (preview-tools), which
// never writes.

export type ToolCall = { tool: string; input: unknown };

export interface PendingEdits {
  /** The unsaved edits as quiz tool calls, for the preview's dry run.
   * Editors whose changes aren't quiz tools (offers) leave it out. */
  calls?: () => ToolCall[];
  /** Saves them. Resolves false when the save failed: the editor shows why
   * and keeps its edits, so Save can be clicked again. */
  save: () => Promise<boolean>;
  /** Drops them. The Studio then remounts the editors from the saved quiz
   * and reloads the preview. */
  discard: () => void;
  /** A save in flight (the Save button spins). */
  saving?: boolean;
}

export interface StudioSaveBarApi {
  enabled: boolean;
  /** An editor's unsaved edits, or null once it has none. */
  report: (owner: string, edits: PendingEdits | null) => void;
  /** An editor's unsaved edits changed: refresh the dry-run preview. */
  previewChanged: () => void;
}

const SaveBarContext = createContext<StudioSaveBarApi>({ enabled: false, report: () => {}, previewChanged: () => {} });
export const StudioSaveBarProvider = SaveBarContext.Provider;

export function useStudioSaveBar(): StudioSaveBarApi {
  return useContext(SaveBarContext);
}

/** Registers an editor's unsaved edits with the Studio save bar while
 * `dirty`, and drops them on unmount. Returns whether the save bar is on
 * (when off this does nothing). */
export function usePendingEdits(dirty: boolean, edits: PendingEdits): boolean {
  const { enabled, report } = useStudioSaveBar();
  const owner = useId();
  // The registered entry calls through this ref, so it never runs a stale
  // closure while the editor re-renders.
  const ref = useRef(edits);
  ref.current = edits;
  const saving = edits.saving === true;
  useEffect(() => {
    if (!enabled) return;
    report(
      owner,
      dirty
        ? {
            calls: () => ref.current.calls?.() ?? [],
            save: () => ref.current.save(),
            discard: () => ref.current.discard(),
            saving,
          }
        : null,
    );
  }, [enabled, dirty, saving, owner, report]);
  useEffect(
    () => () => {
      if (enabled) report(owner, null);
    },
    [enabled, owner, report],
  );
  return enabled;
}

/** Dry run for the preview: the live quiz with these edits applied.
 * Nothing is written. Null when it couldn't be built. */
export async function previewToolCalls(calls: ToolCall[]): Promise<{ flow?: unknown; config?: unknown } | null> {
  const fd = new FormData();
  fd.append("intent", "preview-tools");
  fd.append("calls", JSON.stringify(calls));
  try {
    const res = await postStudioAction(fd);
    const body = (await res.json().catch(() => null)) as StudioActionData | null;
    return body?.ok ? { flow: body.previewFlow, config: body.previewConfig } : null;
  } catch {
    return null;
  }
}

/** Saves quiz tool calls to the live quiz in ONE request (apply-tools takes
 * at most 5), so an editor's edits land together or not at all. */
export async function saveToolCalls(calls: ToolCall[]): Promise<StudioActionData> {
  const fd = new FormData();
  fd.append("intent", "apply-tools");
  fd.append("calls", JSON.stringify(calls));
  try {
    const res = await postStudioAction(fd);
    const body = (await res.json().catch(() => null)) as StudioActionData | null;
    return body ?? { ok: false, error: "Saving failed. Try again." };
  } catch {
    return { ok: false, error: "Couldn't save. Check your connection and try again." };
  }
}

/**
 * The Studio's side: the registry editors report into, the dry-run preview,
 * Save / Discard for everything, and `confirmLeave` for any switch that
 * would unmount an editor holding edits. With the opt-in off, `bar` and
 * `leaveDialog` are null and `confirmLeave` just runs its callback.
 *
 * `hosted`: the Studio is in the dashboard's app window, which hangs the
 * save bar on its max modal (App Bridge reads ui-save-bar from the modal's
 * children for a src modal) and relays Save / Discard here. Otherwise the
 * bar is drawn in this page.
 */
export function useStudioSaveBarHost(
  enabled: boolean,
  opts: {
    hosted?: boolean;
    /** Show a dry-run preview payload in the canvas. */
    onPreview: (payload: { flow?: unknown; config?: unknown }) => void;
    /** Everything was discarded: remount the editors, reload the preview. */
    onDiscarded: () => void;
  },
) {
  const [editors, setEditors] = useState<Record<string, PendingEdits>>({});
  const editorsRef = useRef(editors);
  editorsRef.current = editors;
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const report = useCallback((owner: string, edits: PendingEdits | null) => {
    setEditors((prev) => {
      if (edits) return { ...prev, [owner]: edits };
      if (!(owner in prev)) return prev;
      const next = { ...prev };
      delete next[owner];
      return next;
    });
  }, []);

  // One dry run per pause in typing, for every editor's edits together (the
  // Results slide has two editors). A newer run, a save or a discard makes
  // an older answer stale.
  const previewTimer = useRef<number | null>(null);
  const previewSeq = useRef(0);
  const cancelPreview = () => {
    previewSeq.current += 1;
    if (previewTimer.current != null) window.clearTimeout(previewTimer.current);
    previewTimer.current = null;
  };
  const previewChanged = useCallback(() => {
    if (previewTimer.current != null) window.clearTimeout(previewTimer.current);
    previewTimer.current = window.setTimeout(async () => {
      previewTimer.current = null;
      const calls = Object.values(editorsRef.current).flatMap((e) => e.calls?.() ?? []);
      if (calls.length === 0) return;
      const seq = ++previewSeq.current;
      const payload = await previewToolCalls(calls);
      if (payload && seq === previewSeq.current) optsRef.current.onPreview(payload);
    }, 500);
  }, []);
  useEffect(
    () => () => {
      if (previewTimer.current != null) window.clearTimeout(previewTimer.current);
    },
    [],
  );

  // One save at a time. A caller that arrives mid-save (a Build with AI
  // turn right after the tab switch that started it) waits for that save
  // first: its editors may have unmounted already, so "nothing pending"
  // would otherwise race the write it depends on.
  const [savingAll, setSavingAll] = useState(false);
  const inflight = useRef<Promise<boolean> | null>(null);
  const saveAll = useCallback(async (): Promise<boolean> => {
    if (inflight.current && !(await inflight.current)) return false;
    const entries = Object.values(editorsRef.current);
    if (entries.length === 0) return true;
    cancelPreview();
    setSavingAll(true);
    const run = Promise.all(entries.map((e) => e.save().catch(() => false))).then((r) => r.every(Boolean));
    inflight.current = run;
    try {
      return await run;
    } finally {
      if (inflight.current === run) inflight.current = null;
      setSavingAll(false);
    }
  }, []);

  const discardAll = useCallback(() => {
    for (const e of Object.values(editorsRef.current)) e.discard();
    editorsRef.current = {};
    setEditors({});
    cancelPreview();
    optsRef.current.onDiscarded();
  }, []);

  const hasPending = useCallback(() => enabled && Object.keys(editorsRef.current).length > 0, [enabled]);

  // Leaving an editor that holds edits asks first, in the Studio's own
  // Polaris dialog: it doesn't depend on which frame App Bridge thinks
  // owns the save bar. Leaving discards.
  const [leaveTo, setLeaveTo] = useState<(() => void) | null>(null);
  const confirmLeave = useCallback(
    (go: () => void) => {
      if (hasPending()) setLeaveTo(() => go);
      else go();
    },
    [hasPending],
  );
  const leaveDialog: ReactNode = enabled ? (
    <Modal
      open={leaveTo !== null}
      onClose={() => setLeaveTo(null)}
      title="Discard unsaved changes?"
      primaryAction={{
        content: "Discard changes",
        destructive: true,
        onAction: () => {
          const go = leaveTo;
          setLeaveTo(null);
          discardAll();
          go?.();
        },
      }}
      secondaryActions={[{ content: "Keep editing", onAction: () => setLeaveTo(null) }]}
    >
      <Modal.Section>
        <Text as="p">Your unsaved changes will be lost. To keep them, click Save first.</Text>
      </Modal.Section>
    </Modal>
  ) : null;

  const api = useMemo<StudioSaveBarApi>(() => ({ enabled, report, previewChanged }), [enabled, report, previewChanged]);
  const dirty = enabled && Object.keys(editors).length > 0;
  const saving = savingAll || Object.values(editors).some((e) => e.saving);
  // Mounted only while dirty: a closed ui-save-bar calls .hide() before App
  // Bridge has upgraded it.
  const bar: ReactNode =
    dirty && !opts.hosted ? (
      <SaveBar id="gleame-studio-save-bar" open discardConfirmation>
        <button variant="primary" loading={saving ? "" : undefined} onClick={() => void saveAll()}>
          Save
        </button>
        <button disabled={saving} onClick={discardAll}>
          Discard
        </button>
      </SaveBar>
    ) : null;

  return { api, dirty, saving, hasPending, saveAll, discardAll, confirmLeave, bar, leaveDialog };
}
