// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Default query parameters for API requests to microservices
 * @description These parameters are automatically included in API requests and cannot be overridden by callers
 * @readonly
 * @example
 * // Automatically included in all API requests
 * const params = { ...DEFAULT_QUERY_PARAMS, customParam: 'value' };
 */
export const DEFAULT_QUERY_PARAMS: Record<string, string> = {
  /** API version parameter */
  v: '1',
};
