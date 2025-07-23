// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Default query parameters for different microservices
 * These parameters cannot be overridden by API callers
 */
export const DEFAULT_QUERY_PARAMS: Record<string, Record<string, string>> = {
  QUERY_SERVICE: {
    v: '1',
    type: 'project',
  },
};
