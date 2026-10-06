// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { CAMPAIGN_NEGATIVE_KEYWORDS_OUTCOME_UNCONFIRMED } from '@lfx-one/shared/constants';
import { CampaignNegativeKeywordsResult, CampaignNegativeKeywordsSubmission } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
        { provide: CampaignService, useValue: { addNegativeKeywords } },
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

    expect(addNegativeKeywords).toHaveBeenCalledWith('tlf', 'b-1', 'c-1', [
      { text: 'alpha', matchType: 'Exact' },
      { text: 'beta', matchType: 'Exact' },
    ]);
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

  it('records an unreadable confirmation as unconfirmed, naming the keywords sent', () => {
    service.submit(submission());
    responses[0].error(new HttpErrorResponse({ status: 502, error: { error: CAMPAIGN_NEGATIVE_KEYWORDS_OUTCOME_UNCONFIRMED, code: 'BAD_GATEWAY' } }));

    const request = service.requests()['tlf|b-1|c-1'];
    expect(request.pending).toBe(false);
    expect(request.batchOutcome?.state).toBe('unconfirmed');
    expect(request.batchKeywords).toEqual(['alpha', 'beta']);
    expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warn', sticky: true }));
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

  it('keeps requests of different projects and briefs apart', () => {
    service.submit(submission());
    service.submit(submission({ briefId: 'b-2' }));
    service.submit(submission({ projectSlug: 'cncf' }));

    expect(addNegativeKeywords).toHaveBeenCalledTimes(3);
    answer(1, ['FAILED', 'FAILED']);

    expect(service.requests()['tlf|b-1|c-1'].pending).toBe(true);
    expect(service.requests()['tlf|b-2|c-1'].pending).toBe(false);
    expect(service.requests()['cncf|b-1|c-1'].pending).toBe(true);
  });

  it('clears the settled requests of one scope only, and never one in flight', () => {
    service.submit(submission({ campaignId: 'c-1' }));
    service.submit(submission({ campaignId: 'c-2' }));
    service.submit(submission({ briefId: 'b-2' }));
    answer(0, ['APPLIED', 'APPLIED']);
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
