// Quiz analytics payloads (2026-10-15 analytics revamp, Phase 2).
//
// The storefront quiz may attach a small `properties` object to an event
// (which question was answered with which values, which products were shown,
// opened or added). The public track-event endpoint accepts it only through
// this allowlist: per-event keys, identifier-shaped strings, bounded numbers
// and arrays, a 2 KB cap, and never free text or contact data. Anything
// else is dropped, so a forged payload can at worst add a few well-formed ids.

const AXIS = /^[a-z_][a-z0-9_]{0,63}$/;
const HANDLE = /^[a-z0-9][a-z0-9_-]{0,254}$/i;
const NUMERIC_ID = /^\d{1,20}$/;
const SESSION = /^[A-Za-z0-9_-]{8,40}$/;
const WORD = /^[a-z_]{1,24}$/;
// Columnar results permalink key (columnar/pipeline.ts encodeResultKey).
const RESULT_KEY = /^[a-z0-9.]{1,64}$/;
const MAX_BYTES = 2048;

type Props = Record<string, unknown>;

const int = (v: unknown, min: number, max: number): number | undefined => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
};
const str = (v: unknown, re: RegExp): string | undefined =>
  typeof v === "string" && re.test(v) ? v : typeof v === "number" && re.test(String(v)) ? String(v) : undefined;
const bool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);
const list = <T,>(v: unknown, max: number, item: (x: unknown) => T | undefined): T[] | undefined => {
  if (!Array.isArray(v)) return undefined;
  const out: T[] = [];
  for (const x of v.slice(0, max)) {
    const ok = item(x);
    if (ok !== undefined) out.push(ok);
  }
  return out.length ? out : undefined;
};
const lineItem = (x: unknown) => {
  if (!x || typeof x !== "object") return undefined;
  const r = x as Props;
  const h = str(r.h, HANDLE);
  const v = str(r.v, NUMERIC_ID);
  if (!h && !v) return undefined;
  return compact({ h, v, qty: int(r.qty, 1, 99) });
};

function compact(o: Props): Props {
  const out: Props = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out;
}

const PER_EVENT: Record<string, (r: Props) => Props> = {
  quiz_question_answered: (r) => ({
    qi: int(r.qi, 0, 50),
    q: str(r.q, AXIS),
    vals: list(r.vals, 16, (x) => str(x, AXIS)),
    // Columnar quizzes: the stable answer IDs the matching keys on.
    ids: list(r.ids, 16, (x) => str(x, AXIS)),
    edit: bool(r.edit),
    // ...an answer the pool recorded for a skipped step, and the results
    // zero state's one-tap loosen.
    auto: bool(r.auto),
    loosen: bool(r.loosen),
  }),
  quiz_results_shown: (r) => ({
    n: int(r.n, 0, 50),
    recs: list(r.recs, 12, (x) => str(x, HANDLE)),
    partial: bool(r.partial),
    // Columnar quizzes (brief section 8): the six handles shown, the
    // relaxation rung used and the permalink key.
    handles: list(r.handles, 12, (x) => str(x, HANDLE)),
    rung: int(r.rung, 1, 5),
    rk: str(r.rk, RESULT_KEY),
    // ...and whether a results link (?r=) opened them.
    permalink: bool(r.permalink),
  }),
  quiz_view_product: (r) => ({ h: str(r.h, HANDLE), v: str(r.v, NUMERIC_ID) }),
  quiz_add_to_cart: (r) => ({
    h: str(r.h, HANDLE),
    v: str(r.v, NUMERIC_ID),
    qty: int(r.qty, 1, 99),
    price: int(r.price, 0, 1_000_000_000),
  }),
  quiz_add_bundle_to_bag: (r) => ({
    items: list(r.items, 12, lineItem),
    price: int(r.price, 0, 1_000_000_000),
  }),
  quiz_cross_sell_add: (r) => ({ h: str(r.h, HANDLE), v: str(r.v, NUMERIC_ID) }),
  quiz_restart: (r) => ({ from: str(r.from, WORD) }),
  quiz_lead_submitted: (r) => ({ has_email: bool(r.has_email), has_phone: bool(r.has_phone) }),
};

/** The stored properties for a storefront quiz event, or null. */
export function sanitizeQuizEventProperties(eventType: string, raw: unknown): Props | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Props;
  const shape = PER_EVENT[eventType];
  const out = compact({ sid: str(r.sid, SESSION), ...(shape ? shape(r) : {}) });
  if (Object.keys(out).length === 0) return null;
  return JSON.stringify(out).length <= MAX_BYTES ? out : null;
}
