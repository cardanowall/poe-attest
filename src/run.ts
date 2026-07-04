// The orchestrator: read inputs, acquire the CLI, spawn it, interpret the
// outcome, publish outputs / summary / artifact / release, and decide the step's
// success. The result-interpretation seam (`interpretResult`) is factored out so
// the outcome mapping can be tested against a canned spawn result.

import * as fs from 'node:fs/promises';

import * as core from '@actions/core';

import { acquireCli } from './acquire';
import { attachToRelease } from './release';
import { uploadArtifacts } from './artifact';
import { readInputs, type Config } from './inputs';
import {
  buildOutputs,
  crossCheckReceipt,
  failureMessage,
  isPending,
  parseSummary,
  type ActionOutputs,
  type AttestReceipt,
  type AttestSummary,
} from './outcome';
import { resolveTarget } from './platform';
import { buildArgs, buildChildEnv, spawnCli, type SpawnFn, type SpawnResult } from './run-cli';
import { writeStepSummary } from './summary';

/** Dependencies the orchestrator injects; overridden in tests. */
export interface RunDeps {
  spawn: SpawnFn;
}

const defaultDeps: RunDeps = { spawn: spawnCli };

/** The interpreted result of one CLI run. */
export type InterpretedOutcome =
  | { kind: 'failure'; message: string }
  | {
      kind: 'success' | 'pending';
      summary: AttestSummary;
      receipt: AttestReceipt | null;
      outputs: ActionOutputs;
    };

async function readReceipt(receiptPath: string): Promise<AttestReceipt | null> {
  try {
    return JSON.parse(await fs.readFile(receiptPath, 'utf8')) as AttestReceipt;
  } catch {
    return null;
  }
}

/**
 * Interpret a spawn result. Exit 0 is success, exit 3 is pending (all outputs
 * still land, the receipt was fully written), and 1/2/4 are failures with no
 * summary. The receipt is read for the signer and the pending flag.
 */
export async function interpretResult(
  config: Config,
  result: SpawnResult,
): Promise<InterpretedOutcome> {
  if (result.exitCode !== 0 && result.exitCode !== 3) {
    return { kind: 'failure', message: failureMessage(result.exitCode, result.stderr) };
  }
  const summary = parseSummary(result.stdout);

  // The action always passes --receipt-out, so on a success/pending exit the
  // receipt must exist and agree with the summary. Absence or a mismatch means
  // our own outputs are inconsistent, which we treat as an integrity failure.
  const receipt = await readReceipt(config.receiptOut);
  if (receipt === null) {
    return {
      kind: 'failure',
      message: `integrity: the attest receipt at ${config.receiptOut} was not written or could not be parsed`,
    };
  }
  const mismatch = crossCheckReceipt(summary, receipt);
  if (mismatch !== null) {
    return { kind: 'failure', message: `integrity: ${mismatch}` };
  }

  const outputs = buildOutputs(summary, receipt, config);
  const pending = isPending(summary, result.exitCode);
  return { kind: pending ? 'pending' : 'success', summary, receipt, outputs };
}

function setOutputs(outputs: ActionOutputs): void {
  for (const [name, value] of Object.entries(outputs)) core.setOutput(name, value);
}

/** Run the action end to end. */
export async function run(deps: RunDeps = defaultDeps): Promise<void> {
  const config = readInputs();
  const target = resolveTarget();
  const binaryPath = await acquireCli(config, target);

  // The action owns the certificates directory: recreate it empty so no stale or
  // planted (symlinked) entry from a previous step can be uploaded or attached.
  if (config.certificates) {
    await fs.rm(config.certificatesDir, { recursive: true, force: true });
    await fs.mkdir(config.certificatesDir, { recursive: true });
  }

  const args = buildArgs(config);
  const env = buildChildEnv(process.env, config.apiKey);
  core.info(`Running cardanowall attest (${config.mode} mode) ...`);
  const result = await deps.spawn(binaryPath, args, {
    cwd: config.workingDirectory,
    env,
    stdin: config.seed,
  });

  const outcome = await interpretResult(config, result);
  if (outcome.kind === 'failure') {
    core.setFailed(outcome.message);
    return;
  }

  setOutputs(outcome.outputs);
  await writeStepSummary({
    summary: outcome.summary,
    receipt: outcome.receipt,
    outputs: outcome.outputs,
    pending: outcome.kind === 'pending',
  });
  await uploadArtifacts(config, outcome.summary);
  await attachToRelease(config, outcome.summary);

  if (outcome.kind === 'pending') {
    const message =
      `Publish is still pending (wait '${config.wait}' timed out after ${config.timeout}s). ` +
      `The transaction continues on the gateway; record id ${outcome.outputs['record-id']}.`;
    if (config.failOnTimeout) core.setFailed(message);
    else core.warning(message);
  }
}
