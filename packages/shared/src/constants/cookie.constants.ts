// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Cookie registry key used to store the list of all LFX cookie names.
 * This cookie contains a JSON array of all registered cookie keys.
 */
export const COOKIE_REGISTRY_KEY = 'lfx-cookie-registry';

/** Default lifetime (in days) for client preference cookies (lens, persona, selected project/foundation). */
export const COOKIE_DEFAULT_EXPIRY_DAYS = 30;
