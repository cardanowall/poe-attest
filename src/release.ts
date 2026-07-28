// Best-effort attachment of the receipt/manifest/certificates to a GitHub
// release. Which release is resolved from (in order) the release-tag input, a
// release event payload, or a pushed tag ref. Requires `contents: write`. Like
// artifact upload, the anchor has already succeeded, so failures here warn.

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import * as core from '@actions/core';
import * as github from '@actions/github';

import { collectArtifactFiles } from './artifact';
import type { Config } from './inputs';
import type { AttestSummary } from './outcome';
import { errorMessage } from './util';

export type ReleaseSource =
  { via: 'input'; tag: string } | { via: 'payload' } | { via: 'ref'; tag: string } | null;

const TAG_REF_PREFIX = 'refs/tags/';

/**
 * Resolve which release to attach to. An explicit `release-tag` wins; otherwise
 * a `release` event's payload; otherwise a pushed tag ref. Null means no release
 * is resolvable and the caller should warn.
 */
export function resolveReleaseSource(
  explicitTag: string | null,
  hasPayloadRelease: boolean,
  ref: string | undefined,
): ReleaseSource {
  if (explicitTag !== null && explicitTag !== '') return { via: 'input', tag: explicitTag };
  if (hasPayloadRelease) return { via: 'payload' };
  if (ref !== undefined && ref.startsWith(TAG_REF_PREFIX)) {
    return { via: 'ref', tag: ref.slice(TAG_REF_PREFIX.length) };
  }
  return null;
}

interface ResolvedRelease {
  id: number;
  tag: string;
  draft: boolean;
}

/** Upload every output file to the resolved release; warn (never fail) on error. */
export async function attachToRelease(config: Config, summary: AttestSummary): Promise<void> {
  if (!config.attachToRelease) return;

  const { context } = github;
  const payloadRelease = context.payload['release'] as
    { id: number; tag_name: string; draft?: boolean } | undefined;
  const source = resolveReleaseSource(config.releaseTag, payloadRelease != null, context.ref);
  if (source === null) {
    core.warning(
      'attach-to-release is set but no release could be resolved: pass release-tag, run on a release event, or push a tag.',
    );
    return;
  }

  const octokit = github.getOctokit(config.githubToken);
  const { owner, repo } = context.repo;

  let release: ResolvedRelease;
  try {
    if (source.via === 'payload' && payloadRelease !== undefined) {
      release = {
        id: payloadRelease.id,
        tag: payloadRelease.tag_name,
        draft: payloadRelease.draft ?? false,
      };
    } else if (source.via === 'payload') {
      core.warning('Release event payload had no release object; nothing to attach to.');
      return;
    } else {
      const { data } = await octokit.rest.repos.getReleaseByTag({ owner, repo, tag: source.tag });
      release = { id: data.id, tag: data.tag_name, draft: data.draft };
    }
  } catch (error) {
    core.warning(`Could not resolve the release to attach to: ${errorMessage(error)}`);
    return;
  }

  if (release.draft) {
    core.warning(
      `Release '${release.tag}' is a draft; asset attachment may be rejected until it is published.`,
    );
  }

  const files = await collectArtifactFiles(config, summary);
  if (files.length === 0) {
    core.warning('No receipt/manifest/certificate files were found to attach to the release.');
    return;
  }

  const existing = new Map<string, number>();
  try {
    const assets = await octokit.paginate(octokit.rest.repos.listReleaseAssets, {
      owner,
      repo,
      release_id: release.id,
      per_page: 100,
    });
    for (const asset of assets) existing.set(asset.name, asset.id);
  } catch (error) {
    core.warning(`Could not list existing release assets: ${errorMessage(error)}`);
  }

  const attempted = new Set<string>();
  for (const file of files) {
    const name = path.basename(file);
    if (attempted.has(name)) {
      core.warning(`Two output files share the basename '${name}'; attaching only the first.`);
      continue;
    }
    attempted.add(name);
    try {
      const priorId = existing.get(name);
      if (priorId !== undefined) {
        if (!config.overwriteReleaseAssets) {
          core.warning(
            `Release asset '${name}' already exists; set overwrite-release-assets: true to replace it. Skipping.`,
          );
          continue;
        }
        await octokit.rest.repos.deleteReleaseAsset({ owner, repo, asset_id: priorId });
        existing.delete(name);
      }
      const data = await fs.readFile(file);
      const { data: created } = await octokit.rest.repos.uploadReleaseAsset({
        owner,
        repo,
        release_id: release.id,
        name,
        data: data as unknown as string,
      });
      existing.set(name, created.id);
      core.info(`Attached '${name}' to release '${release.tag}'.`);
    } catch (error) {
      core.warning(
        `Could not attach '${name}' to release '${release.tag}': ${errorMessage(error)}`,
      );
    }
  }
}
