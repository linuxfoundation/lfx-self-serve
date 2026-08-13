// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom, Observable, throwError } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { isTransientHttpError, retryTransientHttpError } from './http-error.utils';

function httpError(status: number): HttpErrorResponse {
  return new HttpErrorResponse({ status, statusText: 'x', url: '/api/thing' });
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
