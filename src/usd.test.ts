import { describe, expect, it } from 'vitest';

import { microsToUsd } from './usd';

describe('microsToUsd', () => {
  it('renders zero with two fraction digits', () => {
    expect(microsToUsd('0')).toBe('0.00');
  });

  it('renders exact cents, trimming to two digits', () => {
    expect(microsToUsd('1500000')).toBe('1.50');
    expect(microsToUsd('10000000')).toBe('10.00');
  });

  it('renders a sub-cent amount without a float artifact', () => {
    expect(microsToUsd('20000')).toBe('0.02');
    expect(microsToUsd('1')).toBe('0.000001');
    expect(microsToUsd('999999')).toBe('0.999999');
  });

  it('keeps mid-precision fraction digits', () => {
    expect(microsToUsd('1234567')).toBe('1.234567');
    expect(microsToUsd('12345000')).toBe('12.345');
  });

  it('handles very large values with exact integer math', () => {
    expect(microsToUsd('123456789000000')).toBe('123456789.00');
    expect(microsToUsd('9007199254740993000000')).toBe('9007199254740993.00');
  });

  it('preserves a leading sign defensively', () => {
    expect(microsToUsd('-2500000')).toBe('-2.50');
  });

  it('returns a non-integer payload unchanged', () => {
    expect(microsToUsd('n/a')).toBe('n/a');
  });
});
