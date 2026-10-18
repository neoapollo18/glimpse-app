// @vitest-environment jsdom
//
// Studio answers list drag-and-drop (Trello: "To reorder answers right now,
// you have to delete and re-add"). A reorder rides the editor's normal
// options autosave (apply-tools -> update_question_options), so it writes
// positions only: every option field survives, nothing is re-created, and a
// drop back where the answer started saves nothing. Mounted in a memory data
// router whose /studio action records what the editor submits.

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { AppProvider } from "@shopify/polaris";
import en from "@shopify/polaris/locales/en.json";
import { EditPanel, gapAt, indexForGap, moveItem } from "../../components/studio/EditPanel";
import { applyUpdateQuestionOptions, type DraftShape } from "../quiz-copilot-tools.server";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  (window as any).matchMedia ||= () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  (window as any).ResizeObserver ||= class { observe() {} unobserve() {} disconnect() {} };
  (window as any).requestAnimationFrame ||= (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0);
  (window as any).cancelAnimationFrame ||= (id: number) => clearTimeout(id);
  (window as any).HTMLElement.prototype.scrollTo ||= function () {};
});

// Every field an answer can carry, including a select-all answer that
// shares its axis value with a sibling (the Glamnetic "Surprise me" shape)
// and bot responses the editor never sends.
const colorOptions = () => [
  {
    label: "Nudes",
    axisValueValue: "nudes",
    botResponse: "Love a neutral",
    reasonText: "Goes with everything",
    imageUrl: "https://cdn.example/nudes.jpg",
    showIf: null,
    selectAll: false,
    displayMeta: { swatch: "#F8E6E0", swatch2: "#D6A899", sublabel: "barely there" },
    position: 0,
  },
  {
    label: "Reds",
    axisValueValue: "reds",
    botResponse: null,
    reasonText: null,
    imageUrl: null,
    showIf: { axis_key: "vibe", axis_value: "bold" },
    selectAll: false,
    displayMeta: { swatch: "#E85468", texture: "chrome" },
    position: 1,
  },
  {
    label: "Surprise me",
    axisValueValue: "nudes",
    botResponse: "Anything goes!",
    reasonText: null,
    imageUrl: null,
    showIf: null,
    selectAll: true,
    displayMeta: { sublabel: "open to anything" },
    position: 2,
  },
  {
    label: "Darks",
    axisValueValue: "darks",
    botResponse: null,
    reasonText: "Moody and chic",
    imageUrl: null,
    showIf: null,
    selectAll: false,
    displayMeta: null,
    position: 3,
  },
];

function fixtureDraft(): DraftShape {
  return {
    flow: {
      axes: [
        {
          key: "vibe",
          label: "Vibe",
          source: "user_question",
          position: 0,
          values: [
            { value: "bold", label: "Bold", position: 0 },
            { value: "soft", label: "Soft", position: 1 },
          ],
        },
        {
          key: "colors",
          label: "Colors",
          source: "user_question",
          position: 1,
          values: [
            { value: "nudes", label: "Nudes", position: 0 },
            { value: "reds", label: "Reds", position: 1 },
            { value: "darks", label: "Darks", position: 2 },
          ],
        },
      ],
      questions: [
        {
          axisKey: "vibe",
          prompt: "What's the vibe?",
          options: [
            { label: "Bold", axisValueValue: "bold", botResponse: null, position: 0 },
            { label: "Soft", axisValueValue: "soft", botResponse: null, position: 1 },
          ],
        },
        { axisKey: "colors", prompt: "Any colors calling your name?", optionStyle: "nails", multiSelect: true, options: colorOptions() },
      ],
      rules: [],
    },
    settings: { recommendation_mode: "ai" },
  } as DraftShape;
}

let submissions: Array<Record<string, string>>;
let root: Root | null = null;
const realFetch = globalThis.fetch;

beforeEach(() => {
  submissions = [];
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } })) as any;
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  globalThis.fetch = realFetch;
});

