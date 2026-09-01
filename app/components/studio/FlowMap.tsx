import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button, Icon } from "@shopify/polaris";
import { HomeIcon, CameraIcon, FlagIcon, MergeIcon } from "@shopify/polaris-icons";
import type { StudioFlow } from "./types";
import { answerLabel } from "./types";
import { buildScreens, slideIdForQuestion } from "./SlideTree";
import { draftProblems, problemsForSlide } from "./draft-problems";

// Read-only flow map (Quiz Kit's "Logic flow map"): screens laid out
// column-per-branch-depth, plain edges for the default path, labeled dark
// edges from the specific answer that reveals a conditioned screen. Click a
// node to select that slide; no drag or edge editing in v1.
//
// Layout: columns are ordinary flex stacks so card heights are whatever the
// content needs and spacing stays uniform (estimated-height absolute
// positioning made tall cards collide with their neighbors). Edges are drawn
// from MEASURED card rects after render.

const NODE_W = 220;
const SMALL_W = 150;
const COL_GAP = 64;
const ROW_GAP = 24;
const PAD = 40;

interface MapNode {
  id: string; // slideId of first question, or intro/photo/results
  col: number;
  kind: "intro" | "screen" | "photo" | "results";
  questionIndices: number[];
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function FlowMap({
  flow,
  selectedSlide,
  onSelect,
  onClose,
}: {
  flow: StudioFlow | null;
  selectedSlide: string;
  onSelect: (slideId: string) => void;
  onClose: () => void;
}) {
  const layout = useMemo(() => {
    if (!flow) return null;
    const screens = buildScreens(flow);
    const problems = draftProblems(flow);

    // Branch depth: 0 = default path; conditioned screens sit one column
    // right of the screen their condition's source question lives on.
    const screenOfAxis = new Map<string, number>();
    screens.forEach((s, si) => s.indices.forEach((qi) => screenOfAxis.set(flow.questions[qi].axisKey, si)));
    const depths: number[] = screens.map(() => 0);
    screens.forEach((s, si) => {
      const q = flow.questions[s.indices[0]];
      if (!q.showIf) return;
      const sourceScreen = screenOfAxis.get(q.showIf.axis_key);
      if (sourceScreen != null && sourceScreen < si) depths[si] = depths[sourceScreen] + 1;
    });
    const maxDepth = Math.max(0, ...depths);

    // Columns: 0 intro, 1..maxDepth+1 screens by depth, then photo, results.
    const nodes: MapNode[] = [];
    const place = (col: number, kind: MapNode["kind"], id: string, questionIndices: number[] = []) => {
      nodes.push({ id, col, kind, questionIndices });
    };
    place(0, "intro", "intro");
    screens.forEach((s, si) => {
      place(1 + depths[si], "screen", slideIdForQuestion(flow.questions[s.indices[0]].axisKey), s.indices);
    });
    const photoCol = maxDepth + 2;
    const hasPhoto = flow.axes.some((a) => a.source === "photo");
    if (hasPhoto) place(photoCol, "photo", "photo");
    place(hasPhoto ? photoCol + 1 : photoCol, "results", "results");

    const colCount = Math.max(...nodes.map((n) => n.col)) + 1;
    const columns: MapNode[][] = Array.from({ length: colCount }, () => []);
    for (const n of nodes) columns[n.col].push(n);

    // Edges by node id; geometry comes from measured rects at render time.
    const screenId = (si: number) => slideIdForQuestion(flow.questions[screens[si].indices[0]].axisKey);
    const defaultScreens = screens.map((_, si) => si).filter((si) => depths[si] === 0);

    const plainEdges: Array<[string, string]> = [];
    if (defaultScreens.length > 0) plainEdges.push(["intro", screenId(defaultScreens[0])]);
    for (let i = 0; i < defaultScreens.length - 1; i++) {
      plainEdges.push([screenId(defaultScreens[i]), screenId(defaultScreens[i + 1])]);
    }
    const tailId = defaultScreens.length > 0 ? screenId(defaultScreens[defaultScreens.length - 1]) : "intro";
    if (hasPhoto) {
      plainEdges.push([tailId, "photo"], ["photo", "results"]);
    } else {
      plainEdges.push([tailId, "results"]);
    }

    const branchEdges: Array<{ from: string; to: string; label: string }> = [];
    const branchSources = new Map<string, Set<string>>(); // nodeId -> answer values that branch
    screens.forEach((s, si) => {
      const q = flow.questions[s.indices[0]];
      if (!q.showIf) return;
      const sourceScreen = screenOfAxis.get(q.showIf.axis_key);
      if (sourceScreen == null || sourceScreen >= si) return;
      const fromId = screenId(sourceScreen);
      branchEdges.push({
        from: fromId,
        to: screenId(si),
        label: answerLabel(flow, q.showIf.axis_key, q.showIf.axis_value).slice(0, 22),
      });
      const set = branchSources.get(fromId) ?? new Set<string>();
      set.add(`${q.showIf.axis_key}:${q.showIf.axis_value}`);
      branchSources.set(fromId, set);
    });

    return { columns, plainEdges, branchEdges, branchSources, problems, flow };
  }, [flow]);

  // Measured card rects, relative to the canvas div (the SVG's coordinate
  // space). Cards resize with their content, so re-measure after every
  // render pass and on canvas resize.
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const nodeRefs = useRef<Map<string, HTMLElement>>(new Map());
  const [rects, setRects] = useState<Record<string, Rect>>({});
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const measure = () => {
      const base = canvas.getBoundingClientRect();
      const next: Record<string, Rect> = {};
      for (const [id, el] of nodeRefs.current) {
        const r = el.getBoundingClientRect();
        next[id] = { x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height };
      }
      setRects((prev) => {
        const prevKeys = Object.keys(prev);
        const same =
          prevKeys.length === Object.keys(next).length &&
          prevKeys.every((k) => {
            const a = prev[k];
            const b = next[k];
            return b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
          });
        return same ? prev : next;
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(canvas);
    for (const [, el] of nodeRefs.current) ro.observe(el);
    return () => ro.disconnect();
  });

  if (!layout || !flow) return null;

  const bezier = (a: Rect, b: Rect) => {
    if (Math.abs(a.x + a.w / 2 - (b.x + b.w / 2)) < 4) {
      // Same column: a short vertical spine between stacked cards reads as
      // "then", where a side-exit bezier looped invisibly.
      const x = a.x + a.w / 2;
      return `M ${x} ${a.y + a.h} L ${x} ${b.y}`;
    }
    const x1 = a.x + a.w;
    const y1 = a.y + a.h / 2;
    const x2 = b.x;
    const y2 = b.y + b.h / 2;
    const mx = (x1 + x2) / 2;
    return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
  };
  // Point at parameter t along the cross-column cubic, for label placement
  // near the TARGET end instead of the midpoint (which sat on the source
  // card and clipped the text).
  const bezierPoint = (a: Rect, b: Rect, t: number) => {
    const x1 = a.x + a.w;
    const y1 = a.y + a.h / 2;
    const x2 = b.x;
    const y2 = b.y + b.h / 2;
    const mx = (x1 + x2) / 2;
    const u = 1 - t;
    const x = u * u * u * x1 + 3 * u * u * t * mx + 3 * u * t * t * mx + t * t * t * x2;
    const y = u * u * u * y1 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y2;
    return { x, y };
  };

  const setNodeRef = (id: string) => (el: HTMLElement | null) => {
    if (el) nodeRefs.current.set(id, el);
    else nodeRefs.current.delete(id);
  };

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto", position: "relative" }}>
      <div style={{ position: "sticky", top: 12, left: 12, zIndex: 2, width: "fit-content", marginLeft: 12 }}>
        <Button size="slim" onClick={onClose}>
          Back to preview
        </Button>
      </div>
      <div
        ref={canvasRef}
        style={{
          position: "relative",
          display: "inline-flex",
          alignItems: "flex-start",
          gap: COL_GAP,
          padding: PAD,
          minWidth: "100%",
        }}
      >
        <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", overflow: "visible" }}>
          <defs>
            <marker id="fm-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
              <path d="M0,0 L8,4 L0,8 z" fill="#1a1a1a" />
            </marker>
          </defs>
          {layout.plainEdges.map(([fromId, toId], i) => {
            const a = rects[fromId];
            const b = rects[toId];
            if (!a || !b) return null;
            return <path key={`p${i}`} d={bezier(a, b)} stroke="#C9CCCF" strokeWidth={1.5} fill="none" />;
          })}
          {layout.branchEdges.map((e, i) => {
            const a = rects[e.from];
            const b = rects[e.to];
            if (!a || !b) return null;
            const at = bezierPoint(a, b, 0.72);
            const pillW = Math.min(150, e.label.length * 5.6 + 18);
            return (
              <g key={`b${i}`}>
                <path d={bezier(a, b)} stroke="#1a1a1a" strokeWidth={2} fill="none" markerEnd="url(#fm-arrow)" />
                <rect x={at.x - pillW / 2} y={at.y - 24} width={pillW} height={19} rx={9.5} fill="#1a1a1a" />
                <text x={at.x} y={at.y - 11} textAnchor="middle" fontSize={10} fontWeight={600} fill="#fff">
                  {e.label}
                </text>
              </g>
            );
          })}
        </svg>

        {layout.columns.map((column, ci) => (
          <div
            key={ci}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              gap: ROW_GAP,
              width: NODE_W,
              flexShrink: 0,
            }}
          >
            {column.map((node) => {
              const selected =
                node.id === selectedSlide ||
                node.questionIndices.some((qi) => slideIdForQuestion(flow.questions[qi].axisKey) === selectedSlide);
              const problem =
                node.kind === "screen"
                  ? node.questionIndices
                      .flatMap((qi) => problemsForSlide(layout.problems, slideIdForQuestion(flow.questions[qi].axisKey)))
                      .map((p) => p.message)[0]
                  : undefined;
              return (
                <button
                  key={node.id}
                  ref={setNodeRef(node.id)}
                  onClick={() => onSelect(node.id)}
                  style={{
                    position: "relative",
                    width: node.kind === "screen" ? NODE_W : SMALL_W,
                    background: "#fff",
                    border: selected ? "2px solid #1a1a1a" : "1px solid #E1E3E5",
                    borderRadius: 12,
                    padding: selected ? 11 : 12,
                    textAlign: "left",
                    cursor: "pointer",
                    fontSize: 13,
                    boxSizing: "border-box",
                  }}
                >
                  {problem && (
                    <span
                      title={problem}
                      style={{ position: "absolute", top: 8, right: 8, width: 8, height: 8, borderRadius: "50%", background: "#D82C0D" }}
                    />
                  )}
                  {node.kind !== "screen" ? (
                    <span style={{ fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <span style={{ width: 14, height: 14, display: "inline-flex" }}>
                        <Icon
                          source={node.kind === "intro" ? HomeIcon : node.kind === "photo" ? CameraIcon : FlagIcon}
                          tone="subdued"
                        />
                      </span>
                      {node.kind === "intro" ? "Intro" : node.kind === "photo" ? "Photo" : "Results"}
                    </span>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: "#6D7175", display: "inline-flex", alignItems: "center", gap: 4 }}>
                        {node.questionIndices.length > 1
                          ? `Q${node.questionIndices[0] + 1}-Q${node.questionIndices[node.questionIndices.length - 1] + 1}`
                          : `Q${node.questionIndices[0] + 1}`}
                        {flow.questions[node.questionIndices[0]].showIf ? (
                          <span style={{ width: 12, height: 12, display: "inline-flex" }}>
                            <Icon source={MergeIcon} tone="subdued" />
                          </span>
                        ) : null}
                      </span>
                      {node.questionIndices.map((qi) => (
                        <span
                          key={qi}
                          style={{
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden",
                          }}
                        >
                          {flow.questions[qi].prompt.trim() || "Untitled question"}
                        </span>
                      ))}
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {flow.questions[node.questionIndices[0]].options.slice(0, 6).map((o, i) => {
                          const q = flow.questions[node.questionIndices[0]];
                          const branches = layout.branchSources
                            .get(node.id)
                            ?.has(`${q.axisKey}:${o.axisValueValue}`);
                          return (
                            <span
                              key={i}
                              style={{
                                background: branches ? "#1a1a1a" : "#F1F1F1",
                                borderRadius: 999,
                                padding: "1px 8px",
                                fontSize: 11,
                                fontWeight: branches ? 600 : 400,
                                color: branches ? "#fff" : "#202223",
                              }}
                            >
                              {o.label || `Answer ${i + 1}`}
                              {branches ? " →" : ""}
                            </span>
                          );
                        })}
                        {flow.questions[node.questionIndices[0]].options.length > 6 && (
                          <span style={{ fontSize: 11, color: "#6D7175" }}>
                            +{flow.questions[node.questionIndices[0]].options.length - 6} more
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
