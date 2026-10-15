// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

import { GithubRepoUrlError, GithubRepoUrlValidatorOptions } from '../interfaces';
import { parseGithubUrlTarget } from '../utils/github-url.utils';

/**
 * Requires a value that resolves to a single GitHub repository —
 * `github.com/<owner>/<repo>`, including deeper paths under it (a README blob
 * URL is a repository URL). Raises `{ githubRepoUrl: { reason } }`, where the
 * reason distinguishes an account URL (`github.com/<owner>`, which may be an
 * organization or a personal profile) from something that is not a GitHub
 * repository URL at all.
 *
 * With `acceptOwner`, an account URL passes too (the Brand Kit's rule: its
 * answer reaches the agent as text, no README is fetched from it, and an
 * organization URL answers "the project's GitHub repo or README" well enough
 * — hand test, 2026-10-12), so only the `unrecognized` reason remains.
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
export function githubRepoUrlValidator(options: GithubRepoUrlValidatorOptions = {}): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = typeof control.value === 'string' ? control.value.trim() : '';
    if (!value) {
      return null;
    }
    const target = parseGithubUrlTarget(value);
    if (target?.kind === 'repository') {
      return null;
    }
    if (target?.kind === 'owner' && options.acceptOwner) {
      return null;
    }
    const error: GithubRepoUrlError = { reason: target?.kind === 'owner' ? 'owner' : 'unrecognized' };
    return { githubRepoUrl: error };
  };
}
