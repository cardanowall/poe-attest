import { describe, expect, it } from 'vitest';

import type { Config } from './inputs';
import {
  buildOutputs,
  exitClass,
  failureMessage,
  isPending,
  parseCliError,
  parseSummary,
  type AttestReceipt,
  type AttestSummary,
} from './outcome';

const TX = 'a'.repeat(64);

function config(overrides: Partial<Config> = {}): Config {
  return {
    verifyBase: 'https://cardanowall.com',
    network: 'mainnet',
    receiptOut: '/work/poe-receipt.json',
    certificatesDir: '/work/poe-certificates',
    ...overrides,
  } as unknown as Config;
}

const singleItem: AttestSummary = {
  mode: 'pre-hashed',
  record: 'items',
  id: 'poe_123',
  tx_hash: TX,
  status: 'confirmed',
  item_sha2_256: 'ab'.repeat(32),
  price_usd_micros: '1500000',
  balance_after_usd_micros: '5000000',
  replayed: false,
  receipt_path: '/work/poe-receipt.json',
  wait_target: 'confirmed',
  wait_reached: true,
};

const merkle: AttestSummary = {
  mode: 'files',
  record: 'merkle',
  id: 'poe_456',
  tx_hash: TX,
  status: 'confirmed',
  root: 'cd'.repeat(32),
  leaf_count: 5,
  ar_uri: 'ar://XYZ',
  price_usd_micros: '3000000',
  balance_after_usd_micros: '2000000',
  replayed: false,
  manifest_path: '/work/poe-manifest.json',
  manifest_sha2_256: 'ef'.repeat(32),
  receipt_path: '/work/poe-receipt.json',
  certificates_written: 5,
  wait_target: 'confirmed',
  wait_reached: true,
};

describe('parseSummary', () => {
  it('parses a single JSON line', () => {
    expect(parseSummary(`${JSON.stringify(singleItem)}\n`).id).toBe('poe_123');
  });

  it('parses the last JSON line past leading chatter', () => {
    const stdout = `warming up\n${JSON.stringify(singleItem)}\n`;
    expect(parseSummary(stdout).status).toBe('confirmed');
  });

  it('throws when no JSON summary is present', () => {
    expect(() => parseSummary('nothing machine-readable here')).toThrow(/could not parse/);
  });
});

describe('parseCliError', () => {
  it('extracts the structured error object from stderr', () => {
    const stderr = `uploading...\n{"error":{"code":1,"message":"quote exceeds --max-usd","command":"attest"}}\n`;
    expect(parseCliError(stderr)).toEqual({
      code: 1,
      message: 'quote exceeds --max-usd',
      command: 'attest',
    });
  });

  it('returns null when stderr carries no structured error', () => {
    expect(parseCliError('just some progress text\n')).toBeNull();
  });
});

describe('exitClass and failureMessage', () => {
  it('labels exit classes', () => {
    expect(exitClass(1)).toBe('integrity');
    expect(exitClass(2)).toBe('network');
    expect(exitClass(4)).toBe('usage');
    expect(exitClass(3)).toBe('exit 3');
  });

  it('prefers the structured error message', () => {
    const stderr = `{"error":{"code":1,"message":"balance overdrawn","command":"attest"}}`;
    expect(failureMessage(1, stderr)).toBe('integrity: balance overdrawn');
  });

  it('falls back to the stderr tail when unstructured', () => {
    expect(failureMessage(2, 'connecting\nboom: connection refused\n')).toBe(
      'network: cardanowall attest exited 2, boom: connection refused',
    );
  });
});

describe('buildOutputs', () => {
  it('maps a single-item confirmed anchor', () => {
    const out = buildOutputs(singleItem, null, config());
    expect(out).toMatchObject({
      tx: TX,
      root: '',
      'leaf-count': '',
      'record-id': 'poe_123',
      status: 'confirmed',
      'price-usd': '1.50',
      'balance-usd': '5.00',
      replayed: 'false',
      signer: '',
      'verify-url': `https://cardanowall.com/m/${TX}`,
      'explorer-url': `https://cardanoscan.io/transaction/${TX}`,
      'receipt-path': '/work/poe-receipt.json',
      'manifest-path': '',
      'certificates-dir': '',
      'wait-target': 'confirmed',
      'wait-reached': 'true',
      'timed-out': 'false',
    });
  });

  it('maps a merkle anchor with manifest, ar-uri, and certificates', () => {
    const out = buildOutputs(merkle, null, config());
    expect(out).toMatchObject({
      root: 'cd'.repeat(32),
      'leaf-count': '5',
      'ar-uri': 'ar://XYZ',
      'price-usd': '3.00',
      'balance-usd': '2.00',
      'manifest-path': '/work/poe-manifest.json',
      'certificates-dir': '/work/poe-certificates',
    });
  });

  it('reads the signer from the receipt, not stdout', () => {
    const receipt: AttestReceipt = { signer_ed25519: '11'.repeat(32), signed: true };
    expect(buildOutputs(singleItem, receipt, config()).signer).toBe('11'.repeat(32));
  });

  it('leaves price empty on a replayed run', () => {
    const replayed: AttestSummary = { ...singleItem, replayed: true };
    delete replayed.price_usd_micros;
    const out = buildOutputs(replayed, null, config());
    expect(out['price-usd']).toBe('');
    expect(out.replayed).toBe('true');
    expect(out['balance-usd']).toBe('5.00');
  });

  it('marks a pending (timed-out) run', () => {
    const pending: AttestSummary = { ...singleItem, status: 'confirming', wait_reached: false };
    const out = buildOutputs(pending, null, config());
    expect(out['wait-reached']).toBe('false');
    expect(out['timed-out']).toBe('true');
    expect(out.status).toBe('confirming');
  });

  it('uses the preprod explorer host', () => {
    const out = buildOutputs(singleItem, null, config({ network: 'preprod' }));
    expect(out['explorer-url']).toBe(`https://preprod.cardanoscan.io/transaction/${TX}`);
  });
});

describe('isPending', () => {
  it('is true on exit 3 or when the wait did not reach', () => {
    expect(isPending(singleItem, 3)).toBe(true);
    expect(isPending({ ...singleItem, wait_reached: false }, 0)).toBe(true);
  });

  it('is false on a reached confirmed wait', () => {
    expect(isPending(singleItem, 0)).toBe(false);
  });
});
