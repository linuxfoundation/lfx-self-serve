// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ORG_CLA_MANAGER_NAME_MAX, ORG_CLA_MANAGER_NAME_MIN } from '../constants/cla.constants';
import { EMAIL_REGEX } from '../constants/regex.constants';
import type { OrgClaManagerAddRequest, OrgClaManagerRefusal } from '../interfaces/cla.interface';

/**
 * Order matters. `last-manager` is checked before `not-authorized` because the sole-manager
 * refusal also mentions the manager role, and the more specific reading is the right one.
 */
const REFUSAL_PATTERNS: readonly (readonly [OrgClaManagerRefusal, readonly string[]])[] = [
  ['no-lf-login', ['does not have an lf login', 'no lf login', 'account does not exist', 'user not found in lf', 'lfid not found']],
  ['last-manager', ['only remaining cla manager', 'at least one cla manager', 'last cla manager', 'only cla manager']],
  ['already-manager', ['already a cla manager', 'already assigned', 'duplicate cla manager']],
  ['not-authorized', ['not authorized', 'unauthorized', 'forbidden', 'does not have permission', 'is not a cla manager', 'does not have access']],
];

export function classifyOrgClaManagerRefusal(status: number, body: unknown): OrgClaManagerRefusal {
  if (status === 409) return 'already-manager';

  const text = refusalTextFrom(body);
  if (text) {
    for (const [outcome, fragments] of REFUSAL_PATTERNS) {
      if (fragments.some((fragment) => text.includes(fragment))) return outcome;
    }
    if (text.includes('company_sanctioned') || text.includes('sanctioned')) return 'unknown';
  }

  if (status === 403) return 'not-authorized';

  return 'unknown';
}

function refusalTextFrom(body: unknown): string {
  if (typeof body === 'string') {
    const raw = body.trim();
    if (!raw) return '';

    try {
      return refusalTextFrom(JSON.parse(raw));
    } catch {
      return raw.toLowerCase();
    }
  }

  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    const message = record['Message'] ?? record['message'] ?? record['error'];
    if (typeof message === 'string') return message.trim().toLowerCase();
  }

  return '';
}

export interface OrgClaManagerAddValidation {
  firstName?: string;
  lastName?: string;
  email?: string;
}

// A request body is untyped on the wire, so a field can be a number, an array, or an object. The
// declared `Partial<OrgClaManagerAddRequest>` is a claim about it, not a fact — trimming without
// this narrowing turns a malformed body into a 500 inside the validator meant to answer it 400.
function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function validateOrgClaManagerAdd(request: Partial<OrgClaManagerAddRequest>): OrgClaManagerAddValidation {
  const result: OrgClaManagerAddValidation = {};

  const firstName = trimmed(request.firstName);
  const lastName = trimmed(request.lastName);
  const email = trimmed(request.email);

  const namePart = (value: string, label: string): string | undefined => {
    if (!value) return `${label} is required.`;
    if (value.length < ORG_CLA_MANAGER_NAME_MIN) return `${label} must be at least ${ORG_CLA_MANAGER_NAME_MIN} characters.`;
    if (value.length > ORG_CLA_MANAGER_NAME_MAX) return `${label} must be ${ORG_CLA_MANAGER_NAME_MAX} characters or fewer.`;
    return undefined;
  };

  const firstNameError = namePart(firstName, 'First name');
  if (firstNameError) result.firstName = firstNameError;

  const lastNameError = namePart(lastName, 'Last name');
  if (lastNameError) result.lastName = lastNameError;

  if (!email) result.email = 'Email address is required.';
  else if (!EMAIL_REGEX.test(email)) result.email = 'Enter a valid email address.';

  return result;
}

export function hasOrgClaManagerAddErrors(validation: OrgClaManagerAddValidation): boolean {
  return Object.keys(validation).length > 0;
}

/**
 * EasyCLA's delete path is `userLFID`: non-empty, no slash (so a path cannot walk out of the
 * segment). Dots and short handles are valid — that is not the Org People `PERSON_KEY_PATTERN`.
 */
export function isOrgClaManagerLfUsername(value: string): boolean {
  return value.length > 0 && !value.includes('/') && !/\s/.test(value);
}
