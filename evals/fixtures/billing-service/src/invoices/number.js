export function nextInvoiceNumber(store, issuedAt) {
  const year = issuedAt.getUTCFullYear();
  const seq = store.increment(`invoice-seq-${year}`);
  return `INV-${year}-${String(seq).padStart(6, "0")}`;
}
