// Supabase serves every public table and function to the anon key over its
// REST API, so the schema invariant (005, 039, 093) is: every table has RLS
// on, and every SECURITY DEFINER function, which bypasses RLS, is revoked
// from PUBLIC, anon and authenticated and granted to service_role. These
// checks read supabase-migrations/ in run order, so a later migration that
// adds a table without RLS, or recreates a definer function without
// restoring its grants, fails here.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const DIR = path.resolve(__dirname, "../../../supabase-migrations");

// Position of a statement in run order: [migration index, offset in file].
type Pos = [number, number];
const after = (a: Pos, b: Pos) => a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]);

// Line comments are dropped so prose like 039's "SECURITY DEFINER bypasses
// RLS" never reads as a statement.
const migrations = fs
  .readdirSync(DIR)
  .filter((f) => /^\d{3}_.*\.sql$/.test(f))
  .sort()
  .map((file) => fs.readFileSync(path.join(DIR, file), "utf8").replace(/--[^\n]*/g, ""));

function* matches(re: RegExp): Generator<{ m: RegExpExecArray; at: Pos }> {
  for (let i = 0; i < migrations.length; i++) {
    for (const m of migrations[i].matchAll(re)) yield { m: m as RegExpExecArray, at: [i, m.index ?? 0] };
  }
}

const TYPE_ALIASES: Record<string, string> = {
  int: "integer",
  int4: "integer",
  "timestamp with time zone": "timestamptz",
};
const normalizeType = (t: string) => {
  const s = t.trim().toLowerCase().replace(/\s+/g, " ");
  return TYPE_ALIASES[s] ?? s;
};

// "p_shop_id UUID, p_days_back INTEGER DEFAULT 30" -> "uuid, integer"
function signatureFromParams(params: string): string {
  return params
    .split(",")
    .map((p) => p.replace(/\s+default\s+[\s\S]*$/i, "").replace(/\s*=[\s\S]*$/, "").trim())
    .filter(Boolean)
    .map((p) => {
      const tokens = p.split(/\s+/).filter((t) => !/^(in|inout|variadic)$/i.test(t));
      return normalizeType((tokens.length > 1 ? tokens.slice(1) : tokens).join(" "));
    })
    .join(", ");
}

// "uuid, timestamptz, timestamptz" as written in REVOKE / GRANT
const signatureFromTypes = (types: string) =>
  types.split(",").map(normalizeType).filter(Boolean).join(", ");

type FunctionDef = { key: string; definer: boolean; at: Pos };

function functionDefinitions(): Map<string, FunctionDef> {
  const latest = new Map<string, FunctionDef>();
  for (let i = 0; i < migrations.length; i++) {
    const sql = migrations[i];
    for (const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?(\w+)\s*\(/gi)) {
      const open = (m.index ?? 0) + m[0].length;
      let depth = 1;
      let close = open;
      while (depth > 0 && close < sql.length) {
        if (sql[close] === "(") depth++;
        if (sql[close] === ")") depth--;
        close++;
      }
      const params = sql.slice(open, close - 1);
      // SECURITY DEFINER may sit before the body or after it, never inside.
      const tag = /\$(\w*)\$/.exec(sql.slice(close));
      const bodyStart = tag ? close + tag.index : sql.length;
      const bodyEnd = tag ? sql.indexOf(tag[0], bodyStart + tag[0].length) + tag[0].length : sql.length;
      const end = sql.indexOf(";", bodyEnd);
      const clauses = sql.slice(close, bodyStart) + sql.slice(bodyEnd, end === -1 ? sql.length : end);
      const key = `${m[1].toLowerCase()}(${signatureFromParams(params)})`;
      latest.set(key, { key, definer: /security\s+definer/i.test(clauses), at: [i, m.index ?? 0] });
    }
  }
  return latest;
}

function lastPositions(re: RegExp): Map<string, Pos> {
  const out = new Map<string, Pos>();
  for (const { m, at } of matches(re)) out.set(`${m[1].toLowerCase()}(${signatureFromTypes(m[2])})`, at);
  return out;
}

describe("supabase-migrations security invariants", () => {
  it("enables row level security on every table a migration creates", () => {
    const created = new Map<string, Pos>();
    for (const { m, at } of matches(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?(\w+)"?/gi)) {
      const name = m[1].toLowerCase();
      if (!created.has(name)) created.set(name, at);
    }
    const rls: Array<{ name: string; at: Pos }> = [];
    for (const { m, at } of matches(
      /alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:public\.)?"?(\w+)"?\s+enable\s+row\s+level\s+security/gi,
    )) {
      rls.push({ name: m[1].toLowerCase(), at });
    }

    expect(created.size).toBeGreaterThan(10);
    expect([...created.keys()]).toEqual(expect.arrayContaining(["quiz_leads", "brand_profiles", "brand_library"]));
    const missing = [...created].filter(([name, at]) => !rls.some((r) => r.name === name && after(r.at, at)));
    expect(missing.map(([name]) => name)).toEqual([]);
  });

  it("limits every SECURITY DEFINER function to service_role after its latest definition", () => {
    const definers = [...functionDefinitions().values()].filter((f) => f.definer);
    expect(definers.map((f) => f.key)).toEqual(
      expect.arrayContaining([
        "add_alternate_domain(uuid, text)",
        "update_updated_at_column()",
        "get_conversion_stats(uuid, integer)",
        "get_top_traffic_sources(uuid, integer, integer)",
        "save_recommendation_config(uuid, jsonb)",
        "get_quiz_attribution(uuid, integer)",
        "get_quiz_order_stats(uuid, timestamptz, timestamptz)",
        "get_quiz_product_orders(uuid, timestamptz, timestamptz)",
      ]),
    );

    const revoked = lastPositions(
      /revoke\s+all\s+on\s+function\s+(?:public\.)?(\w+)\s*\(([^)]*)\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated\b/gi,
    );
    const granted = lastPositions(/grant\s+execute\s+on\s+function\s+(?:public\.)?(\w+)\s*\(([^)]*)\)\s+to\s+service_role\b/gi);
    const open = definers
      .filter((f) => {
        const r = revoked.get(f.key);
        const g = granted.get(f.key);
        return !r || !g || !after(r, f.at) || !after(g, f.at);
      })
      .map((f) => f.key);
    expect(open).toEqual([]);
  });

  it("reads get_event_counts as SECURITY INVOKER, which RLS already covers", () => {
    const defs = functionDefinitions();
    expect(defs.get("get_event_counts(uuid, timestamptz)")?.definer).toBe(false);
  });
});
