import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it, vi } from 'vitest';

import { acquireCli, resolveExpectedArchive, resolveOverrideSha, type ToolCache } from './acquire';
import type { CliSha256Override, Config } from './inputs';

const AA = 'a'.repeat(64);
const BB = 'b'.repeat(64);

// A tool-cache double whose only live method is downloadTool (returns a path to
// a SHA256SUMS file written on disk); the rest throw if the code path reaches
// them unexpectedly.
function stubToolCache(sumsPath: string | null): ToolCache {
  return {
    find: () => '',
    downloadTool: vi.fn(async () => {
      if (sumsPath === null) throw new Error('unexpected downloadTool');
      return sumsPath;
    }),
    extractTar: async () => {
      throw new Error('unexpected extractTar');
    },
    extractZip: async () => {
      throw new Error('unexpected extractZip');
    },
    cacheDir: async () => {
      throw new Error('unexpected cacheDir');
    },
  };
}

describe('resolveOverrideSha', () => {
  it('returns null when there is no override', () => {
    expect(resolveOverrideSha(null, 'x86_64-apple-darwin')).toBeNull();
  });

  it('returns the single digest for any target', () => {
    const override: CliSha256Override = { kind: 'single', sha256: AA };
    expect(resolveOverrideSha(override, 'aarch64-apple-darwin')).toBe(AA);
  });

  it('returns the per-target digest for a listed target', () => {
    const override: CliSha256Override = {
      kind: 'perTarget',
      byTarget: new Map([['x86_64-apple-darwin', AA]]),
    };
    expect(resolveOverrideSha(override, 'x86_64-apple-darwin')).toBe(AA);
  });

  it('hard-fails when a supplied per-target map omits the current target', () => {
    const override: CliSha256Override = {
      kind: 'perTarget',
      byTarget: new Map([['x86_64-apple-darwin', AA]]),
    };
    expect(() => resolveOverrideSha(override, 'aarch64-apple-darwin')).toThrow(
      /no entry for the current target aarch64-apple-darwin/,
    );
  });
});

describe('resolveExpectedArchive (default version)', () => {
  const noNetwork = stubToolCache(null);

  it('uses the embedded pin when no override is given', async () => {
    await expect(
      resolveExpectedArchive('0.9.0', 'x86_64-apple-darwin', true, AA, null, noNetwork),
    ).resolves.toBe(AA);
  });

  it('accepts an override that matches the pin', async () => {
    await expect(
      resolveExpectedArchive('0.9.0', 'x86_64-apple-darwin', true, AA, AA, noNetwork),
    ).resolves.toBe(AA);
  });

  it('rejects an override that conflicts with the pin', async () => {
    await expect(
      resolveExpectedArchive('0.9.0', 'x86_64-apple-darwin', true, AA, BB, noNetwork),
    ).rejects.toThrow(/disagrees with the pinned archive digest/);
  });
});

describe('resolveExpectedArchive (non-default version)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'poe-attest-acquire-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  function sumsWith(name: string, digest: string): string {
    const file = join(dir, `SHA256SUMS-${Math.random().toString(36).slice(2)}`);
    writeFileSync(file, `${digest}  ${name}\n`);
    return file;
  }

  it('adopts the SHA256SUMS digest when unpinned', async () => {
    const target = 'x86_64-unknown-linux-musl';
    const sums = sumsWith(`cardanowall-v1.0.0-${target}.tar.gz`, AA);
    await expect(
      resolveExpectedArchive('1.0.0', target, false, null, null, stubToolCache(sums)),
    ).resolves.toBe(AA);
  });

  it('fails when the manifest lacks the target archive', async () => {
    const sums = sumsWith('some-other-file.tar.gz', AA);
    await expect(
      resolveExpectedArchive(
        '1.0.0',
        'x86_64-unknown-linux-musl',
        false,
        null,
        null,
        stubToolCache(sums),
      ),
    ).rejects.toThrow(/no entry for/);
  });

  it('refuses when the manifest disagrees with an override', async () => {
    const target = 'x86_64-unknown-linux-musl';
    const sums = sumsWith(`cardanowall-v1.0.0-${target}.tar.gz`, AA);
    await expect(
      resolveExpectedArchive('1.0.0', target, false, null, BB, stubToolCache(sums)),
    ).rejects.toThrow(/disagrees with the pinned\/overridden digest/);
  });
});

describe('acquireCli non-default version fail-closed caching', () => {
  const dir = mkdtempSync(join(tmpdir(), 'poe-attest-acquire-nd-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('ignores a poisoned tool-cache and returns the freshly SHA256SUMS-verified binary', async () => {
    const target = 'x86_64-unknown-linux-musl';
    const version = '1.2.3';
    const archiveFile = `cardanowall-v${version}-${target}.tar.gz`;

    // A real "archive" file; its digest is what we pin via cli-sha256.
    const archivePath = join(dir, archiveFile);
    writeFileSync(archivePath, 'ARCHIVE-BYTES');
    const archiveSha = createHash('sha256').update(readFileSync(archivePath)).digest('hex');

    const sumsPath = join(dir, 'SHA256SUMS');
    writeFileSync(sumsPath, `${archiveSha}  ${archiveFile}\n`);

    // The extraction the injected extractTar returns, with the genuine binary.
    const extractDir = join(dir, 'extract');
    const stemDir = join(extractDir, `cardanowall-v${version}-${target}`);
    mkdirSync(stemDir, { recursive: true });
    const genuineBinary = join(stemDir, 'cardanowall');
    writeFileSync(genuineBinary, 'GENUINE-BINARY');

    // A poisoned cross-run cache entry that must never be trusted for a
    // non-default version.
    const poisonedCache = join(dir, 'cache');
    mkdirSync(poisonedCache, { recursive: true });
    writeFileSync(join(poisonedCache, 'cardanowall'), 'POISONED');

    const findSpy = vi.fn(() => poisonedCache);
    const cacheDirSpy = vi.fn(async () => {
      throw new Error('non-default versions must not be cached across runs');
    });
    const toolCache: ToolCache = {
      find: findSpy,
      downloadTool: async (url) => (url.endsWith('SHA256SUMS') ? sumsPath : archivePath),
      extractTar: async () => extractDir,
      extractZip: async () => {
        throw new Error('unexpected extractZip');
      },
      cacheDir: cacheDirSpy,
    };

    const config = {
      cliVersion: version,
      cliSha256: { kind: 'single', sha256: archiveSha } as CliSha256Override,
      cliPath: null,
    } as unknown as Config;

    const result = await acquireCli(config, target, toolCache);

    expect(result).toBe(genuineBinary);
    expect(readFileSync(result, 'utf8')).toBe('GENUINE-BINARY');
    expect(cacheDirSpy).not.toHaveBeenCalled();
  });
});
