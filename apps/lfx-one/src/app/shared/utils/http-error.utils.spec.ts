// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom, Observable, throwError } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { extractErrorMessage, getHttpErrorDetail, isTransientHttpError, retryTransientHttpError } from './http-error.utils';

function httpError(status: number): HttpErrorResponse {
  return new HttpErrorResponse({ status, statusText: 'x', url: '/api/thing' });
}

describe('getHttpErrorDetail', () => {
  // The read that was dead before: every server error body is `{ error, code }`, so a reader that
  // only knew `message` fell through to the hard-coded per-status string on every real failure.
  it('reads the `error` key this server actually sends', () => {
    const error = new HttpErrorResponse({ status: 409, error: { error: 'A member with that email already exists.', code: 'CONFLICT' } });

    expect(getHttpErrorDetail(error, 'fallback')).toBe('A member with that email already exists.');
  });

  it('still reads a `message` key, for upstream bodies that use it', () => {
    const error = new HttpErrorResponse({ status: 422, error: { message: 'Upstream said no' } });

    expect(getHttpErrorDetail(error, 'fallback')).toBe('Upstream said no');
  });

  it('uses the status hint when the body carries no message', () => {
    expect(getHttpErrorDetail(httpError(403), 'fallback')).toBe('You do not have permission to perform this action.');
    expect(getHttpErrorDetail(httpError(404), 'fallback')).toBe('The resource was not found.');
  });

  it('uses the caller fallback for a status with no hint', () => {
    expect(getHttpErrorDetail(httpError(500), 'Could not save your changes.')).toBe('Could not save your changes.');
  });

  // A plain-text body (an upstream 502 HTML page, say) is not a reason to show, so the status hint
  // still wins — unlike `extractErrorMessage`, whose callers have no hint layer to fall back to.
  it('ignores a plain-string body', () => {
    const error = new HttpErrorResponse({ status: 404, error: 'Not Found' });

    expect(getHttpErrorDetail(error, 'fallback')).toBe('The resource was not found.');
  });
});

describe('extractErrorMessage', () => {
  // `error` and not `message` is the key that matters: `BaseApiError.toResponse()` emits
  // `{ error, code }`, so a reader that only knows `message` shows the fallback on every server
  // validation failure — which is what it did before this was the util in use.
  it('reads the `error` key this server actually sends', () => {
    const error = new HttpErrorResponse({ status: 400, error: { error: 'Email address is required.', code: 'VALIDATION_ERROR' } });

    expect(extractErrorMessage(error, 'fallback')).toBe('Email address is required.');
  });

  it('still reads a `message` key, for upstream bodies that use it', () => {
    const error = new HttpErrorResponse({ status: 400, error: { message: 'Upstream said no' } });

    expect(extractErrorMessage(error, 'fallback')).toBe('Upstream said no');
  });

  // Angular populates `HttpErrorResponse.message` for every failure with a string built for a
  // console — "Http failure response for /api/thing: 0 Unknown Error". Preferring it would put a URL
  // and a status code in front of a user on exactly the failures with no body to read.
  it('prefers the caller fallback over Angular internal message text', () => {
    const detail = extractErrorMessage(httpError(0), 'Could not reach the server. Please try again.');

    expect(detail).toBe('Could not reach the server. Please try again.');
    expect(detail).not.toContain('Http failure');
  });

  it('falls back when the body is an object with no usable string', () => {
    const error = new HttpErrorResponse({ status: 500, error: { code: 'BOOM' } });

    expect(extractErrorMessage(error, 'fallback')).toBe('fallback');
  });

  it('uses a plain-string body as the message', () => {
    const error = new HttpErrorResponse({ status: 502, error: 'Bad gateway' });

    expect(extractErrorMessage(error, 'fallback')).toBe('Bad gateway');
  });

  it('reads a thrown Error message, and falls back for anything else', () => {
    expect(extractErrorMessage(new Error('boom'), 'fallback')).toBe('boom');
    expect(extractErrorMessage(null, 'fallback')).toBe('fallback');
  });
});

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
