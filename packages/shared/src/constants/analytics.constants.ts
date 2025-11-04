// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Temporary default values for analytics endpoints
 * TODO: These will be replaced with dynamic values from user profile/session context
 */
export const ANALYTICS_DEFAULTS = {
  /**
   * Default account ID (Microsoft Corporation)
   * Temporary fallback when no accountId is provided
   */
  ACCOUNT_ID: '0014100000Te0OKAAZ',

  /**
   * Default project ID
   * Temporary fallback when no projectId is provided
   */
  PROJECT_ID: 'a0941000002wBz9AAE',

  /**
   * Default segment ID
   * Temporary fallback when no segmentId is provided
   */
  SEGMENT_ID: '8656081c-f2fc-485f-b5f2-389ffcd5621a',
} as const;
