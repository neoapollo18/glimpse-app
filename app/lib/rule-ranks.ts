// Rule-set normalization for save_recommendation_config (pure; tested).

type RuleForSave = {
  criteria: Record<string, string>;
  variantId?: string | null;
  productId?: string | null;
  rank: number;
  quantity?: number;
};

/**
 * Make a rule set satisfy recommendation_rules' UNIQUE (shop_id, criteria,
 * rank) without dropping anything: every rule the caller sent is saved.
 *   - ranks become whole numbers >= 1 (the RPC casts with ::int);
 *   - rules sharing a rank on one answer path keep their relative order
 *     (rank, then input order) and later ones move to the next free rank,
 *     so priority order is preserved.
 * criteria is compared key-order-insensitively, like jsonb equality.
 */
export function dedupeRuleRanks<R extends RuleForSave>(rules: R[]): R[] {
  const pathKey = (c: Record<string, string>) =>
    JSON.stringify(Object.keys(c ?? {}).sort().map((k) => [k, c[k]]));
  const groups = new Map<string, Array<{ rule: R; index: number }>>();
  rules.forEach((rule, index) => {
    const key = pathKey(rule.criteria);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({ rule, index });
  });
  const out: Array<{ rule: R; index: number }> = [];
  for (const group of groups.values()) {
    group.sort((a, b) => Number(a.rule.rank) - Number(b.rule.rank) || a.index - b.index);
    let lastRank = -Infinity;
    for (const entry of group) {
      // Whole numbers: the RPC casts rank with ::int.
      const rank = Math.max(Math.max(1, Math.round(Number(entry.rule.rank))), lastRank + 1);
      lastRank = rank;
      out.push({ rule: rank === entry.rule.rank ? entry.rule : { ...entry.rule, rank }, index: entry.index });
    }
  }
  // Keep the caller's array order for everything else that reads it.
  return out.sort((a, b) => a.index - b.index).map((e) => e.rule);
}
