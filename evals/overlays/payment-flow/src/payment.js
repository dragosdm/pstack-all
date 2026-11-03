// Payment flow for one invoice. The gateway answers each charge request once, possibly after the client gave up waiting.

export function createPayment(invoiceId) {
  return { invoiceId, status: "issued", inFlight: 0, charges: 0 };
}

export function pay(payment) {
  if (payment.status !== "issued" && payment.status !== "failed") return payment;
  return { ...payment, status: "paying", inFlight: payment.inFlight + 1 };
}

export function timeout(payment) {
  if (payment.status !== "paying") return payment;
  return { ...payment, status: "failed" };
}

export function gatewayCharged(payment) {
  if (payment.inFlight === 0) return payment;
  return { ...payment, status: "paid", inFlight: payment.inFlight - 1, charges: payment.charges + 1 };
}

export function gatewayDeclined(payment) {
  if (payment.inFlight === 0) return payment;
  const status = payment.status === "paying" ? "failed" : payment.status;
  return { ...payment, status, inFlight: payment.inFlight - 1 };
}
