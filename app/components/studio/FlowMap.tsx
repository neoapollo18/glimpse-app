import { useMemo } from "react";
import { Button } from "@shopify/polaris";
import type { StudioFlow } from "./types";
import { answerLabel } from "./types";
import { buildScreens, slideIdForQuestion } from "./SlideTree";
import { draftProblems, problemsForSlide } from "./draft-problems";

// Read-only flow map (Quiz Kit's "Logic flow map"): screens laid out
// column-per-branch-depth, plain edges for the default path, labeled dark
// edges from the specific answer that reveals a conditioned screen. Click a
// node to select that slide; no drag or edge editing in v1.

const NODE_W = 220;
const SMALL_W = 150;
const COL_GAP = 64;
const ROW_GAP = 24;
const NODE_H = 120;
const SMALL_H = 44;
const PAD = 40;

interface MapNode {
  id: string; // slideId of first question, or intro/photo/results
  col: number;
  row: number;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: "intro" | "screen" | "photo" | "results";
  questionIndices: number[];
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
    const colRows: number[] = [];
    const place = (col: number, kind: MapNode["kind"], id: string, questionIndices: number[] = []) => {
      const row = colRows[col] ?? 0;
      colRows[col] = row + 1;
      const w = kind === "screen" ? NODE_W : SMALL_W;
      const h = kind === "screen" ? NODE_H : SMALL_H;
      const node: MapNode = {
        id,
        col,
        row,
        w,
        h,
        kind,
        questionIndices,
        x: PAD + col * (NODE_W + COL_GAP),
        y: PAD + row * (NODE_H + ROW_GAP),
      };
      nodes.push(node);
      return node;
    };

    place(0, "intro", "intro");
    screens.forEach((s, si) => {
      place(1 + depths[si], "screen", slideIdForQuestion(flow.questions[s.indices[0]].axisKey), s.indices);
    });
    const photoCol = maxDepth + 2;
    const hasPhoto = flow.axes.some((a) => a.source === "photo");
    if (hasPhoto) place(photoCol, "photo", "photo");
    place(hasPhoto ? photoCol + 1 : photoCol, "results", "results");

    // Edges
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const screenNode = (si: number) => nodeById.get(slideIdForQuestion(flow.questions[screens[si].indices[0]].axisKey))!;
    const defaultScreens = screens.map((_, si) => si).filter((si) => depths[si] === 0);

    const plainEdges: Array<[MapNode, MapNode]> = [];
    const introNode = nodeById.get("intro")!;
    if (defaultScreens.length > 0) plainEdges.push([introNode, screenNode(defaultScreens[0])]);
    for (let i = 0; i < defaultScreens.length - 1; i++) {
      plainEdges.push([screenNode(defaultScreens[i]), screenNode(defaultScreens[i + 1])]);
    }
    const tail = defaultScreens.length > 0 ? screenNode(defaultScreens[defaultScreens.length - 1]) : introNode;
    const photoNode = nodeById.get("photo");
    const resultsNode = nodeById.get("results")!;
    if (photoNode) {
      plainEdges.push([tail, photoNode], [photoNode, resultsNode]);
    } else {
      plainEdges.push([tail, resultsNode]);
    }

    const branchEdges: Array<{ from: MapNode; to: MapNode; label: string }> = [];
    screens.forEach((s, si) => {
      const q = flow.questions[s.indices[0]];
      if (!q.showIf) return;
      const sourceScreen = screenOfAxis.get(q.showIf.axis_key);
      if (sourceScreen == null || sourceScreen >= si) return;
      branchEdges.push({
        from: screenNode(sourceScreen),
        to: screenNode(si),
        label: answerLabel(flow, q.showIf.axis_key, q.showIf.axis_value).slice(0, 16),
      });
    });

    const width = PAD * 2 + (Math.max(...nodes.map((n) => n.col)) + 1) * (NODE_W + COL_GAP);
    const height = PAD * 2 + Math.max(1, ...colRows.map((r) => r ?? 0)) * (NODE_H + ROW_GAP);
    return { nodes, plainEdges, branchEdges, problems, width, height, flow };
  }, [flow]);

  if (!layout || !flow) return null;

  const bezier = (a: MapNode, b: MapNode) => {
    const x1 = a.x + a.w;
    const y1 = a.y + a.h / 2;
    const x2 = b.x;
    const y2 = b.y + b.h / 2;
    const mx = (x1 + x2) / 2;
    return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
  };

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto", position: "relative" }}>
      <div style={{ position: "sticky", top: 12, left: 12, zIndex: 2, width: "fit-content", marginLeft: 12 }}>
        <Button size="slim" onClick={onClose}>
          Back to preview
        </Button>
      </div>
      <div style={{ position: "relative", width: layout.width, height: layout.height }}>
        <svg
          width={layout.width}
          height={layout.height}
          style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
        >
          <defs>
            <marker id="fm-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
              <path d="M0,0 L8,4 L0,8 z" fill="#1a1a1a" />
            </marker>
          </defs>
          {layout.plainEdges.map(([a, b], i) => (
            <path key={`p${i}`} d={bezier(a, b)} stroke="#C9CCCF" strokeWidth={1.5} fill="none" />
          ))}
          {layout.branchEdges.map((e, i) => {
            const midX = (e.from.x + e.from.w + e.to.x) / 2;
            const midY = (e.from.y + e.from.h / 2 + e.to.y + e.to.h / 2) / 2;
            return (
              <g key={`b${i}`}>
                <path d={bezier(e.from, e.to)} stroke="#1a1a1a" strokeWidth={2} fill="none" markerEnd="url(#fm-arrow)" />
                <rect x={midX - 34} y={midY - 10} width={68} height={18} rx={9} fill="#fff" stroke="#E1E3E5" />
                <text x={midX} y={midY + 3} textAnchor="middle" fontSize={10} fill="#202223">
                  {e.label}
                </text>
              </g>
            );
          })}
        </svg>

        {layout.nodes.map((node) => {
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
              onClick={() => onSelect(node.id)}
              style={{
                position: "absolute",
                left: node.x,
                top: node.y,
                width: node.w,
                minHeight: node.h,
                background: "#fff",
                border: selected ? "2px solid #1a1a1a" : "1px solid #E1E3E5",
                borderRadius: 12,
                padding: 12,
                textAlign: "left",
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              {problem && (
                <span
                  title={problem}
                  style={{ position: "absolute", top: 8, right: 8, width: 8, height: 8, borderRadius: "50%", background: "#D82C0D" }}
                />
              )}
              {node.kind !== "screen" ? (
                <span style={{ fontWeight: 600 }}>
                  {node.kind === "intro" ? "⌂ Intro" : node.kind === "photo" ? "◉ Photo" : "⚑ Results"}
                </span>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "#6D7175" }}>
                    {node.questionIndices.length > 1
                      ? `Q${node.questionIndices[0] + 1}-Q${node.questionIndices[node.questionIndices.length - 1] + 1}`
                      : `Q${node.questionIndices[0] + 1}`}
                    {flow.questions[node.questionIndices[0]].showIf ? "  ⑂" : ""}
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
                    {flow.questions[node.questionIndices[0]].options.slice(0, 6).map((o, i) => (
                      <span
                        key={i}
                        style={{
                          background: "#F1F1F1",
                          borderRadius: 999,
                          padding: "1px 8px",
                          fontSize: 11,
                          color: "#202223",
                        }}
                      >
                        {o.label || `Answer ${i + 1}`}
                      </span>
                    ))}
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
    </div>
  );
}
