// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { TRANSIENT_RETRY_DELAY_MS } from '@lfx-one/shared/constants';
import { MonoTypeOperatorFunction, retry, throwError, timer } from 'rxjs';

/**
 * Extracts a user-friendly error message from an HttpErrorResponse.
 * Prefers the server's own message when the body carries one; falls back to
 * status-code hints, then the provided fallback string.
 *
 * The body's `error` key is read as well as `message`, because `error` is the one this server
 * actually sends — `BaseApiError.toResponse()` emits `{ error, code }` and no `message`. Reading only
 * `message` left every branch below on its hard-coded string, so a server validation reason never
 * reached the ~13 committee and profile call sites.
 */
export function getHttpErrorDetail(err: HttpErrorResponse, fallback: string): string {
  const body = err.error as { message?: string; error?: string } | string | null;
  const upstream = typeof body === 'string' ? undefined : [body?.message, body?.error].find((value) => typeof value === 'string' && value.trim().length > 0);

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
 *
 * `body.error` is read as well as `body.message` because that is the key this server's error
 * envelope actually uses — `BaseApiError.toResponse()` emits `{ error, code }` and no `message`.
 *
 * When the body yields nothing, the caller's `fallback` wins over `HttpErrorResponse.message`.
 * Angular fills that property in for every failure with a string built for a developer reading a
 * console — "Http failure response for /public/api/...: 0 Unknown Error" — so preferring it would
 * put a URL and a status code in front of a user on exactly the failures where the body is empty:
 * a network drop, or a 500 with no envelope. Call sites are expected to pass a written-for-a-human
 * fallback; that is the one to show.
 */
export function extractErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof HttpErrorResponse) {
    const body = error.error as { message?: string; error?: string } | string | null;
    if (typeof body === 'string' && body.trim().length > 0) return body;
    if (body && typeof body === 'object') {
      const candidate = [body.message, body.error].find((value): value is string => typeof value === 'string' && value.trim().length > 0);
      if (candidate) return candidate;
    }
    return fallback;
  }

  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

/**
 * Whether an error is worth retrying — a beat of time could plausibly fix a network drop (0),
 * rate limit (429), request timeout (408), or upstream 5xx, but not a client error like an
 * expired session (401) or a permission/not-found response (403/404).
 *
 * 408 is in the list despite being a 4xx because in this app it is not a client error at all:
 * it is the status this server mints for its OWN abort, when an upstream microservice call
 * exceeds the configured timeout (`ApiClientService.executeRequest`). Nothing about the request
 * is wrong, and the next attempt may well land inside the budget — treating it as permanent
 * would abandon exactly the case retrying exists for. The rest of the 4xx range keeps failing
 * fast, so authentication and validation errors still surface on the first response.
 */
export function isTransientHttpError(error: unknown): boolean {
  return error instanceof HttpErrorResponse && (error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500);
}

/**
 * RxJS `retry` config shared by every transient-error retry in the app — one retry policy,
 * defined once, so `count`/delay can't drift between call sites the way a copy-pasted
 * `retry({...})` block can. `count` defaults to 1; pass a different value for a call site that
 * deliberately retries more (e.g. a user-triggered list load can afford to try harder than a
 * bootstrap-critical fetch).
 */
export function retryTransientHttpError<T>(count: number = 1): MonoTypeOperatorFunction<T> {
  return retry({
    count,
    delay: (error: unknown) => (isTransientHttpError(error) ? timer(TRANSIENT_RETRY_DELAY_MS) : throwError(() => error)),
  });
}
