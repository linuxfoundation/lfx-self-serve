// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';

/**
 * Extracts a user-friendly error message from an HttpErrorResponse.
 * Prefers the upstream service message when available; falls back to
 * status-code hints, then the provided fallback string.
 */
export function getHttpErrorDetail(err: HttpErrorResponse, fallback: string): string {
  const upstream = err.error?.message as string | undefined;

  switch (err.status) {
    case 409:
      return upstream ?? 'This resource already exists.';
    case 404:
      return upstream ?? 'The resource was not found.';
    case 403:
      return upstream ?? 'You do not have permission to perform this action.';
    case 422:
      return upstream ?? 'The request contained invalid data. Please check your input.';
    case 400:
      return upstream ?? fallback;
    default:
      return upstream ?? fallback;
  }
}

/**
 * Extracts a user-facing message from an unknown error thrown by an HTTP call,
 * a thrown Error, or any other value. Used by components that catch errors
 * from `firstValueFrom(...)` or RxJS `catchError` and need to surface a
 * single string to the UI.
 */
export function extractErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof HttpErrorResponse) {
    const body = error.error as { message?: string; error?: string } | string | null;
    if (typeof body === 'string' && body.trim().length > 0) return body;
    if (body && typeof body === 'object') {
      const candidate = [body.message, body.error].find((value): value is string => typeof value === 'string' && value.trim().length > 0);
      if (candidate) return candidate;
    }
    return error.message || fallback;
  }

  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

/**
 * Whether an error is worth retrying — a beat of time could plausibly fix a network drop (0),
 * rate limit (429), or upstream 5xx, but not a client error like an expired session (401) or a
 * permission/not-found response (403/404).
 */
export function isTransientHttpError(error: unknown): boolean {
  return error instanceof HttpErrorResponse && (error.status === 0 || error.status === 429 || error.status >= 500);
}
