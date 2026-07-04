// USD money crosses the gateway wire (and the CLI's JSON) as an integer count of
// micro-dollars encoded in a decimal string: 1 USD = 1_000_000 micros. We render
// it back to a human decimal USD string with exact integer (BigInt) math so no
// float rounding ever touches a billed figure.

const MICROS_PER_USD = 1_000_000n;
const FRACTION_DIGITS = 6;
const MIN_FRACTION_DIGITS = 2;

/**
 * Convert an integer micro-dollar string (e.g. `"1500000"`) to a decimal USD
 * string (e.g. `"1.50"`). Trailing zeros are trimmed but at least two fraction
 * digits are kept so the value reads as currency; sub-cent precision is
 * preserved when present (`"1"` → `"0.000001"`).
 *
 * A value that is not a well-formed integer string is returned unchanged, so a
 * surprising gateway payload surfaces verbatim rather than as `NaN`.
 */
export function microsToUsd(micros: string): string {
  const trimmed = micros.trim();
  let value: bigint;
  try {
    value = BigInt(trimmed);
  } catch {
    return micros;
  }
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / MICROS_PER_USD;
  const fraction = abs % MICROS_PER_USD;

  let fractionStr = fraction.toString().padStart(FRACTION_DIGITS, '0').replace(/0+$/, '');
  if (fractionStr.length < MIN_FRACTION_DIGITS) {
    fractionStr = fraction.toString().padStart(FRACTION_DIGITS, '0').slice(0, MIN_FRACTION_DIGITS);
  }
  return `${negative ? '-' : ''}${whole.toString()}.${fractionStr}`;
}
