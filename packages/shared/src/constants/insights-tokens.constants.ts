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
  NOT_ENABLED: 'not_enabled',
} as const;

/** Characters rejected in token names (C0 controls and DEL). */
// eslint-disable-next-line no-control-regex
export const INSIGHTS_TOKEN_NAME_CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/** Eligibility for a caller the `insights-public-api-token-access` flag is off for. */
export const INSIGHTS_TOKEN_INELIGIBLE: InsightsTokenEligibility = { canCreate: false, checkFailed: false };

/** Eligibility for a caller the `insights-public-api-token-access` flag is on for. */
export const INSIGHTS_TOKEN_ELIGIBLE: InsightsTokenEligibility = { canCreate: true, checkFailed: false };

/** Fail-closed eligibility the browser uses when the eligibility request itself fails. */
export const INSIGHTS_TOKEN_ELIGIBILITY_UNAVAILABLE: InsightsTokenEligibility = { canCreate: false, checkFailed: true };

/**
 * LFX Insights documentation, linked from the token group and reveal dialog.
 * TODO: Temporary link, not the final API docs. Replace it with the public API reference once it is published.
 */
export const INSIGHTS_PUBLIC_API_DOCS_URL = 'https://insights.linuxfoundation.org/docs/introduction/what-is-insights/';

/** How long the reveal dialog shows "Copied" before reverting to "Copy". */
export const INSIGHTS_TOKEN_COPIED_RESET_MS = 2000;

/** Inline create-dialog copy per `upstreamCode`; unknown codes fall back to `INSIGHTS_TOKEN_CREATE_FALLBACK_ERROR`. */
export const INSIGHTS_TOKEN_ERROR_MESSAGES: Record<InsightsTokenErrorCode, string> = {
  [INSIGHTS_TOKEN_ERROR_CODES.NAME_TAKEN]: 'You already have a token with this name. Choose a different name.',
  [INSIGHTS_TOKEN_ERROR_CODES.LIMIT_REACHED]: "You've reached the maximum number of LFX Insights API tokens. Revoke one you no longer use, then try again.",
  [INSIGHTS_TOKEN_ERROR_CODES.NOT_ENABLED]: "LFX Insights API tokens aren't enabled for your account yet.",
};

export const INSIGHTS_TOKEN_CREATE_FALLBACK_ERROR = "We couldn't create the token. Please try again.";
