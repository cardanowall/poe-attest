#!/usr/bin/env node
// Build the committed dist/ bundle. See build-lib.mjs for why esbuild.
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runBuild } from './build-lib.mjs';

const distDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
mkdirSync(distDir, { recursive: true });
await runBuild(distDir);
console.log('build OK, wrote dist/index.js and dist/licenses.txt');
