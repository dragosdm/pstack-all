import { validateOrder } from "../orders/validate.js";
import { normalizeLines } from "../orders/normalize.js";
import { product, unitPrice } from "../pricing/catalog.js";
import { applyCoupon, applyLineDiscounts } from "../pricing/discounts.js";
import { computeTax } from "../tax/compute.js";
import { convertMinor, fromMinor, toMinor } from "../money/currency.js";
import { nextInvoiceNumber } from "./number.js";

export function buildInvoice(order, { store, promos = [], issuedAt = new Date() }) {
  validateOrder(order);
  const lines = normalizeLines(order.lines).map(({ sku, qty }) => {
    const p = product(sku);
    const lineMinor = toMinor(unitPrice(sku, qty) * qty, p.currency);
    const amountMinor = convertMinor(lineMinor, p.currency, order.currency);
    return applyLineDiscounts({ sku, qty, category: p.category, amountMinor }, promos);
  });
  const subtotalMinor = lines.reduce((sum, line) => sum + line.amountMinor, 0);
  const { totalMinor: discountedMinor, coupon } = applyCoupon(subtotalMinor, order.coupon);
  const scale = subtotalMinor === 0 ? 1 : discountedMinor / subtotalMinor;
  const taxMinor = computeTax(lines.map((line) => ({ ...line, amountMinor: line.amountMinor * scale })), order.shipTo);
  const invoice = {
    number: nextInvoiceNumber(store, issuedAt),
    customerId: order.customerId,
    currency: order.currency,
    lines,
    coupon,
    subtotal: fromMinor(subtotalMinor, order.currency),
    tax: fromMinor(taxMinor, order.currency),
    total: fromMinor(discountedMinor + taxMinor, order.currency),
  };
  store.save("invoices", invoice.number, invoice);
  return invoice;
}
