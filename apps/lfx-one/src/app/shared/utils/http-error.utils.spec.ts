// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom, Observable, throwError } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { committeeJoinErrorMessage, committeeLeaveErrorMessage, extractErrorMessage, isTransientHttpError, retryTransientHttpError, serverAuthoredMessage } from './http-error.utils';

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

  it('falls back to the top-level error when message is absent', () => {
    const error = httpErrorWithBody(403, { error: 'Not authorized' });

    expect(extractErrorMessage(error, 'fallback')).toBe('Not authorized');
  });

  it('falls back to the synthesized HttpErrorResponse message when the body has no usable message', () => {
    // HttpErrorResponse always synthesizes a `.message` ("Http failure response for ..."), so an
    // empty/unusable body never reaches the caller-provided fallback string for a real HTTP error.
    const error = httpErrorWithBody(500, {});

    expect(extractErrorMessage(error, 'fallback')).toContain('Http failure response');
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

// GH-2349: the join error handler used to read `err.error?.message` only, which is dead code on
// the BFF error-class path (that shape carries the text under `error`) — every rejection rendered
// the generic "Failed to join" toast. These cases pin the branch copy against both shapes.
describe('committeeJoinErrorMessage', () => {
  const ORG_REQUIRED = 'organization id or organization name and domain are required';

  it.each([
    ['error', { error: ORG_REQUIRED }],
    ['message', { message: ORG_REQUIRED }],
  ])('reads the organization-requirement text under %s', (_key, body) => {
    expect(committeeJoinErrorMessage(httpErrorWithBody(400, body), 'TSC')).toBe(
      'This group requires a verified organization to join. Please contact an admin for access.'
    );
  });

  it('maps the business-email requirement to its own copy', () => {
    const error = httpErrorWithBody(400, { error: 'A business email is required to join this group' });

    expect(committeeJoinErrorMessage(error, 'TSC')).toBe('This group requires a business email address to join. Please contact an admin for access.');
  });

  it('answers the already-a-member copy on 409', () => {
    expect(committeeJoinErrorMessage(httpError(409), 'TSC')).toBe('You are already a member of this group.');
  });

  it('answers the no-permission copy on 403', () => {
    expect(committeeJoinErrorMessage(httpError(403), 'TSC')).toBe('You do not have permission to join this group.');
  });

  it('answers the check-your-details fallback on a 400 the server wrote no message for', () => {
    expect(committeeJoinErrorMessage(httpErrorWithBody(400, {}), 'TSC')).toBe('Unable to join "TSC". Please check your details and try again.');
  });

  it('shows the server-authored 400 message when it is not a known branch', () => {
    const error = httpErrorWithBody(400, { error: 'join window is closed' });

    expect(committeeJoinErrorMessage(error, 'TSC')).toBe('join window is closed');
  });

  it('answers the generic fallback for an unknown status with no server message', () => {
    expect(committeeJoinErrorMessage(httpErrorWithBody(500, {}), 'TSC')).toBe('Failed to join "TSC". Please try again.');
  });

  it('never surfaces Angular’s synthesized Http failure response string', () => {
    const shown = committeeJoinErrorMessage(httpErrorWithBody(400, null), 'TSC');

    expect(shown).toBe('Unable to join "TSC". Please check your details and try again.');
    expect(shown).not.toContain('Http failure response');
  });
});

describe('committeeLeaveErrorMessage', () => {
  it('answers the not-a-member copy on 404', () => {
    expect(committeeLeaveErrorMessage(httpError(404), 'TSC')).toBe('You are not a member of this group.');
  });

  // Same two BFF shapes as join: the error-class proxy emits under `error`, a direct controller reply under `message`.
  it.each([
    ['error', { error: 'membership is frozen' }],
    ['message', { message: 'membership is frozen' }],
  ])('shows the server-authored message under %s', (_key, body) => {
    expect(committeeLeaveErrorMessage(httpErrorWithBody(400, body), 'TSC')).toBe('membership is frozen');
  });

  it('answers the generic fallback when the server wrote nothing', () => {
    const shown = committeeLeaveErrorMessage(httpErrorWithBody(500, {}), 'TSC');

    expect(shown).toBe('Failed to leave "TSC". Please try again.');
    expect(shown).not.toContain('Http failure response');
  });
});
