// The job step-summary card. The markdown is built by a pure function so it can
// be asserted directly; `writeStepSummary` is the thin Actions-runtime wrapper.

import * as core from '@actions/core';

import type { ActionOutputs, AttestReceipt, AttestSummary } from './outcome';
import { arweaveHttpUrl } from './urls';

export interface SummaryInput {
  summary: AttestSummary;
  receipt: AttestReceipt | null;
  outputs: ActionOutputs;
  pending: boolean;
}

function shortHex(hex: string): string {
  return hex.length > 24 ? `${hex.slice(0, 12)}…${hex.slice(-6)}` : hex;
}

/** Render the step-summary markdown for an attest outcome. */
export function buildSummaryMarkdown(input: SummaryInput): string {
  const { summary, outputs, pending } = input;
  const lines: string[] = ['### Label 309 Proof of Existence', ''];

  if (pending) {
    lines.push(
      '> [!WARNING]',
      '> **Pending**, the wait timed out client-side, but the publish continues on the gateway.',
      `> Re-check later with record id \`${outputs['record-id']}\`.`,
      '',
    );
  }

  const rows: [string, string][] = [];
  rows.push(['Record', `\`${outputs['record-id']}\``]);
  rows.push(['Mode', summary.mode]);
  rows.push(['Status', pending ? `${outputs.status} (pending)` : outputs.status]);

  if (outputs.root !== '') {
    rows.push(['Merkle root', `\`${shortHex(outputs.root)}\``]);
    rows.push(['Leaves', outputs['leaf-count']]);
  } else if (summary.item_sha2_256 !== undefined) {
    rows.push(['Item SHA-256', `\`${shortHex(summary.item_sha2_256)}\``]);
  }

  if (outputs.tx !== '') {
    rows.push(['Transaction', `[\`${shortHex(outputs.tx)}\`](${outputs['explorer-url']})`]);
  }
  if (outputs['verify-url'] !== '') {
    rows.push(['Verify', `[open verifier](${outputs['verify-url']})`]);
  }
  if (outputs['ar-uri'] !== '') {
    rows.push(['Storage', `[\`${outputs['ar-uri']}\`](${arweaveHttpUrl(outputs['ar-uri'])})`]);
  }

  rows.push([
    'Price',
    outputs.replayed === 'true' ? 'replayed, nothing debited' : `$${outputs['price-usd']}`,
  ]);
  rows.push(['Balance', `$${outputs['balance-usd']}`]);
  if (outputs.signer !== '') {
    rows.push(['Signer', `\`${shortHex(outputs.signer)}\``]);
  }

  lines.push('| | |', '| --- | --- |');
  for (const [label, value] of rows) lines.push(`| ${label} | ${value} |`);
  lines.push('');
  return lines.join('\n');
}

/** Write the step-summary card to the Actions job summary. */
export async function writeStepSummary(input: SummaryInput): Promise<void> {
  await core.summary.addRaw(buildSummaryMarkdown(input)).write();
}
