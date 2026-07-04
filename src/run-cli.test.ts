import { describe, expect, it } from 'vitest';

import type { Config } from './inputs';
import { buildArgs, buildChildEnv } from './run-cli';

function cfg(overrides: Partial<Config> = {}): Config {
  return {
    gatewayUrl: 'https://cardanowall.com/api/v1',
    apiKey: 'cw_secret',
    mode: 'paths',
    paths: ['dist/app.tar.gz'],
    commits: '',
    leaves: [],
    publish: 'full-tree',
    anchorManifest: false,
    seed: null,
    wait: 'confirmed',
    timeout: 600,
    maxUsd: null,
    supersedes: null,
    idempotencyKey: 'auto',
    certificates: false,
    network: 'mainnet',
    workingDirectory: '/work',
    receiptOut: '/work/poe-receipt.json',
    manifestOut: '/work/poe-manifest.json',
    certificatesDir: '/work/poe-certificates',
    uploadArtifact: 'auto',
    artifactName: 'poe-attest',
    attachToRelease: false,
    releaseTag: null,
    overwriteReleaseAssets: true,
    githubToken: 'gh',
    verifyBase: 'https://cardanowall.com',
    cliVersion: null,
    cliSha256: null,
    cliPath: null,
    failOnTimeout: false,
    ...overrides,
  };
}

function pairAt(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i < 0 ? undefined : args[i + 1];
}

describe('buildArgs', () => {
  it('always emits the machine-output preamble and never puts secrets on argv', () => {
    const args = buildArgs(cfg({ apiKey: 'cw_secret', seed: 'L309-SEED-1abc' }));
    expect(args.slice(0, 3)).toEqual(['attest', '--json', '--no-color']);
    expect(pairAt(args, '--base-url')).toBe('https://cardanowall.com/api/v1');
    expect(pairAt(args, '--receipt-out')).toBe('/work/poe-receipt.json');
    // API key and seed never travel as argv.
    expect(args).not.toContain('cw_secret');
    expect(args).not.toContain('L309-SEED-1abc');
    expect(args).not.toContain('--api-key');
    expect(args).toContain('--seed-stdin');
  });

  it('builds paths mode with repeated --paths and a manifest-out', () => {
    const args = buildArgs(cfg({ mode: 'paths', paths: ['a', 'b'] }));
    expect(args.filter((a) => a === '--paths')).toHaveLength(2);
    expect(pairAt(args, '--manifest-out')).toBe('/work/poe-manifest.json');
    expect(args).not.toContain('--anchor-manifest');
    expect(args).not.toContain('--commits');
    expect(args).not.toContain('--leaf');
  });

  it('adds --anchor-manifest only when requested', () => {
    expect(buildArgs(cfg({ anchorManifest: true }))).toContain('--anchor-manifest');
  });

  it('builds commits mode', () => {
    const args = buildArgs(cfg({ mode: 'commits', paths: [], commits: 'v1..v2' }));
    expect(pairAt(args, '--commits')).toBe('v1..v2');
    expect(args).not.toContain('--paths');
    expect(args).not.toContain('--manifest-out');
  });

  it('builds leaves mode with a --leaf per digest', () => {
    const leaves = ['a'.repeat(64), 'b'.repeat(64)];
    const args = buildArgs(cfg({ mode: 'leaves', paths: [], leaves }));
    expect(args.filter((a) => a === '--leaf')).toHaveLength(2);
    expect(args).toContain(leaves[0]);
    expect(args).toContain(leaves[1]);
    expect(args).not.toContain('--paths');
  });

  it('passes wait/timeout/network/publish/idempotency-key through', () => {
    const args = buildArgs(
      cfg({ wait: 'submitted', timeout: 900, network: 'preprod', publish: 'root' }),
    );
    expect(pairAt(args, '--wait')).toBe('submitted');
    expect(pairAt(args, '--timeout')).toBe('900');
    expect(pairAt(args, '--network')).toBe('preprod');
    expect(pairAt(args, '--publish')).toBe('root');
    expect(pairAt(args, '--idempotency-key')).toBe('auto');
  });

  it('adds optional flags only when set', () => {
    const bare = buildArgs(cfg());
    expect(bare).not.toContain('--max-usd');
    expect(bare).not.toContain('--supersedes');
    expect(bare).not.toContain('--certificates-dir');
    expect(bare).not.toContain('--seed-stdin');

    const full = buildArgs(cfg({ maxUsd: '1.50', supersedes: 'f'.repeat(64), certificates: true }));
    expect(pairAt(full, '--max-usd')).toBe('1.50');
    expect(pairAt(full, '--supersedes')).toBe('f'.repeat(64));
    expect(pairAt(full, '--certificates-dir')).toBe('/work/poe-certificates');
  });
});

describe('buildChildEnv', () => {
  it('strips every CARDANOWALL_* var and injects only the API key', () => {
    const base = {
      PATH: '/usr/bin',
      HOME: '/home/runner',
      CARDANOWALL_SEED: 'leaked-seed',
      CARDANOWALL_BASE_URL: 'https://evil.example',
      CARDANOWALL_API_KEY: 'leaked-key',
      CARDANOWALL_GATEWAY_PROFILE: 'evil',
    };
    const env = buildChildEnv(base, 'cw_real_key');
    expect(env['PATH']).toBe('/usr/bin');
    expect(env['HOME']).toBe('/home/runner');
    expect(env['CARDANOWALL_SEED']).toBeUndefined();
    expect(env['CARDANOWALL_BASE_URL']).toBeUndefined();
    expect(env['CARDANOWALL_GATEWAY_PROFILE']).toBeUndefined();
    expect(env['CARDANOWALL_API_KEY']).toBe('cw_real_key');
  });

  it('strips mixed-case CARDANOWALL_* keys (Windows env is case-insensitive)', () => {
    const env = buildChildEnv(
      { cardanowall_seed: 'leak', Cardanowall_Base_Url: 'https://evil', PATH: '/bin' },
      'k',
    );
    expect(env['cardanowall_seed']).toBeUndefined();
    expect(env['Cardanowall_Base_Url']).toBeUndefined();
    expect(env['PATH']).toBe('/bin');
    expect(env['CARDANOWALL_API_KEY']).toBe('k');
  });

  it('drops undefined inherited values', () => {
    const env = buildChildEnv({ PATH: '/bin', EMPTY: undefined }, 'k');
    expect('EMPTY' in env).toBe(false);
    expect(env['PATH']).toBe('/bin');
  });
});
