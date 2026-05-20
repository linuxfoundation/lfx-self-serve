// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { Request } from 'express';

import { API_GW_TIMEOUT_MS, UPSTREAM_ERROR_BODY_LIMIT } from '../constants';
import { MicroserviceError } from '../errors';
import { logger } from '../services/logger.service';

export interface GatewayFetchOptions {
  operation: string;
  service: string;
  errorMessage: string;
  errorCode: string;
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** When provided, overrides req.apiGatewayToken as the Authorization token. */
  bearerToken?: string;
}

/**
 * Fetches a URL via the API gateway. Uses req.apiGatewayToken by default;
 * pass options.bearerToken to override (e.g. for user-token-authenticated calls).
 * Handles timeout (504), network failure (502), non-OK upstream responses,
 * and invalid JSON — all surfaced as MicroserviceError.
 * 204 responses return null without error; all other empty bodies are errors.
 */
export async function gatewayFetch<T>(req: Request, url: string, options: GatewayFetchOptions): Promise<T> {
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

  const hasBody = options.body !== undefined;
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: options.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(hasBody ? { body: JSON.stringify(options.body) } : {}),
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
    const body = (await upstream.text().catch(() => '')).slice(0, UPSTREAM_ERROR_BODY_LIMIT);

    logger.warning(req, options.operation, 'Upstream returned non-OK response', {
      status: upstream.status,
      status_text: upstream.statusText,
      body,
    });

    throw new MicroserviceError(`${options.errorMessage}: ${upstream.status} ${upstream.statusText}`, upstream.status, options.errorCode, {
      operation: options.operation,
      service: options.service,
      errorBody: body,
    });
  }

  const rawBody = await upstream.text();

  if (!rawBody.trim()) {
    if (upstream.status === 204) {
      return null as T;
    }

    logger.warning(req, options.operation, 'Upstream returned empty response body', {
      status: upstream.status,
      status_text: upstream.statusText,
    });

    throw new MicroserviceError(`${options.errorMessage}: empty response from upstream`, 502, 'UPSTREAM_INVALID_RESPONSE', {
      operation: options.operation,
      service: options.service,
    });
  }

  try {
    return JSON.parse(rawBody) as T;
  } catch (error: unknown) {
    const truncatedBody = rawBody.slice(0, UPSTREAM_ERROR_BODY_LIMIT);
    const message = error instanceof Error ? error.message : String(error);

    logger.warning(req, options.operation, 'Upstream returned invalid JSON response', {
      status: upstream.status,
      status_text: upstream.statusText,
      body: truncatedBody,
      error: message,
    });

    throw new MicroserviceError(`${options.errorMessage}: invalid JSON response from upstream`, 502, 'UPSTREAM_INVALID_RESPONSE', {
      operation: options.operation,
      service: options.service,
      errorBody: truncatedBody,
    });
  }
}
