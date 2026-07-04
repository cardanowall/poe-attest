// Platform → Rust target-triple resolution and the release-asset naming that
// follows from it. The CLI ships one static-musl Linux binary per arch (runs on
// any distro), native macOS binaries, and an MSVC Windows binary. Everything the
// downloader needs to name and locate an asset is derived here so the acquire
// path stays free of string-building.

import * as path from 'node:path';

export const SUPPORTED_TARGETS = [
  'x86_64-unknown-linux-musl',
  'aarch64-unknown-linux-musl',
  'x86_64-apple-darwin',
  'aarch64-apple-darwin',
  'x86_64-pc-windows-msvc',
] as const;

export type Target = (typeof SUPPORTED_TARGETS)[number];

const TARGET_BY_PLATFORM_ARCH: Record<string, Target | undefined> = {
  'linux:x64': 'x86_64-unknown-linux-musl',
  'linux:arm64': 'aarch64-unknown-linux-musl',
  'darwin:x64': 'x86_64-apple-darwin',
  'darwin:arm64': 'aarch64-apple-darwin',
  'win32:x64': 'x86_64-pc-windows-msvc',
};

/**
 * Resolve the running platform to a supported target triple, or throw a message
 * that names what runs and what is supported. Arguments are injectable for
 * tests; production callers pass nothing and get `process.platform`/`arch`.
 */
export function resolveTarget(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): Target {
  const target = TARGET_BY_PLATFORM_ARCH[`${platform}:${arch}`];
  if (target === undefined) {
    throw new Error(
      `unsupported runner platform ${platform}/${arch}. The cardanowall CLI ships for: ` +
        `${SUPPORTED_TARGETS.join(', ')} (Linux x64/arm64, macOS x64/arm64, Windows x64). ` +
        'Use a supported runner, or set the cli-path input to a preinstalled binary.',
    );
  }
  return target;
}

export function isWindows(target: Target): boolean {
  return target.includes('windows');
}

/** The binary's filename inside the archive (`cardanowall` / `cardanowall.exe`). */
export function binaryName(target: Target): string {
  return isWindows(target) ? 'cardanowall.exe' : 'cardanowall';
}

/** Archive extension: `.zip` on Windows, `.tar.gz` elsewhere. */
export function archiveExtension(target: Target): string {
  return isWindows(target) ? 'zip' : 'tar.gz';
}

/** The archive's top-level directory name (also the archive stem). */
export function archiveStem(version: string, target: Target): string {
  return `cardanowall-v${version}-${target}`;
}

/** The release-asset filename, e.g. `cardanowall-v0.9.0-aarch64-apple-darwin.tar.gz`. */
export function archiveName(version: string, target: Target): string {
  return `${archiveStem(version, target)}.${archiveExtension(target)}`;
}

/** The GitHub release download base for a CLI version. */
export function releaseBaseUrl(version: string): string {
  return `https://github.com/cardanowall/label-309-cli/releases/download/v${version}`;
}

/** The download URL for a target's archive. */
export function archiveUrl(version: string, target: Target): string {
  return `${releaseBaseUrl(version)}/${archiveName(version, target)}`;
}

/** The download URL for the release's `SHA256SUMS` manifest. */
export function sha256sumsUrl(version: string): string {
  return `${releaseBaseUrl(version)}/SHA256SUMS`;
}

/** Absolute path to the extracted binary given the directory an archive was unpacked into. */
export function binaryPathInExtract(extractDir: string, version: string, target: Target): string {
  return path.join(extractDir, archiveStem(version, target), binaryName(target));
}
