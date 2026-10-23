const PRODUCTS = {
  "seat-pro": { currency: "USD", category: "software", tiers: [[1, 30], [10, 27], [50, 24]] },
  "seat-team": { currency: "USD", category: "software", tiers: [[1, 12], [25, 10]] },
  "onboarding": { currency: "USD", category: "services", tiers: [[1, 1500]] },
  "hardware-key": { currency: "EUR", category: "goods", tiers: [[1, 45], [100, 39]] },
};

export function product(sku) {
  const found = PRODUCTS[sku];
  if (!found) throw new Error(`unknown sku ${sku}`);
  return found;
}

export function unitPrice(sku, qty) {
  const { tiers } = product(sku);
  let price = tiers[0][1];
  for (const [minQty, tierPrice] of tiers) if (qty >= minQty) price = tierPrice;
  return price;
}
