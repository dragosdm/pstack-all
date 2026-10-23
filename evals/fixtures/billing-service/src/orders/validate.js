import { REGIONS } from "../tax/regions.js";
import { digits } from "../money/currency.js";

export function validateOrder(order) {
  const problems = [];
  if (!order.customerId) problems.push("customerId is required");
  if (!Array.isArray(order.lines) || order.lines.length === 0) problems.push("at least one line is required");
  if (!(order.shipTo in REGIONS)) problems.push(`unknown region ${order.shipTo}`);
  try { digits(order.currency); } catch { problems.push(`unsupported currency ${order.currency}`); }
  for (const [i, line] of (order.lines ?? []).entries()) {
    if (!Number.isInteger(line.qty) || line.qty <= 0) problems.push(`line ${i}: qty must be a positive integer`);
  }
  if (problems.length) throw Object.assign(new Error("invalid order"), { problems });
  return order;
}
