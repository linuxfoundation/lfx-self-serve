// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { GITHUB_RESERVED_ROOT_SEGMENTS } from '../constants/github-url.constants';

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

  it('holds the OWNER to GitHub’s stricter account rules while repositories keep theirs', () => {
    // An account name cannot contain `_` or `.`, cannot lead or trail with a
    // hyphen, cannot double a hyphen, and stops at 39 characters — a URL that
    // breaks any of those names an account that cannot exist, so the README
    // request for it would 404 by construction.
    for (const url of [
      'https://github.com/bad_owner/example-repo',
      'https://github.com/bad.owner/example-repo',
      'https://github.com/-example-org/example-repo',
      'https://github.com/example-org-/example-repo',
      'https://github.com/example--org/example-repo',
      `https://github.com/${'a'.repeat(40)}/example-repo`,
    ]) {
      expect(parseGithubUrlTarget(url)).toBeNull();
    }

    // Repository names DO allow underscores and dots.
    expect(parseGithubUrlTarget('https://github.com/example-org/example_repo.v2')).toEqual({
      kind: 'repository',
      owner: 'example-org',
      repo: 'example_repo.v2',
    });
    expect(parseGithubUrlTarget(`https://github.com/${'a'.repeat(39)}/example-repo`)).toEqual({
      kind: 'repository',
      owner: 'a'.repeat(39),
      repo: 'example-repo',
    });
  });

  it('holds the repository name to GitHub’s 100-character limit, measured after the .git suffix', () => {
    expect(parseGithubUrlTarget(`https://github.com/example-org/${'r'.repeat(101)}`)).toBeNull();
    expect(parseGithubUrlTarget(`https://github.com/example-org/${'r'.repeat(100)}`)).toEqual({
      kind: 'repository',
      owner: 'example-org',
      repo: 'r'.repeat(100),
    });
    // `.git` is stripped first, so a 100-char repo written as `<name>.git` still parses.
    expect(parseGithubUrlTarget(`https://github.com/example-org/${'r'.repeat(100)}.git`)).toEqual({
      kind: 'repository',
      owner: 'example-org',
      repo: 'r'.repeat(100),
    });
  });

  it('returns null for github.com’s own reserved routes rather than reading them as an owner/repo', () => {
    // `/orgs/<org>/repositories` is what a user copies out of an organization's
    // repository list; read positionally it looks exactly like `owner/repo`.
    expect(parseGithubUrlTarget('https://github.com/orgs/aaif/repositories')).toBeNull();
    expect(parseGithubUrlTarget('https://github.com/orgs/aaif')).toBeNull();
    // Case-insensitive: the denylist is compared against a lowercased segment.
    expect(parseGithubUrlTarget('https://github.com/Orgs/aaif/repositories')).toBeNull();
  });

  // Driven off the constant itself rather than a hand-picked sample: a typo or
  // an omission in the denylist is exactly the mistake that reopens the
  // guaranteed-404 gap above, and a fixed list of examples would not see it.
  it.each([...GITHUB_RESERVED_ROOT_SEGMENTS])('refuses the reserved root segment /%s, alone and with a path under it', (segment) => {
    expect(parseGithubUrlTarget(`https://github.com/${segment}`)).toBeNull();
    expect(parseGithubUrlTarget(`https://github.com/${segment}/example-org`)).toBeNull();
    expect(parseGithubUrlTarget(`https://github.com/${segment.toUpperCase()}/example-org`)).toBeNull();
  });

  it('returns null for a bare github.com with no owner at all', () => {
    expect(parseGithubUrlTarget('https://github.com')).toBeNull();
    expect(parseGithubUrlTarget('https://github.com/')).toBeNull();
  });
});
