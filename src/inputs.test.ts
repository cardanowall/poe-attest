import { describe, expect, it } from 'vitest';

import {
  parseCliSha256,
  parseGlobLines,
  parseMultiline,
  resolveConfig,
  type RawInputs,
} from './inputs';

const HEX = 'a'.repeat(64);

function baseRaw(overrides: Partial<RawInputs> = {}): RawInputs {
  return {
    gatewayUrl: 'https://cardanowall.com/api/v1',
    apiKey: 'cw_test_key',
    paths: 'dist/app.tar.gz',
    commits: '',
    leaves: '',
    publish: 'full-tree',
    anchorManifest: 'false',
    manifestOut: 'poe-manifest.json',
    seed: '',
    wait: 'confirmed',
    timeout: '600',
    maxUsd: '',
    supersedes: '',
    idempotencyKey: 'auto',
    certificates: 'false',
    network: 'mainnet',
    receiptOut: 'poe-receipt.json',
    uploadArtifact: 'auto',
    artifactName: 'poe-attest',
    attachToRelease: 'false',
    releaseTag: '',
    overwriteReleaseAssets: 'true',
    githubToken: 'gh_token',
    verifyBase: 'https://cardanowall.com',
    cliVersion: '',
    cliSha256: '',
    cliPath: '',
    workingDirectory: '',
    failOnTimeout: 'false',
    ...overrides,
  };
}

describe('parseMultiline', () => {
  it('trims lines, drops blanks, and survives CRLF', () => {
    expect(parseMultiline('a\r\n\r\n  b  \nc\n')).toEqual(['a', 'b', 'c']);
  });

  it('preserves spaces inside a single glob line', () => {
    expect(parseMultiline('src/my dir/**\ndist/*.tgz')).toEqual(['src/my dir/**', 'dist/*.tgz']);
  });

  it('returns an empty list for a blank input', () => {
    expect(parseMultiline('   \n\n')).toEqual([]);
  });
});

describe('parseGlobLines', () => {
  it('preserves edge whitespace on a path but strips trailing CR and blank lines', () => {
    expect(parseGlobLines('dist/*.tgz \r\n  \n\t\n src/a.txt')).toEqual([
      'dist/*.tgz ',
      ' src/a.txt',
    ]);
  });

  it('keeps interior spaces in a glob', () => {
    expect(parseGlobLines('src/my dir/**')).toEqual(['src/my dir/**']);
  });
});

describe('resolveConfig security hardening', () => {
  it('resolves cli-path to an absolute path against the base cwd', () => {
    const abs = resolveConfig(baseRaw({ cliPath: 'bin/cardanowall' }), '/work').cliPath;
    expect(abs).toBe('/work/bin/cardanowall');
    expect(resolveConfig(baseRaw({ cliPath: '/opt/cw' }), '/work').cliPath).toBe('/opt/cw');
  });

  it('requires https for gateway-url, allowing http only for loopback', () => {
    expect(
      resolveConfig(baseRaw({ gatewayUrl: 'https://gw.example/api/v1' }), '/work').gatewayUrl,
    ).toBe('https://gw.example/api/v1');
    expect(
      resolveConfig(baseRaw({ gatewayUrl: 'http://127.0.0.1:8080/api/v1' }), '/work').gatewayUrl,
    ).toBe('http://127.0.0.1:8080/api/v1');
    expect(
      resolveConfig(baseRaw({ gatewayUrl: 'http://localhost:8080/api/v1' }), '/work').gatewayUrl,
    ).toBe('http://localhost:8080/api/v1');
    expect(() =>
      resolveConfig(baseRaw({ gatewayUrl: 'http://gw.example/api/v1' }), '/work'),
    ).toThrow(/gateway-url must use https/);
  });
});

