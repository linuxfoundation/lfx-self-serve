// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom, Observable, throwError } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { extractErrorMessage, isTransientHttpError, retryTransientHttpError, serverAuthoredMessage } from './http-error.utils';

function httpError(status: number): HttpErrorResponse {
  return new HttpErrorResponse({ status, statusText: 'x', url: '/api/thing' });
}

function httpErrorWithBody(status: number, error: unknown): HttpErrorResponse {
  return new HttpErrorResponse({ status, statusText: 'x', url: '/api/thing', error });
}

describe('isTransientHttpError', () => {
  // Each status is named rather than looped so a failure says WHICH class of
  // failure stopped being retryable — the reason a status is in or out of this
  // set differs per status, and a table-driven failure hides that.
  it('retries a network drop, which has no status at all', () => {
    expect(isTransientHttpError(httpError(0))).toBe(true);
  });

  it('retries a rate limit', () => {
    expect(isTransientHttpError(httpError(429))).toBe(true);
  });

  it('retries an upstream server error', () => {
    expect(isTransientHttpError(httpError(503))).toBe(true);
  });

  it('does not retry an expired session', () => {
    expect(isTransientHttpError(httpError(401))).toBe(false);
  });

  it('does not retry a not-found', () => {
    expect(isTransientHttpError(httpError(404))).toBe(false);
  });

  it('ignores anything that is not an HttpErrorResponse', () => {
    expect(isTransientHttpError(new Error('boom'))).toBe(false);
    expect(isTransientHttpError(null)).toBe(false);
  });
});

/** A failing source that records how many times it was subscribed. */
interface CountingSource {
  attempts: () => number;
  run: () => Observable<never>;
}

describe('retryTransientHttpError', () => {
  function countingSource(error: unknown): CountingSource {
    let attempts = 0;
    return {
      attempts: () => attempts,
      run: () =>
        new Observable<never>((subscriber) => {
          attempts += 1;
          subscriber.error(error);
        }),
    };
  }

  it('re-subscribes a transient failure up to count times, then gives up', async () => {
    const source = countingSource(httpError(503));

    await expect(firstValueFrom(source.run().pipe(retryTransientHttpError(2)))).rejects.toBeInstanceOf(HttpErrorResponse);

    // Three, not two: `count` is retries PAST the first attempt. A policy that
    // read it as a total would make `retryTransientHttpError(1)` a no-op, which
    // is the silent-failure case worth pinning.
    expect(source.attempts()).toBe(3);
  });

  it('re-throws a non-transient failure without a second attempt', async () => {
    const source = countingSource(httpError(401));

    await expect(firstValueFrom(source.run().pipe(retryTransientHttpError(2)))).rejects.toBeInstanceOf(HttpErrorResponse);
    expect(source.attempts()).toBe(1);
  });

  it('passes a non-HTTP error straight through', async () => {
    const boom = new Error('boom');

    await expect(firstValueFrom(throwError(() => boom).pipe(retryTransientHttpError(2)))).rejects.toBe(boom);
  });
});

