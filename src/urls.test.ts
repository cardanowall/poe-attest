import { describe, expect, it } from 'vitest';

import { arweaveHttpUrl, explorerUrl, verifyUrl } from './urls';

const TX = 'a'.repeat(64);

describe('verifyUrl', () => {
  it('builds the /m/<tx> deep link', () => {
    expect(verifyUrl('https://cardanowall.com', TX)).toBe(`https://cardanowall.com/m/${TX}`);
  });

  it('tolerates a trailing slash on the base', () => {
    expect(verifyUrl('https://cardanowall.com/', TX)).toBe(`https://cardanowall.com/m/${TX}`);
  });

  it('returns empty when the tx is unknown', () => {
    expect(verifyUrl('https://cardanowall.com', null)).toBe('');
    expect(verifyUrl('https://cardanowall.com', '')).toBe('');
  });
});

describe('explorerUrl', () => {
  it('uses the mainnet Cardanoscan host', () => {
    expect(explorerUrl('mainnet', TX)).toBe(`https://cardanoscan.io/transaction/${TX}`);
  });

  it('uses the preprod Cardanoscan host', () => {
    expect(explorerUrl('preprod', TX)).toBe(`https://preprod.cardanoscan.io/transaction/${TX}`);
  });

  it('returns empty when the tx is unknown', () => {
    expect(explorerUrl('mainnet', null)).toBe('');
  });
});

describe('arweaveHttpUrl', () => {
  it('rewrites an ar:// URI to the gateway host', () => {
    expect(arweaveHttpUrl('ar://abc123')).toBe('https://arweave.net/abc123');
  });

  it('returns a non-ar value unchanged and empty for nullish', () => {
    expect(arweaveHttpUrl('https://example.com/x')).toBe('https://example.com/x');
    expect(arweaveHttpUrl(null)).toBe('');
    expect(arweaveHttpUrl(undefined)).toBe('');
  });
});