describe('resolveConfig mode inference', () => {
  it('infers paths mode', () => {
    const config = resolveConfig(baseRaw({ paths: 'a\nb' }), '/work');
    expect(config.mode).toBe('paths');
    expect(config.paths).toEqual(['a', 'b']);
  });

  it('infers commits mode', () => {
    const config = resolveConfig(baseRaw({ paths: '', commits: 'v1..v2' }), '/work');
    expect(config.mode).toBe('commits');
    expect(config.commits).toBe('v1..v2');
  });

  it('infers leaves mode and lowercases digests', () => {
    const config = resolveConfig(baseRaw({ paths: '', leaves: HEX.toUpperCase() }), '/work');
    expect(config.mode).toBe('leaves');
    expect(config.leaves).toEqual([HEX]);
  });

  it('rejects when none of paths/commits/leaves is set', () => {
    expect(() => resolveConfig(baseRaw({ paths: '' }), '/work')).toThrow(/none were set/);
  });

  it('rejects when more than one mode is set, naming them', () => {
    expect(() => resolveConfig(baseRaw({ paths: 'a', commits: 'HEAD' }), '/work')).toThrow(
      /paths \+ commits were set/,
    );
  });

  it('rejects a non-hex leaf', () => {
    expect(() => resolveConfig(baseRaw({ paths: '', leaves: 'nothex' }), '/work')).toThrow(
      /leaves: expected a 64-character/,
    );
  });
});

describe('resolveConfig validation', () => {
  it('requires certificates to run with wait=confirmed', () => {
    expect(() =>
      resolveConfig(baseRaw({ certificates: 'true', wait: 'submitted' }), '/work'),
    ).toThrow(/certificates requires wait=confirmed/);
  });

  it('allows certificates with wait=confirmed and resolves the dir', () => {
    const config = resolveConfig(baseRaw({ certificates: 'true', wait: 'confirmed' }), '/work');
    expect(config.certificatesDir).toBe('/work/poe-certificates');
  });

  it('restricts anchor-manifest to paths mode', () => {
    expect(() =>
      resolveConfig(baseRaw({ paths: '', commits: 'HEAD', anchorManifest: 'true' }), '/work'),
    ).toThrow(/anchor-manifest applies only to paths mode/);
  });

  it('rejects a non-positive or non-integer timeout', () => {
    expect(() => resolveConfig(baseRaw({ timeout: '0' }), '/work')).toThrow(/positive integer/);
    expect(() => resolveConfig(baseRaw({ timeout: '1.5' }), '/work')).toThrow(/positive integer/);
    expect(() => resolveConfig(baseRaw({ timeout: 'ten' }), '/work')).toThrow(/positive integer/);
  });

  it('accepts well-formed max-usd and rejects garbage', () => {
    expect(resolveConfig(baseRaw({ maxUsd: '1.50' }), '/work').maxUsd).toBe('1.50');
    expect(resolveConfig(baseRaw({ maxUsd: '$0.02' }), '/work').maxUsd).toBe('$0.02');
    expect(() => resolveConfig(baseRaw({ maxUsd: '1,50' }), '/work')).toThrow(/max-usd/);
  });

  it('validates supersedes as a 64-hex tx and lowercases it', () => {
    expect(resolveConfig(baseRaw({ supersedes: HEX.toUpperCase() }), '/work').supersedes).toBe(HEX);
    expect(() => resolveConfig(baseRaw({ supersedes: 'deadbeef' }), '/work')).toThrow(/supersedes/);
  });

  it('rejects a non-http gateway-url', () => {
    expect(() => resolveConfig(baseRaw({ gatewayUrl: 'ftp://x' }), '/work')).toThrow(/gateway-url/);
    expect(() => resolveConfig(baseRaw({ gatewayUrl: 'not a url' }), '/work')).toThrow(
      /gateway-url/,
    );
  });

  it('defaults idempotency-key to auto and passes a seed through', () => {
    expect(resolveConfig(baseRaw({ idempotencyKey: '' }), '/work').idempotencyKey).toBe('auto');
    expect(resolveConfig(baseRaw({ seed: '' }), '/work').seed).toBeNull();
    expect(resolveConfig(baseRaw({ seed: 'L309-SEED-1abc' }), '/work').seed).toBe('L309-SEED-1abc');
  });

  it('resolves output paths against the working directory', () => {
    const config = resolveConfig(
      baseRaw({ workingDirectory: 'sub', receiptOut: 'r.json', manifestOut: 'm.json' }),
      '/work',
    );
    expect(config.workingDirectory).toBe('/work/sub');
    expect(config.receiptOut).toBe('/work/sub/r.json');
    expect(config.manifestOut).toBe('/work/sub/m.json');
  });

  it('rejects cli-path together with cli-version', () => {
    expect(() =>
      resolveConfig(baseRaw({ cliPath: '/opt/cardanowall', cliVersion: '0.9.0' }), '/work'),
    ).toThrow(/mutually exclusive/);
  });

  it('accepts cli-path on its own', () => {
    const config = resolveConfig(baseRaw({ cliPath: '/opt/cardanowall' }), '/work');
    expect(config.cliPath).toBe('/opt/cardanowall');
    expect(config.cliVersion).toBeNull();
  });
});

