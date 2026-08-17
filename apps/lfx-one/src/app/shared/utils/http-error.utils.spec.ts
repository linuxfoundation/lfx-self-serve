// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { MAX_PLAIN_TEXT_BODY_LENGTH } from '@lfx-one/shared/constants';
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

  // `ServiceValidationError.forField` interpolates the WIRE KEY into the top-level message, so showing
  // it puts "Validation failed for invitee_email" in a toast. The readable reason is in `errors[0]`.
  it('prefers the field reason over a wire-key `Validation failed for` message', () => {
    const error = new HttpErrorResponse({
      status: 400,
      error: {
        error: 'Validation failed for invitee_email',
        code: 'VALIDATION_ERROR',
        errors: [{ field: 'invitee_email', message: 'Email address is required' }],
      },
    });

    expect(getHttpErrorDetail(error, 'fallback')).toBe('Email address is required');
  });

  // The other half of that rule: a top-level message written for a person (what `fromFieldErrors` is
  // given on the public-registration guards) wins over the wire-keyed field array.
  it('keeps a human top-level message over the field array', () => {
    const error = new HttpErrorResponse({
      status: 400,
      error: { error: 'Email address is required.', code: 'VALIDATION_ERROR', errors: [{ field: 'email', message: 'Email address is required' }] },
    });

    expect(getHttpErrorDetail(error, 'fallback')).toBe('Email address is required.');
  });

  // The match is the two shapes `ServiceValidationError` mints — the bare prefix and `prefix + ' for '`
  // — rather than any `startsWith`, so a human message that opens with the same words keeps its place.
  it('does not demote a human message that merely starts with the prefix', () => {
    const error = new HttpErrorResponse({
      status: 400,
      error: {
        error: 'Validation failed. Please check the highlighted fields.',
        code: 'VALIDATION_ERROR',
        errors: [{ field: 'email', message: 'Email address is required' }],
      },
    });

    expect(getHttpErrorDetail(error, 'fallback')).toBe('Validation failed. Please check the highlighted fields.');
  });

  // A body with no top-level message at all can't come from this server's envelope — `toResponse()`
  // always sets `error` — but an upstream service is free to send one, and the field array is then
  // the only thing to read.
  it('reads the field array when a foreign body carries no top-level message', () => {
    const error = new HttpErrorResponse({
      status: 400,
      error: { code: 'VALIDATION_ERROR', errors: [{ field: 'email', message: 'Email address is required' }] },
    });

    expect(getHttpErrorDetail(error, 'fallback')).toBe('Email address is required');
  });

  // A 5xx body says "Internal server error", or repeats an upstream Go service's message verbatim.
  // Neither is something to show a user, and both would displace the fallback that at least names
  // the action that failed.
  it('ignores a 5xx body in favour of the caller fallback', () => {
    const error = new HttpErrorResponse({ status: 500, error: { error: 'Internal server error', code: 'INTERNAL_ERROR' } });

    expect(getHttpErrorDetail(error, 'Could not save your changes.')).toBe('Could not save your changes.');
  });

  // `withFetch()` is on (`app.config.ts`), and Angular's fetch backend puts the raw thrown value in
  // `HttpErrorResponse.error` — an `Error` reads as an object with a `message` key, which is exactly the
  // shape this reader looks for. The 5xx skip does not cover it either: the status is 0.
  it('ignores a thrown Error in the body on a network drop', () => {
    const error = new HttpErrorResponse({ status: 0, error: new TypeError('Failed to fetch') });

    expect(getHttpErrorDetail(error, 'Could not reach the server. Please try again.')).toBe('Could not reach the server. Please try again.');
  });

  // `MicroserviceError.toResponse()` forwards `errors` verbatim from upstream, so its shape is an
  // upstream Go service's choice. Reading it unguarded threw from inside a `catchError` — costing the
  // user the toast entirely rather than degrading it to a status hint. The fallback is the hint and
  // NOT the top-level message: that one is already known to be a wire key here, so showing it would
  // put "Validation failed for x" in the toast — the string this branch exists to suppress.
  it('falls back to the status hint when `errors` is not an array of objects', () => {
    const asString = new HttpErrorResponse({ status: 404, error: { error: 'Validation failed for x', code: 'VALIDATION_ERROR', errors: 'nope' } });
    const asObject = new HttpErrorResponse({ status: 404, error: { error: 'Validation failed for x', code: 'VALIDATION_ERROR', errors: { x: 'nope' } } });
    const ofStrings = new HttpErrorResponse({ status: 404, error: { error: 'Validation failed for x', code: 'VALIDATION_ERROR', errors: ['nope'] } });
    const missing = new HttpErrorResponse({ status: 400, error: { error: 'Validation failed for x', code: 'VALIDATION_ERROR' } });

    expect(getHttpErrorDetail(asString, 'fallback')).toBe('The resource was not found.');
    expect(getHttpErrorDetail(asObject, 'fallback')).toBe('The resource was not found.');
    expect(getHttpErrorDetail(ofStrings, 'fallback')).toBe('The resource was not found.');
    expect(getHttpErrorDetail(missing, 'Could not add that member.')).toBe('Could not add that member.');
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

  // 4xx, not 5xx: at 5xx this passes through the status skip and stops testing the branch it names.
  it('falls back when the body is an object with no usable string', () => {
    const error = new HttpErrorResponse({ status: 400, error: { code: 'BOOM' } });

    expect(extractErrorMessage(error, 'fallback')).toBe('fallback');
  });

  // Unlike `getHttpErrorDetail`, this one has no status-hint layer to fall back to, so a plain-text
  // 4xx body is the best thing it has.
  it('uses a plain-string body as the message', () => {
    const error = new HttpErrorResponse({ status: 400, error: 'Missing project' });

    expect(extractErrorMessage(error, 'fallback')).toBe('Missing project');
  });

  // Angular's `parseBody` returns the raw response TEXT for any non-2xx body that isn't JSON, so a
  // proxy or WAF page — a 413 from an nginx body-size limit, say — arrives as a whole HTML document.
  // Reading it verbatim put that document in a toast, and in the `stripeError` signal at
  // `add-payment-card-dialog.component.ts:119`, which renders it as a persistent block.
  // The same text branch also catches a JSON document sent under the wrong content type and a stack
  // trace — both reach a toast as a plain string, and neither is one sentence about the request.
  it('refuses a plain-string body that is not one sentence', () => {
    const fallback = 'Your file is too large to upload.';
    const html = new HttpErrorResponse({ status: 413, error: '<html><head><title>413 Request Entity Too Large</title></head><body>...</body></html>' });
    const json = new HttpErrorResponse({ status: 400, error: '{"error":"upstream timeout"}' });
    const trace = new HttpErrorResponse({ status: 400, error: 'Error: upstream timeout\n    at Object.<anonymous> (/srv/app.js:12:9)' });
    const wall = new HttpErrorResponse({ status: 400, error: 'x'.repeat(MAX_PLAIN_TEXT_BODY_LENGTH + 1) });

    expect(extractErrorMessage(html, fallback)).toBe(fallback);
    expect(extractErrorMessage(json, fallback)).toBe(fallback);
    expect(extractErrorMessage(trace, fallback)).toBe(fallback);
    expect(extractErrorMessage(wall, fallback)).toBe(fallback);
  });

  // The length and newline halves apply to a string inside an object body too — `MicroserviceError`
  // takes its message from the upstream body at any status, so what lands in `error` on a 4xx can be a
  // multi-line or arbitrarily long Go-service string rather than anything this server wrote.
  it('refuses an object-body message that is not one line', () => {
    const fallback = 'Could not save your changes.';
    const multiline = new HttpErrorResponse({ status: 400, error: { error: 'rpc error: code = InvalidArgument\n\tdesc = bad field' } });
    const wall = new HttpErrorResponse({ status: 400, error: { message: 'y'.repeat(MAX_PLAIN_TEXT_BODY_LENGTH + 1) } });
    const wireKeyedWall = new HttpErrorResponse({
      status: 400,
      error: { error: 'Validation failed for id', code: 'VALIDATION_ERROR', errors: [{ field: 'id', message: 'z'.repeat(MAX_PLAIN_TEXT_BODY_LENGTH + 1) }] },
    });

    expect(extractErrorMessage(multiline, fallback)).toBe(fallback);
    expect(extractErrorMessage(wall, fallback)).toBe(fallback);
    expect(getHttpErrorDetail(wireKeyedWall, fallback)).toBe(fallback);
  });

  // Same policy as `getHttpErrorDetail`: nothing in a 5xx body was written for a user, and both the
  // envelope's "Internal server error" and a forwarded Go-service string would displace the caller's
  // fallback, which at least names the action that failed.
  it('ignores a 5xx body in favour of the caller fallback', () => {
    const envelope = new HttpErrorResponse({ status: 500, error: { error: 'Internal server error', code: 'INTERNAL_ERROR' } });
    const upstreamText = new HttpErrorResponse({ status: 502, error: 'Bad gateway' });

    expect(extractErrorMessage(envelope, 'Could not save your changes.')).toBe('Could not save your changes.');
    expect(extractErrorMessage(upstreamText, 'Could not save your changes.')).toBe('Could not save your changes.');
  });

  it('reads a field reason when the top-level message carries a wire key', () => {
    const error = new HttpErrorResponse({
      status: 400,
      error: {
        error: 'Validation failed for occurrence_id',
        code: 'VALIDATION_ERROR',
        errors: [{ field: 'occurrence_id', message: 'Occurrence ID is required' }],
      },
    });

    expect(extractErrorMessage(error, 'fallback')).toBe('Occurrence ID is required');
  });

  // Same fetch-backend shapes as above. The parse failure is the one the 5xx skip cannot catch: the
  // status is the real response status, so a malformed 200 would otherwise show "Unexpected token <".
  it('ignores a thrown Error in the body, on a network drop and on a parse failure', () => {
    const dropped = new HttpErrorResponse({ status: 0, error: new TypeError('Failed to fetch') });
    const unparsable = new HttpErrorResponse({ status: 200, error: new SyntaxError('Unexpected token < in JSON at position 0') });

    expect(extractErrorMessage(dropped, 'Could not reach the server.')).toBe('Could not reach the server.');
    expect(extractErrorMessage(unparsable, 'Could not reach the server.')).toBe('Could not reach the server.');
  });

  // An `Error` the caller threw itself is still worth reading — it is the one place the message was
  // written by this codebase rather than by a network stack.
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
