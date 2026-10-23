import { toMinor, fromMinor } from "./currency.js";
import { applyDiscount } from "./discounts.js";

export function computeTotal(order) {
  const subtotal = order.lines.reduce((sum, line) => sum + toMinor(line.price, order.currency) * line.qty, 0);
  const discounted = applyDiscount(subtotal, order.discount);
  const tax = Math.round(discounted * order.taxRate);
  return { currency: order.currency, total: fromMinor(discounted + tax, order.currency) };
}
