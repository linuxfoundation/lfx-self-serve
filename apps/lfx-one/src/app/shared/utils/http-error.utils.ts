// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ERROR_CODES, MAX_PLAIN_TEXT_BODY_LENGTH, TRANSIENT_RETRY_DELAY_MS, VALIDATION_FAILED_MESSAGE_PREFIX } from '@lfx-one/shared/constants';
import { MonoTypeOperatorFunction, retry, throwError, timer } from 'rxjs';

/**
 * The message an error body offers for display, or `undefined` when it offers none. Every policy the
 * two readers below share lives here rather than in each of them: which key wins, when a 5xx body is
 * discarded (see `getHttpErrorDetail` for why), and what a plain-text body is worth. The only thing
 * left to a caller is `plainString`, which is genuinely a per-caller call.
 *
 * `error` is read as well as `message` because `error` is the key the envelope actually sends —
 * `BaseApiError.toResponse()` emits `{ error, code }` and no `message`. A handful of controllers do
 * hand-write a `message` key (`crowdfunding.controller.ts`, `clas.controller.ts`,
 * `email-verification.service.ts`), and upstream Goa bodies use it, so both are read.
 *
 * A field reason wins over a `VALIDATION_ERROR` whose top-level message is one `ServiceValidationError`
 * built itself: exactly `VALIDATION_FAILED_MESSAGE_PREFIX` (the `fromFieldErrors` default) or that
 * prefix plus " for " (what `forField` mints). The two ends share the constant so a server-side reword
 * fails loudly. `forField` interpolates the *wire key* — "Validation failed for invitee_email" — and
 * leaves the readable reason ("Member ID is required") in the field array. The match is those two
 * shapes rather than any `startsWith`, so a human message that happens to open with the same words
 * ("Validation failed. Please check the highlighted fields.") is not demoted. The branch is also
 * reachable from upstream: `getCodeForStatus(422)` gives a `MicroserviceError` the same code, and
 * `toResponse()` forwards both the Goa message and `errors`, so a Go service whose top-level message
 * happens to be one of those two shapes gets its field reasons preferred too — the wanted outcome.
 *
 * The consequence for the server is that a `forField` *reason* is now what a user reads. Most are
 * already written that way ("Committee ID is required"), but not all: the newsletter schedule and
 * cancel-schedule handlers reach `extractErrorMessage` at `newsletter-manage.component.ts` and
 * `newsletter-list.component.ts`, and their `parseIfMatch` / `validateScheduleOverride` guards read
 * like assertions to a developer ("If-Match header is required", "scheduled_at must be an RFC3339
 * timestamp string or null"). Those guards fire on requests this app shouldn't be making, so a user
 * seeing one means something upstream of the message is already wrong — but the string is now what
 * they see, and it should be written for them. Same for the `fromFieldErrors` reasons on the same
 * routes, which the field-array preference also promotes (those calls pass exactly the prefix).
 *
 * Any other top-level message under that code wins over the field array, on the grounds that a caller
 * who wrote one wrote it for a person — as the public-registration guards do. That is a property of
 * today's call sites, not a rule the type system enforces: several `fromFieldErrors` callers pass a
 * developer string instead (`weekly-brief.controller.ts`, `'Upload request validation failed'` in
 * `project.controller.ts` and `committee.controller.ts`). None of them reaches either reader today, and
 * routing one here means rewording its message first.
 *
 * `errors` is shape-checked rather than trusted: `MicroserviceError.toResponse()` forwards it verbatim
 * from an upstream Go service, so it can arrive as a string or an object. Throwing here would mean a
 * caller's `catchError` shows no toast at all. Only the first usable reason is taken, deliberately: the
 * destination is a one-line toast, and a server that wants to name several fields at once already has
 * `joinAsSentenceList` to write one message that does — which is what `public-meeting.controller.ts`
 * does for the registration form. When `errors` yields nothing usable the answer is `undefined`,
 * not the top-level message: that message is already known to be a wire key at this point, so falling
 * back to it would put "Validation failed for invitee_email" in front of a user — the string this
 * whole branch exists to suppress. `undefined` gets the caller its status hint or its own fallback.
 *
 * A thrown `Error` is not an error body at all. The app runs `provideHttpClient(withFetch())`, and
 * Angular's fetch backend puts the raw thrown value in `HttpErrorResponse.error` — so a dropped
 * connection, an abort, a request timeout, or a body that failed to parse arrives here as an `Error`
 * whose `message` is "Failed to fetch", "signal timed out", or "Unexpected token … in JSON". Those read
 * as an object with a `message` key, which is exactly the shape this function is looking for, and the
 * status is 0 (or a 2xx on a parse failure) so the 5xx skip doesn't cover them either. The check is
 * `instanceof`, so an `Error` minted in another realm (an SSR worker, an iframe) would slip past it and
 * have its `message` read; nothing in this app produces one, and the fallback for a missed case is a
 * developer string in a toast rather than a crash.
 *
 * `plainString: 'read'` lets a caller take a plain-text body as the message — `getHttpErrorDetail` has
 * a per-status hint that is better, `extractErrorMessage` does not. Either way the body has to read like
 * one sentence about the request. Angular's `parseBody` hands back the raw response *text* for any
 * non-2xx body that isn't JSON, so what arrives can be a proxy's whole HTML page, a JSON document the
 * server sent under the wrong content type, or a stack trace — putting any of those in a toast is the
 * failure this function exists to prevent. Hence the markup, structure, newline, and length checks; the
 * length cap is generous enough for a real sentence and short enough that a document can't pass. The
 * length and newline halves apply to a string found *inside* an object body too, because that string
 * isn't necessarily this server's: `MicroserviceError.fromMicroserviceResponse` takes its message from
 * the upstream body at any status, so an arbitrarily long or multi-line Go-service string reaches the
 * `error` key on a 4xx. Only the leading-`<{[` check is specific to the raw-text path, where the payload
 * is whatever the proxy in front of us decided to return rather than a key someone chose to fill.
 */
