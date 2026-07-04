import { describe, expect, it } from 'vitest';

import {
  archiveName,
  archiveUrl,
  binaryName,
  binaryPathInExtract,
  resolveTarget,
  sha256sumsUrl,
} from './platform';

describe('resolveTarget', () => {
  it('maps every supported platform/arch pair to its triple', () => {
    expect(resolveTarget('linux', 'x64')).toBe('x86_64-unknown-linux-musl');
    expect(resolveTarget('linux', 'arm64')).toBe('aarch64-unknown-linux-musl');
    expect(resolveTarget('darwin', 'x64')).toBe('x86_64-apple-darwin');
    expect(resolveTarget('darwin', 'arm64')).toBe('aarch64-apple-darwin');
    expect(resolveTarget('win32', 'x64')).toBe('x86_64-pc-windows-msvc');
  });

  it('throws a listing error on an unsupported platform', () => {
    expect(() => resolveTarget('linux', 'ia32')).toThrow(/unsupported runner platform linux\/ia32/);
    expect(() => resolveTarget('freebsd', 'x64')).toThrow(/x86_64-unknown-linux-musl/);
    expect(() => resolveTarget('win32', 'arm64')).toThrow(/cli-path/);
  });
});

describe('release-asset naming', () => {
  it('builds unix archive names with .tar.gz', () => {
    expect(archiveName('0.9.0', 'aarch64-apple-darwin')).toBe(
      'cardanowall-v0.9.0-aarch64-apple-darwin.tar.gz',
    );
  });

  it('builds the windows archive name with .zip', () => {
    expect(archiveName('0.9.0', 'x86_64-pc-windows-msvc')).toBe(
      'cardanowall-v0.9.0-x86_64-pc-windows-msvc.zip',
    );
  });

  it('names the binary with .exe only on windows', () => {
    expect(binaryName('x86_64-apple-darwin')).toBe('cardanowall');
    expect(binaryName('x86_64-pc-windows-msvc')).toBe('cardanowall.exe');
  });

  it('builds the archive and SHA256SUMS download URLs', () => {
    expect(archiveUrl('0.9.0', 'x86_64-unknown-linux-musl')).toBe(
      'https://github.com/cardanowall/label-309-cli/releases/download/v0.9.0/cardanowall-v0.9.0-x86_64-unknown-linux-musl.tar.gz',
    );
    expect(sha256sumsUrl('0.9.0')).toBe(
      'https://github.com/cardanowall/label-309-cli/releases/download/v0.9.0/SHA256SUMS',
    );
  });

  it('locates the extracted binary inside the stem directory', () => {
    expect(binaryPathInExtract('/tmp/x', '0.9.0', 'aarch64-apple-darwin')).toBe(
      '/tmp/x/cardanowall-v0.9.0-aarch64-apple-darwin/cardanowall',
    );
    expect(binaryPathInExtract('/tmp/x', '0.9.0', 'x86_64-pc-windows-msvc')).toBe(
      '/tmp/x/cardanowall-v0.9.0-x86_64-pc-windows-msvc/cardanowall.exe',
    );
  });
});
