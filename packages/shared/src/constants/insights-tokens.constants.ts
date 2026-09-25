// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { InsightsTokenEligibility, InsightsTokenErrorCode } from '../interfaces/insights-tokens.interface';

/** PAT service audience slug for LFX Insights public API tokens. Always set server-side. */
export const INSIGHTS_TOKEN_AUDIENCE = 'insights';

/** Prefix of every Insights token secret (`lfi_` + 12-char lookup id + 32 random chars). */
export const INSIGHTS_TOKEN_PREFIX = 'lfi_';

/** Mirrors the PAT service's `TokenNameMaxLength`. */
export const INSIGHTS_TOKEN_NAME_MAX_LENGTH = 100;

/** Example Insights public API endpoint used in the reveal dialog's usage snippet (from the design prototype). */
export const INSIGHTS_PUBLIC_API_EXAMPLE_URL = 'https://api.insights.linuxfoundation.org/v1/projects';

/** Stable error codes surfaced to the UI as `upstreamCode`. */
export const INSIGHTS_TOKEN_ERROR_CODES = {
  NAME_TAKEN: 'token_name_taken',
  LIMIT_REACHED: 'token_limit_reached',
  NOT_KEY_CONTACT: 'not_key_contact',
  ELIGIBILITY_UNAVAILABLE: 'eligibility_unavailable',
} as const;

/** Characters rejected in token names (C0 controls and DEL). */
// eslint-disable-next-line no-control-regex
export const INSIGHTS_TOKEN_NAME_CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/** Fail-closed eligibility for a caller confirmed not to be a Key Contact. */
export const INSIGHTS_TOKEN_INELIGIBLE: InsightsTokenEligibility = { canCreate: false, orgs: [], checkFailed: false };

/** Fail-closed eligibility when the Key Contact check itself could not complete (upstream error). */
export const INSIGHTS_TOKEN_ELIGIBILITY_UNAVAILABLE: InsightsTokenEligibility = { canCreate: false, orgs: [], checkFailed: true };

/** LFX Insights public API documentation, linked from the token group and reveal dialog. */
export const INSIGHTS_PUBLIC_API_DOCS_URL = 'https://docs.linuxfoundation.org/lfx/insights';

/** How long the reveal dialog shows "Copied" before reverting to "Copy". */
export const INSIGHTS_TOKEN_COPIED_RESET_MS = 2000;

/** Inline create-dialog copy per `upstreamCode`; unknown codes fall back to `INSIGHTS_TOKEN_CREATE_FALLBACK_ERROR`. */
export const INSIGHTS_TOKEN_ERROR_MESSAGES: Record<InsightsTokenErrorCode, string> = {
  [INSIGHTS_TOKEN_ERROR_CODES.NAME_TAKEN]: 'You already have a token with this name. Choose a different name.',
  [INSIGHTS_TOKEN_ERROR_CODES.LIMIT_REACHED]: "You've reached the maximum number of LFX Insights API tokens. Revoke one you no longer use, then try again.",
  [INSIGHTS_TOKEN_ERROR_CODES.NOT_KEY_CONTACT]: 'Only Key Contacts can create LFX Insights tokens.',
  [INSIGHTS_TOKEN_ERROR_CODES.ELIGIBILITY_UNAVAILABLE]: "We couldn't verify your Key Contact status right now. Please try again in a few minutes.",
};

export const INSIGHTS_TOKEN_CREATE_FALLBACK_ERROR = "We couldn't create the token. Please try again.";
