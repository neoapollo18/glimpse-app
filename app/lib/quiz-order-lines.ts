// Order line items for quiz analytics (migration 091, widget_order_lines).
// Pure mapping from the orders/create webhook payload; the webhook writes
// the rows only for orders whose cart reached quiz results.

export interface OrderLinePayload {
  id?: number | string | null;
  product_id?: number | string | null;
  variant_id?: number | string | null;
  title?: string | null;
  quantity?: number | null;
  price?: string | number | null;
}

export interface QuizOrderLineRow {
  shop_id: string;
  shopify_order_id: string;
  line_item_id: string;
  cart_token: string | null;
  product_id: string | null;
  variant_id: string | null;
  title: string | null;
  quantity: number;
  price: number | null;
  ordered_at: string | null;
}

const id = (v: unknown): string | null => {
  const m = /^(\d{1,20})$/.exec(String(v ?? "").trim());
  return m ? m[1] : null;
};

export function quizOrderLineRows(
  shopId: string,
  order: { id: number | string; cart_token?: string | null; created_at?: string | null; line_items?: OrderLinePayload[] | null },
  cartToken: string | null,
): QuizOrderLineRow[] {
  const orderId = id(order.id);
  if (!orderId || !Array.isArray(order.line_items)) return [];
  const rows: QuizOrderLineRow[] = [];
  for (const li of order.line_items.slice(0, 250)) {
    const lineId = id(li?.id);
    if (!lineId) continue;
    const qty = Number(li.quantity);
    const price = li.price == null ? null : Number(li.price);
    rows.push({
      shop_id: shopId,
      shopify_order_id: orderId,
      line_item_id: lineId,
      cart_token: cartToken,
      product_id: id(li.product_id),
      variant_id: id(li.variant_id),
      title: typeof li.title === "string" ? li.title.slice(0, 255) : null,
      quantity: Number.isInteger(qty) && qty > 0 ? qty : 1,
      price: price != null && Number.isFinite(price) ? Math.round(price * 100) / 100 : null,
      ordered_at: typeof order.created_at === "string" ? order.created_at : null,
    });
  }
  return rows;
}
