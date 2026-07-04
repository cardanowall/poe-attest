// Input reading, normalization, and validation. The action validates everything
// itself with crisp messages rather than deferring to the CLI's exit-4, so a
// misconfigured workflow fails fast and legibly. The `readInputs` shell is the
// only impure part (it reads the Actions runtime); `resolveConfig` and the
// parse helpers are pure and unit-tested directly.

import * as path from 'node:path';

import * as core from '@actions/core';

import { SUPPORTED_TARGETS, type Target } from './platform';
import type { Network } from './urls';

export type Mode = 'paths' | 'commits' | 'leaves';
export type Publish = 'full-tree' | 'root';
export type WaitTarget = 'confirmed' | 'submitted';
export type UploadArtifact = 'auto' | 'true' | 'false';

/** An explicit SHA-256 pin supplied for a non-default `cli-version`. */
export type CliSha256Override =
  | { kind: 'single'; sha256: string }
  | { kind: 'perTarget'; byTarget: Map<Target, string> };

/**
 * The raw, unvalidated inputs exactly as read from the Actions runtime. Every
 * optional field is the raw string (booleans and enums included), so an empty
 * value from a reusable workflow (`with: { flag: ${{ inputs.x }} }` where `x` is
 * empty) is treated uniformly by {@link resolveConfig} as "use the default",
 * rather than crashing `core.getBooleanInput`.
 */
export interface RawInputs {
  gatewayUrl: string;
  apiKey: string;
  paths: string;
  commits: string;
  leaves: string;
  publish: string;
  anchorManifest: string;
  manifestOut: string;
  seed: string;
  wait: string;
  timeout: string;
  maxUsd: string;
  supersedes: string;
  idempotencyKey: string;
  certificates: string;
  network: string;
  receiptOut: string;
  uploadArtifact: string;
  artifactName: string;
  attachToRelease: string;
  releaseTag: string;
  overwriteReleaseAssets: string;
  githubToken: string;
  verifyBase: string;
  cliVersion: string;
  cliSha256: string;
  cliPath: string;
  workingDirectory: string;
  failOnTimeout: string;
}

/** The validated, normalized configuration the rest of the action runs on. */
export interface Config {
  gatewayUrl: string;
  apiKey: string;
  mode: Mode;
  paths: string[];
  commits: string;
  leaves: string[];
  publish: Publish;
  anchorManifest: boolean;
  seed: string | null;
  wait: WaitTarget;
  timeout: number;
  maxUsd: string | null;
  supersedes: string | null;
  idempotencyKey: string;
  certificates: boolean;
  network: Network;
  workingDirectory: string;
  receiptOut: string;
  manifestOut: string;
  certificatesDir: string;
  uploadArtifact: UploadArtifact;
  artifactName: string;
  attachToRelease: boolean;
  releaseTag: string | null;
  overwriteReleaseAssets: boolean;
  githubToken: string;
  verifyBase: string;
  cliVersion: string | null;
  cliSha256: CliSha256Override | null;
  cliPath: string | null;
  failOnTimeout: boolean;
}

const HEX64 = /^[0-9a-f]{64}$/;
const MAX_USD = /^\$?(\d+\.?\d*|\.\d+)$/;

/** Split a multiline input into trimmed, non-empty lines (CRLF-tolerant). */
export function parseMultiline(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/**
 * Split a multiline `paths` input into glob lines. Unlike {@link parseMultiline},
 * this only strips a trailing CR and drops whitespace-only lines; it preserves
 * any other leading/trailing whitespace, because a filename can legitimately
 * contain significant edge whitespace.
 */
export function parseGlobLines(raw: string): string[] {
  return raw
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line.trim() !== '');
}

function assertHex64(value: string, label: string): void {
  if (!HEX64.test(value)) {
    throw new Error(`${label}: expected a 64-character lowercase hex digest, got '${value}'`);
  }
}

