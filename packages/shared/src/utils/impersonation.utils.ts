// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
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
 * Raw upstream text stays on the server (`errorBody`); it is never the user message.
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

/** Dialog-safe copy for POST /api/impersonate failures. Never returns upstream text. */
export function resolveImpersonationStartErrorMessage(code: string | undefined): string {
  if (code === IMPERSONATION_TARGET_USER_NOT_FOUND_CODE) {
    return IMPERSONATION_USER_NOT_FOUND_MESSAGE;
  }

  return IMPERSONATION_START_FAILED_MESSAGE;
}
