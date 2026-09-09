// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

export const RECENT_IMPERSONATIONS_STORAGE_KEY = 'lfx:recent-impersonations';
export const MAX_RECENT_IMPERSONATIONS = 5;

/** Error code for a CTE / auth-service rejection that we treat as "target not found". */
export const IMPERSONATION_TARGET_USER_NOT_FOUND_CODE = 'TARGET_USER_NOT_FOUND';

export const IMPERSONATION_USER_NOT_FOUND_MESSAGE =
  'We were unable to locate the user to impersonate. Please double-check the username or email address and try again.';

export const IMPERSONATION_START_FAILED_MESSAGE = 'We could not start impersonation. Please try again.';
