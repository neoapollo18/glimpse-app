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

export interface GenStatus {
  at: number;
  error?: string;
  warnings?: string[];
}

const statusByShop = new Map<string, GenStatus>();
const TTL_MS = 20 * 60_000;

export function recordGenStart(shopId: string): void {
  statusByShop.delete(shopId);
}

export function recordGenOutcome(shopId: string, outcome: { error?: string; warnings?: string[] }): void {
  statusByShop.set(shopId, { at: Date.now(), ...outcome });
}

export function getGenStatus(shopId: string): GenStatus | null {
  const status = statusByShop.get(shopId);
  if (!status) return null;
  if (Date.now() - status.at > TTL_MS) {
    statusByShop.delete(shopId);
    return null;
  }
  return status;
}
