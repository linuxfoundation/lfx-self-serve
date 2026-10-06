// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import {
  CAMPAIGN_NEGATIVE_KEYWORD_UNCONFIRMED_ADVICE,
  CAMPAIGN_NEGATIVE_KEYWORDS_FAILURE_FALLBACK,
  CAMPAIGN_NEGATIVE_KEYWORDS_OUTCOME_UNCONFIRMED,
} from '@lfx-one/shared/constants';
import type { CampaignNegativeKeywordsResult } from '@lfx-one/shared/interfaces';
import { describe, expect, it } from 'vitest';

import { campaignNegativeKeywordsFailureOutcome, negativeKeywordOutcomeRows, summarizeNegativeKeywordOutcomes } from './campaign-negative-keywords.utils';

const httpError = (status: number, error: unknown): HttpErrorResponse => new HttpErrorResponse({ status, statusText: 'x', error });

describe('negativeKeywordOutcomeRows', () => {
  const sent = ['free', 'cheap', 'jobs', 'torrent'];
  const response: CampaignNegativeKeywordsResult = {
    campaignId: 'c-1',
    appliedCount: 2,
    results: [
      { text: 'free', matchType: 'Exact', outcome: 'APPLIED', negativeKeywordId: '9' },
      { text: 'cheap', matchType: 'Exact', outcome: 'ALREADY_PRESENT' },
      { text: 'jobs', matchType: 'Exact', outcome: 'FAILED', errorCode: 'InvalidKeywordText' },
      { text: 'torrent', matchType: 'Exact', outcome: 'UNCONFIRMED' },
    ],
  };

  it('zips each result onto the keyword sent at the same index, in sent order', () => {
    const rows = negativeKeywordOutcomeRows(sent, 'Exact', response);
    expect(rows.map((r) => [r.index, r.text, r.outcome])).toEqual([
      [0, 'free', 'APPLIED'],
      [1, 'cheap', 'ALREADY_PRESENT'],
      [2, 'jobs', 'FAILED'],
      [3, 'torrent', 'UNCONFIRMED'],
    ]);
    expect(rows[2].detail).toContain('InvalidKeywordText');
    expect(rows[3].detail).toBe(CAMPAIGN_NEGATIVE_KEYWORD_UNCONFIRMED_ADVICE);
    expect(rows[3].label).not.toMatch(/fail|not added/i);
  });

  // Positional, not by text: the SENT text is what is shown, even if the echoed text differs.
  it('labels each row with the text that was sent, not the text echoed back', () => {
    const rows = negativeKeywordOutcomeRows(['Free  Stuff'], 'Phrase', {
      campaignId: 'c-1',
      appliedCount: 1,
      results: [{ text: 'something else', matchType: 'Phrase', outcome: 'APPLIED' }],
    });
    expect(rows[0]).toMatchObject({ text: 'Free  Stuff', matchType: 'Phrase', outcome: 'APPLIED' });
  });

  // A short array or an unknown outcome says nothing about that keyword: it reached the platform.
  it('reports a missing or unrecognised entry as unconfirmed at its own position', () => {
    const rows = negativeKeywordOutcomeRows(['a', 'b', 'c'], 'Exact', {
      campaignId: 'c-1',
      appliedCount: 1,
      results: [
        { text: 'a', matchType: 'Exact', outcome: 'APPLIED' },
        { text: 'b', matchType: 'Exact', outcome: 'SOMETHING_NEW' as never },
      ],
    });
    expect(rows.map((r) => r.outcome)).toEqual(['APPLIED', 'UNCONFIRMED', 'UNCONFIRMED']);
  });

  it('summarises counts in outcome order and appends the verify advice when any is unconfirmed', () => {
    const summary = summarizeNegativeKeywordOutcomes(negativeKeywordOutcomeRows(sent, 'Exact', response));
    expect(summary).toBe(`1 added, 1 already present, 1 not added, 1 not confirmed. ${CAMPAIGN_NEGATIVE_KEYWORD_UNCONFIRMED_ADVICE}`);
    expect(summarizeNegativeKeywordOutcomes([])).toBe('');
  });
});

describe('campaignNegativeKeywordsFailureOutcome', () => {
  it("reports the BFF's unreadable-confirmation 502 as unconfirmed", () => {
    expect(campaignNegativeKeywordsFailureOutcome(httpError(502, { error: CAMPAIGN_NEGATIVE_KEYWORDS_OUTCOME_UNCONFIRMED, code: 'BAD_GATEWAY' }))).toEqual({
      state: 'unconfirmed',
      message: CAMPAIGN_NEGATIVE_KEYWORDS_OUTCOME_UNCONFIRMED,
    });
  });

  it("reports campaign-service's unconfirmed 503 as unconfirmed", () => {
    const message =
      "the negative keywords are unconfirmed — they may or may not have been added on the ad platform; verify this campaign's negative keywords in the platform before retrying";
    expect(campaignNegativeKeywordsFailureOutcome(httpError(503, { error: message })).state).toBe('unconfirmed');
  });

  it.each([0, 504])('reports a message-less %i as unconfirmed', (status) => {
    expect(campaignNegativeKeywordsFailureOutcome(httpError(status, null))).toEqual({
      state: 'unconfirmed',
      message: CAMPAIGN_NEGATIVE_KEYWORDS_OUTCOME_UNCONFIRMED,
    });
  });

  it('passes a refusal through verbatim', () => {
    const message = 'negative keywords can be added to Microsoft Advertising campaigns only';
    expect(campaignNegativeKeywordsFailureOutcome(httpError(400, { error: message }))).toEqual({ state: 'failed', message });
    expect(campaignNegativeKeywordsFailureOutcome(httpError(400, null))).toEqual({ state: 'failed', message: CAMPAIGN_NEGATIVE_KEYWORDS_FAILURE_FALLBACK });
  });
});
