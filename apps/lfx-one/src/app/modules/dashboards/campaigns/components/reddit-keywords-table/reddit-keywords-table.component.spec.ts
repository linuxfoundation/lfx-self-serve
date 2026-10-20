// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LIVE_REGION_MOUNT_DELAY_MS, REDDIT_KEYWORDS_ERROR_MESSAGES } from '@lfx-one/shared/constants';
import type { RedditKeywordMetricsResponse } from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RedditKeywordsTableComponent } from './reddit-keywords-table.component';

describe('RedditKeywordsTableComponent', () => {
  let fixture: ComponentFixture<RedditKeywordsTableComponent>;
  let getRedditKeywords: ReturnType<typeof vi.fn>;

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
    await TestBed.configureTestingModule({
      imports: [RedditKeywordsTableComponent],
      providers: [{ provide: CampaignService, useValue: { getRedditKeywords } }],
    }).compileComponents();
    fixture = TestBed.createComponent(RedditKeywordsTableComponent);
    fixture.componentRef.setInput('projectSlug', 'tlf');
    fixture.componentRef.setInput('campaignNames', { t3_a: 'KubeCon EU' });
  });

  const q = (testId: string): HTMLElement | null => (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${testId}"]`);

  it('reads the default window and renders the rows read-only, named where the brief knows the campaign', () => {
    fixture.detectChanges();

    expect(getRedditKeywords).toHaveBeenCalledWith('tlf', 'last_30_days');
    const first = q('reddit-keyword-row-0')!;
    expect(first.textContent).toContain('service mesh');
    expect(first.textContent).toContain('KubeCon EU');
    // An unknown campaign shows Reddit's id; a keyword-less row says so rather than showing a blank.
    expect(q('reddit-keyword-row-1')!.textContent).toContain('t3_b');
    expect(q('reddit-keyword-unattributed-1')!.textContent).toContain('Not attributed to a keyword');
    expect(q('reddit-keywords-read-only')).not.toBeNull();
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
});