function parseEnum<T extends string>(name: string, value: string, allowed: readonly T[]): T {
  if ((allowed as readonly string[]).includes(value)) return value as T;
  throw new Error(`${name}: expected one of ${allowed.join(' | ')}, got '${value}'`);
}

/**
 * Resolve a boolean input. An empty value falls back to `fallback` (so an unset
 * or empty-string override uses the action default); any other value must be a
 * YAML core-schema boolean (`true`/`false`, case-insensitive) or it errors.
 */
function resolveBoolean(name: string, raw: string, fallback: boolean): boolean {
  const value = raw.trim().toLowerCase();
  if (value === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name}: expected true or false, got '${raw.trim()}'`);
}

/** Resolve an enum input; an empty value falls back to `fallback`. */
function resolveEnum<T extends string>(
  name: string,
  raw: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const value = raw.trim();
  if (value === '') return fallback;
  return parseEnum(name, value, allowed);
}

/**
 * Parse the `cli-sha256` input: either a single archive digest for the current
 * platform, or one `<target>=<sha256>` per comma/newline for multi-platform
 * pinning. Returns null when unset.
 */
export function parseCliSha256(raw: string): CliSha256Override | null {
  const entries = raw
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
  if (entries.length === 0) return null;

  const anyAssignment = entries.some((entry) => entry.includes('='));
  if (!anyAssignment) {
    const [first] = entries;
    if (entries.length !== 1 || first === undefined) {
      throw new Error(
        "cli-sha256: provide a single SHA-256 for the current platform, or one '<target>=<sha256>' entry per line/comma",
      );
    }
    const sha256 = first.toLowerCase();
    assertHex64(sha256, 'cli-sha256');
    return { kind: 'single', sha256 };
  }

  const byTarget = new Map<Target, string>();
  for (const entry of entries) {
    const eq = entry.indexOf('=');
    if (eq < 0) {
      throw new Error(`cli-sha256: mixed formats, '${entry}' is missing a '<target>=' prefix`);
    }
    const target = entry.slice(0, eq).trim();
    const sha256 = entry
      .slice(eq + 1)
      .trim()
      .toLowerCase();
    if (!(SUPPORTED_TARGETS as readonly string[]).includes(target)) {
      throw new Error(
        `cli-sha256: unknown target '${target}'. Supported: ${SUPPORTED_TARGETS.join(', ')}`,
      );
    }
    if (byTarget.has(target as Target)) {
      throw new Error(`cli-sha256: duplicate entry for target '${target}'`);
    }
    assertHex64(sha256, `cli-sha256 (${target})`);
    byTarget.set(target as Target, sha256);
  }
  return { kind: 'perTarget', byTarget };
}

function resolveMode(paths: string[], commits: string, leaves: string[]): Mode {
  const present: Mode[] = [];
  if (paths.length > 0) present.push('paths');
  if (commits.trim() !== '') present.push('commits');
  if (leaves.length > 0) present.push('leaves');
  const [only] = present;
  if (present.length === 1 && only !== undefined) return only;
  const which = present.length === 0 ? 'none were set' : `${present.join(' + ')} were set`;
  throw new Error(
    `exactly one of paths / commits / leaves must be set (${which}). ` +
      'paths = files or globs, commits = a git rev-list range, leaves = precomputed 64-hex digests.',
  );
}

function parseHttpUrl(name: string, value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name}: '${value}' is not a valid URL`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`${name}: expected an http(s) URL, got '${value}'`);
  }
  return value;
}

/** Whether a URL host is a loopback address (dev-gateway http is allowed only here). */
function isLoopbackHost(host: string): boolean {
  const bare = host.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
  return (
    bare === 'localhost' ||
    bare === '::1' ||
    bare === '0.0.0.0' ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(bare)
  );
}

/**
 * Parse the gateway URL. It carries the API key, so it must be https; plain http
 * is permitted only for loopback hosts so local dev gateways and e2e still work.
 */
function parseGatewayUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`gateway-url: '${value}' is not a valid URL`);
  }
  if (url.protocol === 'https:') return value;
  if (url.protocol === 'http:' && isLoopbackHost(url.hostname)) return value;
  throw new Error(
    `gateway-url must use https (the API key is sent to it); plain http is allowed only for ` +
      `loopback hosts (localhost, 127.0.0.0/8, [::1]). Got '${value}'.`,
  );
}

/**
 * Validate and normalize raw inputs into a {@link Config}. Pure: all filesystem
 * paths are resolved against `baseCwd` (defaulting to the process cwd) so tests
 * can pin a deterministic root.
 */
export function resolveConfig(raw: RawInputs, baseCwd: string = process.cwd()): Config {
  const gatewayUrl = parseGatewayUrl(raw.gatewayUrl.trim());
  if (raw.apiKey.trim() === '') {
    throw new Error('api-key: required, but empty');
  }

  const paths = parseGlobLines(raw.paths);
  const leaves = parseMultiline(raw.leaves);
  const commits = raw.commits.trim();
  const mode = resolveMode(paths, commits, leaves);

  for (const leaf of leaves) assertHex64(leaf.toLowerCase(), 'leaves');
  const normalizedLeaves = leaves.map((leaf) => leaf.toLowerCase());

  const publish = resolveEnum<Publish>('publish', raw.publish, ['full-tree', 'root'], 'full-tree');
  const wait = resolveEnum<WaitTarget>('wait', raw.wait, ['confirmed', 'submitted'], 'confirmed');
  const network = resolveEnum<Network>('network', raw.network, ['mainnet', 'preprod'], 'mainnet');
  const uploadArtifact = resolveEnum<UploadArtifact>(
    'upload-artifact',
    raw.uploadArtifact,
    ['auto', 'true', 'false'],
    'auto',
  );

  const anchorManifest = resolveBoolean('anchor-manifest', raw.anchorManifest, false);
  const certificates = resolveBoolean('certificates', raw.certificates, false);
  const attachToRelease = resolveBoolean('attach-to-release', raw.attachToRelease, false);
  const overwriteReleaseAssets = resolveBoolean(
    'overwrite-release-assets',
    raw.overwriteReleaseAssets,
    true,
  );
  const failOnTimeout = resolveBoolean('fail-on-timeout', raw.failOnTimeout, false);

  if (anchorManifest && mode !== 'paths') {
    throw new Error('anchor-manifest applies only to paths mode (it anchors the file manifest)');
  }
  if (certificates && wait !== 'confirmed') {
    throw new Error(
      'certificates requires wait=confirmed, an inclusion certificate anchors a confirmed block',
    );
  }

  const timeoutRaw = raw.timeout.trim();
  let timeout = 600;
  if (timeoutRaw !== '') {
    if (!/^\d+$/.test(timeoutRaw) || Number(timeoutRaw) <= 0) {
      throw new Error(
        `timeout: expected a positive integer number of seconds, got '${raw.timeout}'`,
      );
    }
    timeout = Number(timeoutRaw);
  }

  const maxUsdRaw = raw.maxUsd.trim();
  let maxUsd: string | null = null;
  if (maxUsdRaw !== '') {
    if (!MAX_USD.test(maxUsdRaw)) {
      throw new Error(`max-usd: expected a USD amount like '1.50', got '${maxUsdRaw}'`);
    }
    maxUsd = maxUsdRaw;
  }

  const supersedesRaw = raw.supersedes.trim().toLowerCase();
  let supersedes: string | null = null;
  if (supersedesRaw !== '') {
    assertHex64(supersedesRaw, 'supersedes');
    supersedes = supersedesRaw;
  }

  const idempotencyKey = raw.idempotencyKey.trim() === '' ? 'auto' : raw.idempotencyKey.trim();

  const cliPathRaw = raw.cliPath.trim();
  const cliVersionRaw = raw.cliVersion.trim();
  const cliSha256 = parseCliSha256(raw.cliSha256);
  if (cliPathRaw !== '' && cliVersionRaw !== '') {
    throw new Error(
      'cli-path and cli-version are mutually exclusive, cli-path uses a preinstalled binary',
    );
  }

  const workingDirectory = path.resolve(baseCwd, raw.workingDirectory.trim() || '.');
  const receiptOut = path.resolve(workingDirectory, raw.receiptOut.trim() || 'poe-receipt.json');
  const manifestOut = path.resolve(workingDirectory, raw.manifestOut.trim() || 'poe-manifest.json');
  const certificatesDir = path.resolve(workingDirectory, 'poe-certificates');

  const config: Config = {
    gatewayUrl,
    apiKey: raw.apiKey,
    mode,
    paths,
    commits,
    leaves: normalizedLeaves,
    publish,
    anchorManifest,
    seed: raw.seed === '' ? null : raw.seed,
    wait,
    timeout,
    maxUsd,
    supersedes,
    idempotencyKey,
    certificates,
    network,
    workingDirectory,
    receiptOut,
    manifestOut,
    certificatesDir,
    uploadArtifact,
    artifactName: raw.artifactName.trim() || 'poe-attest',
    attachToRelease,
    releaseTag: raw.releaseTag.trim() === '' ? null : raw.releaseTag.trim(),
    overwriteReleaseAssets,
    githubToken: raw.githubToken,
    verifyBase: parseHttpUrl('verify-base', raw.verifyBase.trim() || 'https://cardanowall.com'),
    cliVersion: cliVersionRaw === '' ? null : cliVersionRaw,
    cliSha256,
    // Resolve cli-path to an absolute path against the action process cwd
    // (GITHUB_WORKSPACE) so the same file is verified and spawned regardless of
    // the working-directory the child runs in.
    cliPath: cliPathRaw === '' ? null : path.resolve(baseCwd, cliPathRaw),
    failOnTimeout,
  };
  return config;
}

