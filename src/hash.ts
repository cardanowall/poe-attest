// Supply-chain integrity primitives: parse a coreutils-style `SHA256SUMS`
// manifest and compute a file's SHA-256. These hashes are public archive/binary
// digests (never secrets), so plain string comparison is correct, timing does
// not matter here.

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

// A SHA256SUMS line is `<64-hex><whitespace><filename>` in text mode or
// `<64-hex><space>*<filename>` in binary mode (the `*` marks a binary read).
// Accept both, plus arbitrary trailing whitespace; ignore blank and comment
// lines.
const SUMS_LINE = /^([0-9a-fA-F]{64})\s+\*?(\S.*?)\s*$/;

/**
 * Parse a `SHA256SUMS` manifest into `filename → lowercase-hex-digest`. Lines
 * that do not match the digest+filename shape are skipped, so a signed or
 * commented manifest still parses its data rows.
 */
export function parseSha256Sums(text: string): Map<string, string> {
  const digests = new Map<string, string>();
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const match = SUMS_LINE.exec(line);
    if (match === null) continue;
    const digest = match[1];
    const name = match[2];
    if (digest === undefined || name === undefined) continue;
    digests.set(name, digest.toLowerCase());
  }
  return digests;
}

/** Stream a file through SHA-256 and resolve its lowercase-hex digest. */
export function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const digest = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => digest.update(chunk));
    stream.on('end', () => resolve(digest.digest('hex')));
  });
}

/**
 * Assert that `actual` matches `expected` (both lowercase-hex SHA-256), throwing
 * a diagnostic naming `label` on mismatch. Comparison is case-insensitive.
 */
export function assertSha256(actual: string, expected: string, label: string): void {
  const a = actual.toLowerCase();
  const b = expected.toLowerCase();
  if (a !== b) {
    throw new Error(`${label}: SHA-256 mismatch, expected ${b}, got ${a}`);
  }
}
