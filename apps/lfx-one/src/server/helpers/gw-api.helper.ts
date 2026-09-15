// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { randomUUID } from 'node:crypto';

import { Response } from 'express';

import { MicroserviceError } from '../errors';

/**
 * Resolves the upstream Gatewaze admin service base URL from the `GW_API_URL` env var.
 *
 * Mirrors `getApiGatewayBaseUrl`'s lazy-validate-on-first-use pattern: nothing reads or checks
 * this at module load, so a misconfigured deployment fails the first proxied request with a
 * clear 503 rather than crashing at startup or building a malformed upstream URL.
 *
 * Validation, beyond "is it set":
 * - Trailing slashes are rejected (not stripped). The controller resolves the caller's path
 *   against this value rather than concatenating onto it, building the base as `new URL(`${base}/`)`
 *   — so a value that already ends in `/` would make `base.pathname` end in `//` and skew the
 *   "does the resolved path stay inside the base" check that keeps a request from escaping it.
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

/**
 * Returns this response's `X-Request-Id`, setting one if it has none.
 *
 * Both the authorization middleware and the controller answer on this route, and both need the
 * header — so minting independently produced two different ids for one request, with whichever ran
 * last winning. This makes the first caller's id the request's id.
 *
 * The value is echoed into log metadata as `gw_request_id` by the controller. That is what makes
 * the header useful: pino's own `request_id` is a per-process counter, so without the echo a caller
 * quoting this header back could not be found in the logs at all.
 */
export function ensureGwRequestId(res: Response): string {
  const existing = res.getHeader('X-Request-Id');
  if (typeof existing === 'string' && existing) {
    return existing;
  }
  const id = randomUUID();
  res.setHeader('X-Request-Id', id);
  return id;
}
