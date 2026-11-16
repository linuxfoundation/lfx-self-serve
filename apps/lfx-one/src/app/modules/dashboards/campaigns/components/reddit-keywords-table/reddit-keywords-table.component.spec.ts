// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import {
  LIVE_REGION_MOUNT_DELAY_MS,
  REDDIT_KEYWORD_NEGATIVE_REVISION_ERROR,
  REDDIT_KEYWORD_NEGATIVE_SCOPE_CHANGED_MESSAGE,
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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

  afterEach(() => {
    vi.restoreAllMocks();
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

    // The row then offers no action, but the add the operator confirmed is still said to have gone nowhere.
    it.each([
      ['the confirmation', false],
      ['the revision read', true],
    ])('says "Not sent" as an alert when the campaign leaves the targets during %s', (_label, duringRead) => {
      const read = new Subject<{ campaign_id: string; platform: 'reddit-ads'; keywords: never[]; revision: string }>();
      getKeywordTargeting.mockReturnValue(read);
      fixture.detectChanges();
      clickAdd(A, duringRead);

      fixture.componentRef.setInput('negativeTargets', {});
      fixture.detectChanges();
      if (duringRead) {
        read.next({ campaign_id: 'c-uuid-a', platform: 'reddit-ads', keywords: [], revision: 'rev-1' });
        read.complete();
      } else {
        confirmations[0].accept!();
      }
      fixture.detectChanges();

      expect(addNegativeKeywords).not.toHaveBeenCalled();
      expect(getKeywordTargeting).toHaveBeenCalledTimes(duringRead ? 1 : 0);
      expect(TestBed.inject(CampaignNegativeKeywordsService).reservations()).toEqual({});
      expect(addButton(A)).toBeNull();
      const note = q(`reddit-keyword-negative-not-sent-${A}`)!;
      expect(note.getAttribute('role')).toBe('alert');
      expect(note.textContent).toContain(REDDIT_KEYWORD_NEGATIVE_SCOPE_CHANGED_MESSAGE);
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
      expect(service.reservations()).toEqual({ 'tlf|c-uuid-a': true });
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

    // An add sent under another brief key (the page's brief id changed under it) still holds the campaign.
    it("holds a campaign's rows while an add to it runs under another brief key, and not another campaign's", () => {
      fixture.componentRef.setInput('negativeTargets', {
        t3_a: { campaignId: 'c-uuid-a', campaignName: 'KubeCon EU' },
        t3_b: { campaignId: 'c-uuid-b', campaignName: 'OSS NA' },
      });
      getRedditKeywords.mockReturnValue(
        of(
          report({
            keywords: [
              { key: 't3_a|service mesh|0', campaignId: 't3_a', keyword: 'service mesh', impressions: 1000, clicks: 50, ctr: 5, spend: 2.5 },
              { key: 't3_b|gitops|1', campaignId: 't3_b', keyword: 'gitops', impressions: 900, clicks: 40, ctr: 4.4, spend: 2 },
            ],
          })
        )
      );
      const add = new Subject<CampaignNegativeKeywordsResult>();
      addNegativeKeywords.mockReturnValue(add);
      fixture.detectChanges();
      TestBed.inject(CampaignNegativeKeywordsService).submit({
        projectSlug: 'tlf',
        briefId: '',
        campaignId: 'c-uuid-a',
        campaignName: 'KubeCon EU',
        platform: 'reddit-ads',
        keywords: ['gitops'],
        matchType: 'Broad',
        revision: 'rev-0',
      });
      fixture.detectChanges();

      expect(addButton(A)!.disabled).toBe(true);
      expect(addButton('t3-b-gitops-1')!.disabled).toBe(false);

      add.next({ campaignId: 'c-uuid-a', appliedCount: 1, results: [{ text: 'gitops', matchType: 'Broad', outcome: 'APPLIED' }] });
      add.complete();
      fixture.detectChanges();
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

    // A note is stamped with the read current when it is RECORDED: a refresh during the revision read
    // must not hide the failure that arrives after it.
    it.each([
      ['a Refresh', 'fails', () => fixture.componentRef.setInput('reloadToken', 1)],
      ['a Refresh', 'answers no revision', () => fixture.componentRef.setInput('reloadToken', 1)],
      ['a window change', 'fails', () => q('reddit-keywords-window-last_7_days')!.click()],
      ['a window change', 'answers no revision', () => q('reddit-keywords-window-last_7_days')!.click()],
    ])('shows the note when, after %s, the pending revision read %s', (_change, outcome, change) => {
      const read = new Subject<{ campaign_id: string; platform: 'reddit-ads'; keywords: never[]; revision?: string }>();
      getKeywordTargeting.mockReturnValue(read);
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      fixture.detectChanges();
      clickAdd(A);

      change();
      fixture.detectChanges();
      expect(q('reddit-keyword-row-0')).not.toBeNull();
      if (outcome === 'fails') {
        read.error(new HttpErrorResponse({ status: 503, error: { error: 'x', code: 'SERVICE_UNAVAILABLE' } }));
      } else {
        read.next({ campaign_id: 'c-uuid-a', platform: 'reddit-ads', keywords: [] });
        read.complete();
      }
      fixture.detectChanges();

      expect(addNegativeKeywords).not.toHaveBeenCalled();
      const note = q(`reddit-keyword-negative-not-sent-${A}`)!;
      expect(note.getAttribute('role')).toBe('alert');
      expect(note.textContent).toContain(REDDIT_KEYWORD_NEGATIVE_REVISION_ERROR);
    });

    it('shows a refused submit recorded after a Refresh', () => {
      const read = new Subject<{ campaign_id: string; platform: 'reddit-ads'; keywords: never[]; revision: string }>();
      const removal = new Subject<never>();
      getKeywordTargeting.mockReturnValue(read);
      (TestBed.inject(CampaignService) as unknown as { removeKeywordTargeting: unknown }).removeKeywordTargeting = vi.fn().mockReturnValue(removal);
      fixture.detectChanges();
      clickAdd(A);

      fixture.componentRef.setInput('reloadToken', 1);
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
      read.next({ campaign_id: 'c-uuid-a', platform: 'reddit-ads', keywords: [], revision: 'rev-1' });
      read.complete();
      removal.error(new HttpErrorResponse({ status: 409, error: { error: 'changed', code: 'CONFLICT' } }));
      fixture.detectChanges();

      expect(addNegativeKeywords).not.toHaveBeenCalled();
      expect(q(`reddit-keyword-negative-not-sent-${A}`)!.textContent).toContain(REDDIT_KEYWORD_NEGATIVE_SUPERSEDED_MESSAGE);
    });

    it('shows a scope-changed note recorded after a window change', () => {
      const read = new Subject<{ campaign_id: string; platform: 'reddit-ads'; keywords: never[]; revision: string }>();
      getKeywordTargeting.mockReturnValue(read);
      fixture.detectChanges();
      clickAdd(A);

      q('reddit-keywords-window-last_7_days')!.click();
      fixture.componentRef.setInput('negativeTargets', {});
      fixture.detectChanges();
      read.next({ campaign_id: 'c-uuid-a', platform: 'reddit-ads', keywords: [], revision: 'rev-1' });
      read.complete();
      fixture.detectChanges();

      expect(addNegativeKeywords).not.toHaveBeenCalled();
      expect(q(`reddit-keyword-negative-not-sent-${A}`)!.textContent).toContain(REDDIT_KEYWORD_NEGATIVE_SCOPE_CHANGED_MESSAGE);
    });

    // Notes belong to the keyword, not to a report row: a re-read re-ranks the rows and drops some.
    describe('across a re-read that re-ranks the rows', () => {
      const mesh = (index: number) => ({
        key: `t3_a|service mesh|${index}`,
        campaignId: 't3_a',
        keyword: 'service mesh',
        impressions: 500,
        clicks: 5,
        ctr: 1,
        spend: 1,
      });
      const gitops = (index: number) => ({ key: `t3_a|gitops|${index}`, campaignId: 't3_a', keyword: 'gitops', impressions: 900, clicks: 9, ctr: 1, spend: 1 });
      let read: Subject<{ campaign_id: string; platform: 'reddit-ads'; keywords: never[] }>;

      function startAddThenChangeWindow(nextWindow: RedditKeywordMetricsResponse): void {
        read = new Subject();
        getKeywordTargeting.mockReturnValue(read);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        getRedditKeywords.mockImplementation((_slug: string, window: string) => of(window === 'last_7_days' ? nextWindow : report()));
        fixture.detectChanges();
        clickAdd(A);
        q('reddit-keywords-window-last_7_days')!.click();
        fixture.detectChanges();
        read.error(new HttpErrorResponse({ status: 503, error: { error: 'x', code: 'SERVICE_UNAVAILABLE' } }));
        fixture.detectChanges();
      }

      it("shows the note on the keyword's new row", () => {
        startAddThenChangeWindow(report({ keywords: [gitops(0), mesh(1)] }));

        expect(q('reddit-keyword-negative-not-sent-t3-a-service-mesh-1')!.textContent).toContain(REDDIT_KEYWORD_NEGATIVE_REVISION_ERROR);
        expect(q('reddit-keyword-negative-not-sent-t3-a-gitops-0')).toBeNull();
        expect(q('reddit-keywords-unplaced-not-sent-tlf-t3-a-service-mesh')).toBeNull();
      });

      it('lists the note above the table when the new report no longer has the keyword', () => {
        startAddThenChangeWindow(report({ keywords: [gitops(0)] }));

        const note = q('reddit-keywords-unplaced-not-sent-tlf-t3-a-service-mesh')!;
        expect(note.getAttribute('role')).toBe('alert');
        expect(note.textContent).toContain('"service mesh" (KubeCon EU)');
        expect(note.textContent).toContain(REDDIT_KEYWORD_NEGATIVE_REVISION_ERROR);
      });

      // The table stays mounted across a project change: a note is never shown under another project.
      it('drops the above-table note when the page moves to another project', () => {
        startAddThenChangeWindow(report({ keywords: [gitops(0)] }));
        expect(q('reddit-keywords-unplaced-not-sent-tlf-t3-a-service-mesh')).not.toBeNull();

        fixture.componentRef.setInput('projectSlug', 'cncf');
        fixture.detectChanges();

        expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid^="reddit-keywords-unplaced-not-sent-"]')).toBeNull();
      });

      it('never shows, under the new project, the note of an add cancelled by moving to it', () => {
        read = new Subject();
        getKeywordTargeting.mockReturnValue(read);
        fixture.detectChanges();
        clickAdd(A);

        fixture.componentRef.setInput('projectSlug', 'cncf');
        fixture.detectChanges();

        expect(read.observed).toBe(false);
        expect(addNegativeKeywords).not.toHaveBeenCalled();
        expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid^="reddit-keywords-unplaced-not-sent-"]')).toBeNull();
        expect(q(`reddit-keyword-negative-not-sent-${A}`)).toBeNull();
      });

      // A newer write outcome for the keyword (here from the campaign's editor) supersedes the note.
      it('clears the above-table note once the keyword is added from the editor', () => {
        startAddThenChangeWindow(report({ keywords: [gitops(0)] }));
        expect(q('reddit-keywords-unplaced-not-sent-tlf-t3-a-service-mesh')).not.toBeNull();

        addNegativeKeywords.mockReturnValue(of(applied()));
        TestBed.inject(CampaignNegativeKeywordsService).submit({
          projectSlug: 'tlf',
          briefId: 'brief-1',
          campaignId: 'c-uuid-a',
          campaignName: 'KubeCon EU',
          platform: 'reddit-ads',
          keywords: ['service mesh'],
          matchType: 'Broad',
          revision: 'rev-2',
        });
        fixture.detectChanges();

        expect(q('reddit-keywords-unplaced-not-sent-tlf-t3-a-service-mesh')).toBeNull();
      });

      // Dismissing the campaign's older result removes its saved request: that is not a newer outcome.
      it.each([
        ['above the table, when the new report drops the keyword', true],
        ['on the row, when the new report still lists it', false],
      ])('keeps a not-sent note through a Dismiss of the older unconfirmed result, %s', (_label, drop) => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        getRedditKeywords.mockImplementation((_slug: string, window: string) =>
          of(window === 'last_7_days' ? report({ keywords: drop ? [gitops(0)] : [gitops(0), mesh(1)] }) : report())
        );
        addNegativeKeywords.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 502, error: { error: 'x', code: 'BAD_GATEWAY' } })));
        fixture.detectChanges();
        clickAdd(A);
        expect(q(`reddit-keyword-negative-outcome-${A}`)!.textContent).toContain('Not confirmed');

        read = new Subject();
        getKeywordTargeting.mockReturnValue(read);
        clickAdd(A);
        q('reddit-keywords-window-last_7_days')!.click();
        fixture.detectChanges();
        read.error(new HttpErrorResponse({ status: 503, error: { error: 'x', code: 'SERVICE_UNAVAILABLE' } }));
        fixture.detectChanges();
        const noteId = drop ? 'reddit-keywords-unplaced-not-sent-tlf-t3-a-service-mesh' : 'reddit-keyword-negative-not-sent-t3-a-service-mesh-1';
        expect(q(noteId)).not.toBeNull();

        TestBed.inject(CampaignNegativeKeywordsService).dismiss('tlf', 'brief-1', 'c-uuid-a');
        fixture.detectChanges();

        expect(q(noteId)!.textContent).toContain(REDDIT_KEYWORD_NEGATIVE_REVISION_ERROR);
      });

      // Once a newer outcome hid the note, removing that outcome from display must not bring it back.
      it.each([
        ['above the table', true, 'a Dismiss', () => TestBed.inject(CampaignNegativeKeywordsService).dismiss('tlf', 'brief-1', 'c-uuid-a')],
        ['above the table', true, 'a brief change dropping it', () => TestBed.inject(CampaignNegativeKeywordsService).setScope('tlf', 'brief-2')],
        ['on the row', false, 'a Dismiss', () => TestBed.inject(CampaignNegativeKeywordsService).dismiss('tlf', 'brief-1', 'c-uuid-a')],
        ['on the row', false, 'a brief change dropping it', () => TestBed.inject(CampaignNegativeKeywordsService).setScope('tlf', 'brief-2')],
      ])('keeps a note %s hidden by a newer add gone after %s of that add', (_where, drop, _how, removeOutcome) => {
        startAddThenChangeWindow(report({ keywords: drop ? [gitops(0)] : [gitops(0), mesh(1)] }));
        const noteId = drop ? 'reddit-keywords-unplaced-not-sent-tlf-t3-a-service-mesh' : 'reddit-keyword-negative-not-sent-t3-a-service-mesh-1';
        expect(q(noteId)).not.toBeNull();

        addNegativeKeywords.mockReturnValue(of(applied()));
        TestBed.inject(CampaignNegativeKeywordsService).submit({
          projectSlug: 'tlf',
          briefId: 'brief-1',
          campaignId: 'c-uuid-a',
          campaignName: 'KubeCon EU',
          platform: 'reddit-ads',
          keywords: ['service mesh'],
          matchType: 'Broad',
          revision: 'rev-2',
        });
        fixture.detectChanges();
        expect(q(noteId)).toBeNull();
        // Pruned from the table's state once the high-water mark passed it, not merely hidden.
        const notes = (fixture.componentInstance as unknown as { notSent: () => Record<string, unknown> }).notSent();
        expect(Object.hasOwn(notes, 'tlf|t3_a|service mesh')).toBe(false);

        removeOutcome();
        fixture.detectChanges();

        expect(TestBed.inject(CampaignNegativeKeywordsService).requests()['tlf|brief-1|c-uuid-a']).toBeUndefined();
        expect(q(noteId)).toBeNull();
      });

      it('shows the note on every row of one report that sends the same text for the campaign', () => {
        startAddThenChangeWindow(report({ keywords: [mesh(0), { ...mesh(1), keyword: 'service  mesh', key: 't3_a|service  mesh|1' }] }));

        expect(q('reddit-keyword-negative-not-sent-t3-a-service-mesh-0')).not.toBeNull();
        expect(q('reddit-keyword-negative-not-sent-t3-a-service-mesh-1')).not.toBeNull();
      });
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

    // Switching back to the window a note was recorded under is a NEW read, not the old one: the stale
    // failure must stay gone rather than reappear as if it were current.
    it('does not bring a "Not sent" note back when the window is switched away and back', () => {
      getKeywordTargeting.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503, error: { error: 'x', code: 'SERVICE_UNAVAILABLE' } })));
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      fixture.detectChanges();
      clickAdd(A);
      expect(q(`reddit-keyword-negative-not-sent-${A}`)).not.toBeNull();

      q('reddit-keywords-window-last_7_days')!.click();
      fixture.detectChanges();
      q('reddit-keywords-window-last_30_days')!.click();
      fixture.detectChanges();

      expect(q(`reddit-keyword-negative-not-sent-${A}`)).toBeNull();
    });

    // The same for a project round trip: the table stays mounted, and returning to the project is a new
    // read, so a note recorded there before the switch must stay gone.
    it('does not bring a "Not sent" note back when the project is switched away and back', () => {
      getKeywordTargeting.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503, error: { error: 'x', code: 'SERVICE_UNAVAILABLE' } })));
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      fixture.detectChanges();
      clickAdd(A);
      expect(q(`reddit-keyword-negative-not-sent-${A}`)).not.toBeNull();

      fixture.componentRef.setInput('projectSlug', 'cncf');
      fixture.detectChanges();
      fixture.componentRef.setInput('projectSlug', 'tlf');
      fixture.detectChanges();

      expect(q(`reddit-keyword-negative-not-sent-${A}`)).toBeNull();
      expect(q('reddit-keywords-unplaced-not-sent-tlf-t3-a-service-mesh')).toBeNull();
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

    // The table stays mounted across scope changes: a read that answers late must not write to a
    // campaign the operator has left.
    describe('when the scope changes while the revision read is pending', () => {
      let read: Subject<{ campaign_id: string; platform: 'reddit-ads'; keywords: never[]; revision: string }>;

      beforeEach(() => {
        read = new Subject();
        getKeywordTargeting.mockReturnValue(read);
        addNegativeKeywords.mockReturnValue(of(applied()));
        fixture.detectChanges();
        clickAdd(A);
        expect(TestBed.inject(CampaignNegativeKeywordsService).reservations()).toEqual({ 'tlf|c-uuid-a': true });
      });

      function answer(): void {
        if (!read.closed) {
          read.next({ campaign_id: 'c-uuid-a', platform: 'reddit-ads', keywords: [], revision: 'rev-1' });
          read.complete();
        }
        fixture.detectChanges();
      }

      it.each([
        ['the project changes', () => fixture.componentRef.setInput('projectSlug', 'cncf')],
        ['the brief changes', () => fixture.componentRef.setInput('briefId', 'brief-2')],
        ['the campaign leaves the targets', () => fixture.componentRef.setInput('negativeTargets', {})],
      ])('sends nothing and releases the campaign when %s', (_label, change) => {
        change();
        fixture.detectChanges();
        answer();

        expect(addNegativeKeywords).not.toHaveBeenCalled();
        expect(TestBed.inject(CampaignNegativeKeywordsService).reservations()).toEqual({});
      });

      // The parent passes `null` targets while it re-reads its campaign list: unknown, not "left the
      // lever". The add waits for the list, then checks it against the targets that come back.
      it('waits out a campaign-list reload and then sends', () => {
        fixture.componentRef.setInput('negativeTargets', null);
        fixture.detectChanges();
        answer();
        expect(addNegativeKeywords).not.toHaveBeenCalled();
        expect(q(`reddit-keyword-negative-not-sent-${A}`)).toBeNull();

        fixture.componentRef.setInput('negativeTargets', { t3_a: { campaignId: 'c-uuid-a', campaignName: 'KubeCon EU' } });
        fixture.detectChanges();

        expect(addNegativeKeywords).toHaveBeenCalledWith('tlf', 'brief-1', 'c-uuid-a', [{ text: 'service mesh', matchType: 'Broad' }], 'rev-1');
        expect(TestBed.inject(CampaignNegativeKeywordsService).reservations()).toEqual({});
      });

      it('sends nothing, and says so, when the reloaded list no longer offers the campaign', () => {
        fixture.componentRef.setInput('negativeTargets', null);
        fixture.detectChanges();
        answer();

        fixture.componentRef.setInput('negativeTargets', {});
        fixture.detectChanges();

        expect(addNegativeKeywords).not.toHaveBeenCalled();
        expect(TestBed.inject(CampaignNegativeKeywordsService).reservations()).toEqual({});
        expect(q(`reddit-keyword-negative-not-sent-${A}`)!.textContent).toContain(REDDIT_KEYWORD_NEGATIVE_SCOPE_CHANGED_MESSAGE);
      });

      // The parent hands `{}` once a list reload FAILS: the waiting add ends, says why, and frees the campaign.
      it('says "Not sent" and releases the campaign when the campaign-list reload fails', () => {
        fixture.componentRef.setInput('negativeTargets', null);
        fixture.detectChanges();
        answer();
        expect(TestBed.inject(CampaignNegativeKeywordsService).reservations()).toEqual({ 'tlf|c-uuid-a': true });

        fixture.componentRef.setInput('negativeTargets', {});
        fixture.detectChanges();

        expect(addNegativeKeywords).not.toHaveBeenCalled();
        expect(TestBed.inject(CampaignNegativeKeywordsService).reservations()).toEqual({});
        expect(q(`reddit-keyword-negative-not-sent-${A}`)!.textContent).toContain(REDDIT_KEYWORD_NEGATIVE_SCOPE_CHANGED_MESSAGE);
      });

      // A failed metrics re-read leaves no row to carry the note: it must still be said, above the error.
      it('says "Not sent" above a failed metrics read when the revision read then fails', () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        getRedditKeywords.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503, error: { error: 'x', code: 'SERVICE_UNAVAILABLE' } })));
        fixture.componentRef.setInput('reloadToken', 1);
        fixture.detectChanges();
        expect(q('reddit-keywords-error')).not.toBeNull();

        read.error(new HttpErrorResponse({ status: 503, error: { error: 'x', code: 'SERVICE_UNAVAILABLE' } }));
        fixture.detectChanges();

        expect(addNegativeKeywords).not.toHaveBeenCalled();
        const note = q('reddit-keywords-unplaced-not-sent-tlf-t3-a-service-mesh');
        expect(note).not.toBeNull();
        expect(note!.getAttribute('role')).toBe('alert');
        expect(note!.textContent).toContain(REDDIT_KEYWORD_NEGATIVE_REVISION_ERROR);
      });

      // Leaving the PROJECT abandons the add after the page has moved on, so no read of the add's project
      // is current. The note must still be there on the return, and go on the next re-read after it.
      it('shows the "Not sent" note on returning to the project an add was abandoned by leaving', () => {
        fixture.componentRef.setInput('projectSlug', 'cncf');
        fixture.detectChanges();
        expect(read.observed).toBe(false);

        fixture.componentRef.setInput('projectSlug', 'tlf');
        fixture.detectChanges();
        expect(addNegativeKeywords).not.toHaveBeenCalled();
        expect(q(`reddit-keyword-negative-not-sent-${A}`)!.textContent).toContain(REDDIT_KEYWORD_NEGATIVE_SCOPE_CHANGED_MESSAGE);

        fixture.componentRef.setInput('reloadToken', 1);
        fixture.detectChanges();
        expect(q(`reddit-keyword-negative-not-sent-${A}`)).toBeNull();
      });

      // Leaving the scope cancels the read; the row still says why nothing went out.
      it('says "Not sent" when leaving the brief cancels the read', () => {
        fixture.componentRef.setInput('briefId', 'brief-2');
        fixture.detectChanges();

        expect(read.observed).toBe(false);
        expect(TestBed.inject(CampaignNegativeKeywordsService).reservations()).toEqual({});
        expect(q(`reddit-keyword-negative-not-sent-${A}`)!.textContent).toContain(REDDIT_KEYWORD_NEGATIVE_SCOPE_CHANGED_MESSAGE);
      });

      // The page's brief id goes empty while a Proceed save runs: that is not a switch to another brief.
      it.each([
        ['after the brief id comes back', true],
        ['while the brief id is still empty', false],
      ])('still sends through a transient empty brief id, answered %s', (_label, restore) => {
        fixture.componentRef.setInput('briefId', '');
        fixture.detectChanges();
        if (restore) {
          fixture.componentRef.setInput('briefId', 'brief-1');
          fixture.detectChanges();
        }
        answer();

        expect(addNegativeKeywords).toHaveBeenCalledWith('tlf', 'brief-1', 'c-uuid-a', [{ text: 'service mesh', matchType: 'Broad' }], 'rev-1');
        expect(TestBed.inject(CampaignNegativeKeywordsService).reservations()).toEqual({});
      });

      it('sends nothing, and says so, when an empty brief id is followed by another brief', () => {
        fixture.componentRef.setInput('briefId', '');
        fixture.detectChanges();
        fixture.componentRef.setInput('briefId', 'brief-2');
        fixture.detectChanges();
        answer();

        expect(addNegativeKeywords).not.toHaveBeenCalled();
        expect(TestBed.inject(CampaignNegativeKeywordsService).reservations()).toEqual({});
        expect(q(`reddit-keyword-negative-not-sent-${A}`)!.textContent).toContain(REDDIT_KEYWORD_NEGATIVE_SCOPE_CHANGED_MESSAGE);
      });

      it('says "Not sent" when the campaign is still listed but now maps to another campaign', () => {
        fixture.componentRef.setInput('negativeTargets', { t3_a: { campaignId: 'c-uuid-other', campaignName: 'KubeCon EU' } });
        fixture.detectChanges();
        answer();

        expect(addNegativeKeywords).not.toHaveBeenCalled();
        expect(TestBed.inject(CampaignNegativeKeywordsService).reservations()).toEqual({});
        expect(q(`reddit-keyword-negative-not-sent-${A}`)!.textContent).toContain(REDDIT_KEYWORD_NEGATIVE_SCOPE_CHANGED_MESSAGE);
      });
    });

    // A's note belongs to A: only a new read, a later attempt for A or a new outcome for A clears it.
    it('keeps keyword A\'s "Not sent" while keyword B of the same campaign is added', () => {
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
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      getKeywordTargeting.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 503, error: { error: 'x', code: 'SERVICE_UNAVAILABLE' } })));
      fixture.detectChanges();
      clickAdd(A);
      expect(q(`reddit-keyword-negative-not-sent-${A}`)).not.toBeNull();

      addNegativeKeywords.mockReturnValue(
        of({ campaignId: 'c-uuid-a', appliedCount: 1, results: [{ text: 'gitops', matchType: 'Broad', outcome: 'APPLIED' }] })
      );
      clickAdd('t3-a-gitops-1');

      expect(q('reddit-keyword-negative-t3-a-gitops-1')).not.toBeNull();
      expect(q(`reddit-keyword-negative-not-sent-${A}`)!.textContent).toContain(REDDIT_KEYWORD_NEGATIVE_REVISION_ERROR);
    });
  });
});
