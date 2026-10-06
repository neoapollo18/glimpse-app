// Pure price formatting in a store currency (migration 084). No I/O.

/** "$24", "€24", "MX$24" etc. for prompts and generated answer labels.
 * Unknown currency = the old "$" formatting. */
export function formatShopPrice(amount: number, currency: string | null | undefined, opts: { whole?: boolean } = {}): string {
  const digits = opts.whole ? 0 : 2;
  if (!currency || currency === "USD") return `$${opts.whole ? Math.ceil(amount) : amount}`;
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(opts.whole ? Math.ceil(amount) : amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

/** Merchant-facing display ("$24.50", "€24,50" per locale). Unknown
 * currency = USD, the previous behaviour. */
export function formatMoneyDisplay(amount: number | string, currency: string | null | undefined): string {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  if (!Number.isFinite(n)) return String(amount);
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD" }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

/** Whole-unit merchant display for revenue totals ("$1,240", "€1.240"). */
export function formatMoneyWhole(amount: number, currency: string | null | undefined): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 0,
      minimumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `$${Math.round(amount).toLocaleString()}`;
  }
}
