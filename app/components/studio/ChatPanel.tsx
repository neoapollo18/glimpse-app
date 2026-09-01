import { useEffect, useRef, useState } from "react";
import { useRevalidator } from "@remix-run/react";
import { Badge, Button, Text, TextField, InlineStack } from "@shopify/polaris";
import { readSseStream } from "../../lib/sse-client";
import type { StudioQuestion } from "./types";

// The Gleame copilot as a real chat interface: full-height message list,
// streamed assistant text, change cards with Undo, suggestion chips, input
// pinned to the bottom. State machine ported from the old quiz-builder page;
// endpoint and session semantics unchanged (/app/api/quiz-copilot).

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

/** Minimal chat formatting: the copilot writes **bold** markers; render
 * them as bold text instead of literal asterisks. No HTML injection — the
 * split output is plain strings and <strong> elements only. */
function renderChatText(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : (
      part
    ),
  );
}

const SUGGESTION_CHIPS = [
  "Shorten the quiz",
  "Make it more playful",
  "Match my brand colors",
  "Add a budget question",
];

export function ChatPanel({
  aiConfigured,
  initialSessionId,
  selectedSlide,
  questions,
  onBusyChange,
  onChangeApplied,
  seedMessage,
}: {
  aiConfigured: boolean;
  initialSessionId: string | null;
  selectedSlide: string;
  questions: StudioQuestion[];
  onBusyChange: (busy: boolean) => void;
  onChangeApplied: (target: string) => void;
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

  useEffect(() => {
    onBusyChange(busy);
  }, [busy, onBusyChange]);

  useEffect(() => {
    if (pinnedRef.current) {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
    }
  }, [items]);

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
    setInput("");
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
      if (sawChange || !gotTerminal) revalidator.revalidate();
    } catch (err) {
      appendAssistantText(
        `Something went wrong: ${err instanceof Error ? err.message : "please try again"}`,
        true,
      );
    } finally {
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
      setItems((prev) =>
        prev.map((it) => (it.kind === "change" && it.snapshotId === snapshotId ? { ...it, undone: true } : it)),
      );
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
  const chips =
    selectedQ >= 0
      ? [`Improve question ${selectedQ + 1}`, ...SUGGESTION_CHIPS.slice(0, 3)]
      : SUGGESTION_CHIPS;

  return (
    <>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "8px 12px",
          borderBottom: "1px solid #E1E3E5",
        }}
      >
        <Text as="span" variant="bodySm" tone="subdued">
          Every change has an Undo.
        </Text>
        {items.length > 0 && (
          <Button size="micro" variant="plain" onClick={resetChat} disabled={busy}>
            Reset conversation
          </Button>
        )}
      </div>

      <div
        ref={listRef}
        onScroll={() => {
          const el = listRef.current;
          if (!el) return;
          pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 8 }}
      >
        {items.length === 0 && (
          <div style={{ margin: "auto", textAlign: "center", padding: 16 }}>
            <Text as="p" variant="headingSm">
              Build with Gleame
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Try: "Make the first question feel more editorial, less like a
              survey."
            </Text>
          </div>
        )}
        {items.map((item, i) => {
          if (item.kind === "change") {
            return (
              <div
                key={i}
                style={{
                  border: "1px solid #E1E3E5",
                  borderRadius: 10,
                  padding: 10,
                  background: item.undone ? "#F6F6F7" : "#F2F7FE",
                  opacity: item.undone ? 0.6 : 1,
                }}
              >
                <InlineStack align="space-between" blockAlign="center">
                  <InlineStack gap="150" blockAlign="center">
                    <Badge tone={item.undone ? undefined : "info"}>{`Applied to ${item.target}`}</Badge>
                    <Text as="span" variant="bodySm">
                      {item.description}
                    </Text>
                  </InlineStack>
                  {!item.undone && (
                    <Button size="micro" variant="plain" onClick={() => undoChange(item.snapshotId)} disabled={busy}>
                      Undo
                    </Button>
                  )}
                </InlineStack>
                {item.undone && (
                  <Text as="p" variant="bodySm" tone="subdued">
                    Undone (later changes were reverted too)
                  </Text>
                )}
                {(item.target === "Rules" || item.target === "Guidance") && !item.undone && (
                  <Text as="p" variant="bodySm" tone="subdued">
                    Logic changes show up on the Logic step.
                  </Text>
                )}
              </div>
            );
          }
          const isUser = item.kind === "user";
          return (
            <div
              key={i}
              style={{
                alignSelf: isUser ? "flex-end" : "flex-start",
                maxWidth: "88%",
                background: isUser ? "#1a1a1a" : item.error ? "#FFF4F4" : "#F6F6F7",
                color: isUser ? "#fff" : "#202223",
                borderRadius: 12,
                padding: "8px 12px",
                fontSize: 13,
                whiteSpace: "pre-wrap",
              }}
            >
              {isUser ? item.text : renderChatText(item.text)}
            </div>
          );
        })}
        {busy && <span className="studio-thinking">Thinking</span>}
      </div>

      <div style={{ padding: "8px 12px", borderTop: "1px solid #E1E3E5" }}>
        <InlineStack gap="150" wrap>
          {chips.map((chip) => (
            <Button key={chip} size="micro" disabled={busy} onClick={() => sendChat(chip)}>
              {chip}
            </Button>
          ))}
        </InlineStack>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", marginTop: 8 }}>
          <div
            style={{ flex: 1 }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendChat(input);
              }
            }}
          >
            <TextField
              label="Message Gleame"
              labelHidden
              placeholder="Tell Gleame what to change…"
              value={input}
              onChange={setInput}
              autoComplete="off"
              multiline={1}
              disabled={busy}
            />
          </div>
          <Button variant="primary" onClick={() => sendChat(input)} loading={busy} disabled={!input.trim()}>
            Send
          </Button>
        </div>
      </div>
    </>
  );
}
