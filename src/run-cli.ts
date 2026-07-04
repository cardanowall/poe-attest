// Building and running the `cardanowall attest` child process. Argv and child
// env are pure functions (unit-tested exhaustively); the spawn itself is behind
// an injectable seam so tests exercise the orchestration without a real process.

import { spawn } from 'node:child_process';

import type { Config } from './inputs';

/** The result of one CLI invocation. */
export interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Options for a single spawn. */
export interface SpawnOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** Written to the child's stdin then closed; null closes stdin empty. */
  stdin: string | null;
}

/** The injectable child-process seam. */
export type SpawnFn = (
  binPath: string,
  args: string[],
  options: SpawnOptions,
) => Promise<SpawnResult>;

/**
 * Build the full `cardanowall` argv. Always machine-readable (`--json`),
 * never colored, and always writing a receipt. The base URL rides argv; the API
 * key rides the child env; the seed rides stdin, none of them touch argv.
 */
export function buildArgs(config: Config): string[] {
  const args: string[] = ['attest', '--json', '--no-color', '--base-url', config.gatewayUrl];

  switch (config.mode) {
    case 'paths':
      for (const glob of config.paths) args.push('--paths', glob);
      if (config.anchorManifest) args.push('--anchor-manifest');
      args.push('--manifest-out', config.manifestOut);
      break;
    case 'commits':
      args.push('--commits', config.commits);
      break;
    case 'leaves':
      for (const leaf of config.leaves) args.push('--leaf', leaf);
      break;
  }

  args.push('--publish', config.publish);
  args.push('--wait', config.wait);
  args.push('--timeout', String(config.timeout));
  args.push('--idempotency-key', config.idempotencyKey);
  args.push('--network', config.network);
  args.push('--receipt-out', config.receiptOut);

  if (config.maxUsd !== null) args.push('--max-usd', config.maxUsd);
  if (config.supersedes !== null) args.push('--supersedes', config.supersedes);
  if (config.certificates) args.push('--certificates-dir', config.certificatesDir);
  if (config.seed !== null) args.push('--seed-stdin');

  return args;
}

/**
 * Compose the child environment explicitly. Every `CARDANOWALL_*` variable is
 * stripped from the inherited environment first, a dirty self-hosted runner
 * must never inject a base URL, API key, seed, or gateway profile behind the
 * user's back, then exactly the API key is set. The base URL is passed via argv
 * and the seed via stdin, so neither appears here.
 */
export function buildChildEnv(baseEnv: NodeJS.ProcessEnv, apiKey: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    // Case-insensitive: Windows environment variable names are not case-sensitive,
    // so a dirty `cardanowall_seed` must be stripped just like `CARDANOWALL_SEED`.
    if (key.toUpperCase().startsWith('CARDANOWALL_')) continue;
    if (value !== undefined) env[key] = value;
  }
  env['CARDANOWALL_API_KEY'] = apiKey;
  return env;
}

/**
 * Default spawn implementation: stream the child's stderr straight to the step
 * log (the CLI's own progress lines), capture stdout for the JSON summary, feed
 * the seed on stdin, and resolve with the exit code and captured streams.
 */
export const spawnCli: SpawnFn = (binPath, args, options) =>
  new Promise<SpawnResult>((resolve, reject) => {
    const child = spawn(binPath, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });

    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });

    if (child.stdin) {
      // The child may exit before draining stdin (e.g. a fast usage error);
      // swallow the resulting EPIPE so it does not crash the action.
      child.stdin.on('error', () => {});
      if (options.stdin !== null) child.stdin.write(options.stdin);
      child.stdin.end();
    }
  });
