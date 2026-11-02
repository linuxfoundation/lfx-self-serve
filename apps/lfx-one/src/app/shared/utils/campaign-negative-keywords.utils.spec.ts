// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import {
  CAMPAIGN_NEGATIVE_KEYWORD_UNCONFIRMED_ADVICE,
  CAMPAIGN_NEGATIVE_KEYWORDS_FAILURE_FALLBACK,
  CAMPAIGN_NEGATIVE_KEYWORDS_OUTCOME_UNCONFIRMED,
  CAMPAIGN_NEGATIVE_KEYWORDS_OUTCOME_UNKNOWN,
} from '@lfx-one/shared/constants';
import type { CampaignNegativeKeywordsRequestState, CampaignNegativeKeywordsResult } from '@lfx-one/shared/interfaces';
import { describe, expect, it } from 'vitest';

import {
  campaignKeywordWriteKey,
  keywordOutcomeSeqKey,
  campaignNegativeKeywordsFailureOutcome,
  mergeNegativeKeywordLastOutcomes,
  negativeKeywordOutcomeRows,
  negativeKeywordsScopesMatch,
  pendingKeywordWrites,
  redditKeywordNegativeAction,
  redditKeywordNoteKey,
  redditKeywordNoteShowable,
  redditKeywordNoteSuperseded,
  redditNegativeKeywordText,
  summarizeNegativeKeywordOutcomes,
} from './campaign-negative-keywords.utils';

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

  // Google Ads, Reddit and X return only NOT_SENT or REJECTED for a FAILED keyword, never their own
  // text; any other code is wire data with no meaning here and is not shown.
  it.each([
    ['google-ads', 'NOT_SENT', 'It was not sent to Google Ads, so nothing changed.'],
    ['google-ads', 'REJECTED', 'Google Ads refused it.'],
    ['reddit-ads', 'NOT_SENT', 'It was not sent to Reddit, so nothing changed.'],
    ['reddit-ads', 'REJECTED', 'Reddit refused it.'],
    ['twitter-ads', 'REJECTED', 'X refused it.'],
    ['twitter-ads', 'SomethingElse', 'X did not add it.'],
    ['twitter-ads', undefined, 'X did not add it.'],
  ] as const)('words a FAILED %s keyword with code %s for its platform', (platform, errorCode, detail) => {
    const rows = negativeKeywordOutcomeRows(
      ['free'],
      'Broad',
      { campaignId: 'c-1', appliedCount: 0, results: [{ text: 'free', matchType: 'Broad', outcome: 'FAILED', ...(errorCode && { errorCode }) }] },
      platform
    );
    expect(rows[0].detail).toBe(detail);
  });

  it('names the platform to check in the unconfirmed advice', () => {
    const rows = negativeKeywordOutcomeRows(['free'], 'Broad', { campaignId: 'c-1', appliedCount: 0, results: [] }, 'twitter-ads');
    expect(rows[0].detail).toContain('in X before retrying');
    expect(summarizeNegativeKeywordOutcomes(rows, 'twitter-ads')).toContain('in X before retrying');
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

  it.each([
    ['a 504 with proxy text', 504, 'upstream request timeout'],
    ['a 502 with proxy text', 502, 'Bad Gateway'],
    ['a 500 with an HTML page', 500, '<html><body>Internal error</body></html>'],
  ])('reports %s as unconfirmed: any keyword may have been added', (_label, status, body) => {
    expect(campaignNegativeKeywordsFailureOutcome(httpError(status, body))).toEqual({
      state: 'unconfirmed',
      message: CAMPAIGN_NEGATIVE_KEYWORDS_OUTCOME_UNCONFIRMED,
    });
  });

  // The add is irreversible and was dispatched: no 5xx, timeout or rate limit says what the platform
  // did, so none is a definite failure, whatever its wording.
  it.each([
    ['a definite-sounding 503', 503, 'the negative keywords could not be added on the ad platform; the campaign was not modified'],
    ['a BFF 500', 500, 'Internal server error'],
    ['a 502', 502, 'Bad gateway'],
    ['a 408', 408, 'Request timeout'],
    ['a 429', 429, 'Too many requests'],
  ])('reports %s in the BFF envelope as unconfirmed', (_label, status, message) => {
    expect(campaignNegativeKeywordsFailureOutcome(httpError(status, { error: message, code: 'X' }))).toEqual({
      state: 'unconfirmed',
      message: CAMPAIGN_NEGATIVE_KEYWORDS_OUTCOME_UNKNOWN,
    });
  });

  it.each([401, 403, 404, 409])('keeps a documented %s refusal definite', (status) => {
    expect(campaignNegativeKeywordsFailureOutcome(httpError(status, { error: 'refused', code: 'X' }))).toEqual({ state: 'failed', message: 'refused' });
  });

  it('passes a refusal through verbatim', () => {
    const message = 'negative keywords can be added to Microsoft Advertising campaigns only';
    expect(campaignNegativeKeywordsFailureOutcome(httpError(400, { error: message, code: 'BAD_REQUEST' }))).toEqual({ state: 'failed', message });
    expect(campaignNegativeKeywordsFailureOutcome(httpError(400, { error: '', code: 'BAD_REQUEST' }))).toEqual({
      state: 'failed',
      message: CAMPAIGN_NEGATIVE_KEYWORDS_FAILURE_FALLBACK,
    });
  });
});

