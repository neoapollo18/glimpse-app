import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useRevalidator } from "@remix-run/react";
import { Text } from "@shopify/polaris";
import {
  AlertCircleIcon,
  ArrowUpIcon,
  ChatIcon,
  CheckSmallIcon,
  EditIcon,
  FilterIcon,
  ListBulletedIcon,
  PaintBrushFlatIcon,
  ResetIcon,
  UndoIcon,
} from "@shopify/polaris-icons";
import { readSseStream } from "../../lib/sse-client";
import type { StudioQuestion } from "./types";

// "Build with AI": the Gleame copilot as an assistant-style chat. Replies
// render as plain readable text beside a small Gleame mark, applied changes
// show as compact action rows with Undo, and a large composer sits at the
// bottom. State machine ported from the old quiz-builder page; endpoint and
// session semantics unchanged (/app/api/quiz-copilot).

type ChatItem =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string; error?: boolean }
  | {
      kind: "change";
      tool: string;
      target: string;
      description: string;
      snapshotId: string;
      undone?: boolean;
    };

type CopilotEvent =
  | { type: "token"; text: string }
  | { type: "change"; tool: string; target: string; description: string; snapshotId: string }
  | { type: "done"; sessionId: string }
  | { type: "error"; error: string }
  | { type: "heartbeat" };

