// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { TRANSIENT_RETRY_DELAY_MS } from '@lfx-one/shared/constants';
import { MonoTypeOperatorFunction, retry, throwError, timer } from 'rxjs';

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
    const body = error.error as { message?: string; error?: string; errors?: { message?: string }[] } | string | null;
    if (typeof body === 'string' && body.trim().length > 0) return body;
    if (body && typeof body === 'object') {
      // ServiceValidationError's `errors[].message` (server) carries the specific, actionable
      // detail for the failing field — the top-level message/error is often a generic
      // "Validation failed for <field>" wrapper, so prefer the field-level detail when present.
      // `body` is unknown runtime data cast through a type assertion, not a runtime guarantee —
      // `errors` could be any shape (e.g. a string), so Array.isArray guards before searching it.
      const fieldDetail = Array.isArray(body.errors)
        ? body.errors.find((e): e is { message: string } => !!e && typeof e.message === 'string' && e.message.trim().length > 0)
        : undefined;
      if (fieldDetail) return fieldDetail.message;
      const candidate = [body.message, body.error].find((value): value is string => typeof value === 'string' && value.trim().length > 0);
      if (candidate) return candidate;
    }
    return error.message || fallback;
  }

  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

/**
 * The message the server wrote, or `fallback` when it wrote none.
 *
 * `extractErrorMessage` ends with `error.message || fallback`, and Angular always synthesizes a
 * non-empty `HttpErrorResponse.message` ("Http failure response for …"), so its own fallback is
 * unreachable for a body-less response — the HTTP debugging string reaches the screen instead.
 * Anywhere the fallback is user-facing copy, this is the composition that is actually wanted.
 */
export function serverAuthoredMessage(error: unknown, fallback: string): string {
  return hasServerAuthoredMessage(error) ? extractErrorMessage(error, fallback) : fallback;
}

/**
 * Whether the response body carries a message the server wrote, in any shape this BFF emits.
 *
 * There are two, because the server has two paths: `BaseApiError#toResponse` answers with the
 * message under `error`, while a controller that validates and replies directly answers with it
 * under `message`. A reader that knows only one of them silently loses half the server's replies.
 */
function hasServerAuthoredMessage(error: unknown): boolean {
  const body = error instanceof HttpErrorResponse ? error.error : null;
  if (typeof body === 'string') return body.trim().length > 0;
  if (!body || typeof body !== 'object') return false;

  const { message, error: errorText, errors } = body as { message?: unknown; error?: unknown; errors?: unknown };
  const hasTopLevel = [message, errorText].some((value) => typeof value === 'string' && value.trim().length > 0);
  const hasFieldDetail =
    Array.isArray(errors) &&
    errors.some((entry) => typeof (entry as { message?: unknown })?.message === 'string' && (entry as { message: string }).message.trim().length > 0);
  return hasTopLevel || hasFieldDetail;
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