function mount(draft: DraftShape = fixtureDraft()) {
  const host = document.createElement("div");
  document.body.innerHTML = "";
  document.body.appendChild(host);
  const data = { draft, settings: {}, studio: { template: null } } as any;
  const router = createMemoryRouter([
    {
      path: "/",
      loader: () => null,
      element: (
        <AppProvider i18n={en}>
          <EditPanel
            data={data}
            step="build"
            selectedSlide="q:colors"
            chatEpoch={0}
            chatBusy={false}
            onSelectSlide={() => {}}
            onPreviewUpdate={() => {}}
            onPreviewReload={() => {}}
            chat={<div />}
          />
        </AppProvider>
      ),
    },
    {
      path: "/studio",
      action: async ({ request }) => {
        const entry: Record<string, string> = {};
        (await request.formData()).forEach((v, k) => (entry[k] = String(v)));
        submissions.push(entry);
        return { ok: true };
      },
    },
  ]);
  root = createRoot(host);
  act(() => root!.render(<RouterProvider router={router} />));
}

const settle = (ms = 30) => act(async () => {
  await new Promise((r) => setTimeout(r, ms));
});
// Past the editor's 500ms autosave debounce plus the fetcher round trip.
const waitForSave = () => settle(800);

const handles = () => [...document.querySelectorAll<HTMLButtonElement>(".studio-reorder-handle")];
const order = () => handles().map((h) => h.getAttribute("aria-label")!.replace("Reorder ", ""));
const handle = (label: string) => handles().find((h) => h.getAttribute("aria-label") === `Reorder ${label}`)!;
const liveText = () => document.querySelector('[role="status"][aria-live]')?.textContent ?? "";
// ReorderList ends every other announcement in a no-break space so repeats
// still re-announce; compare the words.
const status = () => liveText().trim();
const lines = () => [...document.querySelectorAll(".studio-reorder-line")];

function key(el: Element, k: string) {
  act(() => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
  });
}

// jsdom has no layout: stack the rows 100px apart (90px tall) in DOM order.
function layoutRows() {
  document.querySelectorAll<HTMLElement>(".studio-reorder-row").forEach((row, i) => {
    row.getBoundingClientRect = () =>
      ({ top: i * 100, bottom: i * 100 + 90, height: 90, left: 16, right: 288, width: 272, x: 16, y: i * 100, toJSON() {} }) as DOMRect;
  });
}

function pointer(el: Element, type: string, clientY: number) {
  act(() => {
    el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientY, button: 0, pointerId: 1 }));
  });
}

function optionCalls() {
  return submissions.flatMap((s) => JSON.parse(s.calls ?? "[]") as Array<{ tool: string; input: any }>);
}