describe('extractErrorMessage', () => {
  it('prefers the field-level detail in a ServiceValidationError body over the generic top-level message', () => {
    // Mirrors ServiceValidationError.forField's response shape: a generic top-level `error`
    // wrapper plus the actionable detail buried in `errors[0].message`.
    const error = httpErrorWithBody(400, {
      error: 'Validation failed for registrants',
      code: 'VALIDATION_ERROR',
      errors: [{ field: 'registrants', message: 'This meeting has 62 registrants — imports are limited to 50 per meeting.', code: 'FIELD_VALIDATION_ERROR' }],
    });

    expect(extractErrorMessage(error, 'fallback')).toBe('This meeting has 62 registrants — imports are limited to 50 per meeting.');
  });

  it('falls back to the top-level message when errors is absent', () => {
    const error = httpErrorWithBody(404, { message: 'Meeting not found' });

    expect(extractErrorMessage(error, 'fallback')).toBe('Meeting not found');
  });

  // `error` and not `message` is the key that matters here: `BaseApiError.toResponse()` emits
  // `{ error, code }`, so a reader that only knows `message` shows the fallback on every server
  // validation failure.
  it('falls back to the top-level error when message is absent', () => {
    const error = httpErrorWithBody(403, { error: 'Not authorized' });

    expect(extractErrorMessage(error, 'fallback')).toBe('Not authorized');
  });

  // Angular synthesizes `HttpErrorResponse.message` for every failure as a string written for a
  // console — "Http failure response for /api/thing: 500 x". Preferring it would put a URL and a
  // status code in front of a user on exactly the failures with no body to read, so the caller's
  // fallback — which is written for a human — wins instead.
  it('prefers the caller fallback over Angular synthesized message text', () => {
    const detail = extractErrorMessage(httpErrorWithBody(500, {}), 'fallback');

    expect(detail).toBe('fallback');
    expect(detail).not.toContain('Http failure');
  });

  it('prefers the caller fallback for a network drop, which has no body at all', () => {
    const detail = extractErrorMessage(httpError(0), 'Could not reach the server. Please try again.');

    expect(detail).toBe('Could not reach the server. Please try again.');
  });

  it('does not throw when errors is present but not an array — falls back to the top-level message', () => {
    // body.error is unknown runtime data; a non-ServiceValidationError upstream could shape
    // `errors` as anything (e.g. a string), not just the expected array of field errors.
    const error = httpErrorWithBody(400, { message: 'Bad request', errors: 'validation failed' });

    expect(extractErrorMessage(error, 'fallback')).toBe('Bad request');
  });

  it('tolerates malformed entries inside a well-formed errors array', () => {
    const error = httpErrorWithBody(400, { error: 'Validation failed', errors: [null, { field: 'x' }, { message: 'The real detail' }] });

    expect(extractErrorMessage(error, 'fallback')).toBe('The real detail');
  });

  it('returns a plain string body directly', () => {
    const error = httpErrorWithBody(500, 'upstream down');

    expect(extractErrorMessage(error, 'fallback')).toBe('upstream down');
  });

  it('handles a plain Error and an unknown value', () => {
    expect(extractErrorMessage(new Error('boom'), 'fallback')).toBe('boom');
    expect(extractErrorMessage('not an error', 'fallback')).toBe('fallback');
  });
});

/**
 * The composition for anywhere the fallback is user-facing copy rather than a debugging default.
 * `extractErrorMessage` alone cannot serve that case: it ends with `error.message || fallback`,
 * and Angular synthesizes a non-empty `.message` for every failure, so its fallback is unreachable
 * and "Http failure response for /api/…" reaches the screen instead.
 */
describe('serverAuthoredMessage', () => {
  // Two spellings because the server has two paths: `BaseApiError#toResponse` answers with the
  // message under `error`, and a controller that validates and replies directly uses `message`. A
  // reader that knows only one silently loses half the server's replies.
  it.each([
    ['error', { error: 'This organization requires additional review' }],
    ['message', { message: 'This organization requires additional review' }],
  ])('reads the message the server sent under %s', (_key, body) => {
    expect(serverAuthoredMessage(httpErrorWithBody(403, body), 'fallback')).toBe('This organization requires additional review');
  });

  it('prefers a field-level detail, exactly as extractErrorMessage does', () => {
    const error = httpErrorWithBody(400, { error: 'Validation failed', errors: [{ message: 'The real detail' }] });

    expect(serverAuthoredMessage(error, 'fallback')).toBe('The real detail');
  });

  it('returns a plain string body directly', () => {
    expect(serverAuthoredMessage(httpErrorWithBody(502, 'upstream down'), 'fallback')).toBe('upstream down');
  });

  // The whole reason this exists, and the case `extractErrorMessage` gets wrong.
  it.each([[{}], [null], [{ code: 'FORBIDDEN' }], [{ message: '   ' }], [{ errors: 'not an array' }], ['   ']])(
    'answers the fallback, not Angular’s synthesized message, for %p',
    (body) => {
      const shown = serverAuthoredMessage(httpErrorWithBody(403, body), 'fallback');

      expect(shown).toBe('fallback');
      expect(shown).not.toContain('Http failure response');
    }
  );

  it('answers the fallback for anything that is not an HTTP failure', () => {
    expect(serverAuthoredMessage(new Error('boom'), 'fallback')).toBe('fallback');
    expect(serverAuthoredMessage(undefined, 'fallback')).toBe('fallback');
  });
});
