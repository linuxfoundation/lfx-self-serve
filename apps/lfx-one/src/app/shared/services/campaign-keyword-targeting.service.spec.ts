// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import type { CampaignServiceKeywordTargetingRemovals, KeywordTargetingRemovalSubmission } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CampaignKeywordTargetingService } from './campaign-keyword-targeting.service';
import { CampaignService } from './campaign.service';

describe('CampaignKeywordTargetingService', () => {
  let service: CampaignKeywordTargetingService;
  let removeKeywordTargeting: ReturnType<typeof vi.fn>;
  let messageAdd: ReturnType<typeof vi.fn>;
  let responses: Subject<CampaignServiceKeywordTargetingRemovals>[];

  const submission = (over: Partial<KeywordTargetingRemovalSubmission> = {}): KeywordTargetingRemovalSubmission => ({
    projectSlug: 'tlf',
    briefId: 'b-1',
    campaignId: 'c-1',
    campaignName: 'KubeCon EU',
    platform: 'reddit-ads',
    request: { briefId: 'b-1', keywords: [{ keyword: 'kubernetes' }, { keyword: 'devops' }], revision: 'sha256:r1' },
    sent: ['kubernetes', 'devops'],
    ...over,
  });

  beforeEach(() => {
    responses = [];
    removeKeywordTargeting = vi.fn().mockImplementation(() => {
      const response = new Subject<CampaignServiceKeywordTargetingRemovals>();
      responses.push(response);
      return response;
    });
    messageAdd = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: CampaignService, useValue: { removeKeywordTargeting } },
        { provide: MessageService, useValue: { add: messageAdd } },
      ],
    });
    service = TestBed.inject(CampaignKeywordTargetingService);
  });

  // The brief id the page holds can change (go empty) under a removal in flight: holds are per campaign.
  it('refuses a second removal of the campaign under another brief key, counts settles per campaign, and leaves other campaigns alone', () => {
    service.remove(submission());
    service.remove(submission({ briefId: '' }));
    service.remove(submission({ briefId: 'b-2' }));
    expect(removeKeywordTargeting).toHaveBeenCalledTimes(1);
    expect(service.pendingWrites()).toEqual({ 'tlf|c-1': true });

    service.remove(submission({ campaignId: 'c-2' }));
    expect(removeKeywordTargeting).toHaveBeenCalledTimes(2);

    responses[0].error(new HttpErrorResponse({ status: 409, error: { error: 'changed', code: 'CONFLICT' } }));
    expect(service.pendingWrites()).toEqual({ 'tlf|c-2': true });
    expect(service.settledWrites()).toEqual({ 'tlf|c-1': 1 });
  });

  it('sends the request as given, once, and keeps the outcomes in the order sent', () => {
    service.remove(submission());

    expect(removeKeywordTargeting).toHaveBeenCalledWith('tlf', 'c-1', submission().request);
    expect(service.removals()['tlf|b-1|c-1']).toMatchObject({ pending: true, settleCount: 0 });

    responses[0].next({
      campaign_id: 'c-1',
      applied_count: 1,
      results: [
        { keyword: 'kubernetes', outcome: 'APPLIED' },
        { keyword: 'devops', outcome: 'UNCONFIRMED' },
      ],
    });
    responses[0].complete();

    const removal = service.removals()['tlf|b-1|c-1'];
    expect(removal.pending).toBe(false);
    expect(removal.settleCount).toBe(1);
    expect(removal.outcomeRows.map((row) => [row.keyword, row.outcome])).toEqual([
      ['kubernetes', 'APPLIED'],
      ['devops', 'UNCONFIRMED'],
    ]);
    expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warn', sticky: true }));
  });

  it('refuses a second removal for the campaign while one is in flight', () => {
    service.remove(submission());
    service.remove(submission({ sent: ['devops'] }));

    expect(removeKeywordTargeting).toHaveBeenCalledTimes(1);
  });

  it('records a 5xx as unconfirmed, naming the keywords sent', () => {
    service.remove(submission());
    responses[0].error(new HttpErrorResponse({ status: 503, error: { error: 'could not be removed', code: 'SERVICE_UNAVAILABLE' } }));

    const removal = service.removals()['tlf|b-1|c-1'];
    expect(removal.batchOutcome?.state).toBe('unconfirmed');
    expect(removal.sent).toEqual(['kubernetes', 'devops']);
    expect(removal.settleCount).toBe(1);
  });

  it('drops settled removals outside the scope and on release, but never one in flight', () => {
    service.remove(submission());
    responses[0].error(new HttpErrorResponse({ status: 409, error: { error: 'x', code: 'CONFLICT' } }));
    service.remove(submission({ campaignId: 'c-2' }));

    service.setScope('cncf', 'b-9');
    expect(service.removals()['tlf|b-1|c-1']).toBeUndefined();
    expect(service.removals()['tlf|b-1|c-2'].pending).toBe(true);

    // Settling outside the scope drops it as it settles; the toast still announces it.
    responses[1].next({ campaign_id: 'c-2', applied_count: 0, results: [] });
    responses[1].complete();
    expect(service.removals()['tlf|b-1|c-2']).toBeUndefined();
    expect(messageAdd).toHaveBeenCalled();

    service.releaseScope();
    expect(service.removals()).toEqual({});
  });
});
