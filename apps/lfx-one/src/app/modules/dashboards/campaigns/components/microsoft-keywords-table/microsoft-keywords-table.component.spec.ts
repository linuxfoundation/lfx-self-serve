// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MICROSOFT_KEYWORDS_WINDOWS } from '@lfx-one/shared/constants';
import { MicrosoftKeywordActionRequest, MicrosoftKeywordMetrics, MicrosoftKeywordMetricsResponse } from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MicrosoftKeywordsTableComponent } from './microsoft-keywords-table.component';

const keyword = (over: Partial<MicrosoftKeywordMetrics> = {}): MicrosoftKeywordMetrics => ({
  keyword: 'kubernetes training',
  matchType: 'Phrase',
  qualityScore: null,
  status: 'ENABLED',
  adGroup: 'AG',
  adGroupId: '111',
  criterionId: '222',
  campaign: 'KubeCon EU',
  campaignId: '333',
  impressions: 1200,
  clicks: 40,
  ctr: 3.33,
  avgCpc: 1.5,
  spend: 60,
  conversions: 0,
  ...over,
});

const report = (over: Partial<MicrosoftKeywordMetricsResponse> = {}): MicrosoftKeywordMetricsResponse => ({
  pulledAt: '2026-10-05T10:00:00Z',
  window: 'last_30_days',
  totalKeywords: 1,
  truncated: false,
  metricsAsOf: '2026-10-05T09:00:00Z',
  metricsPending: false,
  conversionsComplete: true,
  dataIncomplete: false,
  totals: { impressions: 1200, clicks: 40, spend: 60, conversions: 0, avgCtr: 3.33 },
  keywords: [keyword()],
  ...over,
});