describe("reorder helpers", () => {
  it("moveItem moves by index and returns the same array for a no-op", () => {
    const list = ["a", "b", "c", "d"];
    expect(moveItem(list, 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(list, 3, 0)).toEqual(["d", "a", "b", "c"]);
    expect(moveItem(list, 1, 1)).toBe(list);
    expect(moveItem(list, 0, -1)).toBe(list); // clamped to 0
    expect(moveItem(list, 3, 9)).toBe(list); // clamped to the end
  });

  it("gapAt counts midpoints above the pointer; both gaps beside the row are no-ops", () => {
    const mids = [45, 145, 245, 345];
    expect(gapAt(mids, 10)).toBe(0);
    expect(gapAt(mids, 200)).toBe(2);
    expect(gapAt(mids, 999)).toBe(4);
    expect(indexForGap(1, 1)).toBe(1);
    expect(indexForGap(1, 2)).toBe(1);
    expect(indexForGap(1, 4)).toBe(3);
    expect(indexForGap(2, 0)).toBe(0);
  });
});

describe("Studio answers drag-and-drop", () => {
  it("gives every answer a drag handle, the select-all answer included", async () => {
    mount();
    await settle();
    expect(order()).toEqual(["Nudes", "Reds", "Surprise me", "Darks"]);
    expect(handles().every((h) => !h.disabled && h.getAttribute("aria-describedby"))).toBe(true);
    // The storefront draws the catch-all last, so the editor says so while
    // the list puts it elsewhere.
    expect(document.body.textContent).toContain("Catch-all answer: the quiz shows it last.");
  });

  it("keyboard: Arrow Down on the focused handle moves the answer, keeps focus and announces it", async () => {
    mount();
    await settle();
    act(() => handle("Reds").focus());
    key(handle("Reds"), "ArrowDown");
    expect(order()).toEqual(["Nudes", "Surprise me", "Reds", "Darks"]);
    expect(document.activeElement).toBe(handle("Reds"));
    expect(status()).toBe("Reds moved to position 3 of 4.");
    key(handle("Reds"), "ArrowUp");
    key(handle("Reds"), "ArrowUp");
    expect(order()).toEqual(["Reds", "Nudes", "Surprise me", "Darks"]);
    // Already first: nothing moves, the reason is announced.
    key(handle("Reds"), "ArrowUp");
    expect(status()).toBe("Reds is already first.");
    expect(document.activeElement).toBe(handle("Reds"));
    // Pressed again: the same words, but the region's text still changes,
    // or a screen reader would stay silent the second time.
    const first = liveText();
    key(handle("Reds"), "ArrowUp");
    expect(status()).toBe("Reds is already first.");
    expect(liveText()).not.toBe(first);
    await waitForSave();
    // Rapid moves coalesce into the editor's one debounced options save.
    const calls = optionCalls();
    expect(calls.map((c) => c.tool)).toEqual(["update_question_options"]);
    expect(calls[0].input.options.map((o: any) => o.label)).toEqual(["Reds", "Nudes", "Surprise me", "Darks"]);
  });

  it("writes positions only: every option field survives the save path", async () => {
    mount();
    await settle();
    // Select-all answer straight to the end (End key), as Glamnetic needs.
    act(() => handle("Surprise me").focus());
    key(handle("Surprise me"), "End");
    expect(order()).toEqual(["Nudes", "Reds", "Darks", "Surprise me"]);
    expect(document.body.textContent).not.toContain("Catch-all answer");
    await waitForSave();

    const calls = optionCalls();
    expect(submissions).toHaveLength(1);
    expect(submissions[0].intent).toBe("apply-tools");
    // No question patch, no remove/add: one full options write.
    expect(calls.map((c) => c.tool)).toEqual(["update_question_options"]);
    const sent = calls[0].input;
    expect(sent.axisKey).toBe("colors");
    const before = colorOptions();
    const expectedOrder = [before[0], before[1], before[3], before[2]];
    expect(sent.options).toEqual(
      expectedOrder.map((o) => ({
        label: o.label,
        axisValueValue: o.axisValueValue,
        valueLabel: o.label,
        reasonText: o.reasonText,
        imageUrl: o.imageUrl,
        showIf: o.showIf,
        selectAll: o.selectAll,
        displayMeta: o.displayMeta,
      })),
    );

    // Through the real applier: only `position` changes on any answer,
    // bot responses (never sent) stay with their own answer even though
    // Surprise me shares its value with Nudes, and the axis is untouched.
    const draft = fixtureDraft();
    const applied = applyUpdateQuestionOptions(draft, sent, []);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    const saved = applied.draft.flow.questions[1].options;
    expect(saved.map(({ position, ...rest }) => rest)).toEqual(expectedOrder.map(({ position, ...rest }) => rest));
    expect(saved.map((o) => o.position)).toEqual([0, 1, 2, 3]);
    expect(applied.draft.flow.axes).toEqual(draft.flow.axes);
    expect(applied.draft.flow.questions[0]).toEqual(draft.flow.questions[0]);
  });

  it("pointer drag from the handle shows the drop line and moves on release", async () => {
    mount();
    await settle();
    layoutRows();
    const h = handle("Nudes");
    pointer(h, "pointerdown", 45);
    pointer(h, "pointermove", 47); // under the drag threshold: still a click
    expect(document.querySelector(".studio-reorder-ghost")).toBeNull();
    pointer(h, "pointermove", 120);
    pointer(h, "pointermove", 260); // past Surprise me's midpoint (245)
    expect(document.querySelector(".studio-reorder-ghost")?.textContent).toBe("Nudes");
    expect(lines()).toHaveLength(1);
    expect(lines()[0].closest(".studio-reorder-row")?.contains(handle("Darks"))).toBe(true);
    expect(status()).toBe("Nudes, over position 3 of 4.");
    pointer(h, "pointerup", 260);
    expect(order()).toEqual(["Reds", "Surprise me", "Nudes", "Darks"]);
    expect(status()).toBe("Nudes moved to position 3 of 4.");
    expect(document.querySelector(".studio-reorder-ghost")).toBeNull();
    expect(lines()).toHaveLength(0);
    // The click that follows a drag release must not open the move menu.
    act(() => h.click());
    expect(h.getAttribute("aria-expanded")).toBe("false");
    await waitForSave();
    expect(optionCalls()[0].input.options.map((o: any) => o.label)).toEqual(["Reds", "Surprise me", "Nudes", "Darks"]);
  });

  it("a drop at the same index is a no-op: no line, no change, no save", async () => {
    mount();
    await settle();
    layoutRows();
    const h = handle("Reds");
    pointer(h, "pointerdown", 145);
    pointer(h, "pointermove", 180); // still inside its own row (gap 2 = from + 1)
    expect(document.querySelector(".studio-reorder-ghost")).not.toBeNull();
    expect(lines()).toHaveLength(0);
    pointer(h, "pointerup", 180);
    expect(order()).toEqual(["Nudes", "Reds", "Surprise me", "Darks"]);
    expect(status()).toBe("Reds returned to position 2 of 4.");
    // Keyboard no-op at the edge.
    key(handle("Darks"), "ArrowDown");
    expect(status()).toBe("Darks is already last.");
    await waitForSave();
    expect(submissions).toHaveLength(0);
  });

  it("Escape cancels a pointer drag without saving", async () => {
    mount();
    await settle();
    layoutRows();
    const h = handle("Darks");
    pointer(h, "pointerdown", 345);
    pointer(h, "pointermove", 20);
    expect(lines()).toHaveLength(1);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    expect(document.querySelector(".studio-reorder-ghost")).toBeNull();
    expect(status()).toBe("Move cancelled. Darks stays at position 4 of 4.");
    pointer(h, "pointerup", 20);
    expect(order()).toEqual(["Nudes", "Reds", "Surprise me", "Darks"]);
    expect(document.body.style.cursor).toBe("");
    await waitForSave();
    expect(submissions).toHaveLength(0);
  });

  it("clicking the handle opens Move up / down / top / bottom (single-pointer alternative)", async () => {
    mount();
    await settle();
    act(() => handle("Darks").click());
    await settle();
    const items = [...document.querySelectorAll<HTMLButtonElement>(".Polaris-ActionList__Item")];
    expect(items.map((b) => b.textContent?.trim())).toEqual(["Move up", "Move down", "Move to top", "Move to bottom"]);
    // Darks is last: the downward moves are unavailable.
    expect(items.map((b) => b.disabled || b.getAttribute("aria-disabled") === "true")).toEqual([false, true, false, true]);
    act(() => items[2].click());
    await settle();
    expect(order()).toEqual(["Darks", "Nudes", "Reds", "Surprise me"]);
    expect(document.activeElement).toBe(handle("Darks"));
    expect(status()).toBe("Darks moved to position 1 of 4.");
  });

  it("after a touch drag that fired no click, Enter on the handle still opens the menu", async () => {
    mount();
    await settle();
    layoutRows();
    const h = handle("Reds");
    // Touch drags end without a click to consume the release guard.
    pointer(h, "pointerdown", 145);
    pointer(h, "pointermove", 180);
    pointer(h, "pointerup", 180);
    act(() => h.focus());
    key(h, "Enter");
    act(() => h.click()); // the click Enter fires on a focused button
    expect(h.getAttribute("aria-expanded")).toBe("true");
  });

  it("marks only the first select-all answer, the one the quiz moves to the end", async () => {
    const draft = fixtureDraft();
    const colors = draft.flow.questions[1];
    colors.options = [
      ...colors.options.slice(0, 3),
      { label: "Anything", axisValueValue: "reds", botResponse: null, selectAll: true, position: 3 },
      { ...colors.options[3], position: 4 },
    ];
    mount(draft);
    await settle();
    const noted = () =>
      [...document.querySelectorAll(".studio-reorder-row")]
        .filter((row) => row.textContent?.includes("Catch-all answer"))
        .map((row) => row.querySelector(".studio-reorder-handle")?.getAttribute("aria-label"));
    expect(noted()).toEqual(["Reorder Surprise me"]);
    // Surprise me to the end: Anything is now the first catch-all, so the
    // quiz pulls IT to the end instead.
    act(() => handle("Surprise me").focus());
    key(handle("Surprise me"), "End");
    expect(noted()).toEqual(["Reorder Anything"]);
  });
});

// The upload helper keeps the onChange it started with. Rows must find their
// answer by identity, or an upload finishing after a move (or a delete)
// patches whichever answer now sits at the old index.
describe("Studio answers: uploads in flight", () => {
  function holdUploads() {
    const pending: Array<(res: Response) => void> = [];
    globalThis.fetch = vi.fn(async (url: any) => {
      if (String(url).includes("upload-avatar")) return new Promise<Response>((resolve) => pending.push(resolve));
      return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
    }) as any;
    return (avatarUrl: string) =>
      act(async () => {
        pending.shift()!(new Response(JSON.stringify({ avatarUrl }), { headers: { "content-type": "application/json" } }));
        await new Promise((r) => setTimeout(r, 20));
      });
  }

  function startUpload(label: string) {
    // The uploader sits in Details, which start open for answers with a
    // reason (Darks).
    const input = handle(label).closest(".studio-reorder-row")!.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { value: [new File(["x"], "pic.jpg", { type: "image/jpeg" })], configurable: true });
    act(() => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  const removeButton = (label: string) =>
    handle(label).closest(".studio-reorder-row")!.querySelector<HTMLButtonElement>('button[aria-label="Remove answer"]')!;

  const savedImages = () => {
    const last = optionCalls().filter((c) => c.tool === "update_question_options").pop()!;
    return Object.fromEntries(last.input.options.map((o: any) => [o.label, o.imageUrl]));
  };

  it("an upload that finishes after a reorder lands on the answer that started it", async () => {
    const release = holdUploads();
    mount();
    await settle();
    startUpload("Darks");
    act(() => handle("Darks").focus());
    key(handle("Darks"), "Home");
    expect(order()).toEqual(["Darks", "Nudes", "Reds", "Surprise me"]);
    await release("https://cdn.example/darks-new.jpg");
    await waitForSave();
    expect(savedImages()).toEqual({
      Darks: "https://cdn.example/darks-new.jpg",
      Nudes: "https://cdn.example/nudes.jpg",
      Reds: null,
      "Surprise me": null,
    });
  });

  it("an upload still lands on its answer after an answer above it is removed", async () => {
    const release = holdUploads();
    mount();
    await settle();
    startUpload("Darks");
    act(() => removeButton("Nudes").click());
    expect(order()).toEqual(["Reds", "Surprise me", "Darks"]);
    await release("https://cdn.example/darks-new.jpg");
    await waitForSave();
    expect(savedImages()).toEqual({ Reds: null, "Surprise me": null, Darks: "https://cdn.example/darks-new.jpg" });
  });

  it("an upload that finishes after its own answer was removed changes nothing", async () => {
    const release = holdUploads();
    mount();
    await settle();
    startUpload("Darks");
    act(() => removeButton("Darks").click());
    expect(order()).toEqual(["Nudes", "Reds", "Surprise me"]);
    await release("https://cdn.example/darks-new.jpg");
    await waitForSave();
    expect(savedImages()).toEqual({ Nudes: "https://cdn.example/nudes.jpg", Reds: null, "Surprise me": null });
  });
});
