// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

import { GithubRepoUrlError } from '../interfaces';
import { parseGithubUrlTarget } from '../utils/github-url.utils';

/**
 * Requires a value that resolves to a single GitHub repository —
 * `github.com/<owner>/<repo>`, including deeper paths under it (a README blob
 * URL is a repository URL). Raises `{ githubRepoUrl: { reason } }`, where the
 * reason distinguishes an organization URL from something that is not a GitHub
 * repository URL at all.
 *
 * This BLOCKS submission on the Marketing OS intakes that collect a repo URL.
 * The distinction that makes that correct: Paul's prompt contract
 * (dec-paul-prompt-fidelity) governs what the AGENT accepts — free text, and
 * it tolerates a missing README — but it does not bind the LFX collection UI,
 * and the question wording stays verbatim either way. Product ruling: the UI
 * must not accept a URL that provably cannot yield a README, because the cost
 * lands on the user as a thinner document minutes later rather than as a
 * correction they could have made in a second.
 *
 * Emptiness is `required`'s job, not this validator's, so a blank control
 * yields no error here and the two never double-report.
 */
export function githubRepoUrlValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = typeof control.value === 'string' ? control.value.trim() : '';
    if (!value) {
      return null;
    }
    const target = parseGithubUrlTarget(value);
    if (target?.kind === 'repository') {
      return null;
    }
    const error: GithubRepoUrlError = { reason: target?.kind === 'organization' ? 'organization' : 'unrecognized' };
    return { githubRepoUrl: error };
  };
}
