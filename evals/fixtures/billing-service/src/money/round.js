export const ROUNDING = { HALF_UP: "half-up", HALF_EVEN: "half-even", DOWN: "down" };

export function roundMinor(value, mode = ROUNDING.HALF_UP) {
  const floor = Math.floor(value);
  const fraction = value - floor;
  if (mode === ROUNDING.DOWN) return floor;
  if (Math.abs(fraction - 0.5) < 1e-9) {
    if (mode === ROUNDING.HALF_EVEN) return floor % 2 === 0 ? floor : floor + 1;
    return floor + 1;
  }
  return Math.round(value);
}