function readErrorBodyMessage(body: unknown, status: number, plainString: 'read' | 'ignore'): string | undefined {
  if (status >= 500) {
    return undefined;
  }

  const withinOneLine = (text: string): string | undefined =>
    text.length > 0 && text.length <= MAX_PLAIN_TEXT_BODY_LENGTH && !text.includes('\n') ? text : undefined;

  if (typeof body === 'string') {
    if (plainString === 'ignore') {
      return undefined;
    }

    const text = body.trim();
    return /^[<{[]/.test(text) ? undefined : withinOneLine(text);
  }

  if (!body || typeof body !== 'object' || body instanceof Error) {
    return undefined;
  }

  const nonBlank = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
  const { message, error, code, errors } = body as { message?: string; error?: string; code?: string; errors?: unknown };
  const top = [message, error].find(nonBlank)?.trim();
  const isSelfBuilt = top === undefined || top === VALIDATION_FAILED_MESSAGE_PREFIX || top.startsWith(`${VALIDATION_FAILED_MESSAGE_PREFIX} for `);
  const isWireKeyed = code === ERROR_CODES.VALIDATION_ERROR && isSelfBuilt;

  if (isWireKeyed) {
    const entries = Array.isArray(errors) ? errors : [];
    const reason = entries
      .map((entry) => (entry && typeof entry === 'object' ? (entry as { message?: unknown }).message : undefined))
      .find(nonBlank)
      ?.trim();
    return reason === undefined ? undefined : withinOneLine(reason);
  }

  return top === undefined ? undefined : withinOneLine(top);
}

/**
 * Extracts a user-friendly error message from an HttpErrorResponse.
 * Prefers the server's own message when the body carries one; falls back to
 * status-code hints, then the provided fallback string.
 *
 * Reading only `message` — a key the envelope does not send — left every branch below on its hard-coded
 * string, so a server reason never reached the committee call sites. See `readErrorBodyMessage`.
 *
 * A 5xx body is deliberately not read. Every 5xx body traced to these call sites is either the
 * envelope's own "Internal server error" or an upstream Go service message that `MicroserviceError`
 * passes through verbatim — neither tells the user anything, and both would displace the caller's
 * fallback, which at least names the action that failed ("Failed to remove member. Please try again.").
 * The skip is by status, not by provenance, so it also discards the hand-written 5xx messages this
 * server mints — including ones written for a person (`ACCESS_CHECK_UNAVAILABLE`,
 * `FORWARD_SET_FAILED`, and `ROLE_GRANTS_UNAVAILABLE` in `org-lens-access.service.ts`). None of those
 * reaches a call site of either reader today, but routing one here would silently trade it for the
 * fallback; a `code` allowlist would be the way to let a chosen few through.
 *
 * Below 500 the body is usually a validation or permission reason written about the request, which is
 * worth showing. Not always: `MicroserviceError` forwards an upstream Go message verbatim at any
 * status, so a Goa-shaped string can still reach a 4xx toast. Showing it beats a status hint that says
 * nothing about which field or permission was at fault.
 */
export function getHttpErrorDetail(err: HttpErrorResponse, fallback: string): string {
  const upstream = readErrorBodyMessage(err.error, err.status, 'ignore');

  switch (err.status) {
    case 409:
      return upstream ?? 'This resource already exists.';
    case 404:
      return upstream ?? 'The resource was not found.';
    case 403:
      return upstream ?? 'You do not have permission to perform this action.';
    case 422:
      return upstream ?? 'The request contained invalid data. Please check your input.';
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
 * See `readErrorBodyMessage` for which key in the body is read, and why, and for the 5xx skip these two
 * share — "Internal server error" and a forwarded Go-service string tell a user nothing, and the
 * caller's fallback at least names the action that failed.
 *
 * Unlike `getHttpErrorDetail` this one does read a plain-text body: it has no per-status hint layer, so
 * a 4xx sentence written about the request is the best thing on offer. `readErrorBodyMessage` still
 * refuses one that reads like a proxy's HTML page.
 *
 * When the body yields nothing, the caller's `fallback` wins over `HttpErrorResponse.message`.
 * Angular fills that property in for every failure with a string built for a developer reading a
 * console — "Http failure response for /public/api/...: 0 Unknown Error" — so preferring it would
 * put a URL and a status code in front of a user on exactly the failures the body has nothing to say
 * about: a network drop, or a 500 with no envelope. Call sites are expected to pass a
 * written-for-a-human fallback; that is the one to show.
 */
export function extractErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof HttpErrorResponse) {
    return readErrorBodyMessage(error.error, error.status, 'read') ?? fallback;
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
