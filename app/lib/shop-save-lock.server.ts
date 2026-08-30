// Per-shop serialization for recommendation-config writes.
//
// The capture -> patch -> rewrite save (and the draft publish, and the
// advanced rules editor save) all funnel through the wipe-and-rewrite
// save_recommendation_config RPC. Two concurrent writers would both snapshot
// before either writes, and the second rewrite would erase the first's edit.
// Every code path that calls saveRecommendationConfig for live data must run
// inside this lock.
//
// In-process only (single-instance deploy); a multi-instance deploy would
// need an advisory lock in the RPC instead.

const shopSaveChains = new Map<string, Promise<unknown>>();

export function withShopSaveLock<T>(shopId: string, fn: () => Promise<T>): Promise<T> {
  const prev = shopSaveChains.get(shopId) ?? Promise.resolve();
  const run = prev.then(fn);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  shopSaveChains.set(shopId, tail);
  // Drop the entry once the chain drains so the map stays bounded by the
  // number of shops with an ACTIVE save, not every shop ever seen.
  tail.then(() => {
    if (shopSaveChains.get(shopId) === tail) shopSaveChains.delete(shopId);
  });
  return run;
}