describe('MicrosoftKeywordsTableComponent', () => {
  let fixture: ComponentFixture<MicrosoftKeywordsTableComponent>;
  let getMicrosoftKeywords: ReturnType<typeof vi.fn>;

  async function render(response: MicrosoftKeywordMetricsResponse | Error): Promise<void> {
    getMicrosoftKeywords = vi.fn().mockReturnValue(response instanceof Error ? throwError(() => response) : of(response));
    await TestBed.configureTestingModule({
      imports: [MicrosoftKeywordsTableComponent],
      providers: [{ provide: CampaignService, useValue: { getMicrosoftKeywords } }],
    }).compileComponents();
    fixture = TestBed.createComponent(MicrosoftKeywordsTableComponent);
    fixture.componentRef.setInput('projectSlug', 'tlf');
    fixture.detectChanges();
  }

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const q = (testId: string): HTMLElement | null => el().querySelector(`[data-testid="${testId}"]`);

  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('reads the default window, then the window the operator picks', async () => {
    await render(report());
    expect(getMicrosoftKeywords).toHaveBeenCalledWith('tlf', 'last_30_days');

    q('microsoft-keywords-window-last_7_days')!.click();
    fixture.detectChanges();
    expect(getMicrosoftKeywords).toHaveBeenLastCalledWith('tlf', 'last_7_days');
    expect(q('microsoft-keywords-window-last_7_days')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('offers exactly the windows the Microsoft read accepts', async () => {
    await render(report());
    const offered = Array.from(el().querySelectorAll('[data-testid^="microsoft-keywords-window-"]')).map((b) =>
      b.getAttribute('data-testid')!.replace('microsoft-keywords-window-', '')
    );
    expect(offered).toEqual([...MICROSOFT_KEYWORDS_WINDOWS]);
  });

  it('renders rows and totals with the metrics time, and no currency symbol', async () => {
    await render(report());

    expect(q('microsoft-keywords-as-of')!.textContent).toContain('Metrics as of');
    expect(q('microsoft-keyword-row-microsoft-ads:111-222')!.textContent).toContain('kubernetes training');
    expect(q('microsoft-keyword-row-microsoft-ads:111-222')!.textContent).toContain('60.00');
    const totals = q('microsoft-keywords-totals')!;
    expect(totals.textContent).toContain('1,200');
    // Spend is never summed across campaigns, which may bill in different currencies.
    expect(totals.textContent).toContain('Not totalled');
    expect(totals.textContent).not.toContain('60');
    expect(el().textContent).not.toContain('$');
  });

  // The first read before any report has finished: the rows are empty because it is BUILDING.
  it('says the report is building, not "no keywords", when there is no metricsAsOf', async () => {
    await render(report({ metricsAsOf: null, metricsPending: true, keywords: [], totalKeywords: 0 }));

    expect(q('microsoft-keywords-building')!.textContent).toContain('is building. Check back in a few minutes.');
    expect(q('microsoft-keywords-empty')).toBeNull();
  });

  it('says "no activity" only for a finished report with no rows', async () => {
    await render(report({ keywords: [], totalKeywords: 0 }));

    expect(q('microsoft-keywords-empty')).not.toBeNull();
    expect(q('microsoft-keywords-building')).toBeNull();
  });

  it('shows the building-newer, partial-data and conversions-not-measured notes', async () => {
    await render(
      report({
        metricsPending: true,
        dataIncomplete: true,
        conversionsComplete: false,
        keywords: [keyword(), keyword({ adGroupId: '9', criterionId: '8', conversions: 3 })],
      })
    );

    expect(q('microsoft-keywords-pending')!.textContent).toContain('Building newer metrics');
    expect(q('microsoft-keywords-data-incomplete')!.textContent).toContain('Partial data');
    expect(q('microsoft-keywords-conversions-incomplete')!.textContent).toContain('Conversions not measured');
    // A 0 may be a blank, so it is not shown as a measurement; a positive count is one.
    expect(q('microsoft-keyword-conversions-microsoft-ads:111-222')!.textContent).toContain('Not measured');
    expect(q('microsoft-keyword-conversions-microsoft-ads:9-8')!.textContent!.trim()).toBe('3');
    expect(q('microsoft-keywords-total-conversions')!.textContent).toContain('Not measured');
  });

  it('shows an unreachable read as a calm, retryable message — not a red error box', async () => {
    await render(Object.assign(new Error('boom'), { status: 503 }));

    const box = q('microsoft-keywords-error')!;
    expect(box).not.toBeNull();
    expect(box.className).not.toContain('red');
    expect(getMicrosoftKeywords).toHaveBeenCalledTimes(1);
    getMicrosoftKeywords.mockReturnValue(of(report()));
    (q('microsoft-keywords-retry')!.querySelector('button') ?? q('microsoft-keywords-retry')!).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(getMicrosoftKeywords).toHaveBeenCalledTimes(2);
    expect(q('microsoft-keywords-error')).toBeNull();
  });

  it.each([404, 400])('states a foundation without Microsoft metrics plainly (status %i), with no error box', async (status) => {
    await render(Object.assign(new Error('nope'), { status }));

    expect(q('microsoft-keywords-not-connected')!.textContent).toContain("aren't available for this foundation");
    expect(q('microsoft-keywords-error')).toBeNull();
  });

  it('asks the parent for an action and renders the outcome it hands back, keyed by platform', async () => {
    await render(report());
    const asked: MicrosoftKeywordActionRequest[] = [];
    fixture.componentInstance.keywordAction.subscribe((r) => asked.push(r));

    q('microsoft-keyword-remove-microsoft-ads:111-222')!.click();
    expect(asked).toEqual([{ keyword: keyword(), action: 'remove' }]);

    fixture.componentRef.setInput('actionResults', {
      'microsoft-ads:111-222': { success: false, state: 'unconfirmed', message: 'The change was sent but could not be confirmed.' },
      // A Google outcome under the bare key must not render against the Microsoft row.
      '111-222': { success: true, state: 'done', message: 'ok' },
    });
    fixture.detectChanges();
    const outcome = q('microsoft-keyword-outcome-microsoft-ads:111-222')!;
    expect(outcome.textContent).toContain('Unconfirmed');
    expect(outcome.textContent).not.toContain('Done');
  });
});