// Scoped to .gai so nothing leaks into other Studio surfaces. Warm off-white
// canvas, dark warm ink, and a neutral near-black accent (mark, send,
// focus): no purple, since Shopify reserves its magic purple and the
// Sidekick look for its own AI (Built for Shopify 4.3.5).
// Muted text is #6B635A on #FAF8F4 (5.6:1) and on white (5.9:1), AA.
const CHAT_CSS = `
  .gai { --gai-bg: #FAF8F4; --gai-ink: #26211C; --gai-ink-2: #4A433B; --gai-muted: #6B635A; --gai-line: #E8E2D8; --gai-line-2: #D6CEC1; --gai-user: #EFEAE2; --gai-card: #FFFFFF; --gai-accent: #303030; --gai-accent-hover: #1A1A1A; --gai-accent-soft: #F1F1F1;
    flex: 1; min-height: 0; display: flex; flex-direction: column; background: var(--gai-bg); color: var(--gai-ink); font-size: 14px; line-height: 1.6; -webkit-font-smoothing: antialiased; }
  .gai button { font: inherit; }
  .gai button:focus-visible { outline: 2px solid var(--gai-accent); outline-offset: 2px; }
  .gai-sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
  /* Soft edges where messages scroll under the tab bar and composer. */
  .gai-list { flex: 1; min-height: 0; overflow-y: auto; padding: 14px 16px 24px; display: flex; flex-direction: column; gap: 16px; -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 6px, #000 calc(100% - 20px), transparent 100%); mask-image: linear-gradient(to bottom, transparent 0, #000 6px, #000 calc(100% - 20px), transparent 100%); }
  .gai-user { align-self: flex-end; max-width: 85%; background: var(--gai-user); border-radius: 18px; padding: 8px 14px; white-space: pre-wrap; overflow-wrap: anywhere; }
  .gai-user + .gai-a { margin-top: 4px; }
  .gai-a { position: relative; padding-left: 32px; min-width: 0; }
  .gai-a > .gai-mark { position: absolute; left: 0; top: 1px; }
  .gai-mark { width: 22px; height: 22px; border-radius: 999px; background: var(--gai-accent); display: inline-grid; place-items: center; flex-shrink: 0; }
  .gai-mark svg { width: 62%; height: 62%; fill: #fff; }
  .gai-mark[data-busy="true"] { animation: gai-breathe 1.8s ease-in-out infinite; }
  @keyframes gai-breathe { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(0.86); opacity: 0.7; } }
  .gai-md { display: flex; flex-direction: column; gap: 10px; overflow-wrap: anywhere; }
  .gai-md p { margin: 0; white-space: pre-wrap; }
  .gai-md ul { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 4px; }
  .gai-md li::marker { color: var(--gai-muted); }
  .gai-md strong { font-weight: 650; }
  .gai-error { display: flex; gap: 8px; align-items: flex-start; padding: 8px 12px; border-radius: 12px; background: #FBEFEB; border: 1px solid #F0D3C9; color: #8A2914; font-size: 13px; line-height: 20px; overflow-wrap: anywhere; }
  .gai-error svg { width: 16px; height: 16px; fill: currentColor; flex-shrink: 0; margin-top: 2px; }
  .gai-actions { list-style: none; margin: 0; padding: 0; border: 1px solid var(--gai-line); border-radius: 12px; background: var(--gai-card); overflow: hidden; }
  .gai-action { display: grid; grid-template-columns: 20px minmax(0, 1fr) auto; column-gap: 10px; align-items: start; padding: 8px 6px 8px 10px; font-size: 13px; line-height: 20px; }
  .gai-action + .gai-action { border-top: 1px solid var(--gai-line); }
  .gai-action-icon { width: 20px; height: 20px; border-radius: 999px; background: var(--gai-accent-soft); color: var(--gai-accent); display: grid; place-items: center; }
  .gai-action-icon svg { width: 16px; height: 16px; fill: currentColor; }
  .gai-action-main { min-width: 0; overflow-wrap: anywhere; }
  .gai-action-tag { display: inline-block; margin-right: 6px; padding: 0 6px; border-radius: 6px; background: #F3EFE8; color: var(--gai-ink-2); font-size: 12px; font-weight: 600; line-height: 18px; vertical-align: 1px; }
  .gai-action-note { display: block; color: var(--gai-muted); font-size: 12px; line-height: 18px; margin-top: 1px; }
  .gai-undo { display: inline-flex; align-items: center; gap: 3px; border: 0; border-radius: 6px; background: transparent; color: var(--gai-ink-2); font-size: 12px; font-weight: 600; line-height: 20px; padding: 0 8px 0 5px; cursor: pointer; }
  .gai-undo svg { width: 14px; height: 14px; fill: currentColor; }
  .gai-undo:hover:not(:disabled) { background: #F0EBE3; color: var(--gai-ink); }
  .gai-undo:disabled { color: var(--gai-muted); opacity: 0.6; cursor: default; }
  .gai-action-state { color: var(--gai-muted); font-size: 12px; line-height: 20px; padding: 0 8px; }
  .gai-action[data-undone="true"] .gai-action-icon { background: transparent; color: var(--gai-muted); box-shadow: inset 0 0 0 1px var(--gai-line-2); }
  .gai-action[data-undone="true"] .gai-action-icon svg { width: 14px; height: 14px; }
  .gai-action[data-undone="true"] .gai-action-text { color: var(--gai-muted); text-decoration: line-through; text-decoration-color: rgba(107, 99, 90, 0.55); }
  .gai-action[data-undone="true"] .gai-action-tag { background: transparent; box-shadow: inset 0 0 0 1px var(--gai-line); color: var(--gai-muted); }
  .gai-thinking { display: flex; align-items: center; min-height: 24px; }
  .gai-thinking-text { font-size: 13px; font-weight: 500; background: linear-gradient(90deg, var(--gai-muted) 25%, var(--gai-ink) 50%, var(--gai-muted) 75%); background-size: 200% 100%; -webkit-background-clip: text; background-clip: text; color: transparent; animation: gai-shimmer 1.6s linear infinite; }
  @keyframes gai-shimmer { 0% { background-position: 200% 0; } 100% { background-position: 0% 0; } }
  .gai-empty { margin: auto 0; display: flex; flex-direction: column; align-items: center; text-align: center; padding: 4px 0; }
  .gai-empty .gai-mark { width: 36px; height: 36px; }
  .gai-empty-title { margin: 14px 0 6px; font-size: 20px; line-height: 28px; font-weight: 600; color: var(--gai-ink); }
  .gai-empty-lead { margin: 0; max-width: 310px; color: var(--gai-ink-2); font-size: 14px; line-height: 21px; }
  .gai-examples-label { align-self: stretch; text-align: left; margin: 20px 0 8px; color: var(--gai-muted); font-size: 12px; font-weight: 600; line-height: 16px; }
  .gai-examples { list-style: none; margin: 0; padding: 0; align-self: stretch; display: flex; flex-direction: column; gap: 6px; }
  .gai-example { width: 100%; display: flex; gap: 10px; align-items: flex-start; text-align: left; border: 1px solid var(--gai-line); border-radius: 12px; background: rgba(255, 255, 255, 0.55); padding: 9px 12px; color: var(--gai-ink); font-size: 13px; line-height: 19px; cursor: pointer; transition: background-color 0.15s ease, border-color 0.15s ease; }
  .gai-example:hover { background: var(--gai-card); border-color: var(--gai-line-2); }
  .gai-example svg { width: 16px; height: 16px; fill: var(--gai-muted); flex-shrink: 0; margin-top: 1.5px; }
  /* Short windows (a 13" laptop, 1024x768): tighten the welcome so every
     example stays above the composer instead of scrolling under it. */
  @media (max-height: 820px) {
    .gai-list { padding-top: 8px; }
    .gai-empty .gai-mark { width: 30px; height: 30px; }
    .gai-empty-title { margin: 10px 0 4px; font-size: 18px; line-height: 24px; }
    .gai-empty-lead { line-height: 20px; }
    .gai-examples-label { margin: 14px 0 6px; }
    .gai-examples { gap: 4px; }
    .gai-example { padding: 7px 12px; line-height: 18px; }
  }
  .gai-foot { padding: 4px 12px 10px; }
  .gai-composer { display: flex; flex-direction: column; background: var(--gai-card); border: 1px solid var(--gai-line); border-radius: 20px; padding: 12px 10px 10px 16px; box-shadow: 0 1px 2px rgba(38, 33, 28, 0.04), 0 8px 24px -10px rgba(38, 33, 28, 0.16); cursor: text; transition: border-color 0.15s ease, box-shadow 0.15s ease; }
  .gai-composer:focus-within { border-color: #8A8A8A; box-shadow: 0 1px 2px rgba(38, 33, 28, 0.04), 0 8px 24px -10px rgba(38, 33, 28, 0.16), 0 0 0 3px rgba(48, 48, 48, 0.10); }
  .gai-input { display: block; width: 100%; margin: 0; padding: 0 6px 0 0; border: 0; outline: 0; resize: none; background: transparent; color: var(--gai-ink); font: inherit; font-size: 14px; line-height: 21px; min-height: 21px; overflow-y: hidden; }
  .gai-input::placeholder { color: #7A7268; opacity: 1; }
  .gai-input:disabled { color: var(--gai-muted); cursor: default; }
  .gai-composer-row { display: flex; justify-content: flex-end; margin-top: 6px; }
  .gai-send { width: 32px; height: 32px; border: 0; border-radius: 999px; background: var(--gai-accent); color: #fff; display: grid; place-items: center; cursor: pointer; transition: background-color 0.15s ease; }
  .gai-send svg { width: 18px; height: 18px; fill: currentColor; }
  .gai-send:hover:not(:disabled) { background: var(--gai-accent-hover); }
  .gai-send:disabled { background: #ECE6DD; color: #8F867A; cursor: default; }
  .gai-send[data-busy="true"] { background: var(--gai-accent); color: #fff; }
  .gai-spinner { width: 14px; height: 14px; border-radius: 999px; border: 2px solid rgba(255, 255, 255, 0.35); border-top-color: #fff; animation: gai-spin 0.8s linear infinite; }
  @keyframes gai-spin { to { transform: rotate(360deg); } }
  /* Reassurance on the left, Reset tucked on the right: nothing sits above
     the conversation, so it never scrolls under a control row. */
  .gai-hint { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 24px; margin-top: 6px; padding: 0 0 0 8px; color: var(--gai-muted); font-size: 12px; line-height: 16px; }
  .gai-reset { display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0; border: 0; border-radius: 6px; background: transparent; color: var(--gai-muted); font-size: 12px; line-height: 16px; padding: 4px 8px 4px 6px; cursor: pointer; }
  .gai-reset svg { width: 14px; height: 14px; fill: currentColor; }
  .gai-reset:hover:not(:disabled) { background: #F0EBE3; color: var(--gai-ink); }
  .gai-reset:disabled { opacity: 0.55; cursor: default; }
  @media (prefers-reduced-motion: reduce) {
    .gai-mark[data-busy="true"], .gai-thinking-text, .gai-spinner { animation: none; }
    .gai-thinking-text { background: none; color: var(--gai-muted); }
  }
`;

