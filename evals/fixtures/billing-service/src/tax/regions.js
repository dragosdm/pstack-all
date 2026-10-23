import { ROUNDING } from "../money/round.js";

export const REGIONS = {
  "US-CA": { rate: 0.0725, exempt: ["services"], rounding: ROUNDING.HALF_UP, perLine: false },
  "US-OR": { rate: 0, exempt: [], rounding: ROUNDING.HALF_UP, perLine: false },
  "DE": { rate: 0.19, exempt: [], rounding: ROUNDING.HALF_EVEN, perLine: true },
  "GB": { rate: 0.2, exempt: ["software"], rounding: ROUNDING.HALF_UP, perLine: true },
};

export function region(code) {
  const found = REGIONS[code];
  if (!found) throw new Error(`no tax region ${code}`);
  return found;
}
