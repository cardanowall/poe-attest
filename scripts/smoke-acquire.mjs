#!/usr/bin/env node
// Live smoke test of the acquisition path (NOT part of the unit suite, it hits
// the network once). Downloads the current platform's pinned release archive,
// verifies the archive digest against src/pins.ts, extracts, verifies the binary
// digest, and runs `--version`. Proves the committed pins match the real assets
// and that the download/extract/verify flow works end to end.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const TARGET_BY_PLATFORM_ARCH = {
  'linux:x64': 'x86_64-unknown-linux-musl',
  'linux:arm64': 'aarch64-unknown-linux-musl',
  'darwin:x64': 'x86_64-apple-darwin',
  'darwin:arm64': 'aarch64-apple-darwin',
  'win32:x64': 'x86_64-pc-windows-msvc',
};

function readPins() {
  const text = readFileSync(join(PACKAGE_ROOT, 'src', 'pins.ts'), 'utf8');
  const version = /DEFAULT_CLI_VERSION = '([^']+)'/.exec(text)?.[1];
  if (!version) throw new Error('could not read DEFAULT_CLI_VERSION from src/pins.ts');
  const pins = {};
  const re = /'([^']+)':\s*{\s*archiveSha256:\s*'([0-9a-f]+)',\s*binarySha256:\s*'([0-9a-f]+)',/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    pins[match[1]] = { archiveSha256: match[2], binarySha256: match[3] };
  }
  return { version, pins };
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function download(url) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`download failed (${response.status}): ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

async function main() {
  const target = TARGET_BY_PLATFORM_ARCH[`${process.platform}:${process.arch}`];
  if (!target) throw new Error(`no pinned target for ${process.platform}/${process.arch}`);
  const { version, pins } = readPins();
  const pin = pins[target];
  if (!pin) throw new Error(`src/pins.ts has no entry for ${target}`);

  const isWindows = target.includes('windows');
  const ext = isWindows ? 'zip' : 'tar.gz';
  const stem = `cardanowall-v${version}-${target}`;
  const bin = isWindows ? 'cardanowall.exe' : 'cardanowall';
  const url = `https://github.com/cardanowall/label-309-cli/releases/download/v${version}/${stem}.${ext}`;

  console.log(`Target:  ${target}`);
  console.log(`Version: ${version}`);
  console.log(`Archive: ${url}`);

  const archive = await download(url);
  const archiveSha256 = sha256(archive);
  console.log(`\nArchive digest: ${archiveSha256}`);
  console.log(`Pinned:         ${pin.archiveSha256}`);
  if (archiveSha256 !== pin.archiveSha256)
    throw new Error('archive digest does not match src/pins.ts');
  console.log('  archive digest OK');

  const work = mkdtempSync(join(tmpdir(), 'poe-attest-smoke-'));
  try {
    const archivePath = join(work, `${stem}.${ext}`);
    writeFileSync(archivePath, archive);
    if (isWindows)
      execFileSync('unzip', ['-o', '-q', archivePath, '-d', work], { stdio: 'inherit' });
    else execFileSync('tar', ['-xzf', archivePath, '-C', work], { stdio: 'inherit' });

    const binaryPath = join(work, stem, bin);
    const binarySha256 = sha256(readFileSync(binaryPath));
    console.log(`\nBinary digest:  ${binarySha256}`);
    console.log(`Pinned:         ${pin.binarySha256}`);
    if (binarySha256 !== pin.binarySha256)
      throw new Error('binary digest does not match src/pins.ts');
    console.log('  binary digest OK');

    if (process.platform !== 'win32') execFileSync('chmod', ['+x', binaryPath]);
    const out = execFileSync(binaryPath, ['--version'], { encoding: 'utf8' }).trim();
    console.log(`\n$ cardanowall --version\n${out}`);
    console.log('\nsmoke-acquire OK');
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
