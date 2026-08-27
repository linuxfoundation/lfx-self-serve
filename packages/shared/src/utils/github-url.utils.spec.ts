// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { parseGithubUrlTarget } from './github-url.utils';

/**
 * One parser serves both the intake form's inline warning and the BFF's README
 * fetch, so what it calls "a repository" is the contract both sides keep. The
 * organization case is the one that matters most: it used to be
 * indistinguishable from garbage, which is how an organization URL passed the
 * form and then produced a document with no README and no explanation.
 */
describe('parseGithubUrlTarget', () => {
  it('resolves owner/repo from a repository root URL', () => {
    expect(parseGithubUrlTarget('https://github.com/example-org/example-repo')).toEqual({ kind: 'repository', owner: 'example-org', repo: 'example-repo' });
  });

  it('resolves the repository from deeper paths, .git suffixes, and schemeless input', () => {
    for (const url of [
      'https://github.com/example-org/example-repo/blob/main/README.md',
      'https://github.com/example-org/example-repo/tree/main/src',
      'https://github.com/example-org/example-repo.git',
      'github.com/example-org/example-repo',
      'https://www.github.com/example-org/example-repo',
      '  https://github.com/example-org/example-repo  ',
    ]) {
      expect(parseGithubUrlTarget(url)).toEqual({ kind: 'repository', owner: 'example-org', repo: 'example-repo' });
    }
  });

  it('resolves an owner-only URL as an ORGANIZATION rather than rejecting it', () => {
    // The exact shape that slipped through the intake unnoticed.
    expect(parseGithubUrlTarget('https://github.com/aaif')).toEqual({ kind: 'organization', owner: 'aaif' });
    expect(parseGithubUrlTarget('github.com/example-org/')).toEqual({ kind: 'organization', owner: 'example-org' });
  });

  it('returns null for non-GitHub hosts, look-alike hosts, and malformed input', () => {
    for (const url of [
      'https://gitlab.com/example-org/example-repo',
      'https://github.com.evil.example/example-org/example-repo',
      'https://169.254.169.254/latest/meta-data',
      'not a url at all',
      '',
      '   ',
    ]) {
      expect(parseGithubUrlTarget(url)).toBeNull();
    }
  });

  it('returns null when a path segment falls outside GitHub’s character set', () => {
    expect(parseGithubUrlTarget('https://github.com/owner%2F..%2Fadmin/repo')).toBeNull();
    expect(parseGithubUrlTarget('https://github.com/owner/re po')).toBeNull();
  });

  it('returns null for a bare github.com with no owner at all', () => {
    expect(parseGithubUrlTarget('https://github.com')).toBeNull();
    expect(parseGithubUrlTarget('https://github.com/')).toBeNull();
  });
});
