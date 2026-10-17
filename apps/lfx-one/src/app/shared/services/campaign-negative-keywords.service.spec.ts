// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { CAMPAIGN_NEGATIVE_KEYWORDS_OUTCOME_UNCONFIRMED } from '@lfx-one/shared/constants';
import { CampaignNegativeKeywordsResult, CampaignNegativeKeywordsSubmission } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CampaignKeywordTargetingService } from './campaign-keyword-targeting.service';
import { CampaignNegativeKeywordsService } from './campaign-negative-keywords.service';
import { CampaignService } from './campaign.service';

describe('CampaignNegativeKeywordsService', () => {
  let service: CampaignNegativeKeywordsService;
  let addNegativeKeywords: ReturnType<typeof vi.fn>;
  let messageAdd: ReturnType<typeof vi.fn>;
  let responses: Subject<CampaignNegativeKeywordsResult>[];

  const submission = (over: Partial<CampaignNegativeKeywordsSubmission> = {}): CampaignNegativeKeywordsSubmission => ({
    projectSlug: 'tlf',
    briefId: 'b-1',
    campaignId: 'c-1',
    campaignName: 'KubeCon EU',
    platform: 'microsoft-ads',
    keywords: ['alpha', 'beta'],
    matchType: 'Exact',
    ...over,
  });

  beforeEach(() => {
    responses = [];
    addNegativeKeywords = vi.fn().mockImplementation(() => {
      const response = new Subject<CampaignNegativeKeywordsResult>();
      responses.push(response);
      return response;
    });
    messageAdd = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: CampaignService, useValue: { addNegativeKeywords, removeKeywordTargeting: vi.fn().mockReturnValue(new Subject()) } },
        { provide: MessageService, useValue: { add: messageAdd } },
      ],
    });
    service = TestBed.inject(CampaignNegativeKeywordsService);
  });

  const answer = (index: number, outcomes: ('APPLIED' | 'ALREADY_PRESENT' | 'FAILED' | 'UNCONFIRMED')[]): void => {
    responses[index].next({
      campaignId: 'c-1',
      appliedCount: outcomes.filter((o) => o === 'APPLIED' || o === 'ALREADY_PRESENT').length,
      results: outcomes.map((outcome, i) => ({ text: `kw-${i}`, matchType: 'Exact', outcome })),
    });
    responses[index].complete();
  };

  it('sends the keywords and keeps the outcomes in the order they were sent', () => {
    service.submit(submission());

    expect(addNegativeKeywords).toHaveBeenCalledWith(
      'tlf',
      'b-1',
      'c-1',
      [
        { text: 'alpha', matchType: 'Exact' },
        { text: 'beta', matchType: 'Exact' },
      ],
      undefined
    );
    expect(service.requests()['tlf|b-1|c-1'].pending).toBe(true);

    answer(0, ['ALREADY_PRESENT', 'APPLIED']);

    const request = service.requests()['tlf|b-1|c-1'];
    expect(request.pending).toBe(false);
    expect(request.outcomeRows.map((row) => [row.text, row.outcome])).toEqual([
      ['alpha', 'ALREADY_PRESENT'],
      ['beta', 'APPLIED'],
    ]);
    expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success' }));
  });

  // Reddit requires the keyword-targeting read's revision; Microsoft Advertising and X answer a
  // PRESENT one (even empty) with 400, so it must reach Reddit and only Reddit.
  it('sends the revision for a Reddit campaign', () => {
    service.submit(submission({ platform: 'reddit-ads', matchType: 'Broad', revision: 'sha256:r1' }));

    expect(addNegativeKeywords).toHaveBeenCalledWith(
      'tlf',
      'b-1',
      'c-1',
      [
        { text: 'alpha', matchType: 'Broad' },
        { text: 'beta', matchType: 'Broad' },
      ],
      'sha256:r1'
    );
  });

  it.each(['microsoft-ads', 'twitter-ads'] as const)('never sends a revision for a %s campaign, even when handed one', (platform) => {
    service.submit(submission({ platform, revision: 'sha256:r1' }));

    expect(addNegativeKeywords).toHaveBeenCalledTimes(1);
    expect(addNegativeKeywords.mock.calls[0][4]).toBeUndefined();
  });

  it('sends nothing for a Reddit campaign without a revision', () => {
    service.submit(submission({ platform: 'reddit-ads', matchType: 'Broad' }));
    service.submit(submission({ platform: 'reddit-ads', matchType: 'Broad', revision: '' }));

    expect(addNegativeKeywords).not.toHaveBeenCalled();
    expect(service.requests()['tlf|b-1|c-1']).toBeUndefined();
  });

  // A mixed Reddit batch: the new keywords rode on one write that could not be confirmed, while the
  // ones Reddit already excluded keep ALREADY_PRESENT. Neither is dropped, and the advice names Reddit.
  it('keeps the ALREADY_PRESENT results of a mixed Reddit batch and words the advice for Reddit', () => {
    service.submit(submission({ platform: 'reddit-ads', matchType: 'Broad', revision: 'sha256:r1', keywords: ['alpha', 'beta', 'gamma'] }));
    answer(0, ['UNCONFIRMED', 'ALREADY_PRESENT', 'UNCONFIRMED']);

    const request = service.requests()['tlf|b-1|c-1'];
    expect(request.outcomeRows.map((row) => row.outcome)).toEqual(['UNCONFIRMED', 'ALREADY_PRESENT', 'UNCONFIRMED']);
    expect(request.outcomeRows[0].detail).toContain('Reddit');
    expect(request.platform).toBe('reddit-ads');
    expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warn', detail: expect.stringContaining('1 already present') }));
  });

  it('records an unreadable confirmation as unconfirmed, naming the keywords sent', () => {
    service.submit(submission());
    responses[0].error(new HttpErrorResponse({ status: 502, error: { error: CAMPAIGN_NEGATIVE_KEYWORDS_OUTCOME_UNCONFIRMED, code: 'BAD_GATEWAY' } }));

    const request = service.requests()['tlf|b-1|c-1'];
    expect(request.pending).toBe(false);
    expect(request.batchOutcome?.state).toBe('unconfirmed');
    expect(request.batchKeywords).toEqual(['alpha', 'beta']);
    expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warn', sticky: true }));
  });

  it("keeps each keyword's last outcome across the campaign's later requests", () => {
    service.submit(submission());
    answer(0, ['UNCONFIRMED', 'APPLIED']);
    service.submit(submission({ keywords: ['gamma'] }));
    expect(service.requests()['tlf|b-1|c-1'].keywordOutcomes['alpha'].outcome).toBe('UNCONFIRMED');
    answer(1, ['APPLIED']);

    const outcomes = service.requests()['tlf|b-1|c-1'].keywordOutcomes;
    expect(outcomes['alpha'].outcome).toBe('UNCONFIRMED');
    expect(outcomes['beta'].outcome).toBe('APPLIED');
    expect(outcomes['gamma'].outcome).toBe('APPLIED');
  });

  // What decides "a newer outcome happened" must not depend on what is still on display.
  it("raises each sent keyword's outcome high-water mark on every settle, and never clears it", () => {
    service.submit(submission());
    answer(0, ['UNCONFIRMED', 'APPLIED']);
    expect(service.keywordOutcomeSeqs()).toEqual({ 'tlf|c-1|alpha': 1, 'tlf|c-1|beta': 1 });
    service.submit(submission({ keywords: ['alpha'] }));
    answer(1, ['APPLIED']);
    expect(service.keywordOutcomeSeqs()).toEqual({ 'tlf|c-1|alpha': 2, 'tlf|c-1|beta': 1 });
    expect(service.latestOutcomeSeq()).toBe(2);

    service.dismiss('tlf', 'b-1', 'c-1');
    service.setScope('tlf', 'b-2');
    service.releaseScope();
    expect(service.requests()).toEqual({});
    expect(service.keywordOutcomeSeqs()).toEqual({ 'tlf|c-1|alpha': 2, 'tlf|c-1|beta': 1 });
  });

  it('says whether it sent', () => {
    expect(service.submit(submission())).toBe(true);
    expect(service.submit(submission())).toBe(false);
    expect(service.submit(submission({ campaignId: 'c-2', platform: 'reddit-ads', matchType: 'Broad' }))).toBe(false);
    expect(addNegativeKeywords).toHaveBeenCalledTimes(1);
  });

  // Keyword writes are serialized per campaign, not per brief: the page's brief id can go empty under one.
  it('holds a campaign across brief keys, counts its settles, and leaves other campaigns alone', () => {
    expect(service.reserve('tlf', 'c-1')).toBe(true);
    expect(service.submit(submission({ briefId: '' }))).toBe(false);
    expect(service.submit(submission({ briefId: 'b-2' }))).toBe(false);
    expect(service.isWriteHeld('tlf', 'c-1')).toBe(true);
    expect(service.submit(submission({ campaignId: 'c-2' }))).toBe(true);
    service.release('tlf', 'c-1');

    expect(service.submit(submission())).toBe(true);
    expect(service.pendingWrites()).toEqual({ 'tlf|c-1': true, 'tlf|c-2': true });
    expect(service.submit(submission({ briefId: '' }))).toBe(false);
    expect(service.reserve('tlf', 'c-1')).toBe(false);

    answer(1, ['APPLIED', 'APPLIED']);
    expect(service.pendingWrites()).toEqual({ 'tlf|c-2': true });
    expect(service.settledWrites()['tlf|c-1']).toBe(1);
    expect(service.isWriteHeld('tlf', 'c-1')).toBe(false);
  });

  it('refuses a held campaign until it is released, and holds nothing busy', () => {
    expect(service.reserve('tlf', 'c-1')).toBe(true);
    expect(service.reservations()).toEqual({ 'tlf|c-1': true });
    expect(service.reserve('tlf', 'c-1')).toBe(false);
    expect(service.submit(submission())).toBe(false);
    expect(addNegativeKeywords).not.toHaveBeenCalled();

    service.release('tlf', 'c-1');
    expect(service.reservations()).toEqual({});
    expect(service.submit(submission())).toBe(true);
    // A campaign with a request in flight cannot be held.
    expect(service.reserve('tlf', 'c-1')).toBe(false);
  });

  // A campaign's Reddit targeting is one domain: an add waits for a removal from it to settle.
  it('refuses to send or hold while a keyword-targeting removal of the campaign is in flight', () => {
    TestBed.inject(CampaignKeywordTargetingService).remove({
      projectSlug: 'tlf',
      briefId: 'b-1',
      campaignId: 'c-1',
      campaignName: 'KubeCon EU',
      platform: 'reddit-ads',
      request: { briefId: 'b-1', keywords: [{ keyword: 'mesh' }], revision: 'sha256:r1' },
      sent: ['mesh'],
    });

    expect(service.reserve('tlf', 'c-1')).toBe(false);
    expect(service.submit(submission({ platform: 'reddit-ads', matchType: 'Broad', revision: 'sha256:r1' }))).toBe(false);
    expect(service.submit(submission({ campaignId: 'c-2' }))).toBe(true);
  });

  it('refuses a second request for the same campaign while one is in flight', () => {
    service.submit(submission());
    service.submit(submission({ keywords: ['gamma'] }));

    expect(addNegativeKeywords).toHaveBeenCalledTimes(1);
    answer(0, ['APPLIED', 'APPLIED']);
    service.submit(submission({ keywords: ['gamma'] }));
    expect(addNegativeKeywords).toHaveBeenCalledTimes(2);
  });

  it('calls onAllSettled once, and only when every keyword was added or already present', () => {
    const settled = vi.fn();
    service.submit(submission(), settled);
    answer(0, ['APPLIED', 'ALREADY_PRESENT']);
    expect(settled).toHaveBeenCalledTimes(1);

    const unsettled = vi.fn();
    service.submit(submission(), unsettled);
    answer(1, ['APPLIED', 'UNCONFIRMED']);
    expect(unsettled).not.toHaveBeenCalled();
  });

  // Outcomes are kept per brief; WRITES are serialized per campaign, so the same campaign under
  // another brief waits for the first request to settle.
  it('keeps requests of different projects and briefs apart', () => {
    service.submit(submission());
    service.submit(submission({ projectSlug: 'cncf' }));
    answer(0, ['APPLIED', 'APPLIED']);
    service.submit(submission({ briefId: 'b-2' }));

    expect(addNegativeKeywords).toHaveBeenCalledTimes(3);
    answer(2, ['FAILED', 'FAILED']);

    expect(service.requests()['tlf|b-1|c-1'].outcomeRows.map((row) => row.outcome)).toEqual(['APPLIED', 'APPLIED']);
    expect(service.requests()['tlf|b-2|c-1'].outcomeRows.map((row) => row.outcome)).toEqual(['FAILED', 'FAILED']);
    expect(service.requests()['cncf|b-1|c-1'].pending).toBe(true);
  });

  it('clears the settled requests of one scope only, and never one in flight', () => {
    service.submit(submission({ campaignId: 'c-1' }));
    service.submit(submission({ campaignId: 'c-2' }));
    answer(0, ['APPLIED', 'APPLIED']);
    service.submit(submission({ briefId: 'b-2' }));
    answer(2, ['APPLIED', 'APPLIED']);

    service.clearSettled('tlf', 'b-1');

    expect(service.requests()['tlf|b-1|c-1']).toBeUndefined();
    expect(service.requests()['tlf|b-1|c-2'].pending).toBe(true);
    expect(service.requests()['tlf|b-2|c-1'].pending).toBe(false);
  });

  it('dismisses one settled request, but not one still in flight', () => {
    service.submit(submission());
    service.dismiss('tlf', 'b-1', 'c-1');
    expect(service.requests()['tlf|b-1|c-1'].pending).toBe(true);

    answer(0, ['UNCONFIRMED', 'APPLIED']);
    service.dismiss('tlf', 'b-1', 'c-1');
    expect(service.requests()['tlf|b-1|c-1']).toBeUndefined();
  });

  it('keeps what was sent and its match type, for an editor to restore', () => {
    service.submit(submission({ matchType: 'Phrase' }));
    answer(0, ['APPLIED', 'FAILED']);

    expect(service.requests()['tlf|b-1|c-1'].sent).toEqual(['alpha', 'beta']);
    expect(service.requests()['tlf|b-1|c-1'].matchType).toBe('Phrase');
  });

  describe('scoped by the campaigns page', () => {
    it('drops settled requests outside a new scope, keeping ones in flight', () => {
      service.setScope('tlf', 'b-1');
      service.submit(submission({ campaignId: 'c-1' }));
      service.submit(submission({ campaignId: 'c-2' }));
      answer(0, ['APPLIED', 'APPLIED']);

      service.setScope('tlf', 'b-2');

      expect(service.requests()['tlf|b-1|c-1']).toBeUndefined();
      expect(service.requests()['tlf|b-1|c-2'].pending).toBe(true);
    });

    it('drops a request that settles outside the active scope; its toast still announces it', () => {
      service.setScope('tlf', 'b-1');
      service.submit(submission());
      service.setScope('tlf', 'b-2');
      answer(0, ['APPLIED', 'UNCONFIRMED']);

      expect(service.requests()['tlf|b-1|c-1']).toBeUndefined();
      expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warn' }));
    });

    it('keeps a request that settles inside the active scope', () => {
      service.setScope('tlf', 'b-1');
      service.submit(submission());
      service.setScope('tlf', 'b-1');
      answer(0, ['APPLIED', 'UNCONFIRMED']);

      expect(service.requests()['tlf|b-1|c-1'].pending).toBe(false);
    });

    // A Proceed save empties the page's brief id while it runs, and a failed save leaves it empty.
    // Neither is a switch to another brief.
    it("keeps the brief's results while its id is empty during a save, and through its return", () => {
      service.setScope('tlf', 'b-1');
      service.submit(submission());
      answer(0, ['APPLIED', 'APPLIED']);

      service.setScope('tlf', '');
      service.setScope('tlf', 'b-1');

      expect(service.requests()['tlf|b-1|c-1'].pending).toBe(false);
    });

    it('keeps a request sent under the empty id after a failed save, and one that settles then', () => {
      service.setScope('tlf', '');
      service.submit(submission({ briefId: '' }));
      service.submit(submission({ campaignId: 'c-2' }));
      answer(0, ['APPLIED', 'APPLIED']);
      answer(1, ['APPLIED', 'APPLIED']);

      expect(service.requests()['tlf||c-1'].pending).toBe(false);
      expect(service.requests()['tlf|b-1|c-2'].pending).toBe(false);
    });

    it("drops another project's settled requests, whatever the brief", () => {
      service.setScope('tlf', 'b-1');
      service.submit(submission());
      answer(0, ['APPLIED', 'APPLIED']);

      service.setScope('cncf', '');

      expect(service.requests()['tlf|b-1|c-1']).toBeUndefined();
    });

    it('drops every settled request when the page is released, and ones in flight as they settle', () => {
      service.setScope('tlf', 'b-1');
      service.submit(submission({ campaignId: 'c-1' }));
      service.submit(submission({ campaignId: 'c-2' }));
      answer(0, ['APPLIED', 'APPLIED']);

      service.releaseScope();
      expect(service.requests()['tlf|b-1|c-1']).toBeUndefined();
      expect(service.requests()['tlf|b-1|c-2'].pending).toBe(true);

      answer(1, ['APPLIED', 'APPLIED']);
      expect(service.requests()).toEqual({});
    });
  });
});
