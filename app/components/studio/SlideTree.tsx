import { Fragment, useState } from "react";
import { Banner, Tooltip } from "@shopify/polaris";
import type { StudioFlow } from "./types";
import { answerLabel } from "./types";
import { draftProblems, problemsForSlide } from "./draft-problems";

export function slideIdForQuestion(axisKey: string): string {
  return `q:${axisKey}`;
}

function humanizeGroup(key: string): string {
  const words = key.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Screen structure exactly as the storefront builds it: consecutive
 * questions sharing a non-empty screenGroup render together. */
export function buildScreens(flow: StudioFlow): Array<{ group: string | null; indices: number[] }> {
  const screens: Array<{ group: string | null; indices: number[] }> = [];
  flow.questions.forEach((q, i) => {
    const group = q.screenGroup?.trim() || null;
    const last = screens[screens.length - 1];
    if (group && last && last.group === group) last.indices.push(i);
    else screens.push({ group, indices: [i] });
  });
  return screens;
}

function WarningDot({ message }: { message: string }) {
  return (
    <Tooltip content={message}>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: "#D82C0D",
          flexShrink: 0,
          marginLeft: "auto",
        }}
      />
    </Tooltip>
  );
}

function BranchIcon({ label }: { label: string }) {
  return (
    <Tooltip content={label}>
      <span aria-hidden style={{ color: "#6D7175", fontSize: 11, flexShrink: 0 }}>
        ⑂
      </span>
    </Tooltip>
  );
}