/** Read every input from the Actions runtime, mask secrets, and resolve a {@link Config}. */
export function readInputs(): Config {
  const apiKey = core.getInput('api-key', { required: true });
  if (apiKey !== '') core.setSecret(apiKey);
  const seed = core.getInput('seed');
  if (seed !== '') core.setSecret(seed);

  const raw: RawInputs = {
    gatewayUrl: core.getInput('gateway-url', { required: true }),
    apiKey,
    paths: core.getInput('paths'),
    commits: core.getInput('commits'),
    leaves: core.getInput('leaves'),
    publish: core.getInput('publish'),
    anchorManifest: core.getInput('anchor-manifest'),
    manifestOut: core.getInput('manifest-out'),
    seed,
    wait: core.getInput('wait'),
    timeout: core.getInput('timeout'),
    maxUsd: core.getInput('max-usd'),
    supersedes: core.getInput('supersedes'),
    idempotencyKey: core.getInput('idempotency-key'),
    certificates: core.getInput('certificates'),
    network: core.getInput('network'),
    receiptOut: core.getInput('receipt-out'),
    uploadArtifact: core.getInput('upload-artifact'),
    artifactName: core.getInput('artifact-name'),
    attachToRelease: core.getInput('attach-to-release'),
    releaseTag: core.getInput('release-tag'),
    overwriteReleaseAssets: core.getInput('overwrite-release-assets'),
    githubToken: core.getInput('github-token'),
    verifyBase: core.getInput('verify-base'),
    cliVersion: core.getInput('cli-version'),
    cliSha256: core.getInput('cli-sha256'),
    cliPath: core.getInput('cli-path'),
    workingDirectory: core.getInput('working-directory'),
    failOnTimeout: core.getInput('fail-on-timeout'),
  };
  return resolveConfig(raw);
}
