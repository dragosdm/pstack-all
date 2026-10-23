import { roundMinor, ROUNDING } from "../money/round.js";

// Order: line-level promos first, then at most one order-level coupon, never below the floor.
export function applyLineDiscounts(line, promos) {
  const promo = promos.find((p) => p.sku === line.sku && line.qty >= (p.minQty ?? 1));
  if (!promo) return line;
  const off = roundMinor((line.amountMinor * promo.percent) / 100, ROUNDING.DOWN);
  return { ...line, amountMinor: line.amountMinor - off, promo: promo.code };
}

export function applyCoupon(subtotalMinor, coupon, floorMinor = 0) {
  if (!coupon) return { totalMinor: subtotalMinor, coupon: null };
  const off = coupon.kind === "percent" ? roundMinor((subtotalMinor * coupon.value) / 100) : coupon.valueMinor;
  return { totalMinor: Math.max(floorMinor, subtotalMinor - off), coupon: coupon.code };
}
