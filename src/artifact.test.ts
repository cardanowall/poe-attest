import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { collectArtifactFiles, shouldUpload } from './artifact';
import type { Config } from './inputs';
import type { AttestSummary } from './outcome';

describe('shouldUpload', () => {
  it('honors an explicit true/false', () => {
    expect(shouldUpload('true', 'https://ghe.example.com').upload).toBe(true);
    expect(shouldUpload('false', 'https://github.com').upload).toBe(false);
  });

  it('auto-uploads on github.com and skips on GHES', () => {
    expect(shouldUpload('auto', 'https://github.com').upload).toBe(true);
    expect(shouldUpload('auto', undefined).upload).toBe(true);
    const ghes = shouldUpload('auto', 'https://ghe.example.com');
    expect(ghes.upload).toBe(false);
    expect(ghes.reason).toMatch(/Enterprise Server/);
  });
});

describe('collectArtifactFiles', () => {
  const dir = mkdtempSync(join(tmpdir(), 'poe-attest-artifact-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  function config(overrides: Partial<Config> = {}): Config {
    return {
      workingDirectory: dir,
      receiptOut: join(dir, 'poe-receipt.json'),
      certificatesDir: join(dir, 'poe-certificates'),
      ...overrides,
    } as unknown as Config;
  }

  it('collects only the files that exist', async () => {
    writeFileSync(join(dir, 'poe-receipt.json'), '{}');
    const summary = { certificates_written: 0 } as unknown as AttestSummary;
    expect(await collectArtifactFiles(config(), summary)).toEqual([join(dir, 'poe-receipt.json')]);
  });

  it('includes the manifest and every certificate when present', async () => {
    writeFileSync(join(dir, 'poe-receipt.json'), '{}');
    writeFileSync(join(dir, 'poe-manifest.json'), '{}');
    const certsDir = join(dir, 'poe-certificates');
    mkdirSync(certsDir, { recursive: true });
    writeFileSync(join(certsDir, '0.certificate.json'), '{}');
    writeFileSync(join(certsDir, '1.certificate.json'), '{}');

    const summary = {
      manifest_path: join(dir, 'poe-manifest.json'),
      certificates_written: 2,
    } as unknown as AttestSummary;

    const files = await collectArtifactFiles(config(), summary);
    expect(files).toContain(join(dir, 'poe-receipt.json'));
    expect(files).toContain(join(dir, 'poe-manifest.json'));
    expect(files).toContain(join(certsDir, '0.certificate.json'));
    expect(files).toContain(join(certsDir, '1.certificate.json'));
    expect(files).toHaveLength(4);
  });

  it('omits certificates when none were written', async () => {
    writeFileSync(join(dir, 'poe-receipt.json'), '{}');
    const summary = {
      manifest_path: join(dir, 'missing-manifest.json'),
      certificates_written: 0,
    } as unknown as AttestSummary;
    const files = await collectArtifactFiles(config(), summary);
    expect(files).toEqual([join(dir, 'poe-receipt.json')]);
  });

  it('excludes a symlinked certificate that points outside the dir', async () => {
    const base = join(dir, 'symcerts');
    const certsDir = join(base, 'poe-certificates');
    mkdirSync(certsDir, { recursive: true });
    const secret = join(dir, 'secret.txt');
    writeFileSync(secret, 'SECRET');
    writeFileSync(join(base, 'poe-receipt.json'), '{}');
    writeFileSync(join(certsDir, '0.certificate.json'), '{}');
    symlinkSync(secret, join(certsDir, 'evil.certificate.json'));

    const cfg = config({
      workingDirectory: base,
      receiptOut: join(base, 'poe-receipt.json'),
      certificatesDir: certsDir,
    });
    const files = await collectArtifactFiles(cfg, {
      certificates_written: 1,
    } as unknown as AttestSummary);
    expect(files).toContain(join(base, 'poe-receipt.json'));
    expect(files).toContain(join(certsDir, '0.certificate.json'));
    expect(files).not.toContain(join(certsDir, 'evil.certificate.json'));
  });

  it('excludes a symlinked receipt', async () => {
    const base = join(dir, 'symreceipt');
    mkdirSync(base, { recursive: true });
    const secret = join(dir, 'secret2.txt');
    writeFileSync(secret, 'SECRET');
    const receiptPath = join(base, 'poe-receipt.json');
    symlinkSync(secret, receiptPath);

    const cfg = config({
      workingDirectory: base,
      receiptOut: receiptPath,
      certificatesDir: join(base, 'poe-certificates'),
    });
    const files = await collectArtifactFiles(cfg, {
      certificates_written: 0,
    } as unknown as AttestSummary);
    expect(files).toEqual([]);
  });
});
