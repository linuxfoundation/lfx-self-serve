// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { AbstractControl } from '@angular/forms';
import { describe, expect, it } from 'vitest';

import { githubRepoUrlValidator } from './github-repo-url.validator';

// ValidatorFn only reads control.value, so a bare object stands in for an AbstractControl.
function control(value: unknown): AbstractControl {
  return { value } as AbstractControl;
}

/**
 * The intake refuses a repo URL that provably cannot yield a README — an
 * organization URL like `https://github.com/aaif` is the case that reached a
 * live run, was dropped server-side, and came back as a thinner document with
 * no explanation. Blocking is a UI decision, not an agent-contract one: the
 * agent still tolerates a missing README, and the question wording is
 * unchanged; what the collection UI stops doing is accepting an answer it
 * knows will not work.
 */
describe('githubRepoUrlValidator', () => {
  const validate = (value: unknown): Record<string, unknown> | null => githubRepoUrlValidator()(control(value));

  it('accepts repository URLs, including deeper paths, .git suffixes and schemeless input', () => {
    for (const value of [
      'https://github.com/example-org/example-repo',
      'https://github.com/example-org/example-repo/blob/main/README.md',
      'https://github.com/example-org/example-repo.git',
      'github.com/example-org/example-repo',
      '  https://github.com/example-org/example-repo  ',
    ]) {
      expect(validate(value)).toBeNull();
    }
  });

  it('rejects an organization URL with the organization reason', () => {
    expect(validate('https://github.com/aaif')).toEqual({ githubRepoUrl: { reason: 'organization' } });
  });

  it('rejects a non-GitHub or malformed URL with the unrecognized reason', () => {
    for (const value of ['https://gitlab.com/example-org/example-repo', 'https://github.com.evil.example/example-org/example-repo', 'not a url at all']) {
      expect(validate(value)).toEqual({ githubRepoUrl: { reason: 'unrecognized' } });
    }
  });

  it('rejects github.com’s own reserved routes, which read positionally as owner/repo', () => {
    // Blocking regression: `/orgs/<org>/repositories` used to validate as the
    // repository `orgs/<org>` and reach the BFF as a guaranteed 404.
    for (const value of [
      'https://github.com/orgs/aaif/repositories',
      'https://github.com/orgs/aaif',
      'https://github.com/marketplace/actions/checkout',
      'https://github.com/settings/profile',
      'https://github.com/topics/kubernetes',
    ]) {
      expect(validate(value)).toEqual({ githubRepoUrl: { reason: 'unrecognized' } });
    }
  });

  it('rejects an owner GitHub could never assign, before the BFF pays for the 404', () => {
    for (const value of ['https://github.com/bad_owner/example-repo', 'https://github.com/-example-org/example-repo']) {
      expect(validate(value)).toEqual({ githubRepoUrl: { reason: 'unrecognized' } });
    }
    // Repository names keep the looser rule.
    expect(validate('https://github.com/example-org/example_repo.v2')).toBeNull();
  });

  it('rejects a repository name past GitHub’s 100-character limit', () => {
    expect(validate(`https://github.com/example-org/${'r'.repeat(101)}`)).toEqual({ githubRepoUrl: { reason: 'unrecognized' } });
    expect(validate(`https://github.com/example-org/${'r'.repeat(100)}`)).toBeNull();
  });

  it('leaves emptiness to `required` so the two never double-report', () => {
    expect(validate('')).toBeNull();
    expect(validate('   ')).toBeNull();
    expect(validate(null)).toBeNull();
    expect(validate(undefined)).toBeNull();
  });
});
