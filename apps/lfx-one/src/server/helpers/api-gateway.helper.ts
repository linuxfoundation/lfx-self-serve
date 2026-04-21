// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MicroserviceError } from '../errors';

/**
 * Resolves the API Gateway base URL from the `API_GW_AUDIENCE` env var.
 *
 * Trailing slashes are stripped so callers can safely build paths via
 * string interpolation. Throws a `MicroserviceError` (503,
 * `API_GATEWAY_MISCONFIGURED`) when the env var is not set so misconfiguration
 * surfaces consistently across services instead of producing malformed URLs.
 *
 * @param operation - Logical operation name for error metadata (e.g. `fetch_user_profile`).
 * @param service - Calling service name for error metadata (e.g. `rewards_service`).
 */
export function getApiGatewayBaseUrl(operation: string, service: string): string {
  const apiGwAudience = process.env['API_GW_AUDIENCE'];

  if (!apiGwAudience) {
    throw new MicroserviceError('API_GW_AUDIENCE environment variable is not configured', 503, 'API_GATEWAY_MISCONFIGURED', {
      operation,
      service,
    });
  }

  return apiGwAudience.replace(/\/+$/, '');
}

/**
 * Resolves the user-service base URL (`{API_GW_AUDIENCE}/user-service/v1`).
 *
 * @param operation - Logical operation name for error metadata.
 * @param service - Calling service name for error metadata.
 */
export function getUserServiceBaseUrl(operation: string, service: string): string {
  return `${getApiGatewayBaseUrl(operation, service)}/user-service/v1`;
}
