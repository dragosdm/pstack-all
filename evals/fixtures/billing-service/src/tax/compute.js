import { roundMinor } from "../money/round.js";
import { region } from "./regions.js";

// Per-line regions round each line's tax; others round once on the taxable sum.
export function computeTax(lines, regionCode) {
  const r = region(regionCode);
  const taxable = lines.filter((line) => !r.exempt.includes(line.category));
  if (r.perLine) return taxable.reduce((sum, line) => sum + roundMinor(line.amountMinor * r.rate, r.rounding), 0);
  const base = taxable.reduce((sum, line) => sum + line.amountMinor, 0);
  return roundMinor(base * r.rate, r.rounding);
}
