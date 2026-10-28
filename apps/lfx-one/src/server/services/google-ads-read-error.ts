// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ERROR_CODES, GOOGLE_ADS_NOT_CONFIGURED_MESSAGE, GOOGLE_ADS_READ_FAILED_MESSAGE } from '@lfx-one/shared/constants';

import { BaseApiError, MicroserviceError } from '../errors';

/** The BFF's own Google Ads client is missing a credential it needs before any call can be made. */
export class GoogleAdsNotConfiguredError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'GoogleAdsNotConfiguredError';
  }
}

/**
 * The 502 advisory for a failed Google Ads read. `googleAdsFailure` keeps a `GoogleAdsFailure` (which is
 * not an `Error`) whole, as an own property, so the error serializer logs its error codes, locations and
 * request id under `err` (after its credential scrub). `toResponse` never reads it, so it is log-only.
 */
export class GoogleAdsReadError extends MicroserviceError {
  public readonly googleAdsFailure?: unknown;

  public constructor(message: string, operation: string, originalError: Error, googleAdsFailure?: unknown) {
    super(message, 502, ERROR_CODES.SERVICE_ADVISORY, { operation, service: 'google_ads', originalError });
    this.name = 'GoogleAdsReadError';
    if (googleAdsFailure !== undefined) {
      this.googleAdsFailure = googleAdsFailure;
    }
  }
}

/**
 * The first Google Ads API error code on a `google-ads-api` failure (`errors[0].error_code`), kept only
 * when it looks like an enum value. The value is untrusted wire data that ends up in a rendered
 * message, so anything but a short identifier is dropped rather than shown.
 */
export function googleAdsFailureCode(error: unknown): string | null {
  const errors = (error as { errors?: unknown } | null)?.errors;
  if (!Array.isArray(errors) || errors.length === 0) {
    return null;
  }
  const errorCode = (errors[0] as { error_code?: unknown } | null)?.error_code;
  if (!errorCode || typeof errorCode !== 'object') {
    return null;
  }
  const code = Object.values(errorCode as Record<string, unknown>)[0];
  return typeof code === 'string' && /^[A-Z0-9_]{1,100}$/.test(code) ? code : null;
}

/**
 * Turns a failed read of the BFF's own Google Ads account into an error the Monitor tab can show
 * (#4526). Without this, every failure here (a missing credential, a revoked refresh token, quota, a
 * GAQL error) reached the error handler as a plain `Error` and became a 500 "Internal server error",
 * which the UI discards for its generic "Failed to load campaign data". Nothing then told an operator
 * whether the account, the credentials or the request was at fault.
 *
 * The answer carries `SERVICE_ADVISORY` because its message is written here for the reader, and
 * names at most the Google Ads error code, never the upstream's free text. The original error is
 * attached as `originalError` (logged as `original_error`) and, for a `GoogleAdsFailure`, whole as
 * `googleAdsFailure` (see {@link GoogleAdsReadError}); neither is ever sent to the client. An error that is already an API error passes through unchanged.
 */
export function toGoogleAdsReadError(error: unknown, operation: string): unknown {
  if (error instanceof BaseApiError) {
    return error;
  }
  const originalError = asLoggableError(error);
  if (error instanceof GoogleAdsNotConfiguredError) {
    return new MicroserviceError(GOOGLE_ADS_NOT_CONFIGURED_MESSAGE, 503, ERROR_CODES.SERVICE_ADVISORY, {
      operation,
      service: 'google_ads',
      originalError,
    });
  }
  const code = googleAdsFailureCode(error);
  const message = code ? `${GOOGLE_ADS_READ_FAILED_MESSAGE} Google Ads error: ${code}.` : `${GOOGLE_ADS_READ_FAILED_MESSAGE} Please try again.`;
  return new GoogleAdsReadError(message, operation, originalError, error instanceof Error ? undefined : error);
}

/**
 * `google-ads-api` rejects with a `GoogleAdsFailure`, which is not an `Error`, so it would otherwise
 * leave no `original_error` in the log. Its summary (every error's code and message, then the request
 * id) is kept for the log only and is never part of the response. The whole failure is also kept on
 * {@link GoogleAdsReadError.googleAdsFailure}; this line is what `original_error` shows at a glance.
 */
function asLoggableError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  const errors = (error as { errors?: unknown } | null)?.errors;
  const summary = (Array.isArray(errors) ? errors : [])
    .map((entry: unknown) => {
      const code = googleAdsFailureCode({ errors: [entry] }) ?? 'UNKNOWN';
      const message = (entry as { message?: unknown } | null)?.message;
      return typeof message === 'string' && message !== '' ? `${code}: ${message}` : code;
    })
    .join('; ');
  const requestId = (error as { request_id?: unknown } | null)?.request_id;
  const requestSuffix = typeof requestId === 'string' && requestId !== '' ? ` (request_id=${requestId})` : '';
  return new Error(summary === '' ? `${describeFailure(error)}${requestSuffix}` : `${summary}${requestSuffix}`);
}

/** A failure with no `errors` list, as JSON where it can be (never `[object Object]`), else its string form. */
function describeFailure(error: unknown): string {
  try {
    const json = JSON.stringify(error);
    if (typeof json === 'string') {
      return json.length > 500 ? `${json.slice(0, 500)}…` : json;
    }
  } catch {
    // A circular or otherwise unserializable value falls through to its string form.
  }
  return String(error);
}
