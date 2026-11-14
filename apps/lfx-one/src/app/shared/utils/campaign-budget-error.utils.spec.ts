// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { CAMPAIGN_BUDGET_CONFLICT_MESSAGE, CAMPAIGN_BUDGET_FAILURE_FALLBACK, CAMPAIGN_BUDGET_OUTCOME_UNCONFIRMED } from '@lfx-one/shared/constants';
import { describe, expect, it } from 'vitest';

import { campaignBudgetFailureOutcome } from './campaign-budget-error.utils';

const httpError = (status: number, error: unknown): HttpErrorResponse => new HttpErrorResponse({ status, statusText: 'x', error });

describe('campaignBudgetFailureOutcome', () => {
  it('reports a 412 as a conflict that needs a refresh, whatever the body says', () => {
    expect(
      campaignBudgetFailureOutcome(httpError(412, { error: 'the supplied ETag does not match the current version', code: 'PRECONDITION_FAILED' }))
    ).toEqual({
      state: 'conflict',
      message: CAMPAIGN_BUDGET_CONFLICT_MESSAGE,
    });
  });

  // campaign-service's 409s run past the 200-character cap the generic readers apply, and must
  // still reach the operator word for word.
  it('passes a long upstream 409 through verbatim', () => {
    const message =
      "this campaign's budget is shared with other campaigns, so changing it here would change their spend too; give the campaign its own budget in the ad platform, or make the change there where its full effect is visible";
    expect(campaignBudgetFailureOutcome(httpError(409, { error: message, code: 'CONFLICT' }))).toEqual({ state: 'failed', message });
  });

  it('passes an upstream 400 platform minimum through verbatim', () => {
    const message = 'budget is below the LinkedIn minimum daily budget of 10.00 in the account currency';
    expect(campaignBudgetFailureOutcome(httpError(400, { error: message, code: 'BAD_REQUEST' }))).toEqual({ state: 'failed', message });
  });

  // A forwarded 503 is labelled SERVICE_UNAVAILABLE, which the generic readers discard. The
  // definite one says the campaign was not modified, and that must be shown, not replaced.
  it('shows a definite upstream 503 verbatim as a failure', () => {
    const message = 'the campaign budget could not be changed on the ad platform; the campaign was not modified';
    expect(campaignBudgetFailureOutcome(httpError(503, { error: message, code: 'SERVICE_UNAVAILABLE' }))).toEqual({ state: 'failed', message });
  });

  it("reports campaign-service's own unconfirmed 503 as unconfirmed, keeping its words", () => {
    const message =
      'the campaign budget change is unconfirmed — it may or may not have been applied on the ad platform; verify the budget in the platform before retrying';
    expect(campaignBudgetFailureOutcome(httpError(503, { error: message, code: 'SERVICE_UNAVAILABLE' }))).toEqual({ state: 'unconfirmed', message });
  });

  it("reports the BFF's unconfirmed rewrite as unconfirmed", () => {
    expect(campaignBudgetFailureOutcome(httpError(504, { error: CAMPAIGN_BUDGET_OUTCOME_UNCONFIRMED, code: 'GATEWAY_TIMEOUT', transport: true }))).toEqual({
      state: 'unconfirmed',
      message: CAMPAIGN_BUDGET_OUTCOME_UNCONFIRMED,
    });
  });

  it.each([0, 408, 502, 503, 504])('reports a %s with no message as unconfirmed, never as a failure', (status) => {
    expect(campaignBudgetFailureOutcome(httpError(status, null))).toEqual({ state: 'unconfirmed', message: CAMPAIGN_BUDGET_OUTCOME_UNCONFIRMED });
  });

  it('reports a non-HTTP error as unconfirmed', () => {
    expect(campaignBudgetFailureOutcome(new Error('boom')).state).toBe('unconfirmed');
  });

  it('prefers the field reason over the wire-keyed summary of a BFF validation error', () => {
    const body = {
      error: 'Validation failed for budget',
      code: 'VALIDATION_ERROR',
      errors: [{ field: 'budget', message: 'budget must be a finite number greater than zero' }],
    };
    expect(campaignBudgetFailureOutcome(httpError(400, body))).toEqual({ state: 'failed', message: 'budget must be a finite number greater than zero' });
  });

  it('falls back to a generic failure for a refusal with no readable message', () => {
    expect(campaignBudgetFailureOutcome(httpError(400, { error: '', code: 'BAD_REQUEST' }))).toEqual({
      state: 'failed',
      message: CAMPAIGN_BUDGET_FAILURE_FALLBACK,
    });
  });

  // The BFF answers every error with its JSON `{ error, code }` envelope. A body without it came from
  // a proxy or gateway in front of the BFF, which cannot know whether the budget write applied.
  it.each([
    ['a 504 with proxy text', 504, 'upstream request timeout'],
    ['a 502 with proxy text', 502, 'Bad Gateway'],
    ['a 500 with an HTML page', 500, '<html><body>Internal error</body></html>'],
    ['a 503 with a JSON body that is not the envelope', 503, { message: 'no healthy upstream' }],
  ])('reports %s as unconfirmed, never as a plain failure', (_label, status, body) => {
    expect(campaignBudgetFailureOutcome(httpError(status, body))).toEqual({ state: 'unconfirmed', message: CAMPAIGN_BUDGET_OUTCOME_UNCONFIRMED });
  });

  // Aligned with the bid lever: a 4xx other than 408 is a refusal before its wording is read.
  it('keeps a 409 a failure even though its wording mentions confirmation', () => {
    const message = 'the budget this service created for it could not be confirmed';
    expect(campaignBudgetFailureOutcome(httpError(409, { error: message, code: 'CONFLICT' }))).toEqual({ state: 'failed', message });
  });
});
