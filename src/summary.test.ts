import { describe, expect, it } from 'vitest';

import type { Config } from './inputs';
import { buildOutputs, type AttestReceipt, type AttestSummary } from './outcome';
import { buildSummaryMarkdown } from './summary';

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

const single: AttestSummary = {
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
  wait_target: 'confirmed',
  wait_reached: true,
};

function render(summary: AttestSummary, receipt: AttestReceipt | null, pending: boolean): string {
  const outputs = buildOutputs(summary, receipt, config());
  return buildSummaryMarkdown({ summary, receipt, outputs, pending });
}

describe('buildSummaryMarkdown', () => {
  it('renders the record id, status, price, and balance for a single item', () => {
    const md = render(single, null, false);
    expect(md).toContain('poe_123');
    expect(md).toContain('confirmed');
    expect(md).toContain('$1.50');
    expect(md).toContain('$5.00');
    expect(md).toContain('Item SHA-256');
    expect(md).toContain(`https://cardanoscan.io/transaction/${TX}`);
    expect(md).not.toContain('Merkle root');
  });

  it('renders the merkle root, leaf count, and arweave link', () => {
    const md = render(merkle, null, false);
    expect(md).toContain('Merkle root');
    expect(md).toContain('| Leaves | 5 |');
    expect(md).toContain('https://arweave.net/XYZ');
    expect(md).not.toContain('Item SHA-256');
  });

  it('shows a pending banner and marks the status', () => {
    const pending: AttestSummary = { ...single, status: 'confirming', wait_reached: false };
    const md = render(pending, null, true);
    expect(md).toContain('Pending');
    expect(md).toContain('confirming (pending)');
  });

  it('states that a replayed run debited nothing', () => {
    const replayed: AttestSummary = { ...single, replayed: true };
    delete replayed.price_usd_micros;
    expect(render(replayed, null, false)).toContain('replayed, nothing debited');
  });

  it('shows the signer only when the receipt is signed', () => {
    const receipt: AttestReceipt = { signer_ed25519: '11'.repeat(32), signed: true };
    expect(render(single, receipt, false)).toContain('Signer');
    expect(render(single, null, false)).not.toContain('Signer');
  });
});
