// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * The upstream `domain.ErrorType` values (#2269/lfx-v2-meeting-service#281), stringified. Single
 * source of truth for both the compile-time `PreferredEmailErrorType` union (see
 * `user-profile.interface.ts`) and the runtime allow-list `asKnownErrorType` validates against, so
 * the two can't drift independently — adding a value here is enough for both.
 */
export const PREFERRED_EMAIL_ERROR_TYPE = {
  VALIDATION: 'validation',
  FORBIDDEN: 'forbidden',
  NOT_FOUND: 'not_found',
  CONFLICT: 'conflict',
  INTERNAL: 'internal',
  UNAVAILABLE: 'unavailable',
} as const;

/**
 * The upstream `code` value for "email not yet synced from Auth0 to SFDC" (#2269/#2270) — the one
 * case that needs finer resolution than `type` gives. Single source of truth shared by
 * `PreferredEmailErrorCode` (`user-profile.interface.ts`) and the runtime checks in
 * `meeting-preference.service.ts`, so they can't drift independently.
 */
export const PREFERRED_EMAIL_ERROR_CODE = {
  EMAIL_NOT_SYNCED: 'email_not_synced',
} as const;