/** The Gleame "G" in white, sized to sit inside the dark .gai-mark disc.
 * Paths from public/placeholders/gleametransparent.svg. */
function GleameMark({ busy }: { busy?: boolean }) {
  return (
    <span className="gai-mark" data-busy={busy ? "true" : undefined} aria-hidden>
      <svg viewBox="15 21 508 508">
        <path d="M270.314 21.0001V21.3223C132.622 21.3223 21 134.639 21 274.421C21 373.976 63.8516 451.773 146.184 493.102C136.046 487.808 140.348 490.009 131.677 483.036C95.6525 454.069 73.3975 410.683 73.3975 353.101C73.3975 238.649 161.317 145.689 270.222 144.641V144.632H365.396C432.655 144.632 487.18 89.2798 487.18 21.0001H270.314Z" />
        <path d="M143.264 490.907C161.826 494.411 179.736 492.577 197.451 489.147C227.389 483.351 254.31 469.192 279.928 450.049C322.499 418.236 353.942 370.527 362.189 319.712L245.748 320.816C245.34 320.82 244.969 320.658 244.696 320.392C244.156 319.976 243.945 319.226 244.23 318.568L260.097 281.892L260.103 281.878L260.113 281.851C260.132 281.805 260.161 281.735 260.196 281.648C260.269 281.47 260.374 281.206 260.514 280.868C260.792 280.19 261.2 279.207 261.716 277.988C262.748 275.548 264.217 272.153 265.964 268.333C269.449 260.715 274.077 251.33 278.575 244.466C279.888 242.463 281.471 240.299 283.21 238.07C298.966 217.878 324.122 208.61 349.256 208.61C349.323 208.61 349.396 208.602 349.461 208.61L517.133 208.625V278.334C517.133 321.827 506.415 364.629 485.955 402.843L484.308 405.919C473.542 426.026 459.96 444.444 443.988 460.594C397.154 507.947 332.574 533.89 266.751 526.843C245.836 524.604 226.787 521.983 215.711 519.085C197.963 514.44 159.247 497.551 142.338 490.907C140.985 490.488 141.95 490.659 143.264 490.907Z" />
      </svg>
    </span>
  );
}