describe('redditNegativeKeywordText', () => {
  it('parses the keyword as the editor parses a line', () => {
    expect(redditNegativeKeywordText('  service   mesh ')).toBe('service mesh');
  });

  it.each([
    ['no keyword', null],
    ['a blank keyword', '   '],
    ['disallowed characters', 'k8s!!'],
    ['adjacent punctuation', "rock''n"],
    ['more than one line', 'a\nb'],
    ['a text over the length cap', 'x'.repeat(101)],
  ])('is null for %s', (_label, keyword) => {
    expect(redditNegativeKeywordText(keyword)).toBeNull();
  });
});

describe('redditKeywordNegativeAction', () => {
  const target = { campaignId: 'c-1', campaignName: 'KubeCon EU' };
  const idle = { campaignReading: false, rowReading: false, negativeWritePending: false, targetingRemovalPending: false };
  /** A settled request, its per-keyword last outcomes built as the service builds them unless given. */
  const request = (over: Partial<CampaignNegativeKeywordsRequestState> = {}): CampaignNegativeKeywordsRequestState => {
    const base: CampaignNegativeKeywordsRequestState = {
      pending: false,
      outcomeRows: [],
      batchOutcome: null,
      batchKeywords: [],
      sent: [],
      matchType: 'Broad',
      platform: 'reddit-ads',
      settleCount: 1,
      keywordOutcomes: {},
      ...over,
    };
    return over.keywordOutcomes !== undefined
      ? base
      : { ...base, keywordOutcomes: mergeNegativeKeywordLastOutcomes({}, base.pending ? [] : base.sent, base.outcomeRows, base.batchOutcome, 1) };
  };
  const rows = (sent: string[], outcomes: ('APPLIED' | 'ALREADY_PRESENT' | 'FAILED' | 'UNCONFIRMED')[]) =>
    negativeKeywordOutcomeRows(
      sent,
      'Broad',
      { campaignId: 'c-1', appliedCount: 0, results: sent.map((text, i) => ({ text, matchType: 'Broad' as const, outcome: outcomes[i] })) },
      'reddit-ads'
    );

  it('offers nothing without a target or a sendable keyword', () => {
    expect(redditKeywordNegativeAction('service mesh', null, null, idle).state).toBe('none');
    expect(redditKeywordNegativeAction(null, target, null, idle).state).toBe('none');
    expect(redditKeywordNegativeAction('k8s!!', target, null, idle).state).toBe('none');
  });

  it('still carries a not-sent note when no action is offered any more, but not for a row with no sendable keyword', () => {
    expect(redditKeywordNegativeAction('service mesh', null, null, idle, 'Nothing was sent.')).toMatchObject({
      state: 'none',
      notSentMessage: 'Nothing was sent.',
    });
    expect(redditKeywordNegativeAction(null, null, null, idle, 'Nothing was sent.')).toMatchObject({ state: 'none', notSentMessage: '' });
  });

  it('offers the add, named for the keyword and the campaign', () => {
    expect(redditKeywordNegativeAction('service mesh', target, null, idle)).toEqual({
      state: 'available',
      sending: false,
      ariaLabel: 'Add as negative: service mesh (KubeCon EU)',
      outcomeLabel: '',
      outcomeDetail: '',
      outcomeTone: 'none',
      notSentMessage: '',
    });
  });

  it('is busy while a request of the campaign is in flight, sending only on the keyword it carries', () => {
    const pending = request({ pending: true, sent: ['service mesh'] });
    expect(redditKeywordNegativeAction('service mesh', target, pending, idle)).toMatchObject({ state: 'busy', sending: true });
    expect(redditKeywordNegativeAction('gitops', target, pending, idle)).toMatchObject({ state: 'busy', sending: false });
  });

  it('is busy while the revision of the campaign is being read', () => {
    expect(redditKeywordNegativeAction('gitops', target, null, { ...idle, campaignReading: true, rowReading: true })).toMatchObject({
      state: 'busy',
      sending: true,
    });
    expect(redditKeywordNegativeAction('gitops', target, null, { ...idle, campaignReading: true, rowReading: false })).toMatchObject({
      state: 'busy',
      sending: false,
    });
  });

  it('is busy while an add to the campaign runs under another brief key', () => {
    expect(redditKeywordNegativeAction('gitops', target, null, { ...idle, negativeWritePending: true })).toMatchObject({ state: 'busy', sending: false });
  });

  // A campaign's Reddit targeting is one domain: no add while a removal from it is in flight.
  it('is busy while a keyword-targeting removal of the campaign is in flight', () => {
    expect(redditKeywordNegativeAction('gitops', target, null, { ...idle, targetingRemovalPending: true })).toMatchObject({ state: 'busy', sending: false });
  });

  // Positional: the outcome at the keyword's index in what was SENT.
  it('shows a confirmed keyword as a negative and an unsettled one with its outcome', () => {
    const settled = request({
      sent: ['free', 'service mesh', 'gitops', 'jobs'],
      outcomeRows: rows(['free', 'service mesh', 'gitops', 'jobs'], ['APPLIED', 'ALREADY_PRESENT', 'UNCONFIRMED', 'FAILED']),
    });

    expect(redditKeywordNegativeAction('free', target, settled, idle)).toMatchObject({ state: 'negative', outcomeLabel: 'Added', ariaLabel: '' });
    expect(redditKeywordNegativeAction('service mesh', target, settled, idle)).toMatchObject({ state: 'negative', outcomeLabel: 'Already present' });
    expect(redditKeywordNegativeAction('gitops', target, settled, idle)).toMatchObject({
      state: 'available',
      outcomeLabel: 'Not confirmed',
      outcomeTone: 'warning',
    });
    expect(redditKeywordNegativeAction('jobs', target, settled, idle)).toMatchObject({ state: 'available', outcomeLabel: 'Not added', outcomeTone: 'error' });
    expect(redditKeywordNegativeAction('other', target, settled, idle)).toMatchObject({ state: 'available', outcomeTone: 'none' });
  });

  it('words a request that produced no per-keyword results by its batch outcome', () => {
    const refused = request({ sent: ['gitops'], batchKeywords: ['gitops'], batchOutcome: { state: 'failed', message: 'stale revision' } });
    const unknown = request({ sent: ['gitops'], batchKeywords: ['gitops'], batchOutcome: { state: 'unconfirmed', message: 'verify first' } });

    expect(redditKeywordNegativeAction('gitops', target, refused, idle)).toMatchObject({
      state: 'available',
      outcomeLabel: 'Not added',
      outcomeDetail: 'stale revision',
      outcomeTone: 'error',
    });
    expect(redditKeywordNegativeAction('gitops', target, unknown, idle)).toMatchObject({
      state: 'available',
      outcomeLabel: 'Not confirmed',
      outcomeDetail: 'verify first',
      outcomeTone: 'warning',
    });
  });

  // A later request for OTHER keywords replaces the campaign's latest request, not a keyword's own last outcome.
  it("keeps a keyword's last outcome, and its verify-first tone, across a later request for other keywords", () => {
    const first = mergeNegativeKeywordLastOutcomes({}, ['gitops'], rows(['gitops'], ['UNCONFIRMED']), null, 1);
    const later = request({
      sent: ['service mesh'],
      outcomeRows: rows(['service mesh'], ['APPLIED']),
      keywordOutcomes: mergeNegativeKeywordLastOutcomes(first, ['service mesh'], rows(['service mesh'], ['APPLIED']), null, 2),
    });

    expect(redditKeywordNegativeAction('gitops', target, later, idle)).toMatchObject({
      state: 'available',
      outcomeLabel: 'Not confirmed',
      outcomeTone: 'warning',
    });
    expect(redditKeywordNegativeAction('service mesh', target, later, idle)).toMatchObject({ state: 'negative' });
  });

  it('shows the latest unsent attempt beside, not instead of, the last write outcome', () => {
    const settled = request({ sent: ['gitops'], outcomeRows: rows(['gitops'], ['UNCONFIRMED']) });

    expect(redditKeywordNegativeAction('gitops', target, settled, idle, 'Nothing was sent.')).toMatchObject({
      state: 'available',
      outcomeLabel: 'Not confirmed',
      outcomeTone: 'warning',
      notSentMessage: 'Nothing was sent.',
    });
  });
});

