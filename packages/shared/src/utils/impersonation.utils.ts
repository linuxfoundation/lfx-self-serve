// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  IMPERSONATION_ALREADY_TARGET_CODE,
  IMPERSONATION_ALREADY_TARGET_MESSAGE,
  IMPERSONATION_SEARCH_FAILED_CODE,
  IMPERSONATION_SEARCH_FAILED_MESSAGE,
  IMPERSONATION_SEARCH_FORBIDDEN_CODE,
  IMPERSONATION_SEARCH_FORBIDDEN_MESSAGE,
  IMPERSONATION_SEARCH_INVALID_CODE,
  IMPERSONATION_SEARCH_INVALID_MESSAGE,
  IMPERSONATION_SEARCH_UNAVAILABLE_CODE,
  IMPERSONATION_SEARCH_UNAVAILABLE_MESSAGE,
  IMPERSONATION_START_FAILED_MESSAGE,
  IMPERSONATION_TARGET_USER_NOT_FOUND_CODE,
  IMPERSONATION_USER_NOT_FOUND_MESSAGE,
} from '../constants/impersonation.constants';

/**
 * True when the auth-service / Auth0 CTE failure is a target-identity miss.
 *
 * Auth0 denies with `target_user_not_found`. The auth-service HTTP client
 * currently swallows that body and returns
 * `token exchange request failed: upstream returned status 400` instead.
 */
export function isImpersonationTargetLookupFailure(upstreamError: string): boolean {
  const normalized = upstreamError.trim().toLowerCase();
  return normalized.startsWith('target_user_not_found') || normalized.includes('upstream returned status 400');
}

/**
 * Maps a failed CTE NATS `result.error` string to the public API error shape.
 * Raw upstream text stays on the server under a log-only `errorBody` key; it is never the user message.
 */
export function classifyImpersonationExchangeFailure(upstreamError: string): { statusCode: number; code: string; message: string } {
  if (isImpersonationTargetLookupFailure(upstreamError)) {
    return {
      statusCode: 404,
      code: IMPERSONATION_TARGET_USER_NOT_FOUND_CODE,
      message: IMPERSONATION_USER_NOT_FOUND_MESSAGE,
    };
  }

  return {
    statusCode: 400,
    code: 'CTE_EXCHANGE_FAILED',
    message: IMPERSONATION_START_FAILED_MESSAGE,
  };
}

/**
 * Maps a failed auth-service user search `error` string to the public API error shape. The auth-service replies
 * with plain text, so this keys off its stable phrases; anything unrecognised is a generic 502. Raw upstream text
 * stays on the server under a log-only `errorBody` key and is never the user message.
 */
export function classifyImpersonationSearchFailure(upstreamError: string): { statusCode: number; code: string; message: string } {
  const normalized = upstreamError.trim().toLowerCase();

  if (normalized.includes('not authorized') || normalized.includes('invalid subject_token')) {
    return { statusCode: 403, code: IMPERSONATION_SEARCH_FORBIDDEN_CODE, message: IMPERSONATION_SEARCH_FORBIDDEN_MESSAGE };
  }

  if (normalized.startsWith('query ')) {
    return { statusCode: 400, code: IMPERSONATION_SEARCH_INVALID_CODE, message: IMPERSONATION_SEARCH_INVALID_MESSAGE };
  }

  if (normalized.includes('unavailable')) {
    return { statusCode: 503, code: IMPERSONATION_SEARCH_UNAVAILABLE_CODE, message: IMPERSONATION_SEARCH_UNAVAILABLE_MESSAGE };
  }

  return { statusCode: 502, code: IMPERSONATION_SEARCH_FAILED_CODE, message: IMPERSONATION_SEARCH_FAILED_MESSAGE };
}

/** Dialog-safe copy for POST /api/impersonate failures. Never returns upstream text. */
export function resolveImpersonationStartErrorMessage(code: string | undefined): string {
  if (code === IMPERSONATION_TARGET_USER_NOT_FOUND_CODE) {
    return IMPERSONATION_USER_NOT_FOUND_MESSAGE;
  }

  if (code === IMPERSONATION_ALREADY_TARGET_CODE) {
    return IMPERSONATION_ALREADY_TARGET_MESSAGE;
  }

  return IMPERSONATION_START_FAILED_MESSAGE;
}
