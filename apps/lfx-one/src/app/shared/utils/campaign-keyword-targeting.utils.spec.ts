// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import {
  KEYWORD_TARGETING_READ_ERROR_MESSAGES,
  KEYWORD_TARGETING_REMOVAL_ERROR_MESSAGES,
  KEYWORD_TARGETING_REMOVAL_FAILED_FALLBACK,
  KEYWORD_TARGETING_REMOVAL_UNCONFIRMED_ADVICE,
  KEYWORD_TARGETING_REMOVAL_UNCONFIRMED_CODE,
} from '@lfx-one/shared/constants';
import { describe, expect, it } from 'vitest';

import {
  classifyKeywordTargetingRemovalFailure,
  keywordTargetingListItems,
  keywordTargetingReadErrorMessage,
  keywordTargetingRemovalOutcomeRows,
  summarizeKeywordTargetingRemovals,
} from './campaign-keyword-targeting.utils';

const httpError = (status: number, error: unknown): HttpErrorResponse => new HttpErrorResponse({ status, error });

describe('keywordTargetingListItems', () => {
  // Reddit compares a removal verbatim, so the text is kept exactly as read.
  it('names a Reddit keyword by its exact text', () => {
    const items = keywordTargetingListItems({
      campaign_id: 'c-1',
      platform: 'reddit-ads',
      targeting_entity_id: 'ag-1',
      keywords: [{ keyword: ' Cloud  Native ' }],
      revision: 'sha256:r1',
    });
    expect(items).toEqual([{ key: ' Cloud  Native ', keyword: ' Cloud  Native ', matchLabel: '', removalItem: { keyword: ' Cloud  Native ' } }]);
  });

  it('names an X keyword by its criterion id, and gives one without an id no handle', () => {
    const items = keywordTargetingListItems({
      campaign_id: 'c-1',
      platform: 'twitter-ads',
      targeting_entity_id: 'li-1',
      keywords: [{ keyword: 'devops', criterion_id: 'k1', match_type: 'EXACT_KEYWORD' }, { keyword: 'orphan' }],
    });
    expect(items[0]).toEqual({ key: 'k1', keyword: 'devops', matchLabel: 'Exact', removalItem: { criterionId: 'k1' } });
    expect(items[1].removalItem).toBeNull();
  });

  it('lists nothing for no read', () => {
    expect(keywordTargetingListItems(null)).toEqual([]);
  });
});

describe('keywordTargetingRemovalOutcomeRows', () => {
  it('zips each result onto the keyword sent at its index, unknown or missing entries unconfirmed', () => {
    const rows = keywordTargetingRemovalOutcomeRows(['a', 'b', 'c', 'd'], {
      campaign_id: 'c-1',
      applied_count: 1,
      results: [
        { keyword: 'a', outcome: 'APPLIED' },
        { keyword: 'b', outcome: 'FAILED', error_code: 'NOT_FOUND' },
        { keyword: 'c', outcome: 'SOMETHING_NEW' as never },
      ],
    });
    expect(rows.map((r) => [r.keyword, r.outcome])).toEqual([
      ['a', 'APPLIED'],
      ['b', 'FAILED'],
      ['c', 'UNCONFIRMED'],
      ['d', 'UNCONFIRMED'],
    ]);
    expect(rows[1].detail).toContain('no longer in the targeting');
    expect(rows[3].detail).toBe(KEYWORD_TARGETING_REMOVAL_UNCONFIRMED_ADVICE);
  });

  it('never shows an unknown error code', () => {
    const rows = keywordTargetingRemovalOutcomeRows(['a'], {
      campaign_id: 'c-1',
      applied_count: 0,
      results: [{ keyword: 'a', outcome: 'FAILED', error_code: '<b>x</b>' }],
    });
    expect(rows[0].detail).toBe(KEYWORD_TARGETING_REMOVAL_FAILED_FALLBACK);
  });

  it('summarises counts with the reload advice when any is unconfirmed', () => {
    const rows = keywordTargetingRemovalOutcomeRows(['a', 'b'], {
      campaign_id: 'c-1',
      applied_count: 1,
      results: [{ outcome: 'APPLIED' }, { outcome: 'UNCONFIRMED' }],
    });
    expect(summarizeKeywordTargetingRemovals(rows)).toBe(`1 removed, 1 not confirmed. ${KEYWORD_TARGETING_REMOVAL_UNCONFIRMED_ADVICE}`);
    expect(summarizeKeywordTargetingRemovals([])).toBe('');
  });
});

describe('classifyKeywordTargetingRemovalFailure', () => {
  it.each([
    ["the BFF's unconfirmed code", httpError(503, { error: 'x', code: KEYWORD_TARGETING_REMOVAL_UNCONFIRMED_CODE })],
    ['a lost connection', httpError(0, null)],
    ["a proxy's text", httpError(504, 'upstream request timeout')],
    ['a non-HTTP error', new Error('boom')],
  ])('reports %s as unconfirmed', (_label, error) => {
    expect(classifyKeywordTargetingRemovalFailure(error, 'reddit-ads')).toEqual({
      state: 'unconfirmed',
      message: KEYWORD_TARGETING_REMOVAL_UNCONFIRMED_ADVICE,
    });
  });

  it.each([
    [409, 'reddit-ads', KEYWORD_TARGETING_REMOVAL_ERROR_MESSAGES.conflict],
    [400, 'reddit-ads', KEYWORD_TARGETING_REMOVAL_ERROR_MESSAGES.refusedReddit],
    [400, 'twitter-ads', KEYWORD_TARGETING_REMOVAL_ERROR_MESSAGES.refused],
    [403, 'twitter-ads', KEYWORD_TARGETING_REMOVAL_ERROR_MESSAGES.forbidden],
    [404, 'twitter-ads', KEYWORD_TARGETING_REMOVAL_ERROR_MESSAGES.notFound],
    [401, 'twitter-ads', KEYWORD_TARGETING_REMOVAL_ERROR_MESSAGES.forbidden],
  ] as const)('words a documented, enveloped %s on %s as definite, in fixed text', (status, platform, message) => {
    expect(classifyKeywordTargetingRemovalFailure(httpError(status, { error: 'upstream words', code: 'X' }), platform)).toEqual({ state: 'failed', message });
  });

  // A removal is irreversible: no 5xx (not even a definite-sounding 503), timeout or rate limit says
  // what the platform did after dispatch.
  it.each([500, 502, 503, 504, 408, 429])('reports an enveloped %s as unconfirmed', (status) => {
    expect(
      classifyKeywordTargetingRemovalFailure(
        httpError(status, { error: 'the keyword targeting could not be removed', code: 'SERVICE_UNAVAILABLE' }),
        'reddit-ads'
      )
    ).toEqual({ state: 'unconfirmed', message: KEYWORD_TARGETING_REMOVAL_UNCONFIRMED_ADVICE });
  });
});

describe('keywordTargetingReadErrorMessage', () => {
  it.each([
    [409, KEYWORD_TARGETING_READ_ERROR_MESSAGES.conflict],
    [503, KEYWORD_TARGETING_READ_ERROR_MESSAGES.unavailable],
    [400, KEYWORD_TARGETING_READ_ERROR_MESSAGES.refused],
    [403, KEYWORD_TARGETING_READ_ERROR_MESSAGES.forbidden],
    [0, KEYWORD_TARGETING_READ_ERROR_MESSAGES.other],
  ])('words a %s in fixed text', (status, message) => {
    expect(keywordTargetingReadErrorMessage(httpError(status, { error: 'upstream words', code: 'X' }))).toBe(message);
  });
});
