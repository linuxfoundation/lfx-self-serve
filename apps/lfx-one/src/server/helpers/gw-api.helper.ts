// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MicroserviceError } from '../errors';

/**
 * Resolves the upstream Gatewaze admin service base URL from the `GW_API_URL` env var.
 *
 * Mirrors `getApiGatewayBaseUrl`'s lazy-validate-on-first-use pattern: nothing reads or checks
 * this at module load, so a misconfigured deployment fails the first proxied request with a
 * clear 503 rather than crashing at startup or building a malformed upstream URL.
 *
 * Validation, beyond "is it set":
 * - Trailing slashes are rejected (not stripped) so `gw-proxy.controller.ts`'s naive
 *   `${base}${req.url}` concatenation can't silently produce a double slash.
 * - Outside `NODE_ENV` values of `development`/`local`/`test`, the URL must be `https:` — this
 *   proxy forwards `Authorization` and (for non-GET/HEAD requests) the full request body
 *   upstream, so an accidental `http://` target in a real environment would leak both in transit.
 *
 * @param operation - Logical operation name for error metadata (e.g. `gw_proxy_request`).
 */
export function getGwApiBaseUrl(operation: string): string {
  const gwApiUrl = process.env['GW_API_URL'];

  if (!gwApiUrl || !gwApiUrl.trim()) {
    throw new MicroserviceError('GW_API_URL environment variable is not configured', 503, 'GW_API_URL_MISCONFIGURED', {
      operation,
      service: 'gw_proxy',
    });
  }

  const trimmed = gwApiUrl.trim();

  if (trimmed.endsWith('/')) {
    throw new MicroserviceError('GW_API_URL must not have a trailing slash', 503, 'GW_API_URL_MISCONFIGURED', {
      operation,
      service: 'gw_proxy',
    });
  }

  const nodeEnv = (process.env['NODE_ENV'] || '').toLowerCase();
  const isDevLocal = nodeEnv === 'development' || nodeEnv === 'local' || nodeEnv === 'test';

  if (!isDevLocal && !trimmed.startsWith('https://')) {
    throw new MicroserviceError('GW_API_URL must use https:// outside local development', 503, 'GW_API_URL_MISCONFIGURED', {
      operation,
      service: 'gw_proxy',
    });
  }

  return trimmed;
}
