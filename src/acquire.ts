// Acquiring the cardanowall CLI binary: resolve a preinstalled path, or
// download + verify + cache the pinned release. Integrity is enforced twice,
// the archive digest before extraction, and the binary digest against the
// executable right before it is handed back to be spawned, so a poisoned
// tool-cache entry on a long-lived self-hosted runner cannot slip through.

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import * as core from '@actions/core';
import * as tc from '@actions/tool-cache';

import { assertSha256, parseSha256Sums, sha256File } from './hash';
import type { CliSha256Override, Config } from './inputs';
import {
  archiveName,
  archiveStem,
  archiveUrl,
  binaryName,
  binaryPathInExtract,
  isWindows,
  sha256sumsUrl,
  type Target,
} from './platform';
import { CLI_PINS, DEFAULT_CLI_VERSION } from './pins';

const TOOL_NAME = 'cardanowall';

/** The subset of `@actions/tool-cache` the acquisition path needs; injectable for tests. */
export interface ToolCache {
  find(tool: string, version: string, arch: string): string;
  downloadTool(url: string): Promise<string>;
  extractTar(file: string): Promise<string>;
  extractZip(file: string): Promise<string>;
  cacheDir(sourceDir: string, tool: string, version: string, arch: string): Promise<string>;
}

const defaultToolCache: ToolCache = {
  find: (tool, version, arch) => tc.find(tool, version, arch),
  downloadTool: (url) => tc.downloadTool(url),
  extractTar: (file) => tc.extractTar(file),
  extractZip: (file) => tc.extractZip(file),
  cacheDir: (sourceDir, tool, version, arch) => tc.cacheDir(sourceDir, tool, version, arch),
};

/**
 * The archive digest a `cli-sha256` override supplies for a given target. Null
 * only when no override was supplied at all. If an override WAS supplied but its
 * per-target map omits the current target, that is a hard failure rather than a
 * silent skip: the user asked to pin, so an unpinned target must not slip through.
 */
export function resolveOverrideSha(
  override: CliSha256Override | null,
  target: Target,
): string | null {
  if (override === null) return null;
  if (override.kind === 'single') return override.sha256;
  const digest = override.byTarget.get(target);
  if (digest === undefined) {
    throw new Error(
      `cli-sha256 was provided but has no entry for the current target ${target}. ` +
        `Add "${target}=<sha256>" or remove cli-sha256.`,
    );
  }
  return digest;
}

function binaryInDir(dir: string, target: Target): string {
  return path.join(dir, binaryName(target));
}

async function ensureExecutable(binaryPath: string): Promise<void> {
  try {
    await fs.chmod(binaryPath, 0o755);
  } catch {
    // chmod is a no-op on Windows; a failure there is not fatal.
  }
}

/**
 * Reuse a cross-run tool-cache entry only if its binary re-verifies against the
 * trusted pin. A mismatch evicts the entry. Returns null to fall through to a
 * fresh download.
 */
async function useCachedIfValid(
  toolCache: ToolCache,
  version: string,
  target: Target,
  pinnedBinary: string,
): Promise<string | null> {
  const cachedDir = toolCache.find(TOOL_NAME, version, target);
  if (cachedDir === '') return null;
  const cachedBinary = binaryInDir(cachedDir, target);
  if ((await sha256File(cachedBinary)) === pinnedBinary) {
    await ensureExecutable(cachedBinary);
    core.info(
      `Using cached cardanowall ${version} (${target}); re-verified binary SHA-256 (${pinnedBinary}).`,
    );
    return cachedBinary;
  }
  core.warning(`Cached cardanowall ${version} failed verification; re-downloading.`);
  await fs.rm(cachedDir, { recursive: true, force: true });
  return null;
}

/**
 * Populate the tool-cache and return the cached binary, re-verified against the
 * pin. If another job populated the cache first (a self-hosted race), reuse and
 * re-verify that copy instead of failing.
 */
async function cacheAndVerify(
  toolCache: ToolCache,
  stemDir: string,
  version: string,
  target: Target,
  pinnedBinary: string,
): Promise<string> {
  let cachedRoot: string;
  try {
    cachedRoot = await toolCache.cacheDir(stemDir, TOOL_NAME, version, target);
  } catch (error) {
    const found = toolCache.find(TOOL_NAME, version, target);
    if (found === '') throw error;
    cachedRoot = found;
  }
  const cachedBinary = binaryInDir(cachedRoot, target);
  assertSha256(
    await sha256File(cachedBinary),
    pinnedBinary,
    `cardanowall ${version} binary (cached)`,
  );
  return cachedBinary;
}

async function acquirePreinstalled(cliPath: string, override: string | null): Promise<string> {
  try {
    await fs.access(cliPath);
  } catch {
    throw new Error(`cli-path: '${cliPath}' does not exist or is not readable`);
  }
  if (override !== null) {
    const actual = await sha256File(cliPath);
    assertSha256(actual, override, 'cli-path binary');
    core.info('cli-path binary verified against cli-sha256.');
  } else {
    core.info(
      `Using preinstalled cardanowall at ${cliPath} (no cli-sha256 given; hash check skipped).`,
    );
  }
  await ensureExecutable(cliPath);
  return cliPath;
}

