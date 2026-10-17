// @vitest-environment jsdom
//
// Build with AI panel (Studio ChatPanel, redesigned 2026-10-16): example
// prompts fill the composer instead of sending, Enter sends while
// Shift+Enter does not, the SSE turn renders replies and action rows, busy
// and applied changes still reach Studio, Undo still cascades to every later
// change, and model text never becomes HTML. Mounted in a memory data router
// (useRevalidator needs one) inside Polaris' AppProvider.

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { AppProvider } from "@shopify/polaris";
import en from "@shopify/polaris/locales/en.json";
import { ChatPanel } from "../../components/studio/ChatPanel";
import { EditPanel } from "../../components/studio/EditPanel";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  (window as any).matchMedia ||= () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  (window as any).ResizeObserver ||= class { observe() {} unobserve() {} disconnect() {} };
  (window as any).requestAnimationFrame ||= (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0);
  (window as any).HTMLElement.prototype.scrollTo ||= function () {};
});

const questions = [
  { axisKey: "vibe", prompt: "What's the vibe?", options: [] },
  { axisKey: "colors", prompt: "Any colors you're drawn to?", options: [] },
];

let calls: Array<Record<string, string>>;
let loaderRuns: number;
// Each message turn gets a fresh stream; tests push events into it and
// close it when the turn should end (so the busy state can be inspected).
let stream: ReadableStreamDefaultController<Uint8Array> | null;
let nextEvents: unknown[] | null;
const enc = new TextEncoder();
const send = (e: unknown) => stream!.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));

let root: Root | null = null;
const realFetch = globalThis.fetch;

beforeEach(() => {
  calls = [];
  loaderRuns = 0;
  stream = null;
  nextEvents = [];
  globalThis.fetch = vi.fn(async (_url: unknown, init?: { body?: FormData }) => {
    const entry: Record<string, string> = {};
    init?.body?.forEach((v, k) => (entry[k] = String(v)));
    calls.push(entry);
    if (entry.intent === "message") {
      const scripted = nextEvents;
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          stream = c;
          if (scripted) {
            scripted.forEach(send);
            c.close();
          }
        },
      });
      return new Response(body, { headers: { "content-type": "text/event-stream" } });
    }
    return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
  }) as any;
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  globalThis.fetch = realFetch;
});

function mount(ui: React.ReactElement) {
  const host = document.createElement("div");
  document.body.innerHTML = "";
  document.body.appendChild(host);
  const router = createMemoryRouter([
    {
      path: "/",
      element: <AppProvider i18n={en}>{ui}</AppProvider>,
      loader: () => {
        loaderRuns += 1;
        return null;
      },
    },
  ]);
  root = createRoot(host);
  act(() => root!.render(<RouterProvider router={router} />));
}

const flush = () => act(async () => {
  await new Promise((r) => setTimeout(r, 30));
});

function panel(overrides: Partial<React.ComponentProps<typeof ChatPanel>> = {}) {
  return (
    <ChatPanel
      aiConfigured
      initialSessionId={null}
      selectedSlide="intro"
      questions={questions as any}
      onBusyChange={() => {}}
      onChangeApplied={() => {}}
      {...overrides}
    />
  );
}

const textarea = () => document.querySelector("textarea") as HTMLTextAreaElement;
const examples = () => [...document.querySelectorAll<HTMLButtonElement>(".gai-example")];

function typeInto(value: string) {
  const el = textarea();
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function pressEnter(shiftKey = false) {
  act(() => {
    textarea().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey, bubbles: true, cancelable: true }));
  });
}

