import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import type { Config } from './inputs';
import type { AttestReceipt, AttestSummary } from './outcome';
import { interpretResult } from './run';

const TX = 'a'.repeat(64);

const dir = mkdtempSync(join(tmpdir(), 'poe-attest-run-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function config(receiptName: string): Config {
  return {
    verifyBase: 'https://cardanowall.com',
    network: 'mainnet',
    receiptOut: join(dir, receiptName),
    certificatesDir: join(dir, 'poe-certificates'),
  } as unknown as Config;
}

const baseSummary: AttestSummary = {
  mode: 'pre-hashed',
  record: 'items',
  id: 'poe_123',
  tx_hash: TX,
  status: 'confirmed',
  item_sha2_256: 'ab'.repeat(32),
  price_usd_micros: '1500000',
  balance_after_usd_micros: '5000000',
  replayed: false,
  wait_target: 'confirmed',
  wait_reached: true,
};

function writeReceipt(cfg: Config, receipt: AttestReceipt): void {
  writeFileSync(cfg.receiptOut, JSON.stringify(receipt));
}

const matchingReceipt: AttestReceipt = {
  poe_id: 'poe_123',
  tx_hash: TX,
  status: 'confirmed',
  signed: true,
  signer_ed25519: '11'.repeat(32),
  wait: { reached: true, timed_out: false },
};

describe('interpretResult', () => {
  it('maps a successful exit and reads the signer from the receipt', async () => {
    const cfg = config('success-receipt.json');
    writeReceipt(cfg, matchingReceipt);

    const outcome = await interpretResult(cfg, {
      exitCode: 0,
      stdout: `${JSON.stringify(baseSummary)}\n`,
      stderr: '',
    });

    expect(outcome.kind).toBe('success');
    if (outcome.kind === 'success') {
      expect(outcome.outputs['record-id']).toBe('poe_123');
      expect(outcome.outputs.signer).toBe('11'.repeat(32));
      expect(outcome.outputs['timed-out']).toBe('false');
    }
  });

  it('classifies exit 3 as pending with outputs intact', async () => {
    const cfg = config('pending-receipt.json');
    writeReceipt(cfg, {
      poe_id: 'poe_123',
      tx_hash: TX,
      status: 'confirming',
      wait: { reached: false, timed_out: true },
    });
    const pendingSummary: AttestSummary = {
      ...baseSummary,
      status: 'confirming',
      wait_reached: false,
    };

    const outcome = await interpretResult(cfg, {
      exitCode: 3,
      stdout: `${JSON.stringify(pendingSummary)}\n`,
      stderr: 'confirming...\n',
    });

    expect(outcome.kind).toBe('pending');
    if (outcome.kind === 'pending') {
      expect(outcome.outputs['timed-out']).toBe('true');
      expect(outcome.outputs.status).toBe('confirming');
    }
  });

  it('classifies exit 1 as a failure with the structured message', async () => {
    const outcome = await interpretResult(config('none.json'), {
      exitCode: 1,
      stdout: '',
      stderr: `{"error":{"code":1,"message":"quote exceeds --max-usd","command":"attest"}}`,
    });
    expect(outcome).toEqual({ kind: 'failure', message: 'integrity: quote exceeds --max-usd' });
  });

  it('fails on a success exit when the receipt is missing', async () => {
    const outcome = await interpretResult(config('absent.json'), {
      exitCode: 0,
      stdout: `${JSON.stringify(baseSummary)}\n`,
      stderr: '',
    });
    expect(outcome.kind).toBe('failure');
    if (outcome.kind === 'failure')
      expect(outcome.message).toMatch(/was not written or could not be parsed/);
  });

  it('fails when the receipt poe_id disagrees with the summary', async () => {
    const cfg = config('mismatch-receipt.json');
    writeReceipt(cfg, { ...matchingReceipt, poe_id: 'poe_999' });
    const outcome = await interpretResult(cfg, {
      exitCode: 0,
      stdout: `${JSON.stringify(baseSummary)}\n`,
      stderr: '',
    });
    expect(outcome.kind).toBe('failure');
    if (outcome.kind === 'failure') expect(outcome.message).toMatch(/poe_id.*does not match/);
  });

  it('fails when the receipt tx_hash disagrees with the summary', async () => {
    const cfg = config('txmismatch-receipt.json');
    writeReceipt(cfg, { ...matchingReceipt, tx_hash: 'b'.repeat(64) });
    const outcome = await interpretResult(cfg, {
      exitCode: 0,
      stdout: `${JSON.stringify(baseSummary)}\n`,
      stderr: '',
    });
    expect(outcome.kind).toBe('failure');
    if (outcome.kind === 'failure') expect(outcome.message).toMatch(/tx_hash.*does not match/);
  });
});
