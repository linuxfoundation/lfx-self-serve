// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { CAMPAIGN_BID_CONFLICT_MESSAGE, CAMPAIGN_BID_FAILURE_FALLBACK, CAMPAIGN_BID_OUTCOME_UNCONFIRMED } from '@lfx-one/shared/constants';
import { describe, expect, it } from 'vitest';

import { campaignBidFailureOutcome } from './campaign-bid-error.utils';

const httpError = (status: number, error: unknown): HttpErrorResponse => new HttpErrorResponse({ status, statusText: 'x', error });

describe('campaignBidFailureOutcome', () => {
  it('reports a 412 as a conflict that needs a refresh', () => {
    expect(campaignBidFailureOutcome(httpError(412, { error: 'etag mismatch', code: 'PRECONDITION_FAILED' }))).toEqual({
      state: 'conflict',
      message: CAMPAIGN_BID_CONFLICT_MESSAGE,
    });
  });

  // Upstream's NEUTRAL 409 (automated or non-per-click bidding, or an unconfirmable ad group) is
  // shown word for word: it is the reason the bid editor's strategy note exists.
  it('passes the neutral bidding-setup 409 through verbatim as a failure', () => {
    const message =
      "this campaign's bid cannot be set here: its bidding setup is not a manual per-click bid, or the ad group, ad set or line item this service created for it could not be confirmed; this endpoint never changes a bid strategy — check the campaign in the ad platform";
    expect(campaignBidFailureOutcome(httpError(409, { error: message, code: 'CONFLICT' }))).toEqual({ state: 'failed', message });
  });

  // Its wording contains "could not be confirmed", which must not turn a definite refusal unconfirmed.
  it('keeps a 409 a failure even though its wording mentions confirmation', () => {
    const message = 'the ad group this service created for it could not be confirmed';
    expect(campaignBidFailureOutcome(httpError(409, { error: message })).state).toBe('failed');
  });

  it('passes a platform floor 400 through verbatim', () => {
    const message = "the requested bid is not accepted by this campaign's ad platform: bid 0.001 is below Microsoft's minimum of 0.01";
    expect(campaignBidFailureOutcome(httpError(400, { error: message, code: 'BAD_REQUEST' }))).toEqual({ state: 'failed', message });
  });

  it("reports campaign-service's unconfirmed 503 as possibly applied", () => {
    const message =
      'the campaign bid change is unconfirmed — it may or may not have been applied on the ad platform; verify the bid in the platform before retrying';
    expect(campaignBidFailureOutcome(httpError(503, { error: message, code: 'SERVICE_UNAVAILABLE' }))).toEqual({ state: 'unconfirmed', message });
  });

  it("reports the BFF's own unconfirmed message as possibly applied, whatever the status", () => {
    expect(campaignBidFailureOutcome(httpError(504, { error: CAMPAIGN_BID_OUTCOME_UNCONFIRMED, code: 'TIMEOUT' }))).toEqual({
      state: 'unconfirmed',
      message: CAMPAIGN_BID_OUTCOME_UNCONFIRMED,
    });
  });

  // A 503 is how both an unconfirmed outcome and an unanswered gateway arrive; only the explicit
  // definite wording earns "failed".
  it.each([
    ['no body', null],
    ['a gateway page', '<html>Service Unavailable</html>'],
    ['an unrecognised message', { error: 'Service Unavailable' }],
    ['an unrecognised BFF envelope', { error: 'Service Unavailable', code: 'SERVICE_UNAVAILABLE' }],
  ])('reports a 503 with %s as unconfirmed, never as a plain failure', (_label, body) => {
    expect(campaignBidFailureOutcome(httpError(503, body))).toEqual({ state: 'unconfirmed', message: CAMPAIGN_BID_OUTCOME_UNCONFIRMED });
  });

  it('shows the definite 503 verbatim as a failure', () => {
    const message = 'the campaign bid could not be changed on the ad platform; the campaign was not modified';
    expect(campaignBidFailureOutcome(httpError(503, { error: message, code: 'SERVICE_UNAVAILABLE' }))).toEqual({ state: 'failed', message });
  });

  it.each([0, 408, 502, 504])('reports a message-less %i as unconfirmed', (status) => {
    expect(campaignBidFailureOutcome(httpError(status, null)).state).toBe('unconfirmed');
  });

  it.each([
    ['a 504 with proxy text', 504, 'upstream request timeout'],
    ['a 502 with proxy text', 502, 'Bad Gateway'],
    ['a 500 with an HTML page', 500, '<html><body>Internal error</body></html>'],
  ])('reports %s as unconfirmed, never as a plain failure', (_label, status, body) => {
    expect(campaignBidFailureOutcome(httpError(status, body))).toEqual({ state: 'unconfirmed', message: CAMPAIGN_BID_OUTCOME_UNCONFIRMED });
  });

  it('falls back to a generic failure for a message-less refusal', () => {
    expect(campaignBidFailureOutcome(httpError(400, null))).toEqual({ state: 'failed', message: CAMPAIGN_BID_FAILURE_FALLBACK });
  });
});