describe('mergeNegativeKeywordLastOutcomes', () => {
  it('takes the new outcome of each keyword sent, by position, and keeps every other keyword', () => {
    const sent = ['a', 'b'];
    const rows = negativeKeywordOutcomeRows(
      sent,
      'Broad',
      {
        campaignId: 'c-1',
        appliedCount: 1,
        results: [
          { text: 'a', matchType: 'Broad', outcome: 'APPLIED' },
          { text: 'b', matchType: 'Broad', outcome: 'FAILED' },
        ],
      },
      'reddit-ads'
    );
    const merged = mergeNegativeKeywordLastOutcomes(
      { c: { outcome: 'UNCONFIRMED', label: 'Not confirmed', detail: 'verify', seq: 1 }, b: { outcome: 'APPLIED', label: 'Added', detail: '', seq: 1 } },
      sent,
      rows,
      null,
      2
    );

    expect(merged['a'].outcome).toBe('APPLIED');
    expect(merged['b'].outcome).toBe('FAILED');
    expect(merged['a'].seq).toBe(2);
    expect(merged['c']).toEqual({ outcome: 'UNCONFIRMED', label: 'Not confirmed', detail: 'verify', seq: 1 });
  });

  it("gives every keyword of a batch with no per-keyword results the batch's outcome", () => {
    expect(mergeNegativeKeywordLastOutcomes({}, ['a'], [], { state: 'unconfirmed', message: 'verify first' }, 3)).toEqual({
      a: { outcome: 'UNCONFIRMED', label: 'Not confirmed', detail: 'verify first', seq: 3 },
    });
    expect(mergeNegativeKeywordLastOutcomes({}, ['a'], [], { state: 'failed', message: 'refused' }, 4)['a'].outcome).toBe('FAILED');
  });
});

