// Repeated SKUs merge into one line so quantity tiers see the combined quantity.
export function normalizeLines(lines) {
  const bySku = new Map();
  for (const line of lines) bySku.set(line.sku, (bySku.get(line.sku) ?? 0) + line.qty);
  return [...bySku].map(([sku, qty]) => ({ sku, qty }));
}