/**
 * Resolve the target's expected archive digest, consulting (in order): the
 * embedded pin for the default version, the user's `cli-sha256` override, and
 * the release `SHA256SUMS` manifest for a non-default version. Conflicts between
 * any two sources are a hard failure, a supply-chain alarm, not a warning.
 */
export async function resolveExpectedArchive(
  version: string,
  target: Target,
  isDefault: boolean,
  pinnedArchive: string | null,
  override: string | null,
  toolCache: ToolCache,
): Promise<string> {
  let expected = pinnedArchive;
  if (override !== null) {
    if (expected !== null && override !== expected) {
      throw new Error(
        `cli-sha256 for ${target} (${override}) disagrees with the pinned archive digest (${expected})`,
      );
    }
    expected = override;
  }

  if (!isDefault) {
    const sumsPath = await toolCache.downloadTool(sha256sumsUrl(version));
    const sums = parseSha256Sums(await fs.readFile(sumsPath, 'utf8'));
    const sumsDigest = sums.get(archiveName(version, target));
    if (sumsDigest === undefined) {
      throw new Error(
        `the SHA256SUMS for v${version} has no entry for ${archiveName(version, target)}`,
      );
    }
    if (expected !== null && sumsDigest !== expected) {
      throw new Error(
        `the release SHA256SUMS (${sumsDigest}) disagrees with the pinned/overridden digest (${expected}) for ${archiveName(version, target)}, refusing`,
      );
    }
    if (expected === null) {
      expected = sumsDigest;
      core.notice(
        `cardanowall CLI v${version} is not the pinned default; trusting its release SHA256SUMS. ` +
          'Set cli-sha256 to pin the archive digest explicitly.',
      );
    }
    core.info(
      `Verified cardanowall v${version} archive digest against the release SHA256SUMS` +
        `${override !== null ? ' and the cli-sha256 pin' : ''}.`,
    );
  }

  if (expected === null) {
    throw new Error(`internal: no expected archive digest for cardanowall ${version} (${target})`);
  }
  return expected;
}

/**
 * Return an absolute path to a cardanowall binary whose digest is verified.
 * `toolCache` is injectable so the orchestration can be exercised without the
 * network; production callers pass nothing.
 */
export async function acquireCli(
  config: Config,
  target: Target,
  toolCache: ToolCache = defaultToolCache,
): Promise<string> {
  const override = resolveOverrideSha(config.cliSha256, target);
  if (config.cliPath !== null) {
    return acquirePreinstalled(config.cliPath, override);
  }

  const version = config.cliVersion ?? DEFAULT_CLI_VERSION;
  const isDefault = version === DEFAULT_CLI_VERSION;
  const pin = isDefault ? CLI_PINS[target] : undefined;
  const pinnedBinary = pin?.binarySha256 ?? null;

  const expectedArchive = await resolveExpectedArchive(
    version,
    target,
    isDefault,
    pin?.archiveSha256 ?? null,
    override,
    toolCache,
  );
  if (isDefault) {
    core.info(
      `Verifying cardanowall ${version} against the action's embedded archive + binary digests.`,
    );
  }

  // Cross-run tool-cache is trusted only when we hold an independent binary
  // digest to re-verify against, which today means the embedded pin for the
  // default version. A non-default version's release manifest pins archives, not
  // the extracted binary, so it is re-downloaded and archive-verified every run
  // rather than accepted from a cache on weaker authority.
  if (pinnedBinary !== null) {
    const cached = await useCachedIfValid(toolCache, version, target, pinnedBinary);
    if (cached !== null) return cached;
  }

  core.info(`Downloading cardanowall ${version} (${target}) ...`);
  const archivePath = await toolCache.downloadTool(archiveUrl(version, target));
  assertSha256(await sha256File(archivePath), expectedArchive, `cardanowall ${version} archive`);
  core.info(`Verified downloaded archive SHA-256 (${expectedArchive}).`);

  const extractDir = isWindows(target)
    ? await toolCache.extractZip(archivePath)
    : await toolCache.extractTar(archivePath);
  const extractedBinary = binaryPathInExtract(extractDir, version, target);
  const extractedDigest = await sha256File(extractedBinary);

  if (pinnedBinary !== null) {
    assertSha256(extractedDigest, pinnedBinary, `cardanowall ${version} binary`);
    core.info(`Verified extracted binary SHA-256 (${extractedDigest}).`);
    const stemDir = path.join(extractDir, archiveStem(version, target));
    const cachedBinary = await cacheAndVerify(toolCache, stemDir, version, target, pinnedBinary);
    await ensureExecutable(cachedBinary);
    core.info(`cardanowall ${version} (${target}) ready.`);
    return cachedBinary;
  }

  // Non-default: the archive was SHA256SUMS-verified, so the extracted binary is
  // trusted transitively. Spawn it from the extraction directory; it is not
  // cached across runs because there is no pin to re-verify a future hit against.
  core.info(`Extracted binary SHA-256 (${extractedDigest}) from the SHA256SUMS-verified archive.`);
  await ensureExecutable(extractedBinary);
  core.info(`cardanowall ${version} (${target}) ready.`);
  return extractedBinary;
}
