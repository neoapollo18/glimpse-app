// In-process record of the last quiz-generation outcome per shop.
//
// Exists for the wizard's WATCH MODE: when the SSE stream cuts, the client
// polls the studio loader waiting for the draft — but a generation that
// FAILS after the cut writes nothing, and the merchant used to watch a
// progress bar for the full watch budget before a generic timeout. The
// loader surfaces this record so the wizard can stop on the real error,
// and so warnings from a stream-cut success still reach the merchant.
//
// In-process on purpose (single Render instance): a restart loses at most
// one status, and the watch timeout still backstops that case.
//
// Each run gets a token from recordGenStart; heartbeat/outcome writes are
// dropped unless the token still owns the shop's slot (last start wins).
// Without this, two concurrent runs for one shop interleave and run A's
// failure stops run B's watch with the wrong error. A running entry whose
// heartbeat goes stale (generation died in-process without recording an
// outcome) is reported as a failure so the watcher stops early instead of
// burning the full watch budget.

export interface GenStatus {
  at: number;
  error?: string;
  warnings?: string[];
}

interface GenEntry {
  token: number;
  heartbeatAt: number;
  outcome?: GenStatus;
}

const statusByShop = new Map<string, GenEntry>();
const TTL_MS = 20 * 60_000;
// The generating route heartbeats every 10s for as long as it is alive;
// well past that means the generation died without recording an outcome.
const STALE_MS = 90_000;
let nextToken = 1;

export function recordGenStart(shopId: string): number {
  const token = nextToken++;
  statusByShop.set(shopId, { token, heartbeatAt: Date.now() });
  return token;
}

export function recordGenHeartbeat(shopId: string, token: number): void {
  const entry = statusByShop.get(shopId);
  if (!entry || entry.token !== token || entry.outcome) return;
  entry.heartbeatAt = Date.now();
}

export function recordGenOutcome(shopId: string, token: number, outcome: { error?: string; warnings?: string[] }): void {
  const entry = statusByShop.get(shopId);
  // Superseded by a newer run for this shop — its status is not ours to write.
  if (!entry || entry.token !== token) return;
  entry.outcome = { at: Date.now(), ...outcome };
}

export function getGenStatus(shopId: string): GenStatus | null {
  const entry = statusByShop.get(shopId);
  if (!entry) return null;
  if (entry.outcome) {
    if (Date.now() - entry.outcome.at > TTL_MS) {
      statusByShop.delete(shopId);
      return null;
    }
    return entry.outcome;
  }
  // Still running: silent while the heartbeat is fresh; a stale heartbeat
  // means the generation died without an outcome, so fail the watch now.
  if (Date.now() - entry.heartbeatAt > TTL_MS) {
    statusByShop.delete(shopId);
    return null;
  }
  if (Date.now() - entry.heartbeatAt > STALE_MS) {
    return {
      at: entry.heartbeatAt,
      error: "Generation stopped unexpectedly. Try again — your answers are still filled in.",
    };
  }
  return null;
}
