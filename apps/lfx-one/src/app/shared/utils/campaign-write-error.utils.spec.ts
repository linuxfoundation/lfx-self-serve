// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';

import { classifyCampaignWriteFailure, isBffErrorEnvelope } from './campaign-write-error.utils';

const httpError = (status: number, error: unknown): HttpErrorResponse => new HttpErrorResponse({ status, statusText: 'x', error });

const messages = { conflict: 'refresh first', unconfirmed: 'may have applied — verify in the platform', failureFallback: 'not changed' };
const noValidator = { unconfirmed: messages.unconfirmed, failureFallback: messages.failureFallback };

describe('classifyCampaignWriteFailure', () => {
  it.each([
    ['a 504 with plain proxy text', 504, 'upstream request timeout'],
    ['a 502 with plain proxy text', 502, 'Bad Gateway'],
    ['a 503 with plain proxy text', 503, 'no healthy upstream'],
    ['a 408 with plain proxy text', 408, 'Request Timeout'],
    ['a 500 with an HTML page', 500, '<html><body>Internal error</body></html>'],
    ['a 0 with no body', 0, null],
    ['a JSON body without the envelope code', 502, { error: 'Bad Gateway' }],
  ])('reports %s as unconfirmed', (_label, status, body) => {
    expect(classifyCampaignWriteFailure(httpError(status, body), messages)).toEqual({ state: 'unconfirmed', message: messages.unconfirmed });
    expect(classifyCampaignWriteFailure(httpError(status, body), noValidator)).toEqual({ state: 'unconfirmed', message: messages.unconfirmed });
  });

  it('reports a non-HTTP error as unconfirmed', () => {
    expect(classifyCampaignWriteFailure(new Error('boom'), messages).state).toBe('unconfirmed');
  });

  it('keeps the words of a BFF envelope 503 that carries the unconfirmed marker', () => {
    const message = 'the change is unconfirmed — it may or may not have been applied on the ad platform';
    expect(classifyCampaignWriteFailure(httpError(503, { error: message, code: 'SERVICE_UNAVAILABLE' }), messages)).toEqual({ state: 'unconfirmed', message });
  });

  it('reports a BFF definite refusal as failed, verbatim', () => {
    const message = 'the change could not be made on the ad platform; the campaign was not modified';
    expect(classifyCampaignWriteFailure(httpError(503, { error: message, code: 'SERVICE_UNAVAILABLE' }), messages)).toEqual({ state: 'failed', message });
    expect(classifyCampaignWriteFailure(httpError(400, { error: 'too low', code: 'BAD_REQUEST' }), messages)).toEqual({ state: 'failed', message: 'too low' });
  });

  it('treats a definite 4xx as a refusal before reading its wording, even a proxy body', () => {
    expect(classifyCampaignWriteFailure(httpError(409, { error: 'could not be confirmed', code: 'CONFLICT' }), messages).state).toBe('failed');
    expect(classifyCampaignWriteFailure(httpError(403, 'Forbidden'), messages)).toEqual({ state: 'failed', message: 'Forbidden' });
  });

  it('reports a 412 as a conflict only when the lever sends a validator', () => {
    expect(classifyCampaignWriteFailure(httpError(412, { error: 'etag', code: 'PRECONDITION_FAILED' }), messages)).toEqual({
      state: 'conflict',
      message: messages.conflict,
    });
    expect(classifyCampaignWriteFailure(httpError(412, { error: 'etag', code: 'PRECONDITION_FAILED' }), noValidator)).toEqual({
      state: 'failed',
      message: 'etag',
    });
  });

  it('with a definite-failure marker, reports a BFF 503 without it as unconfirmed', () => {
    const marked = { ...messages, definiteFailureMarker: 'was not modified' };
    expect(classifyCampaignWriteFailure(httpError(503, { error: 'Service Unavailable', code: 'SERVICE_UNAVAILABLE' }), marked)).toEqual({
      state: 'unconfirmed',
      message: messages.unconfirmed,
    });
    expect(classifyCampaignWriteFailure(httpError(503, { error: 'Service Unavailable', code: 'SERVICE_UNAVAILABLE' }), messages).state).toBe('failed');
  });
});

describe('isBffErrorEnvelope', () => {
  it.each([
    [{ error: 'x', code: 'CONFLICT' }, true],
    [{ error: 'x' }, false],
    [{ message: 'x', code: 'CONFLICT' }, false],
    ['plain text', false],
    [null, false],
    [[{ error: 'x', code: 'y' }], false],
  ])('%j → %s', (body, expected) => {
    expect(isBffErrorEnvelope(body)).toBe(expected);
  });
});
