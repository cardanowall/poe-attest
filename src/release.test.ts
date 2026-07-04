import { describe, expect, it } from 'vitest';

import { resolveReleaseSource } from './release';

describe('resolveReleaseSource', () => {
  it('prefers an explicit release-tag', () => {
    expect(resolveReleaseSource('v1.2.3', true, 'refs/tags/v9')).toEqual({
      via: 'input',
      tag: 'v1.2.3',
    });
  });

  it('falls back to a release event payload', () => {
    expect(resolveReleaseSource(null, true, 'refs/heads/main')).toEqual({ via: 'payload' });
  });

  it('falls back to a pushed tag ref', () => {
    expect(resolveReleaseSource(null, false, 'refs/tags/v2.0.0')).toEqual({
      via: 'ref',
      tag: 'v2.0.0',
    });
  });

  it('returns null when nothing resolves a release', () => {
    expect(resolveReleaseSource(null, false, 'refs/heads/main')).toBeNull();
    expect(resolveReleaseSource('', false, undefined)).toBeNull();
  });
});