/** Lightweight, injection-safe chat formatting: **bold** spans plus
 * dash/star bullet lines rendered as a real list. Pure string splitting
 * into strings and styled elements — no HTML parsing. */
function renderInline(text: string, keyBase: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={`${keyBase}-${i}`}>{part.slice(2, -2)}</strong>
    ) : (
      part
    ),
  );
}

function renderChatText(text: string) {
  const lines = text.split("\n");
  const blocks: React.ReactNode[] = [];
  let bullets: string[] = [];
  let para: string[] = [];

  const flushPara = () => {
    if (para.length === 0) return;
    blocks.push(<p key={`p${blocks.length}`}>{renderInline(para.join("\n"), `p${blocks.length}`)}</p>);
    para = [];
  };
  const flushBullets = () => {
    if (bullets.length === 0) return;
    blocks.push(
      <ul key={`u${blocks.length}`}>
        {bullets.map((b, i) => (
          <li key={i}>{renderInline(b, `u${blocks.length}-${i}`)}</li>
        ))}
      </ul>,
    );
    bullets = [];
  };

  for (const line of lines) {
    const m = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (m) {
      flushPara();
      bullets.push(m[1]);
    } else if (line.trim() === "") {
      flushPara();
      flushBullets();
    } else {
      flushBullets();
      para.push(line);
    }
  }
  flushPara();
  flushBullets();
  return <div className="gai-md">{blocks}</div>;
}