function NumberChip({ children, glyph }: { children?: string; glyph?: string }) {
  return (
    <span
      style={{
        width: 20,
        height: 20,
        borderRadius: 6,
        background: "#F1F1F1",
        color: "#6D7175",
        fontSize: 11,
        fontWeight: 600,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      {glyph ?? children}
    </span>
  );
}

export function SlideTree({
  error,
  onDismissError,
  flow,
  selectedSlide,
  onSelect,
  onAdd,
  onMove,
  onReorder,
  flowMapOpen,
  onToggleFlowMap,
  flashSlide,
  disabled,
  readOnly,
  onReturnToBuild,
}: {
  error?: string | null;
  onDismissError?: () => void;
  flow: StudioFlow | null;
  selectedSlide: string;
  onSelect: (slideId: string) => void;
  onAdd?: () => void;
  onMove?: (axisKey: string, direction: -1 | 1) => void;
  onReorder?: (axisKeysInOrder: string[]) => void;
  flowMapOpen: boolean;
  onToggleFlowMap: () => void;
  flashSlide: string | null;
  disabled?: boolean;
  readOnly?: boolean;
  onReturnToBuild?: () => void;
}) {
  const questions = flow?.questions ?? [];
  // Drag-to-reorder: question rows only. dragQi = the question being
  // dragged; overQi = the row the pointer is above (drop inserts before it,
  // or at the end when hovering the last row's lower half is overkill —
  // insert-before semantics keep it simple and predictable).
  const [dragQi, setDragQi] = useState<number | null>(null);
  const [overQi, setOverQi] = useState<number | null>(null);
  const [overAfter, setOverAfter] = useState(false);
  const dropReorder = (targetQi: number) => {
    if (dragQi === null || !onReorder) return;
    const order = questions.map((q) => q.axisKey);
    const [moved] = order.splice(dragQi, 1);
    const insertAt = Math.min(dragQi < targetQi ? targetQi - 1 : targetQi, order.length);
    order.splice(insertAt, 0, moved);
    if (order.some((k, i) => k !== questions[i].axisKey)) onReorder(order);
  };
  const problems = flow ? draftProblems(flow) : [];
  const screens = flow ? buildScreens(flow) : [];
  const hasPhotoAxis = (flow?.axes ?? []).some((a) => a.source === "photo");

  const row = (
    slideId: string,
    label: string,
    opts: {
      glyph?: string;
      number?: number;
      indent?: boolean;
      branchTip?: string;
      problem?: string;
      showMove?: boolean;
      axisKey?: string;
      qi?: number;
      isFirst?: boolean;
      isLast?: boolean;
      untitled?: boolean;
    } = {},
  ) => (
    <div
      key={slideId}
      role="button"
      tabIndex={disabled ? -1 : 0}
      className="studio-tree-row"
      data-selected={selectedSlide === slideId}
      data-flash={flashSlide === slideId}
      style={{
        paddingLeft: opts.indent ? 24 : 8,
        opacity: disabled ? 0.6 : dragQi !== null && dragQi === opts.qi ? 0.4 : 1,
        pointerEvents: disabled ? "none" : undefined,
        boxShadow:
          overQi !== null && overQi === opts.qi && dragQi !== null && dragQi !== opts.qi
            ? overAfter && opts.qi === questions.length - 1
              ? "inset 0 -2px 0 #2C6ECB"
              : "inset 0 2px 0 #2C6ECB"
            : undefined,
      }}
      draggable={!readOnly && !disabled && opts.qi != null && Boolean(onReorder)}
      onDragStart={(e) => {
        if (opts.qi == null) return;
        // Firefox refuses to start a drag without data.
        e.dataTransfer.setData("text/plain", String(opts.qi));
        setDragQi(opts.qi);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(e) => {
        if (dragQi === null || opts.qi == null) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setOverQi(opts.qi);
        // Hovering the lower half of the LAST row means "insert after" so
        // questions can be dragged to the end.
        const rect = e.currentTarget.getBoundingClientRect();
        setOverAfter(opts.qi === questions.length - 1 && e.clientY > rect.top + rect.height / 2);
      }}
      onDrop={(e) => {
        if (opts.qi == null) return;
        e.preventDefault();
        dropReorder(overAfter ? opts.qi + 1 : opts.qi);
        setDragQi(null);
        setOverQi(null);
        setOverAfter(false);
      }}
      onDragEnd={() => {
        setDragQi(null);
        setOverQi(null);
        setOverAfter(false);
      }}
      onClick={() => {
        if (readOnly && onReturnToBuild) onReturnToBuild();
        onSelect(slideId);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (readOnly && onReturnToBuild) onReturnToBuild();
          onSelect(slideId);
        }
      }}
    >
      <NumberChip glyph={opts.glyph}>{opts.number != null ? String(opts.number) : ""}</NumberChip>
      <span
        className="studio-rail-wide"
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontStyle: opts.untitled ? "italic" : undefined,
          color: opts.untitled ? "#6D7175" : undefined,
        }}
      >
        {label}
      </span>
      {opts.branchTip && <BranchIcon label={opts.branchTip} />}
      {opts.showMove && selectedSlide === slideId && onMove && opts.axisKey && (
        <span className="studio-rail-wide" style={{ display: "inline-flex", gap: 2, marginLeft: "auto" }}>
          <button
            aria-label="Move up"
            disabled={opts.isFirst || disabled}
            onClick={(e) => {
              e.stopPropagation();
              onMove(opts.axisKey!, -1);
            }}
            style={moveBtnStyle(opts.isFirst)}
          >
            ↑
          </button>
          <button
            aria-label="Move down"
            disabled={opts.isLast || disabled}
            onClick={(e) => {
              e.stopPropagation();
              onMove(opts.axisKey!, 1);
            }}
            style={moveBtnStyle(opts.isLast)}
          >
            ↓
          </button>
        </span>
      )}
      {opts.problem && <WarningDot message={opts.problem} />}
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
        {row("intro", "Intro", { glyph: "⌂" })}

        {screens.map((screen) => (
          <Fragment key={screen.indices[0]}>
            {screen.group && screen.indices.length > 1 && (
              <div
                className="studio-rail-wide"
                style={{ padding: "6px 8px 2px", fontSize: 11, fontWeight: 600, color: "#6D7175" }}
              >
                ▾ {humanizeGroup(screen.group)}
              </div>
            )}
            {screen.indices.map((qi) => {
              const q = questions[qi];
              const slideId = slideIdForQuestion(q.axisKey);
              const slideProblems = problemsForSlide(problems, slideId);
              const branchTip =
                q.showIf && flow
                  ? `Only shown when "${answerLabel(flow, q.showIf.axis_key, q.showIf.axis_value)}" is picked`
                  : undefined;
              return row(slideId, q.prompt.trim() || "Untitled question", {
                number: qi + 1,
                indent: Boolean(screen.group && screen.indices.length > 1),
                branchTip,
                problem: slideProblems[0]?.message,
                untitled: !q.prompt.trim(),
                showMove: !readOnly,
                axisKey: q.axisKey,
                qi,
                isFirst: qi === 0,
                isLast: qi === questions.length - 1,
              });
            })}
          </Fragment>
        ))}

        {hasPhotoAxis && row("photo", "Photo", { glyph: "◉" })}
        {row("results", "Results", { glyph: "⚑" })}

        {!readOnly && onAdd && (
          <>
            <button
              className="studio-tree-row"
              onClick={onAdd}
              disabled={disabled || questions.length >= 12}
              style={{
                color: "#2C6ECB",
                fontWeight: 600,
                opacity: disabled || questions.length >= 12 ? 0.5 : 1,
              }}
            >
              <NumberChip glyph="+" />
              <span className="studio-rail-wide">Add question</span>
            </button>
            {questions.length >= 12 && (
              <div
                className="studio-rail-wide"
                style={{ padding: "2px 8px", fontSize: 11, color: "#6D7175" }}
              >
                12 questions is the limit (long quizzes lose shoppers).
              </div>
            )}
          </>
        )}
        <div style={{ height: 6 }} aria-hidden />
        <div
          role="button"
          tabIndex={disabled ? -1 : 0}
          className="studio-tree-row"
          data-selected={selectedSlide === "theme"}
          style={{ opacity: disabled ? 0.6 : 1, pointerEvents: disabled ? "none" : undefined }}
          onClick={() => onSelect("theme")}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelect("theme");
            }
          }}
          >
          <span
            aria-hidden
            style={{ display: "inline-flex", alignItems: "center", flexShrink: 0, width: 20, justifyContent: "center" }}
          >
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#1A1A1E", marginRight: -3, zIndex: 2, border: "1.5px solid #fff" }} />
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#B692F6", marginRight: -3, zIndex: 1, border: "1.5px solid #fff" }} />
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#FDA47A", border: "1.5px solid #fff" }} />
          </span>
          <span className="studio-rail-wide" style={{ fontWeight: 600 }}>
            Theme &amp; fonts
          </span>
        </div>
        {error && (
          <div style={{ padding: 8 }} className="studio-rail-wide">
            <Banner tone="critical" onDismiss={onDismissError}>
              {error}
            </Banner>
          </div>
        )}
      </div>

      {!readOnly && (
        <div style={{ borderTop: "1px solid #E1E3E5", padding: 8 }}>
          <button
            className="studio-tree-row"
            data-selected={flowMapOpen}
            onClick={onToggleFlowMap}
          >
            <NumberChip glyph="⑂" />
            <span className="studio-rail-wide">Flow map</span>
          </button>
        </div>
      )}
    </div>
  );
}

function moveBtnStyle(disabled?: boolean): React.CSSProperties {
  return {
    width: 22,
    height: 22,
    border: "1px solid #E1E3E5",
    borderRadius: 6,
    background: "#fff",
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.4 : 1,
    fontSize: 11,
    lineHeight: 1,
  };
}
