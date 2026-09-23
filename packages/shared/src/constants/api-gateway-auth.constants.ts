// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

export const API_GATEWAY_AUTH = {
  START_PATH: '/api-gateway/auth/start',
  CALLBACK_PATH: '/api-gateway/callback',
  SCOPE: 'openid email profile access:api offline_access',
  ERROR_PARAM: 'api_gateway_error',
  TIMEOUT_MS: 10_000,
  EXPIRY_BUFFER_SECONDS: 300,
} as const;