// Open-ended starters for the empty state. Clicking one only fills the
// composer: auto-sending canned prompts made the tool feel smaller than it
// is, and merchants usually want to tweak the wording first.
const EXAMPLE_PROMPTS = [
  { icon: ChatIcon, text: "Rewrite the questions so they sound like a friendly expert, not a survey." },
  { icon: FilterIcon, text: "Add a budget question and use it to choose which products we recommend." },
  { icon: PaintBrushFlatIcon, text: "Make it feel more premium: softer colors, more white space, an elegant font." },
  { icon: ListBulletedIcon, text: "Cut the quiz down to the questions that matter most for matching." },
];

// Studio is server-rendered: a plain useLayoutEffect warns there.
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

const INPUT_LINE_PX = 21;
const INPUT_MAX_LINES = 8;

/** Grow the composer with its content (1 to 8 lines, then scroll). */
function fitInput(el: HTMLTextAreaElement) {
  // Hidden (Edit tab showing): scrollHeight reads 0, so keep the last size
  // and let the resize observer re-measure once the pane is visible.
  if (el.clientWidth === 0) return;
  el.style.height = "auto";
  const max = INPUT_LINE_PX * INPUT_MAX_LINES;
  el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
}

export function ChatPanel({
  aiConfigured,
  initialSessionId,
  selectedSlide,
  questions,
  onBusyChange,
  onChangeApplied,
  onBeforeSend,
  seedMessage,
}: {
  aiConfigured: boolean;
  initialSessionId: string | null;
  selectedSlide: string;
  questions: StudioQuestion[];
  onBusyChange: (busy: boolean) => void;
  onChangeApplied: (target: string) => void;
  /** Flush pending debounced editor saves before the turn starts, so the
   * copilot's server-side draft read includes what was just typed. With the
   * save bar on it is a Save the turn waits for; false stops the turn. */
  onBeforeSend?: () => void | boolean | Promise<boolean | void>;
  seedMessage?: string | null;
}) {
  const revalidator = useRevalidator();
  const [items, setItems] = useState<ChatItem[]>(
    seedMessage ? [{ kind: "assistant", text: seedMessage }] : [],
  );
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const sessionIdRef = useRef<string | null>(initialSessionId);
  const listRef = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  // The composer text an example click produced, so a second click can
  // swap examples while a typed draft is never wiped.
  const exampleDraftRef = useRef<string | null>(null);
  const inputId = useId();

  useEffect(() => {
    onBusyChange(busy);
  }, [busy, onBusyChange]);

  useEffect(() => {
    if (pinnedRef.current) {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
    }
  }, [items]);

  // Keyed on the value so example fills and post-send clears resize too.
  useIsoLayoutEffect(() => {
    if (inputRef.current) fitInput(inputRef.current);
  }, [input, aiConfigured]);

  // Re-fit when the panel's width changes (0 while the Edit tab hides it,
  // 320px when it shows again), so a
  // multi-line draft that rewraps is never clipped. Observes the panel
  // root, whose size the textarea's own growth doesn't change.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    let lastWidth = -1;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (width === lastWidth) return;
      lastWidth = width;
      if (inputRef.current) fitInput(inputRef.current);
    });
    ro.observe(root);
    return () => ro.disconnect();
  }, [aiConfigured]);

  // The composer is disabled while a turn runs, which drops focus to the
  // body; hand it back when the turn ends unless the merchant moved on.
  const wasBusyRef = useRef(false);
  useEffect(() => {
    if (wasBusyRef.current && !busy) {
      const active = typeof document !== "undefined" ? document.activeElement : null;
      if (!active || active === document.body) inputRef.current?.focus();
    }
    wasBusyRef.current = busy;
  }, [busy]);

  const appendAssistantText = (text: string, error = false) => {
    setItems((prev) => {
      const last = prev[prev.length - 1];
      if (!error && last?.kind === "assistant" && !last.error) {
        return [...prev.slice(0, -1), { kind: "assistant", text: last.text + text }];
      }
      return [...prev, { kind: "assistant", text, error }];
    });
  };

  const sendChat = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    // A save that failed stops the turn (the panel says why) and keeps the
    // text, so nothing is sent against a quiz missing the merchant's edits.
    if ((await onBeforeSend?.()) === false) {
      setBusy(false);
      return;
    }
    setInput("");
    // A new message always scrolls into view, even if the merchant had
    // scrolled up to reread an earlier reply.
    pinnedRef.current = true;
    setItems((prev) => [...prev, { kind: "user", text: trimmed }]);
    let sawChange = false;
    let gotTerminal = false;
    try {
      const fd = new FormData();
      fd.append("intent", "message");
      fd.append("text", trimmed);
      if (sessionIdRef.current) fd.append("sessionId", sessionIdRef.current);
      const res = await fetch("/app/api/quiz-copilot", { method: "POST", body: fd });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
      await readSseStream<CopilotEvent>(res, (event) => {
        if (event.type === "token") appendAssistantText(event.text);
        else if (event.type === "change") {
          sawChange = true;
          setItems((prev) => [
            ...prev,
            {
              kind: "change",
              tool: event.tool,
              target: event.target,
              description: event.description,
              snapshotId: event.snapshotId,
            },
          ]);
          onChangeApplied(event.target);
        } else if (event.type === "done") {
          gotTerminal = true;
          sessionIdRef.current = event.sessionId;
        } else if (event.type === "error") {
          gotTerminal = true;
          appendAssistantText(`Something went wrong: ${event.error}`, true);
        }
      });
      if (!gotTerminal) {
        appendAssistantText(
          "Connection was interrupted. Your last change may still have applied; check the preview.",
          true,
        );
      }
    } catch (err) {
      appendAssistantText(
        `Something went wrong: ${err instanceof Error ? err.message : "please try again"}`,
        true,
      );
    } finally {
      // Revalidate in finally, not the try: a thrown SSE read (connection
      // reset mid-stream) after an applied change must still refresh loader
      // data. The studio's postTurnLock is only released when that
      // revalidation completes, so skipping it froze every editor behind
      // "Gleame is making changes" until a full reload.
      if (sawChange || !gotTerminal) revalidator.revalidate();
      setBusy(false);
    }
  };

  const undoChange = async (snapshotId: string) => {
    if (!sessionIdRef.current || busy) return;
    const fd = new FormData();
    fd.append("intent", "undo");
    fd.append("sessionId", sessionIdRef.current);
    fd.append("snapshotId", snapshotId);
    const res = await fetch("/app/api/quiz-copilot", { method: "POST", body: fd });
    const body = await res.json().catch(() => null);
    if (body?.ok) {
      // The server restores the pre-change draft and prunes every LATER
      // snapshot (they describe reverted states) — so mark this card AND all
      // change cards after it as undone. Leaving later cards live showed
      // "Applied" badges for reverted changes and Undo buttons that could
      // only fail with "Snapshot not found".
      setItems((prev) => {
        const idx = prev.findIndex((it) => it.kind === "change" && it.snapshotId === snapshotId);
        if (idx < 0) return prev;
        return prev.map((it, i) => (it.kind === "change" && i >= idx ? { ...it, undone: true } : it));
      });
      onChangeApplied("");
      revalidator.revalidate();
    } else {
      appendAssistantText(`Undo failed: ${body?.error ?? "unknown error"}`, true);
    }
  };

  const resetChat = async () => {
    if (busy) return;
    if (sessionIdRef.current) {
      const fd = new FormData();
      fd.append("intent", "reset");
      fd.append("sessionId", sessionIdRef.current);
      await fetch("/app/api/quiz-copilot", { method: "POST", body: fd }).catch(() => {});
    }
    setItems([]);
  };

  const fillComposer = (text: string) => {
    // An example replaces an empty box or a previous example, but text the
    // merchant typed stays: the example goes on a new line after it.
    const keep = input.trim() !== "" && input !== exampleDraftRef.current;
    const next = keep ? `${input.trimEnd()}\n${text}` : text;
    exampleDraftRef.current = next;
    setInput(next);
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    // Caret at the end so the merchant can keep typing onto the example.
    requestAnimationFrame(() => el.setSelectionRange(next.length, next.length));
  };

  if (!aiConfigured) {
    return (
      <div style={{ padding: 24, textAlign: "center" }}>
        <Text as="p" tone="subdued">
          AI isn't set up for this installation. Contact Gleame support. All
          manual editing still works.
        </Text>
      </div>
    );
  }

  const selectedQ = questions.findIndex((q) => `q:${q.axisKey}` === selectedSlide);
  const examples =
    selectedQ >= 0
      ? [
          {
            icon: EditIcon,
            text: `For question ${selectedQ + 1} (${quoted(questions[selectedQ].prompt)}), make the wording warmer and give every answer a short, vivid description.`,
          },
          // It stands in for the general wording example, so the four
          // still span wording, logic, style and structure.
          ...EXAMPLE_PROMPTS.slice(1),
        ]
      : EXAMPLE_PROMPTS;

  // Group the flat item list into render blocks: consecutive change cards
  // share one action list, and the Gleame mark marks the start of each
  // assistant turn (the first assistant block after a user message).
  type Block =
    | { kind: "user"; key: number; text: string }
    | { kind: "assistant"; key: number; text: string; error?: boolean; lead: boolean }
    | { kind: "changes"; key: number; lead: boolean; rows: Array<{ index: number; item: Extract<ChatItem, { kind: "change" }> }> };
  const blocks: Block[] = [];
  let turnHasLead = false;
  items.forEach((item, i) => {
    if (item.kind === "user") {
      blocks.push({ kind: "user", key: i, text: item.text });
      turnHasLead = false;
      return;
    }
    const lead = !turnHasLead;
    turnHasLead = true;
    if (item.kind === "assistant") {
      blocks.push({ kind: "assistant", key: i, text: item.text, error: item.error, lead });
      return;
    }
    const prev = blocks[blocks.length - 1];
    if (prev?.kind === "changes") prev.rows.push({ index: i, item });
    else blocks.push({ kind: "changes", key: i, lead, rows: [{ index: i, item }] });
  });
  const changeIdx = items.flatMap((it, i) => (it.kind === "change" ? [i] : []));

  return (
    <div className="gai" ref={rootRef}>
      {/* Static stylesheet constant only; model text is never HTML. */}
      <style dangerouslySetInnerHTML={{ __html: CHAT_CSS }} />

      <div
        ref={listRef}
        className="gai-list"
        aria-busy={busy}
        onScroll={() => {
          const el = listRef.current;
          if (!el) return;
          pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {items.length === 0 && (
          <div className="gai-empty">
            <GleameMark />
            <h2 className="gai-empty-title">What should we change?</h2>
            <p className="gai-empty-lead">
              Ask in your own words. I can change anything in this quiz: questions,
              answers, wording, logic, style and matching.
            </p>
            <p className="gai-examples-label" id={`${inputId}-examples`}>
              Try something like
            </p>
            <ul className="gai-examples" aria-labelledby={`${inputId}-examples`}>
              {examples.map((ex) => {
                const Icon = ex.icon;
                return (
                  <li key={ex.text}>
                    <button type="button" className="gai-example" onClick={() => fillComposer(ex.text)}>
                      <Icon aria-hidden />
                      <span>{ex.text}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {blocks.map((block) => {
          if (block.kind === "user") {
            return (
              <div key={block.key} className="gai-user">
                {block.text}
              </div>
            );
          }
          if (block.kind === "assistant") {
            return (
              <div key={block.key} className="gai-a">
                {block.lead && <GleameMark />}
                {block.error ? (
                  <div className="gai-error" role="alert">
                    <AlertCircleIcon aria-hidden />
                    <span>{block.text}</span>
                  </div>
                ) : (
                  renderChatText(block.text)
                )}
              </div>
            );
          }
          return (
            <div key={block.key} className="gai-a">
              {block.lead && <GleameMark />}
              <ul className="gai-actions" aria-label="Changes made">
                {block.rows.map(({ index, item }) => {
                  const pos = changeIdx.indexOf(index);
                  const prevChange = pos > 0 ? items[changeIdx[pos - 1]] : null;
                  // Undo reverts this change and every later one; say so on
                  // the row that was undone when later rows went with it.
                  const cascadeNote =
                    item.undone &&
                    !(prevChange?.kind === "change" && prevChange.undone) &&
                    pos < changeIdx.length - 1;
                  const showTag = !item.description.toLowerCase().includes(item.target.toLowerCase());
                  return (
                    <li key={index} className="gai-action" data-undone={item.undone ? "true" : undefined}>
                      <span className="gai-action-icon" aria-hidden>
                        {item.undone ? <UndoIcon /> : <CheckSmallIcon />}
                      </span>
                      <span className="gai-action-main">
                        <span className="gai-action-text">
                          {showTag && <span className="gai-action-tag">{item.target}</span>}
                          {item.description}
                        </span>
                        {item.undone && <span className="gai-sr"> (undone)</span>}
                        {cascadeNote && <span className="gai-action-note">Later changes were undone too.</span>}
                        {(item.target === "Rules" || item.target === "Guidance") && !item.undone && (
                          <span className="gai-action-note">Logic changes show up on the Check matches tab.</span>
                        )}
                      </span>
                      {item.undone ? (
                        <span className="gai-action-state" aria-hidden>
                          Undone
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="gai-undo"
                          onClick={() => undoChange(item.snapshotId)}
                          disabled={busy}
                          aria-label={`Undo: ${item.description}`}
                        >
                          <UndoIcon aria-hidden />
                          Undo
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}

        {busy && (
          // Visual only: the status region below does the announcing. The
          // mark pulses beside the label even mid-reply, so "Thinking" is
          // always attributed to Gleame.
          <div className="gai-a gai-thinking" aria-hidden>
            <GleameMark busy />
            <span className="gai-thinking-text">Thinking</span>
          </div>
        )}
      </div>

      {/* Always mounted, outside the aria-busy list: screen readers announce
          a live region whose text changes, but often miss one inserted
          together with its text. */}
      <div className="gai-sr" role="status" aria-live="polite">
        {busy ? "Gleame is working" : ""}
      </div>

      <div className="gai-foot">
        <form
          className="gai-composer"
          onSubmit={(e) => {
            e.preventDefault();
            sendChat(input);
          }}
          onMouseDown={(e) => {
            // The whole card is the input's hit area, like a text box.
            if (!(e.target as HTMLElement).closest("button, textarea")) {
              e.preventDefault();
              inputRef.current?.focus();
            }
          }}
        >
          <label htmlFor={inputId} className="gai-sr">
            Message Gleame
          </label>
          <textarea
            id={inputId}
            ref={inputRef}
            className="gai-input"
            rows={1}
            placeholder={busy ? "Gleame is working…" : "Describe any change, big or small…"}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends, Shift+Enter is a newline; never send mid IME
              // composition (Japanese/Chinese input confirms with Enter).
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                sendChat(input);
              }
            }}
            disabled={busy}
            autoComplete="off"
          />
          <div className="gai-composer-row">
            <button
              type="submit"
              className="gai-send"
              data-busy={busy ? "true" : undefined}
              disabled={busy || !input.trim()}
              aria-label={busy ? "Gleame is working" : "Send message"}
            >
              {busy ? <span className="gai-spinner" aria-hidden /> : <ArrowUpIcon aria-hidden />}
            </button>
          </div>
        </form>
        <div className="gai-hint">
          <span>Every change can be undone.</span>
          {items.length > 0 && (
            <button type="button" className="gai-reset" onClick={resetChat} disabled={busy}>
              <ResetIcon aria-hidden />
              Reset conversation
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Question prompt for an example line, quoted and kept to one short line. */
function quoted(prompt: string): string {
  const clean = prompt.replace(/\s+/g, " ").trim();
  if (!clean) return "untitled";
  return `"${clean.length > 48 ? `${clean.slice(0, 47).trimEnd()}…` : clean}"`;
}
