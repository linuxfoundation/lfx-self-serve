// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import {
  LIVE_REGION_MOUNT_DELAY_MS,
  REDDIT_KEYWORD_NEGATIVE_REVISION_ERROR,
  REDDIT_KEYWORD_NEGATIVE_SUPERSEDED_MESSAGE,
  REDDIT_KEYWORDS_ERROR_MESSAGES,
} from '@lfx-one/shared/constants';
import type { CampaignNegativeKeywordsResult, RedditKeywordMetricsResponse } from '@lfx-one/shared/interfaces';
import { CampaignKeywordTargetingService } from '@services/campaign-keyword-targeting.service';
import { CampaignNegativeKeywordsService } from '@services/campaign-negative-keywords.service';
import { CampaignService } from '@services/campaign.service';
import { negativeKeywordUnconfirmedAdvice } from '@shared/utils/campaign-negative-keywords.utils';
import { type Confirmation, ConfirmationService, MessageService } from 'primeng/api';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RedditKeywordsTableComponent } from './reddit-keywords-table.component';

describe('RedditKeywordsTableComponent', () => {
  let fixture: ComponentFixture<RedditKeywordsTableComponent>;
  let getRedditKeywords: ReturnType<typeof vi.fn>;
  let getKeywordTargeting: ReturnType<typeof vi.fn>;
  let addNegativeKeywords: ReturnType<typeof vi.fn>;
  let messageAdd: ReturnType<typeof vi.fn>;

  const report = (over: Partial<RedditKeywordMetricsResponse> = {}): RedditKeywordMetricsResponse => ({
    pulledAt: '2026-10-14T00:00:00Z',
    window: 'last_30_days',
    totalKeywords: 2,
    truncated: false,
    totals: { impressions: 1200, clicks: 50, spend: 2.5, avgCtr: 4.1667 },
    keywords: [
      { key: 't3_a|service mesh|0', campaignId: 't3_a', keyword: 'service mesh', impressions: 1000, clicks: 50, ctr: 5, spend: 2.5 },
      { key: 't3_b||1', campaignId: 't3_b', keyword: null, impressions: 200, clicks: 0, ctr: 0, spend: 0 },
    ],
    ...over,
  });

  beforeEach(async () => {
    getRedditKeywords = vi.fn().mockReturnValue(of(report()));
    getKeywordTargeting = vi.fn().mockReturnValue(of({ campaign_id: 'c-uuid-a', platform: 'reddit-ads', keywords: [], revision: 'rev-1' }));
    addNegativeKeywords = vi.fn();
    messageAdd = vi.fn();
    await TestBed.configureTestingModule({
      imports: [RedditKeywordsTableComponent],
      providers: [
        provideNoopAnimations(),
        {
          provide: CampaignService,
          useValue: { getRedditKeywords, getKeywordTargeting, addNegativeKeywords, removeKeywordTargeting: vi.fn().mockReturnValue(new Subject()) },
        },
        { provide: MessageService, useValue: { add: messageAdd } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(RedditKeywordsTableComponent);
    fixture.componentRef.setInput('projectSlug', 'tlf');
    fixture.componentRef.setInput('campaignNames', { t3_a: 'KubeCon EU' });
  });

  const q = (testId: string): HTMLElement | null => (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${testId}"]`);

  it('reads the default window and renders the rows, named where the brief knows the campaign, with no action outside a brief', () => {
    fixture.detectChanges();

    expect(getRedditKeywords).toHaveBeenCalledWith('tlf', 'last_30_days');
    const first = q('reddit-keyword-row-0')!;
    expect(first.textContent).toContain('service mesh');
    expect(first.textContent).toContain('KubeCon EU');
    // An unknown campaign shows Reddit's id; a keyword-less row says so rather than showing a blank.
    expect(q('reddit-keyword-row-1')!.textContent).toContain('t3_b');
    expect(q('reddit-keyword-unattributed-1')!.textContent).toContain('Not attributed to a keyword');
    expect(q('reddit-keywords-actions-note')).not.toBeNull();
    expect(q('reddit-keywords-totals')!.textContent).toContain('Total');
    expect((fixture.nativeElement as HTMLElement).querySelector('button[aria-label^="Remove"], button[aria-label^="Pause"]')).toBeNull();
  });

  it('re-reads for a newly chosen window', () => {
    fixture.detectChanges();
    (q('reddit-keywords-window-last_7_days') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(getRedditKeywords).toHaveBeenLastCalledWith('tlf', 'last_7_days');
  });

  it('says the totals cover only the rows shown when the read was truncated', () => {
    getRedditKeywords.mockReturnValue(of(report({ truncated: true })));
    fixture.detectChanges();

    expect(q('reddit-keywords-truncated')).not.toBeNull();
    expect(q('reddit-keywords-totals')!.textContent).toContain('Subtotal');
  });

  it('says so when there is no activity', () => {
    getRedditKeywords.mockReturnValue(of(report({ keywords: [], totalKeywords: 0 })));
    fixture.detectChanges();

    expect(q('reddit-keywords-empty')).not.toBeNull();
  });

  it('shows loading while the read is in flight', () => {
    getRedditKeywords.mockReturnValue(new Subject());
    fixture.detectChanges();

    expect(q('reddit-keywords-loading')).not.toBeNull();
  });

  // A status region inserted pre-filled is not reliably announced, so one persistent region, empty
  // when first mounted, carries the loading text — and the SAME element announces the next read.
  it('announces each read in flight through one persistent, initially empty live region', async () => {
    const first = new Subject<RedditKeywordMetricsResponse>();
    getRedditKeywords.mockReturnValue(first);
    fixture.detectChanges();
    const region = q('reddit-keywords-live')!;
    expect(region.getAttribute('role')).toBe('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(q('reddit-keywords-loading')!.getAttribute('role')).toBeNull();
    // Empty on the render that mounts it: the loading text arrives as a CHANGE, which is announced.
    expect(region.textContent!.trim()).toBe('');

    await new Promise((resolve) => setTimeout(resolve, LIVE_REGION_MOUNT_DELAY_MS + 20));
    fixture.detectChanges();
    expect(region.textContent!.trim()).toBe('Loading Reddit keyword metrics');

    first.next(report());
    first.complete();
    fixture.detectChanges();
    expect(q('reddit-keywords-live')).toBe(region);
    expect(region.textContent!.trim()).toBe('');

    getRedditKeywords.mockReturnValue(new Subject());
    q('reddit-keywords-window-this_month')!.click();
    fixture.detectChanges();
    expect(q('reddit-keywords-live')).toBe(region);
    expect(region.textContent!.trim()).toBe('Loading Reddit keyword metrics');
  });

  it.each([
    [404, 'reddit-keywords-unavailable', REDDIT_KEYWORDS_ERROR_MESSAGES.notConnected],
    [400, 'reddit-keywords-unavailable', REDDIT_KEYWORDS_ERROR_MESSAGES.disabled],
    [409, 'reddit-keywords-error', REDDIT_KEYWORDS_ERROR_MESSAGES.conflict],
    [503, 'reddit-keywords-error', REDDIT_KEYWORDS_ERROR_MESSAGES.other],
  ])('words a %s in fixed text, never upstream text', (status, testId, message) => {
    getRedditKeywords.mockReturnValue(throwError(() => new HttpErrorResponse({ status, error: { error: 'reddit said: secret detail', code: 'X' } })));
    fixture.detectChanges();

    const box = q(testId)!;
    expect(box.textContent).toContain(message);
    expect(box.textContent).not.toContain('secret detail');
  });

  it('announces a failed read as an alert', () => {
    getRedditKeywords.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503, error: { error: 'x', code: 'SERVICE_UNAVAILABLE' } })));
    fixture.detectChanges();

    expect(q('reddit-keywords-error')!.getAttribute('role')).toBe('alert');
  });

  it('retries a failed read', () => {
    getRedditKeywords.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503, error: { error: 'x', code: 'SERVICE_UNAVAILABLE' } })));
    fixture.detectChanges();
    getRedditKeywords.mockReturnValue(of(report()));

    (q('reddit-keywords-retry')!.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(getRedditKeywords).toHaveBeenCalledTimes(2);
    expect(q('reddit-keyword-row-0')).not.toBeNull();
  });

  describe('Add as negative', () => {
    /** Confirmations raised on the table's OWN ConfirmationService (no other page dialog can answer it). */
    let confirmations: Confirmation[];

    const applied = (outcome: 'APPLIED' | 'ALREADY_PRESENT' = 'APPLIED'): CampaignNegativeKeywordsResult => ({
      campaignId: 'c-uuid-a',
      appliedCount: 1,
      results: [{ text: 'service mesh', matchType: 'Broad', outcome }],
    });

    beforeEach(() => {
      fixture.componentRef.setInput('briefId', 'brief-1');
      fixture.componentRef.setInput('negativeTargets', { t3_a: { campaignId: 'c-uuid-a', campaignName: 'KubeCon EU' } });
      confirmations = [];
      fixture.debugElement.injector.get(ConfirmationService).requireConfirmation$.subscribe((c) => {
        if (c) {
          confirmations.push(c);
        }
      });
    });

    /** The rows' testid keys: `row.key` slugged. */
    const A = 't3-a-service-mesh-0';
    const B = 't3-b-1';

    const addButton = (testIdKey: string): HTMLButtonElement | null =>
      (q(`reddit-keyword-add-negative-${testIdKey}`)?.querySelector('button') as HTMLButtonElement | null) ?? null;

    /** Clicks the row's button and, unless told not to, accepts the confirmation as the operator would. */
    function clickAdd(testIdKey: string, accept = true): void {
      addButton(testIdKey)!.click();
      fixture.detectChanges();
      if (accept) {
        confirmations[confirmations.length - 1].accept!();
        fixture.detectChanges();
      }
    }

    it('confirms, reads the revision, then adds the keyword as a Broad negative with it', () => {
      addNegativeKeywords.mockReturnValue(of(applied()));
      fixture.detectChanges();
      // The visible label leads the accessible name, so speech input still matches it.
      expect(addButton(A)!.getAttribute('aria-label')).toBe('Add as negative: service mesh (KubeCon EU)');

      clickAdd(A);

      expect(confirmations).toHaveLength(1);
      expect(confirmations[0]).toMatchObject({ key: 'reddit-keywords-add-negative', acceptLabel: 'Add as negative' });
      expect(confirmations[0].message).toContain('"service mesh"');
      expect(confirmations[0].message).toContain('KubeCon EU');
      expect(getKeywordTargeting).toHaveBeenCalledWith('tlf', 'brief-1', 'c-uuid-a');
      expect(addNegativeKeywords).toHaveBeenCalledWith('tlf', 'brief-1', 'c-uuid-a', [{ text: 'service mesh', matchType: 'Broad' }], 'rev-1');
      // The lever's own toast; the row now shows the keyword as a negative instead of the button.
      expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success', summary: 'Negative keywords for KubeCon EU' }));
      expect(addButton(A)).toBeNull();
      expect(q(`reddit-keyword-negative-${A}`)!.textContent).toContain('Added');
    });

    it('sends nothing until the operator accepts', () => {
      fixture.detectChanges();

      clickAdd(A, false);

      expect(confirmations).toHaveLength(1);
      expect(getKeywordTargeting).not.toHaveBeenCalled();
      expect(addNegativeKeywords).not.toHaveBeenCalled();
    });

    it('sends nothing when the campaign stopped taking negatives while the dialog was open', () => {
      fixture.detectChanges();
      clickAdd(A, false);

      fixture.componentRef.setInput('negativeTargets', {});
      fixture.detectChanges();
      confirmations[0].accept!();
      fixture.detectChanges();

      expect(getKeywordTargeting).not.toHaveBeenCalled();
      expect(addNegativeKeywords).not.toHaveBeenCalled();
    });

    it('holds every row of the campaign while the add is in flight', () => {
      const add = new Subject<CampaignNegativeKeywordsResult>();
      addNegativeKeywords.mockReturnValue(add);
      fixture.detectChanges();

      clickAdd(A);
      expect(addButton(A)!.disabled).toBe(true);
      addButton(A)!.click();
      fixture.detectChanges();
      expect(confirmations).toHaveLength(1);
      expect(addNegativeKeywords).toHaveBeenCalledTimes(1);

      add.next(applied());
      add.complete();
      fixture.detectChanges();
      expect(q(`reddit-keyword-negative-${A}`)).not.toBeNull();
    });

    it('shows a keyword the campaign editor already confirmed as a negative, with no button', () => {
      addNegativeKeywords.mockReturnValue(
        of({ ...applied('ALREADY_PRESENT'), results: [{ text: 'service mesh', matchType: 'Broad', outcome: 'ALREADY_PRESENT' }] })
      );
      TestBed.inject(CampaignNegativeKeywordsService).submit({
        projectSlug: 'tlf',
        briefId: 'brief-1',
        campaignId: 'c-uuid-a',
        campaignName: 'KubeCon EU',
        platform: 'reddit-ads',
        keywords: ['service mesh'],
        matchType: 'Broad',
        revision: 'rev-0',
      });
      fixture.detectChanges();

      expect(addButton(A)).toBeNull();
      expect(q(`reddit-keyword-negative-${A}`)!.textContent).toContain('Already present');
    });

    it('offers nothing for a campaign that does not take negatives now, nor without a brief, nor for unattributed delivery', () => {
      fixture.componentRef.setInput('negativeTargets', {});
      fixture.detectChanges();
      expect(addButton(A)).toBeNull();

      fixture.componentRef.setInput('negativeTargets', { t3_a: { campaignId: 'c-uuid-a', campaignName: 'KubeCon EU' } });
      fixture.componentRef.setInput('briefId', '');
      fixture.detectChanges();
      expect(addButton(A)).toBeNull();

      fixture.componentRef.setInput('briefId', 'brief-1');
      fixture.componentRef.setInput('negativeTargets', {
        t3_a: { campaignId: 'c-uuid-a', campaignName: 'KubeCon EU' },
        t3_b: { campaignId: 'c-uuid-b', campaignName: 'OSS NA' },
      });
      fixture.detectChanges();
      expect(addButton(A)).not.toBeNull();
      expect(addButton(B)).toBeNull();
    });

    it('offers nothing for keyword text the lever would refuse', () => {
      getRedditKeywords.mockReturnValue(
        of(report({ keywords: [{ key: 't3_a|k8s!!|0', campaignId: 't3_a', keyword: 'k8s!!', impressions: 1, clicks: 0, ctr: 0, spend: 0 }] }))
      );
      fixture.detectChanges();

      expect(q('reddit-keyword-row-0')).not.toBeNull();
      expect(addButton('t3-a-k8s-0')).toBeNull();
    });

    // Reddit writes switched off upstream (REDDIT_KEYWORD_TARGETING_WRITES_ENABLED) answer 400 before
    // Reddit is contacted: a definite refusal, shown with the BFF's message, and the button stays.
    it('shows a refusal with the server message when Reddit writes are switched off upstream', () => {
      const message = 'Negative keywords are not supported for this campaign.';
      addNegativeKeywords.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 400, error: { error: message, code: 'BAD_REQUEST' } })));
      fixture.detectChanges();

      clickAdd(A);

      const outcome = q(`reddit-keyword-negative-outcome-${A}`)!;
      expect(outcome.textContent).toContain('Not added');
      expect(outcome.textContent).toContain(message);
      expect(outcome.classList).toContain('text-red-600');
      // Inserted as the outcome lands, so it is announced there.
      expect(outcome.getAttribute('role')).toBe('alert');
      expect(messageAdd).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'error', summary: 'Negative keywords not added to KubeCon EU', sticky: true })
      );
      expect(addButton(A)!.disabled).toBe(false);
    });

    it('shows a stale-revision conflict as not added, and reads the revision afresh on the next try', () => {
      const message = "The ad group's targeting changed since it was read.";
      addNegativeKeywords.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 409, error: { error: message, code: 'CONFLICT' } })));
      fixture.detectChanges();

      clickAdd(A);
      expect(q(`reddit-keyword-negative-outcome-${A}`)!.textContent).toContain(message);

      getKeywordTargeting.mockReturnValue(of({ campaign_id: 'c-uuid-a', platform: 'reddit-ads', keywords: [], revision: 'rev-2' }));
      addNegativeKeywords.mockReturnValue(of(applied()));
      clickAdd(A);

      expect(getKeywordTargeting).toHaveBeenCalledTimes(2);
      expect(addNegativeKeywords).toHaveBeenLastCalledWith('tlf', 'brief-1', 'c-uuid-a', [{ text: 'service mesh', matchType: 'Broad' }], 'rev-2');
      expect(q(`reddit-keyword-negative-${A}`)).not.toBeNull();
    });

    it('says an unconfirmed add may have landed, as a warning rather than a failure', () => {
      addNegativeKeywords.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 502, error: { error: 'x', code: 'BAD_GATEWAY' } })));
      fixture.detectChanges();

      clickAdd(A);

      const outcome = q(`reddit-keyword-negative-outcome-${A}`)!;
      expect(outcome.textContent).toContain('Not confirmed');
      expect(outcome.classList).toContain('text-amber-700');
      expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warn', summary: 'Negative keywords not confirmed for KubeCon EU' }));
    });

    it.each([
      ['fails', () => throwError(() => new HttpErrorResponse({ status: 503, error: { error: 'x', code: 'SERVICE_UNAVAILABLE' } })), true],
      ['answers no revision', () => of({ campaign_id: 'c-uuid-a', platform: 'reddit-ads', keywords: [] }), false],
    ])('sends nothing when the revision read %s', (_label, read, logs) => {
      const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      getKeywordTargeting.mockReturnValue(read());
      fixture.detectChanges();

      clickAdd(A);

      expect(addNegativeKeywords).not.toHaveBeenCalled();
      expect(q(`reddit-keyword-negative-not-sent-${A}`)!.textContent).toContain(REDDIT_KEYWORD_NEGATIVE_REVISION_ERROR);
      expect(q(`reddit-keyword-negative-not-sent-${A}`)!.getAttribute('role')).toBe('alert');
      expect(logged).toHaveBeenCalledTimes(logs ? 1 : 0);
      expect(addButton(A)!.disabled).toBe(false);
    });

    // The table reserves the campaign for its revision read, so nothing else can send meanwhile.
    it('holds the campaign for its revision read: another send is refused, then the add goes out', () => {
      const read = new Subject<{ campaign_id: string; platform: 'reddit-ads'; keywords: never[]; revision: string }>();
      getKeywordTargeting.mockReturnValue(read);
      addNegativeKeywords.mockReturnValue(of(applied()));
      fixture.detectChanges();
      clickAdd(A);

      const service = TestBed.inject(CampaignNegativeKeywordsService);
      expect(service.reservations()).toEqual({ 'tlf|brief-1|c-uuid-a': true });
      const other = service.submit({
        projectSlug: 'tlf',
        briefId: 'brief-1',
        campaignId: 'c-uuid-a',
        campaignName: 'KubeCon EU',
        platform: 'reddit-ads',
        keywords: ['gitops'],
        matchType: 'Broad',
        revision: 'rev-0',
      });
      expect(other).toBe(false);

      read.next({ campaign_id: 'c-uuid-a', platform: 'reddit-ads', keywords: [], revision: 'rev-1' });
      read.complete();
      fixture.detectChanges();

      expect(service.reservations()).toEqual({});
      expect(addNegativeKeywords).toHaveBeenCalledTimes(1);
      expect(addNegativeKeywords).toHaveBeenCalledWith('tlf', 'brief-1', 'c-uuid-a', [{ text: 'service mesh', matchType: 'Broad' }], 'rev-1');
    });

    // A removal started while the read ran: the service refuses the add, and the row says it was not sent.
    it('says "Not sent" when another keyword change of the campaign started during the revision read', () => {
      const read = new Subject<{ campaign_id: string; platform: 'reddit-ads'; keywords: never[]; revision: string }>();
      const removal = new Subject<never>();
      getKeywordTargeting.mockReturnValue(read);
      (TestBed.inject(CampaignService) as unknown as { removeKeywordTargeting: unknown }).removeKeywordTargeting = vi.fn().mockReturnValue(removal);
      fixture.detectChanges();
      clickAdd(A);

      TestBed.inject(CampaignKeywordTargetingService).remove({
        projectSlug: 'tlf',
        briefId: 'brief-1',
        campaignId: 'c-uuid-a',
        campaignName: 'KubeCon EU',
        platform: 'reddit-ads',
        request: { briefId: 'brief-1', keywords: [{ keyword: 'mesh' }], revision: 'rev-1' },
        sent: ['mesh'],
      });
      read.next({ campaign_id: 'c-uuid-a', platform: 'reddit-ads', keywords: [], revision: 'rev-1' });
      read.complete();
      fixture.detectChanges();

      expect(addNegativeKeywords).not.toHaveBeenCalled();
      // Held while the removal runs; once it settles the row says why nothing went out.
      expect(addButton(A)!.disabled).toBe(true);
      removal.error(new HttpErrorResponse({ status: 409, error: { error: 'changed', code: 'CONFLICT' } }));
      fixture.detectChanges();

      const outcome = q(`reddit-keyword-negative-not-sent-${A}`)!;
      expect(outcome.textContent).toContain('Not sent');
      expect(outcome.textContent).toContain(REDDIT_KEYWORD_NEGATIVE_SUPERSEDED_MESSAGE);
      expect(addButton(A)!.disabled).toBe(false);
    });

    it('holds the rows of a campaign while a keyword-targeting removal of it is in flight', () => {
      fixture.detectChanges();
      TestBed.inject(CampaignKeywordTargetingService).remove({
        projectSlug: 'tlf',
        briefId: 'brief-1',
        campaignId: 'c-uuid-a',
        campaignName: 'KubeCon EU',
        platform: 'reddit-ads',
        request: { briefId: 'brief-1', keywords: [{ keyword: 'mesh' }], revision: 'rev-1' },
        sent: ['mesh'],
      });
      fixture.detectChanges();

      expect(addButton(A)!.disabled).toBe(true);
    });

    it('asks to verify first when the last add of the keyword was not confirmed', () => {
      addNegativeKeywords.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 502, error: { error: 'x', code: 'BAD_GATEWAY' } })));
      fixture.detectChanges();
      clickAdd(A);
      expect(confirmations[0].message).not.toContain('before retrying');

      clickAdd(A, false);

      expect(confirmations[1].message).toContain(negativeKeywordUnconfirmedAdvice('reddit-ads'));
    });

    it('drops a "Not sent" note when the table reads again', () => {
      getKeywordTargeting.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503, error: { error: 'x', code: 'SERVICE_UNAVAILABLE' } })));
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      fixture.detectChanges();
      clickAdd(A);
      expect(q(`reddit-keyword-negative-not-sent-${A}`)).not.toBeNull();

      fixture.componentRef.setInput('reloadToken', 1);
      fixture.detectChanges();
      expect(q(`reddit-keyword-negative-not-sent-${A}`)).toBeNull();

      clickAdd(A);
      expect(q(`reddit-keyword-negative-not-sent-${A}`)).not.toBeNull();
      q('reddit-keywords-window-last_7_days')!.click();
      fixture.detectChanges();
      expect(q(`reddit-keyword-negative-not-sent-${A}`)).toBeNull();
    });

    // The newer attempt that went nowhere is shown, beside the older write outcome it does not erase.
    it('shows a retry that was not sent beside the earlier unconfirmed outcome, and keeps the verify-first advice', () => {
      addNegativeKeywords.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 502, error: { error: 'x', code: 'BAD_GATEWAY' } })));
      fixture.detectChanges();
      clickAdd(A);
      expect(q(`reddit-keyword-negative-outcome-${A}`)!.textContent).toContain('Not confirmed');

      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      getKeywordTargeting.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503, error: { error: 'x', code: 'SERVICE_UNAVAILABLE' } })));
      clickAdd(A);

      expect(q(`reddit-keyword-negative-outcome-${A}`)!.textContent).toContain('Not confirmed');
      expect(q(`reddit-keyword-negative-not-sent-${A}`)!.textContent).toContain(REDDIT_KEYWORD_NEGATIVE_REVISION_ERROR);
      clickAdd(A, false);
      expect(confirmations[confirmations.length - 1].message).toContain(negativeKeywordUnconfirmedAdvice('reddit-ads'));
    });

    // Each keyword keeps its own last outcome: an add of another keyword does not erase it.
    it("keeps a keyword's unconfirmed outcome after another keyword of the campaign is added", () => {
      getRedditKeywords.mockReturnValue(
        of(
          report({
            keywords: [
              { key: 't3_a|service mesh|0', campaignId: 't3_a', keyword: 'service mesh', impressions: 1000, clicks: 50, ctr: 5, spend: 2.5 },
              { key: 't3_a|gitops|1', campaignId: 't3_a', keyword: 'gitops', impressions: 900, clicks: 40, ctr: 4.4, spend: 2 },
            ],
          })
        )
      );
      addNegativeKeywords.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 502, error: { error: 'x', code: 'BAD_GATEWAY' } })));
      fixture.detectChanges();
      clickAdd(A);

      addNegativeKeywords.mockReturnValue(
        of({ campaignId: 'c-uuid-a', appliedCount: 1, results: [{ text: 'gitops', matchType: 'Broad', outcome: 'APPLIED' }] })
      );
      clickAdd('t3-a-gitops-1');

      expect(q('reddit-keyword-negative-t3-a-gitops-1')).not.toBeNull();
      expect(q(`reddit-keyword-negative-outcome-${A}`)!.textContent).toContain('Not confirmed');
      clickAdd(A, false);
      expect(confirmations[confirmations.length - 1].message).toContain(negativeKeywordUnconfirmedAdvice('reddit-ads'));
    });
  });
});
