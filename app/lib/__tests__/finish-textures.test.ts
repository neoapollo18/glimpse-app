import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Finish previews (displayMeta.texture) are a closed set kept in four
// places that can't share code: the server allowlist, the AI copilot's
// tool schema, the Studio "Finish preview" choices and the widget (plus a
// CSS rule per texture). Glamnetic v3 added glossy / glazed / velvet.

const root = path.resolve(__dirname, "../../..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const words = (s: string) => (s.match(/["']([a-z]+)["']/g) || []).map((w) => w.slice(1, -1));

const server = words(/OPTION_TEXTURES = \[([^\]]+)\]/.exec(read("app/lib/supabase.server.ts"))![1]);
const copilot = words(/texture: \{\s*type: "string",\s*enum: \[([^\]]+)\]/.exec(read("app/lib/quiz-copilot-tools.server.ts"))![1]);
const studio = [...read("app/components/studio/EditPanel.tsx").matchAll(/\{ label: "[^"]+", value: "([a-z]+)" \}/g)].map((m) => m[1]);
const widgetJs = read("extensions/glimpse-widget/assets/gleame-quiz.js");
const widget = Object.keys(JSON.parse("{" + /var TEXTURES = \{([^}]+)\}/.exec(widgetJs)![1].replace(/(\w+):/g, '"$1":') + "}"));
const css = read("extensions/glimpse-widget/assets/gleame-quiz.css");

describe("finish textures stay in sync", () => {
  it("includes the Glamnetic v3 finishes", () => {
    for (const t of ["glossy", "glazed", "velvet", "chrome", "matte"]) expect(server).toContain(t);
  });

  it("server, copilot, Studio and widget list the same set", () => {
    expect([...copilot].sort()).toEqual([...server].sort());
    expect([...widget].sort()).toEqual([...server].sort());
    for (const t of server) expect(studio).toContain(t);
  });

  it("every texture draws as a card swatch, and the finishes as nails", () => {
    for (const t of server) expect(css).toContain(`.gq-texture--${t}`);
    for (const t of ["glossy", "glazed", "velvet", "chrome", "matte"]) expect(css).toContain(`.gq-nail--${t}`);
  });
});
