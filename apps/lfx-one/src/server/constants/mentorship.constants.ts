// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// ---------------------------------------------------------------------------
// Mentorship service — Server-Only Constants
// ---------------------------------------------------------------------------

/** Upstream path that creates (or refreshes) the signed-in user's local mentorship record. */
export const MENTORSHIP_BOOTSTRAP_PATH = '/mentorship/v1/me';

/**
 * The `error` the mentorship service returns with a 401 when the signed-in user has no local
 * record yet. Every authenticated mentorship route except `PUT /me` answers this way until
 * that call has run once for the user.
 */
export const MENTORSHIP_NOT_PROVISIONED_ERROR = 'local user is not provisioned';

/** Upstream path that lists the signed-in user's own `user_profiles` rows (filter with `profile_type`). */
export const MENTORSHIP_ME_PROFILES_PATH = `${MENTORSHIP_BOOTSTRAP_PATH}/profiles`;
