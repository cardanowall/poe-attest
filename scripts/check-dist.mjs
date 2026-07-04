#!/usr/bin/env node
// Verify the committed dist/ is in sync with src/. Rebuilds into a temp dir with
// the same esbuild invocation and byte-compares the outputs, so a source change
// without a rebuilt dist fails CI.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runBuild } from './build-lib.mjs';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = mkdtempSync(join(tmpdir(), 'poe-attest-dist-'));

try {
  await runBuild(tmp);
  let stale = false;
  for (const file of ['index.js', 'licenses.txt']) {
    const built = readFileSync(join(tmp, file), 'utf8');
    const committed = readFileSync(join(packageRoot, 'dist', file), 'utf8');
    if (built !== committed) {
      console.error(`check:dist FAIL, dist/${file} is out of date.`);
      stale = true;
    }
  }
  if (stale) {
    console.error('Run `npm run build` and commit dist/.');
    process.exit(1);
  }
  console.log('check:dist OK, dist/ matches the current source.');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
