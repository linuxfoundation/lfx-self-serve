// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Request } from 'express';

import { MicroserviceError } from '../errors';
import { logger } from '../services/logger.service';
import { fetchGatewayResponse, rethrowGatewayTransportFailure, type GatewayFetchOptions } from './gateway-fetch.helper';

/**
 * Fetches a binary body via the API gateway. Same token, timeout, and non-OK mapping as
 * `gatewayFetch` — it does not parse JSON, because a PDF is not JSON and teaching `gatewayFetch`
 * to return buffers would risk every caller that expects an object.
 *
 * A 204 or an empty 2xx is a failure here: a review-copy download with no bytes is not a
 * successful document.
 */
export async function gatewayFetchBinary(req: Request, url: string, options: GatewayFetchOptions): Promise<Buffer> {
  const upstream = await fetchGatewayResponse(req, url, options);
  let bytes: Buffer;
  try {
    bytes = Buffer.from(await upstream.arrayBuffer());
  } catch (error: unknown) {
    rethrowGatewayTransportFailure(req, options, error);
  }
  if (bytes.length === 0) {
    logger.warning(req, options.operation, 'Upstream returned empty response body', {
      status: upstream.status,
      status_text: upstream.statusText,
    });
    throw new MicroserviceError(`${options.errorMessage}: empty response from upstream`, 502, 'UPSTREAM_INVALID_RESPONSE', {
      operation: options.operation,
      service: options.service,
    });
  }

  return bytes;
}
