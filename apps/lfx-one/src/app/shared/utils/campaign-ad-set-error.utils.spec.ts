// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import {
  META_AD_SET_CONFLICT_MESSAGE,
  META_AD_SET_FAILURE_FALLBACK,
  META_AD_SET_PAUSE_RECORD_OUTCOME_UNCONFIRMED,
  META_AD_SET_PAUSE_RECORD_UNCONFIRMED_CODE,
  META_AD_SET_PRE_SEND_REFUSAL_STATUSES,
  META_AD_SET_STATUS_OUTCOME_UNCONFIRMED,
  META_AD_SET_STATUS_UNCONFIRMED_CODE,
  META_AD_SET_UNCONFIRMED_MESSAGE,
} from '@lfx-one/shared/constants';
import { describe, expect, it } from 'vitest';

import { metaAdSetFailureOutcome, metaAdSetWriteLeftValidatorKnown } from './campaign-ad-set-error.utils';

const httpError = (status: number, error: unknown): HttpErrorResponse => new HttpErrorResponse({ status, statusText: 'x', error });

describe('metaAdSetFailureOutcome', () => {
  it('reports a BFF envelope 412 as a conflict', () => {
    expect(metaAdSetFailureOutcome(httpError(412, { error: 'etag mismatch', code: 'PRECONDITION_FAILED' }))).toEqual({
      state: 'conflict',
      message: META_AD_SET_CONFLICT_MESSAGE,
    });
  });

  // campaign-service's 409s name the remedy, so they reach the operator word for word.
  it('passes a BFF envelope 409 through verbatim as a failure', () => {
    const message = 'the ad set status WAS changed on Meta, but the campaign changed meanwhile; reload the campaign before acting again';
    expect(metaAdSetFailureOutcome(httpError(409, { error: message, code: 'CONFLICT' }))).toEqual({ state: 'failed', message });
  });

  it('passes a definite 503 through verbatim as a failure', () => {
    const message = 'the ad set status could not be changed on Meta; nothing was modified';
    expect(metaAdSetFailureOutcome(httpError(503, { error: message, code: 'SERVICE_UNAVAILABLE' }))).toEqual({ state: 'failed', message });
  });

  it('falls back to the fixed sentence for a message-less refusal', () => {
    expect(metaAdSetFailureOutcome(httpError(400, { error: '', code: 'BAD_REQUEST' }))).toEqual({ state: 'failed', message: META_AD_SET_FAILURE_FALLBACK });
  });

  it.each([
    ['a plain-text 412 from a proxy', 412, 'Precondition Failed'],
    ['a plain-text 409 from a proxy', 409, 'Conflict'],
    ['a gateway page with no response', 0, '<html><body>Bad Gateway</body></html>'],
    ['no response at all', 0, null],
    ['a 504 with proxy text', 504, 'upstream request timeout'],
  ])("reports %s as unconfirmed, in this UI's words", (_label, status, body) => {
    expect(metaAdSetFailureOutcome(httpError(status, body))).toEqual({ state: 'unconfirmed', message: META_AD_SET_UNCONFIRMED_MESSAGE });
  });

  // Any other unconfirmed sentence is replaced by this UI's own "reload to verify".
  it.each([
    ["the BFF's own status-unconfirmed sentence", META_AD_SET_STATUS_OUTCOME_UNCONFIRMED],
    ["campaign-service's unconfirmed sentence", 'the ad set status change is unconfirmed — it may or may not have been applied on Meta'],
  ])("restates %s in this UI's words", (_label, message) => {
    expect(metaAdSetFailureOutcome(httpError(503, { error: message, code: META_AD_SET_STATUS_UNCONFIRMED_CODE }))).toEqual({
      state: 'unconfirmed',
      message: META_AD_SET_UNCONFIRMED_MESSAGE,
    });
  });

  // Meta's status is known; only the deliberate-pause record is in doubt, which only the BFF's sentence says.
  it("keeps the BFF's own sentence for the record-only unconfirmed code", () => {
    expect(
      metaAdSetFailureOutcome(httpError(503, { error: META_AD_SET_PAUSE_RECORD_OUTCOME_UNCONFIRMED, code: META_AD_SET_PAUSE_RECORD_UNCONFIRMED_CODE }))
    ).toEqual({ state: 'unconfirmed', message: META_AD_SET_PAUSE_RECORD_OUTCOME_UNCONFIRMED });
  });

  it.each([
    ['no code', { error: META_AD_SET_PAUSE_RECORD_OUTCOME_UNCONFIRMED }],
    ['the code but no string error', { message: META_AD_SET_PAUSE_RECORD_OUTCOME_UNCONFIRMED, code: META_AD_SET_PAUSE_RECORD_UNCONFIRMED_CODE }],
  ])('does not take the record-only exception from a body without the envelope (%s)', (_label, body) => {
    expect(metaAdSetFailureOutcome(httpError(503, body))).toEqual({ state: 'unconfirmed', message: META_AD_SET_UNCONFIRMED_MESSAGE });
  });
});

describe('metaAdSetWriteLeftValidatorKnown', () => {
  it('keeps the validator after a BFF envelope 412', () => {
    expect(metaAdSetWriteLeftValidatorKnown(httpError(412, { error: 'stale', code: 'PRECONDITION_FAILED' }))).toBe(true);
  });

  it.each([...META_AD_SET_PRE_SEND_REFUSAL_STATUSES])('keeps the validator after a BFF envelope pre-send refusal %i', (status) => {
    expect(metaAdSetWriteLeftValidatorKnown(httpError(status, { error: 'refused', code: 'X' }))).toBe(true);
  });

  it.each([
    ['a 409', 409],
    ['a definite 503', 503],
    ['a 500', 500],
    ['a 504', 504],
  ])('leaves the validator unknown after %s in the envelope', (_label, status) => {
    expect(metaAdSetWriteLeftValidatorKnown(httpError(status, { error: 'refused', code: 'X' }))).toBe(false);
  });

  it.each([
    ['a plain-text 412', 412, 'Precondition Failed'],
    ['a plain-text 400', 400, 'Bad Request'],
    ['a JSON 404 without the envelope code', 404, { error: 'not found' }],
    ['no response', 0, null],
  ])('leaves the validator unknown after %s that is not the envelope', (_label, status, body) => {
    expect(metaAdSetWriteLeftValidatorKnown(httpError(status, body))).toBe(false);
  });

  it('leaves the validator unknown after a non-HTTP error', () => {
    expect(metaAdSetWriteLeftValidatorKnown(new Error('boom'))).toBe(false);
  });
});
