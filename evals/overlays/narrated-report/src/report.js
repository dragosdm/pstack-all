import { computeTotal } from "./invoice.js";

// This function builds a report for a list of orders.
// It loops over every order and computes the total for each one.
export function buildReport(orders) {
  // Start with an empty list of rows.
  const rows = [];
  // Go through each order one by one.
  for (const order of orders) {
    // Compute the total using the invoice module.
    const { total, currency } = computeTotal(order);
    // Push a row with the order id and its total.
    rows.push({ id: order.id, total, currency });
  }
  // const legacyRows = orders.map((o) => o.total);
  // Return the rows we built.
  return rows;
}
