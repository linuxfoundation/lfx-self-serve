// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ORG_CLA_DESIGNEE_NAME_MAX, ORG_CLA_DESIGNEE_NAME_MIN, ORG_CLA_DESIGNEE_NAME_PATTERN } from '../constants/cla.constants';
import type { OrgClaDesigneeNominationRequest, OrgClaDesigneeNominationValidation, OrgClaDesigneeRefusal } from '../interfaces/cla.interface';
import { isOrgClaManagerAddEmail, orgClaRefusalCodeFrom, orgClaRefusalTextFrom } from './org-cla-manager.utils';

/**
 * The CLA service answers every designee refusal except sanctions with HTTP 400, so the reason is
 * only in its sentence. `lfx user not found` is the designee path's no-account refusal; `user has
 * no lf login` is the manager-request path's.
 */
const REFUSAL_PATTERNS: readonly (readonly [OrgClaDesigneeRefusal, readonly string[]])[] = [
  ['already-signed', ['project already signed']],
  ['no-lf-login', ['user has no lf login', 'lfx user not found']],
  ['sanctioned', ['company_sanctioned']],
];

const LF_LOGIN_REQUIRED_FRAGMENT = 'user has no lf login';

export function classifyOrgClaDesigneeRefusal(status: number, body: unknown): OrgClaDesigneeRefusal {
  if (orgClaRefusalCodeFrom(body) === 'company_sanctioned') return 'sanctioned';

  const text = orgClaRefusalTextFrom(body);
  if (text) {
    for (const [outcome, fragments] of REFUSAL_PATTERNS) {
      if (fragments.some((fragment) => text.includes(fragment))) return outcome;
    }
  }

  if (status === 401 || status === 403) return 'not-authorized';

  return 'unknown';
}

/**
 * True when a manager request was refused only because the named person has no LF Login. The CLA
 * service sends this refusal whether or not it emailed them, so it is no proof an invitation went out.
 */
export function isOrgClaDesigneeLfLoginRequired(status: number, body: unknown): boolean {
  return status === 400 && orgClaRefusalTextFrom(body).includes(LF_LOGIN_REQUIRED_FRAGMENT);
}

export function isOrgClaDesigneeFullName(value: string): boolean {
  return value.length >= ORG_CLA_DESIGNEE_NAME_MIN && value.length <= ORG_CLA_DESIGNEE_NAME_MAX && ORG_CLA_DESIGNEE_NAME_PATTERN.test(value);
}

function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function validateOrgClaDesigneeNomination(request: Partial<Record<keyof OrgClaDesigneeNominationRequest, unknown>>): OrgClaDesigneeNominationValidation {
  const result: OrgClaDesigneeNominationValidation = {};

  const fullName = trimmed(request.fullName);
  const email = trimmed(request.email);

  if (!fullName) result.fullName = 'Name is required.';
  else if (fullName.length < ORG_CLA_DESIGNEE_NAME_MIN) result.fullName = `Name must be at least ${ORG_CLA_DESIGNEE_NAME_MIN} characters.`;
  else if (fullName.length > ORG_CLA_DESIGNEE_NAME_MAX) result.fullName = `Name must be ${ORG_CLA_DESIGNEE_NAME_MAX} characters or fewer.`;
  else if (!ORG_CLA_DESIGNEE_NAME_PATTERN.test(fullName))
    result.fullName = 'Use only letters, numbers, and underscores, with single spaces between words. Accents, hyphens, and apostrophes are not accepted.';

  if (!email) result.email = 'Email address is required.';
  else if (!isOrgClaManagerAddEmail(email)) result.email = 'Enter a valid email address.';

  return result;
}

export function hasOrgClaDesigneeNominationErrors(validation: OrgClaDesigneeNominationValidation): boolean {
  return Object.keys(validation).length > 0;
}