describe("Build with AI panel", () => {
  it("labels the tab Build with AI", async () => {
    mount(<EditPanel data={{} as any} step="live" selectedSlide="intro" chatEpoch={0} chatBusy={false} onSelectSlide={() => {}} onPreviewUpdate={() => {}} onPreviewReload={() => {}} chat={panel()} />);
    await flush();
    const tabs = [...document.querySelectorAll(".studio-panel-tab")].map((b) => b.textContent?.trim());
    expect(tabs).toEqual(["Build with AI"]);
    expect(document.body.textContent).not.toMatch(/\bChat\b/);
  });

  it("shows open-ended examples that fill and focus the composer without sending", async () => {
    mount(panel());
    await flush();
    expect(examples()).toHaveLength(4);
    expect(document.body.textContent).toContain("questions, answers, wording, logic, style and matching");
    // The old always-visible auto-send chips are gone.
    expect(document.body.textContent).not.toContain("Shorten the quiz");
    act(() => examples()[1].click());
    await flush();
    expect(textarea().value).toBe(examples()[1].textContent);
    expect(document.activeElement).toBe(textarea());
    expect(calls).toHaveLength(0);
    // The composer has an accessible name.
    expect(document.querySelector(`label[for="${textarea().id}"]`)?.textContent).toBe("Message Gleame");
  });

  it("leads with an example about the selected question", async () => {
    mount(panel({ selectedSlide: "q:colors" }));
    await flush();
    expect(examples()).toHaveLength(4);
    expect(examples()[0].textContent).toBe(
      'For question 2 ("Any colors you\'re drawn to?"), make the wording warmer and give every answer a short, vivid description.',
    );
  });

  it("swaps one example for another but never wipes a typed draft", async () => {
    mount(panel());
    await flush();
    act(() => examples()[0].click());
    act(() => examples()[2].click());
    expect(textarea().value).toBe(examples()[2].textContent);
    typeInto("Use our pink, #E5418A");
    act(() => examples()[3].click());
    expect(textarea().value).toBe(`Use our pink, #E5418A\n${examples()[3].textContent}`);
    expect(calls).toHaveLength(0);
  });

  it("Enter sends, Shift+Enter does not, and a turn renders replies and action rows", async () => {
    const applied: string[] = [];
    const busy: boolean[] = [];
    let flushed = 0;
    mount(panel({ onChangeApplied: (t) => applied.push(t), onBusyChange: (b) => busy.push(b), onBeforeSend: () => (flushed += 1) }));
    await flush();
    typeInto("Make it warmer");
    pressEnter(true);
    expect(calls).toHaveLength(0);

    nextEvents = [
      { type: "token", text: "Done. **Question 1** is warmer:\n- shorter\n- <img src=x onerror=alert(1)>" },
      { type: "change", tool: "update_question", target: "Q1", description: "Updated the Q1 question", snapshotId: "a" },
      { type: "change", tool: "reorder_questions", target: "Flow", description: "Reordered the questions", snapshotId: "b" },
      { type: "change", tool: "update_recommendation_mode", target: "Rules", description: "Matching mode set to hybrid", snapshotId: "c" },
      { type: "done", sessionId: "sess-1" },
    ];
    const before = loaderRuns;
    pressEnter();
    await flush();
    expect(flushed).toBe(1);
    expect(calls[0]).toMatchObject({ intent: "message", text: "Make it warmer" });
    // Busy reaches Studio (it locks the editors) and is released after.
    expect(busy).toContain(true);
    expect(busy.at(-1)).toBe(false);
    expect(textarea().value).toBe("");
    expect(document.querySelector(".gai-user")?.textContent).toBe("Make it warmer");
    expect(document.querySelector(".gai-md strong")?.textContent).toBe("Question 1");
    expect(document.querySelectorAll(".gai-md li")).toHaveLength(2);
    // Model text stays text: no element is created from it.
    expect(document.querySelector(".gai-md img")).toBeNull();
    expect(document.querySelector(".gai-md")?.textContent).toContain("<img src=x onerror=alert(1)>");
    const rows = document.querySelectorAll(".gai-action");
    expect(rows).toHaveLength(3);
    // Only targets the description doesn't already name get a tag.
    expect([...document.querySelectorAll(".gai-action-tag")].map((n) => n.textContent)).toEqual(["Flow", "Rules"]);
    // Matching changes point at the step where they show up.
    expect(rows[2].querySelector(".gai-action-note")?.textContent).toBe("Logic changes show up on the Check matches tab.");
    expect(rows[0].querySelector(".gai-action-note")).toBeNull();
    expect([...document.querySelectorAll(".gai-undo")].map((b) => b.getAttribute("aria-label"))).toEqual([
      "Undo: Updated the Q1 question",
      "Undo: Reordered the questions",
      "Undo: Matching mode set to hybrid",
    ]);
    expect(applied).toEqual(["Q1", "Flow", "Rules"]);
    expect(loaderRuns).toBeGreaterThan(before);

    // Undo on the second change reverts it and every later one.
    act(() => (rows[1].querySelector(".gai-undo") as HTMLButtonElement).click());
    await flush();
    expect(calls[1]).toMatchObject({ intent: "undo", sessionId: "sess-1", snapshotId: "b" });
    const after = [...document.querySelectorAll(".gai-action")];
    expect(after.map((r) => r.getAttribute("data-undone"))).toEqual([null, "true", "true"]);
    expect(document.querySelectorAll(".gai-undo")).toHaveLength(1);
    expect(after[1].textContent).toContain("Later changes were undone too.");
    expect(after[2].textContent).not.toContain("Later changes were undone too.");
    // An undone matching change drops the "where it shows up" note.
    expect(after[2].textContent).not.toContain("Check matches");
    expect(applied.at(-1)).toBe("");

    // Reset sits in the hint row under the composer and clears the
    // conversation through the same endpoint.
    const reset = document.querySelector(".gai-hint .gai-reset") as HTMLButtonElement;
    expect(reset.textContent).toBe("Reset conversation");
    act(() => reset.click());
    await flush();
    expect(calls[2]).toMatchObject({ intent: "reset", sessionId: "sess-1" });
    expect(document.querySelector(".gai-empty")).not.toBeNull();
    expect(document.querySelector(".gai-reset")).toBeNull();
  });

  it("shows the Gleame mark beside Thinking mid-reply and announces work in a persistent status", async () => {
    mount(panel());
    await flush();
    const status = document.querySelector('[role="status"]') as HTMLElement;
    expect(status.textContent).toBe("");
    // The live region must sit outside the aria-busy list to be announced.
    expect(status.closest("[aria-busy]")).toBeNull();

    nextEvents = null;
    typeInto("Tighten the copy");
    pressEnter();
    await flush();
    act(() => {
      send({ type: "token", text: "Working on it." });
      send({ type: "change", tool: "update_question", target: "Q1", description: "Updated the Q1 question", snapshotId: "a" });
    });
    await flush();
    const thinking = document.querySelector(".gai-thinking") as HTMLElement;
    expect(thinking.textContent).toBe("Thinking");
    expect(thinking.querySelector('.gai-mark[data-busy="true"]')).not.toBeNull();
    expect(thinking.getAttribute("aria-hidden")).toBe("true");
    expect(document.querySelector('[role="status"]')).toBe(status);
    expect(status.textContent).toBe("Gleame is working");
    expect(textarea().disabled).toBe(true);
    expect((document.querySelector(".gai-reset") as HTMLButtonElement).disabled).toBe(true);
    expect((document.querySelector(".gai-undo") as HTMLButtonElement).disabled).toBe(true);

    act(() => {
      send({ type: "done", sessionId: "sess-2" });
      stream!.close();
    });
    await flush();
    expect(document.querySelector(".gai-thinking")).toBeNull();
    expect(status.textContent).toBe("");
    expect(textarea().disabled).toBe(false);
  });

  it("keeps the not-configured fallback", async () => {
    mount(panel({ aiConfigured: false }));
    await flush();
    expect(document.body.textContent).toContain("AI isn't set up for this installation.");
    expect(document.querySelector("textarea")).toBeNull();
  });
});
