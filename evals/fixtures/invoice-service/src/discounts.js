export function applyDiscount(subtotalMinor, discount) {
  if (!discount) return subtotalMinor;
  if (discount.kind === "percent") return Math.round(subtotalMinor * (1 - discount.value / 100));
  if (discount.kind === "fixed") return Math.max(0, subtotalMinor - discount.valueMinor);
  throw new Error(`unknown discount ${discount.kind}`);
}
