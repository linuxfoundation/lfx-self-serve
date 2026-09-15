// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Request } from 'express';

import { API_GW_TIMEOUT_MS, UPSTREAM_ERROR_BODY_LIMIT } from '../constants';
import { MicroserviceError } from '../errors';
import { logger } from '../services/logger.service';
import type { GatewayFetchOptions } from './gateway-fetch.helper';

/**
 * Fetches a binary body via the API gateway. Same token, timeout, and non-OK mapping as
 * `gatewayFetch` — it does not parse JSON, because a PDF is not JSON and teaching `gatewayFetch`
 * to return buffers would risk every caller that expects an object.
 *
 * A 204 or an empty 2xx is a failure here: a review-copy download with no bytes is not a
 * successful document.
 */
export async function gatewayFetchBinary(req: Request, url: string, options: GatewayFetchOptions): Promise<Buffer> {
  const token = options.bearerToken ?? req.apiGatewayToken;

  if (!token) {
    throw new MicroserviceError(
      'API Gateway token not available — check API_GW_AUDIENCE env var, auth middleware config, and server logs for M2M token failures',
      503,
      'API_GATEWAY_UNAVAILABLE',
      {
        service: options.service,
        operation: options.operation,
      }
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: options.method ?? 'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(API_GW_TIMEOUT_MS),
    });
  } catch (error: unknown) {
    if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
      logger.warning(req, options.operation, 'Upstream request timed out', { timeout_ms: API_GW_TIMEOUT_MS });
      throw new MicroserviceError(`${options.errorMessage}: request timed out after ${API_GW_TIMEOUT_MS}ms`, 504, 'UPSTREAM_TIMEOUT', {
        operation: options.operation,
        service: options.service,
      });
    }

    const cause = (error as (Error & { cause?: { code?: string } }) | undefined)?.cause;
    const networkCode = cause?.code ?? 'UPSTREAM_UNREACHABLE';
    const message = error instanceof Error ? error.message : String(error);

    logger.warning(req, options.operation, 'Upstream request failed before response', {
      error_code: networkCode,
      error_message: message,
    });

    throw new MicroserviceError(`${options.errorMessage}: ${message}`, 502, networkCode, {
      operation: options.operation,
      service: options.service,
    });
  }

  if (!upstream.ok) {
    const body = options.redactResponseBody
      ? await discardResponseBody(upstream.body)
      : (await upstream.text().catch(() => '')).slice(0, UPSTREAM_ERROR_BODY_LIMIT);
    const loggableBody = options.redactResponseBodyFromLogs ? undefined : body;
    const logContext = {
      status: upstream.status,
      status_text: upstream.statusText,
      ...(loggableBody === undefined ? { body_redacted: true } : { body: loggableBody }),
    };

    logger.warning(req, options.operation, 'Upstream returned non-OK response', logContext);

    throw new MicroserviceError(`${options.errorMessage}: ${upstream.status} ${upstream.statusText}`, upstream.status, options.errorCode, {
      operation: options.operation,
      service: options.service,
      ...(body === undefined ? {} : { errorBody: body }),
    });
  }

  const bytes = Buffer.from(await upstream.arrayBuffer());
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

async function discardResponseBody(body: ReadableStream<Uint8Array> | null): Promise<void> {
  if (!body) return;

  const reader = body.getReader();
  try {
    while (!(await reader.read()).done) {
      // Drain without retaining response content so the connection can be reused.
    }
  } catch {
    await reader.cancel().catch(() => undefined);
  } finally {
    reader.releaseLock();
  }
}
