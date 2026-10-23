import { roundMinor } from "./round.js";

const MINOR_DIGITS = { USD: 2, EUR: 2, GBP: 2, JPY: 0, BHD: 3 };
const FX_TO_USD = { USD: 1, EUR: 1.08, GBP: 1.27, JPY: 0.0067, BHD: 2.65 };

export function digits(currency) {
  if (!(currency in MINOR_DIGITS)) throw new Error(`unsupported currency ${currency}`);
  return MINOR_DIGITS[currency];
}

export const toMinor = (amount, currency, mode) => roundMinor(amount * 10 ** digits(currency), mode);
export const fromMinor = (minor, currency) => minor / 10 ** digits(currency);

export function convertMinor(minor, from, to, mode) {
  if (from === to) return minor;
  const usd = fromMinor(minor, from) * FX_TO_USD[from];
  return toMinor(usd / FX_TO_USD[to], to, mode);
}
