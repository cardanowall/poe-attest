// Parsing the CLI's machine output and mapping it to the action's outputs. The
// `--json` stdout summary is the success/pending contract; the `{"error":{…}}`
// stderr object is the failure contract; the receipt file carries the signer.

import type { Config } from './inputs';
import { microsToUsd } from './usd';
import { explorerUrl, verifyUrl } from './urls';

/** The single-line `--json` stdout summary from `cardanowall attest`. */
export interface AttestSummary {
  mode: string;
  record: string;
  id: string;
  tx_hash: string | null;
  status: string;
  item_sha2_256?: string;
  root?: string;
  leaf_count?: number;
  ar_uri?: string;
  price_usd_micros?: string;
  balance_after_usd_micros: string;
  idempotency_key?: string;
  replayed: boolean;
  manifest_path?: string;
  manifest_sha2_256?: string;
  receipt_path?: string;
  certificates_written?: number;
  wait_target: string;
  wait_reached: boolean;
}

/** The fields of the receipt file the action reads (the signer is receipt-only). */
export interface AttestReceipt {
  poe_id?: string;
  tx_hash?: string | null;
  status?: string;
  signer_ed25519?: string;
  signed?: boolean;
  wait?: { reached?: boolean; timed_out?: boolean };
}

/** The structured CLI error printed to stderr in `--json` mode. */
export interface CliErrorJson {
  code: number;
  message: string;
  command: string;
}

/** The full output surface the action sets. Keys are the literal output names. */
export interface ActionOutputs {
  tx: string;
  root: string;
  'leaf-count': string;
  'ar-uri': string;
  'record-id': string;
  status: string;
  'price-usd': string;
  'balance-usd': string;
  replayed: string;
  signer: string;
  'verify-url': string;
  'explorer-url': string;
  'receipt-path': string;
  'manifest-path': string;
  'certificates-dir': string;
  'wait-target': string;
  'wait-reached': string;
  'timed-out': string;
}

/** Try to JSON-parse a string into an object, returning null on any failure. */
function tryParseObject(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    if (value !== null && typeof value === 'object') return value as Record<string, unknown>;
  } catch {
    // fall through
  }
  return null;
}

/**
 * Parse the CLI's `--json` summary from captured stdout. The summary is a single
 * JSON line; the whole stream is tried first, then each line from the end, so a
 * stray leading line never defeats the parse.
 */
export function parseSummary(stdout: string): AttestSummary {
  const whole = tryParseObject(stdout.trim());
  if (whole !== null && typeof whole['id'] === 'string') return whole as unknown as AttestSummary;

  const lines = stdout.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]?.trim();
    if (line === undefined || line === '') continue;
    const parsed = tryParseObject(line);
    if (parsed !== null && typeof parsed['id'] === 'string')
      return parsed as unknown as AttestSummary;
  }
  throw new Error('could not parse the CLI JSON summary from stdout');
}

/**
 * Extract the structured `{"error":{…}}` object from captured stderr, scanning
 * from the last line (progress chatter precedes it). Returns null when no
 * structured error is present so the caller can fall back to the raw tail.
 */
export function parseCliError(stderr: string): CliErrorJson | null {
  const lines = stderr.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]?.trim();
    if (line === undefined || line === '') continue;
    const parsed = tryParseObject(line);
    const error = parsed?.['error'];
    if (error !== null && typeof error === 'object' && error !== undefined) {
      const e = error as Record<string, unknown>;
      const code = e['code'];
      const message = e['message'];
      const command = e['command'];
      if (typeof message === 'string' && typeof code === 'number') {
        return { code, message, command: typeof command === 'string' ? command : 'attest' };
      }
    }
  }
  return null;
}

/** Human label for a CLI exit code, used to prefix a failure message. */
export function exitClass(code: number): string {
  switch (code) {
    case 1:
      return 'integrity';
    case 2:
      return 'network';
    case 4:
      return 'usage';
    default:
      return `exit ${code}`;
  }
}

/**
 * Compose a failure message for a non-recoverable CLI exit (1/2/4). Prefers the
 * structured error's message, falling back to the last non-empty stderr line.
 */
export function failureMessage(exitCode: number, stderr: string): string {
  const structured = parseCliError(stderr);
  if (structured !== null) return `${exitClass(exitCode)}: ${structured.message}`;
  const tail = stderr
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .pop();
  return `${exitClass(exitCode)}: cardanowall attest exited ${exitCode}${tail !== undefined ? `, ${tail}` : ''}`;
}

/** Map a parsed summary + receipt to the action's output surface. */
export function buildOutputs(
  summary: AttestSummary,
  receipt: AttestReceipt | null,
  config: Config,
): ActionOutputs {
  const tx = summary.tx_hash ?? '';
  const certificatesWritten = summary.certificates_written ?? 0;
  return {
    tx,
    root: summary.root ?? '',
    'leaf-count': summary.leaf_count === undefined ? '' : String(summary.leaf_count),
    'ar-uri': summary.ar_uri ?? '',
    'record-id': summary.id,
    status: summary.status,
    'price-usd':
      summary.price_usd_micros === undefined ? '' : microsToUsd(summary.price_usd_micros),
    'balance-usd': microsToUsd(summary.balance_after_usd_micros),
    replayed: String(summary.replayed),
    signer: receipt?.signer_ed25519 ?? '',
    'verify-url': verifyUrl(config.verifyBase, tx || null),
    'explorer-url': explorerUrl(config.network, tx || null),
    'receipt-path': config.receiptOut,
    'manifest-path': summary.manifest_path ?? '',
    'certificates-dir': certificatesWritten > 0 ? config.certificatesDir : '',
    'wait-target': summary.wait_target,
    'wait-reached': String(summary.wait_reached),
    'timed-out': String(!summary.wait_reached),
  };
}

/** Whether the run timed out (pending, CLI exit 3). */
export function isPending(summary: AttestSummary, exitCode: number): boolean {
  return exitCode === 3 || summary.wait_reached === false;
}

/**
 * Cross-check the receipt file against the stdout summary. The action always
 * writes a receipt, so on a success/pending exit it must exist and agree with
 * the summary on the record id, transaction hash, and wait state; a mismatch
 * means our own outputs are internally inconsistent. Returns an error message,
 * or null when the receipt is consistent.
 */
export function crossCheckReceipt(summary: AttestSummary, receipt: AttestReceipt): string | null {
  if (receipt.poe_id !== summary.id) {
    return `receipt poe_id (${receipt.poe_id ?? 'absent'}) does not match the summary record id (${summary.id})`;
  }
  const receiptTx = receipt.tx_hash ?? null;
  const summaryTx = summary.tx_hash ?? null;
  if (receiptTx !== summaryTx) {
    return `receipt tx_hash (${receiptTx ?? 'none'}) does not match the summary tx (${summaryTx ?? 'none'})`;
  }
  if (receipt.wait?.reached !== summary.wait_reached) {
    return `receipt wait.reached (${String(receipt.wait?.reached)}) does not match the summary wait_reached (${String(summary.wait_reached)})`;
  }
  return null;
}
