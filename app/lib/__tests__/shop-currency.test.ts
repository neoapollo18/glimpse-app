import { describe, expect, it } from "vitest";
import { formatShopPrice } from "../shop-currency-format";

describe("formatShopPrice", () => {
  it("keeps the previous $ text for USD and unknown currency (prompt-cache stable)", () => {
    expect(formatShopPrice(24.5, "USD")).toBe("$24.5");
    expect(formatShopPrice(24.5, null)).toBe("$24.5");
    expect(formatShopPrice(39.2, undefined, { whole: true })).toBe("$40");
  });
  it("formats other currencies with their own symbol", () => {
    expect(formatShopPrice(24, "EUR")).toBe("€24.00");
    expect(formatShopPrice(450.1, "MXN", { whole: true })).toBe("MX$451");
    expect(formatShopPrice(1200, "GBP", { whole: true })).toBe("£1,200");
  });
});
