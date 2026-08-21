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

  it('leaves emptiness to `required` so the two never double-report', () => {
    expect(validate('')).toBeNull();
    expect(validate('   ')).toBeNull();
    expect(validate(null)).toBeNull();
    expect(validate(undefined)).toBeNull();
  });
});