describe('negativeKeywordsScopesMatch', () => {
  it('treats an empty brief id on the same project as the same scope, and anything else as another', () => {
    expect(negativeKeywordsScopesMatch('tlf', 'b-1', 'tlf', 'b-1')).toBe(true);
    expect(negativeKeywordsScopesMatch('tlf', '', 'tlf', 'b-1')).toBe(true);
    expect(negativeKeywordsScopesMatch('tlf', 'b-1', 'tlf', '')).toBe(true);
    expect(negativeKeywordsScopesMatch('tlf', 'b-2', 'tlf', 'b-1')).toBe(false);
    expect(negativeKeywordsScopesMatch('cncf', '', 'tlf', 'b-1')).toBe(false);
  });
});

describe('keyword-write keys', () => {
  it('key a campaign by project and campaign, whatever the brief', () => {
    expect(campaignKeywordWriteKey('tlf', 'c-1')).toBe('tlf|c-1');
    expect(
      pendingKeywordWrites({
        'tlf|b-1|c-1': { pending: true },
        'tlf||c-1': { pending: true },
        'tlf|b-1|c-2': { pending: false },
        'cncf|b-1|c-3': { pending: true },
      })
    ).toEqual({ 'tlf|c-1': true, 'cncf|c-3': true });
  });
});

describe('redditKeywordNoteKey', () => {
  it('keys a note by project, Reddit campaign and the text as sent, with no report index', () => {
    expect(redditKeywordNoteKey('tlf', 't3_a', 'service mesh')).toBe('tlf|t3_a|service mesh');
  });
});

describe('redditKeywordNoteShowable', () => {
  const note = {
    read: 'r1',
    outcomeSeq: 3,
    message: 'Nothing was sent.',
    keyword: 'gitops',
    campaignName: 'KubeCon EU',
    projectSlug: 'tlf',
    redditCampaignId: 't3_a',
    campaignId: 'c-1',
  };
  const current = (latestKeywordSeq: number | undefined, over: { projectSlug?: string; readId?: string } = {}) => ({
    projectSlug: 'tlf',
    readId: 'r1',
    latestKeywordSeq,
    ...over,
  });

  it('shows a note only under its project and for the read it was recorded in', () => {
    expect(redditKeywordNoteShowable(note, current(undefined))).toBe(true);
    expect(redditKeywordNoteShowable(note, current(undefined, { projectSlug: 'cncf' }))).toBe(false);
    expect(redditKeywordNoteShowable(note, current(undefined, { readId: 'r2' }))).toBe(false);
  });

  // The keyword's high-water mark, not the outcome on display: only a later settle supersedes.
  it("is superseded only once the keyword's high-water mark passes the note's seq", () => {
    expect(redditKeywordNoteShowable(note, current(4))).toBe(false);
    expect(redditKeywordNoteSuperseded(note, 4)).toBe(true);
    expect(redditKeywordNoteShowable(note, current(3))).toBe(true);
    expect(redditKeywordNoteShowable(note, current(2))).toBe(true);
    expect(redditKeywordNoteSuperseded(note, undefined)).toBe(false);
  });
});

describe('keywordOutcomeSeqKey', () => {
  it('keys a keyword by its campaign write key and text, with no brief', () => {
    expect(keywordOutcomeSeqKey('tlf', 'c-1', 'gitops')).toBe('tlf|c-1|gitops');
  });
});
