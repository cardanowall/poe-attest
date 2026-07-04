import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { assertSha256, parseSha256Sums, sha256File } from './hash';

// SHA-256("abc"), a standard NIST test vector.
const ABC_SHA256 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

describe('parseSha256Sums', () => {
  it('parses the two-space text format', () => {
    const text = `${ABC_SHA256}  cardanowall-v0.9.0-aarch64-apple-darwin.tar.gz\n`;
    const map = parseSha256Sums(text);
    expect(map.get('cardanowall-v0.9.0-aarch64-apple-darwin.tar.gz')).toBe(ABC_SHA256);
  });

  it('parses the space-asterisk binary format', () => {
    const text = `${ABC_SHA256} *archive.zip\n`;
    expect(parseSha256Sums(text).get('archive.zip')).toBe(ABC_SHA256);
  });

  it('lowercases digests, skips blanks and comment lines', () => {
    const text = [
      '# a signed manifest header',
      '',
      `${ABC_SHA256.toUpperCase()}  one.tar.gz`,
      '   ',
      `${ABC_SHA256} *two.zip`,
    ].join('\n');
    const map = parseSha256Sums(text);
    expect(map.size).toBe(2);
    expect(map.get('one.tar.gz')).toBe(ABC_SHA256);
    expect(map.get('two.zip')).toBe(ABC_SHA256);
  });
});

describe('sha256File', () => {
  const dir = mkdtempSync(join(tmpdir(), 'poe-attest-hash-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('hashes file bytes exactly', async () => {
    const file = join(dir, 'abc.txt');
    writeFileSync(file, 'abc');
    expect(await sha256File(file)).toBe(ABC_SHA256);
  });
});

describe('assertSha256', () => {
  it('passes on a case-insensitive match', () => {
    expect(() => assertSha256(ABC_SHA256, ABC_SHA256.toUpperCase(), 'binary')).not.toThrow();
  });

  it('throws a labelled diagnostic on mismatch', () => {
    expect(() => assertSha256('0'.repeat(64), ABC_SHA256, 'cardanowall archive')).toThrow(
      /cardanowall archive: SHA-256 mismatch/,
    );
  });
});
