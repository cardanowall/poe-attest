// Best-effort upload of the receipt, manifest, and inclusion certificates as a
// workflow artifact. The anchor has already succeeded by the time this runs, so
// every failure here is a warning, never a step failure.

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import * as core from '@actions/core';
import { DefaultArtifactClient } from '@actions/artifact';

import type { Config, UploadArtifact } from './inputs';
import type { AttestSummary } from './outcome';
import { errorMessage } from './util';

/**
 * Decide whether to upload. `auto` uploads on github.com and skips on GHES,
 * where the artifact backend is not always available; `true`/`false` force it.
 */
export function shouldUpload(
  mode: UploadArtifact,
  serverUrl: string | undefined,
): { upload: boolean; reason: string } {
  if (mode === 'true') return { upload: true, reason: 'upload-artifact: true' };
  if (mode === 'false') return { upload: false, reason: 'upload-artifact: false' };
  const isDotCom = (serverUrl ?? 'https://github.com') === 'https://github.com';
  return isDotCom
    ? { upload: true, reason: 'upload-artifact: auto (github.com)' }
    : {
        upload: false,
        reason:
          'upload-artifact: auto, skipped on GitHub Enterprise Server (set upload-artifact: true to force)',
      };
}

/** True only for an existing regular file. lstat means a symlink is rejected. */
async function isRegularFile(filePath: string): Promise<boolean> {
  try {
    return (await fs.lstat(filePath)).isFile();
  } catch {
    return false;
  }
}

/** True when `filePath`'s real path is a direct descendant of `dir`'s real path. */
async function isContainedIn(filePath: string, dir: string): Promise<boolean> {
  try {
    const realDir = await fs.realpath(dir);
    const realFile = await fs.realpath(filePath);
    return realFile.startsWith(realDir + path.sep);
  } catch {
    return false;
  }
}

/**
 * Gather the absolute paths of the output files to publish. Only regular files
 * are included (never symlinks, so a planted link cannot exfiltrate an arbitrary
 * file through the artifact or a release asset), and certificate entries must
 * additionally resolve inside the action-owned certificates directory.
 */
export async function collectArtifactFiles(
  config: Config,
  summary: AttestSummary,
): Promise<string[]> {
  const files: string[] = [];
  if (await isRegularFile(config.receiptOut)) files.push(config.receiptOut);
  if (summary.manifest_path !== undefined && (await isRegularFile(summary.manifest_path))) {
    files.push(summary.manifest_path);
  }
  if ((summary.certificates_written ?? 0) > 0) {
    let entries: string[];
    try {
      entries = await fs.readdir(config.certificatesDir);
    } catch {
      entries = [];
    }
    for (const entry of entries) {
      const full = path.join(config.certificatesDir, entry);
      if ((await isRegularFile(full)) && (await isContainedIn(full, config.certificatesDir))) {
        files.push(full);
      }
    }
  }
  return files;
}

/** Upload the receipt/manifest/certificates artifact; warn (never fail) on error. */
export async function uploadArtifacts(config: Config, summary: AttestSummary): Promise<void> {
  const decision = shouldUpload(config.uploadArtifact, process.env['GITHUB_SERVER_URL']);
  if (!decision.upload) {
    core.info(decision.reason);
    return;
  }
  try {
    const files = await collectArtifactFiles(config, summary);
    if (files.length === 0) {
      core.warning('No receipt/manifest/certificate files were found to upload.');
      return;
    }
    const client = new DefaultArtifactClient();
    const { id } = await client.uploadArtifact(config.artifactName, files, config.workingDirectory);
    core.info(
      `Uploaded artifact '${config.artifactName}' (${files.length} file(s), id ${id ?? 'unknown'}).`,
    );
  } catch (error) {
    core.warning(`Artifact upload failed (the anchor already succeeded): ${errorMessage(error)}`);
  }
}
