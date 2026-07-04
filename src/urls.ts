// Pure URL builders for the human-facing links the action emits (outputs + step
// summary). Every builder is total: given a missing transaction hash it returns
// an empty string so a caller can treat "no link yet" uniformly.

export type Network = 'mainnet' | 'preprod';

/**
 * The Label 309 verifier deep-link for a transaction, e.g.
 * `https://cardanowall.com/m/<tx>`. The base is the `verify-base` input; a
 * trailing slash on the base is tolerated.
 */
export function verifyUrl(verifyBase: string, tx: string | null | undefined): string {
  if (!tx) return '';
  return `${verifyBase.replace(/\/+$/, '')}/m/${tx}`;
}

/**
 * The public block explorer link for a transaction. Mainnet and preprod live on
 * separate Cardanoscan hosts; this mirrors the convention the CLI writes into
 * its inclusion certificates.
 */
export function explorerUrl(network: Network, tx: string | null | undefined): string {
  if (!tx) return '';
  const host = network === 'preprod' ? 'preprod.cardanoscan.io' : 'cardanoscan.io';
  return `https://${host}/transaction/${tx}`;
}

/**
 * Turn an `ar://<id>` URI into a browser-openable gateway URL. A value that is
 * not an `ar://` URI is returned unchanged.
 */
export function arweaveHttpUrl(arUri: string | null | undefined): string {
  if (!arUri) return '';
  const match = /^ar:\/\/(.+)$/.exec(arUri);
  if (!match) return arUri;
  return `https://arweave.net/${match[1]}`;
}
