const MINOR_UNITS = { USD: 2, EUR: 2, JPY: 0 };

export function toMinor(amount, currency) {
  const digits = MINOR_UNITS[currency] ?? 2;
  return Math.round(amount * 10 ** digits);
}

export function fromMinor(minor, currency) {
  const digits = MINOR_UNITS[currency] ?? 2;
  return minor / 10 ** digits;
}