describe('resolveConfig empty-input fallback', () => {
  it('treats empty booleans as the action default', () => {
    const config = resolveConfig(
      baseRaw({
        anchorManifest: '',
        certificates: '',
        attachToRelease: '',
        overwriteReleaseAssets: '',
        failOnTimeout: '',
      }),
      '/work',
    );
    expect(config.anchorManifest).toBe(false);
    expect(config.certificates).toBe(false);
    expect(config.attachToRelease).toBe(false);
    expect(config.overwriteReleaseAssets).toBe(true);
    expect(config.failOnTimeout).toBe(false);
  });

  it('parses booleans case-insensitively and rejects non-booleans', () => {
    expect(resolveConfig(baseRaw({ anchorManifest: 'TRUE' }), '/work').anchorManifest).toBe(true);
    expect(
      resolveConfig(baseRaw({ overwriteReleaseAssets: 'False' }), '/work').overwriteReleaseAssets,
    ).toBe(false);
    expect(() => resolveConfig(baseRaw({ certificates: 'yes' }), '/work')).toThrow(
      /certificates: expected true or false/,
    );
  });

  it('treats empty enums as the action default and rejects unknown values', () => {
    const config = resolveConfig(
      baseRaw({ publish: '', wait: '', network: '', uploadArtifact: '' }),
      '/work',
    );
    expect(config.publish).toBe('full-tree');
    expect(config.wait).toBe('confirmed');
    expect(config.network).toBe('mainnet');
    expect(config.uploadArtifact).toBe('auto');
    expect(() => resolveConfig(baseRaw({ publish: 'bogus' }), '/work')).toThrow(
      /publish: expected one of/,
    );
  });

  it('treats an empty timeout as the 600s default', () => {
    expect(resolveConfig(baseRaw({ timeout: '' }), '/work').timeout).toBe(600);
  });
});

describe('parseCliSha256', () => {
  it('returns null for an empty input', () => {
    expect(parseCliSha256('')).toBeNull();
    expect(parseCliSha256('  \n ')).toBeNull();
  });

  it('parses a single digest for the current platform', () => {
    expect(parseCliSha256(HEX.toUpperCase())).toEqual({ kind: 'single', sha256: HEX });
  });

  it('rejects a single non-hex digest', () => {
    expect(() => parseCliSha256('nothex')).toThrow(/cli-sha256/);
  });

  it('rejects two bare digests with no target prefix', () => {
    expect(() => parseCliSha256(`${HEX}\n${HEX}`)).toThrow(/single SHA-256/);
  });

  it('parses per-target entries split on commas and newlines', () => {
    const raw = `x86_64-apple-darwin=${HEX}\naarch64-apple-darwin=${'b'.repeat(64)}`;
    const parsed = parseCliSha256(raw);
    expect(parsed).toEqual({
      kind: 'perTarget',
      byTarget: new Map([
        ['x86_64-apple-darwin', HEX],
        ['aarch64-apple-darwin', 'b'.repeat(64)],
      ]),
    });
  });

  it('rejects an unknown target, a duplicate, and a mixed format', () => {
    expect(() => parseCliSha256(`sparc-unknown=${HEX}`)).toThrow(/unknown target/);
    expect(() => parseCliSha256(`x86_64-apple-darwin=${HEX},x86_64-apple-darwin=${HEX}`)).toThrow(
      /duplicate/,
    );
    expect(() => parseCliSha256(`x86_64-apple-darwin=${HEX},${HEX}`)).toThrow(/mixed formats/);
  });
});
