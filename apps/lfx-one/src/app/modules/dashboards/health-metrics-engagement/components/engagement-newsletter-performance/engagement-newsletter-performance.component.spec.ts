// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

import { EngagementNewsletterPerformanceComponent } from './engagement-newsletter-performance.component';

import type {
  HealthMetricsEngagementNewsletter,
  HealthMetricsEngagementNewsletterPerformance,
  HealthMetricsEngagementNewsletterPeriod,
} from '@lfx-one/shared/interfaces';

const YEAR = new Date().getFullYear();
const PERIOD: HealthMetricsEngagementNewsletterPeriod = {
  subscribers: 1490,
  subscribersGrowth: 0.21,
  growthBaselineDate: `${YEAR}-08-10`,
  newslettersSent: 2,
  avgOpenRate: 0.45,
  avgClickRate: 0.057,
  avgClickToOpenRate: 0.13,
  avgDeliveryRate: 0.96,
};
const LATEST: HealthMetricsEngagementNewsletter = {
  key: 'n2',
  name: 'Monthly: Latest',
  sentDate: `${YEAR}-10-26`,
  hasEngagementData: true,
  recipients: 1490,
  failed: 61,
  uniqueOpens: 647,
  totalOpens: 997,
  uniqueClicks: 76,
  totalClicks: 1462,
  openRate: 0.43,
  clickRate: 0.05,
  clickToOpenRate: 0.12,
};
const PERFORMANCE: HealthMetricsEngagementNewsletterPerformance = {
  measured: true,
  periods: { YTD: PERIOD, COMPLETED_YEAR: { ...PERIOD, newslettersSent: 0 }, COMPLETED_YEAR_2: null, COMPLETED_YEAR_3: null },
  newsletters: [LATEST, { ...LATEST, key: 'n1', name: 'Monthly: First', sentDate: `${YEAR}-09-14`, uniqueOpens: 500, openRate: 0.4 }],
};

describe('EngagementNewsletterPerformanceComponent', () => {
  let fixture: ComponentFixture<EngagementNewsletterPerformanceComponent>;
  let verdicts: boolean[];

  async function render(payload: HealthMetricsEngagementNewsletterPerformance | Error = PERFORMANCE): Promise<void> {
    verdicts = [];
    await TestBed.configureTestingModule({
      imports: [EngagementNewsletterPerformanceComponent],
      providers: [
        provideRouter([]),
        HealthMetricsChromeService,
        { provide: UserService, useValue: { impersonating: signal(false) } },
        {
          provide: AnalyticsService,
          useValue: { getEngagementNewsletterPerformance: vi.fn().mockReturnValue(payload instanceof Error ? throwError(() => payload) : of(payload)) },
        },
        { provide: ProjectContextService, useValue: { selectedFoundation: signal({ slug: 'acme' }) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EngagementNewsletterPerformanceComponent);
    fixture.componentInstance.settled.subscribe((empty) => verdicts.push(empty));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function query(testId: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  }

  function text(testId: string): string {
    return query(testId)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  function legend(): string[] {
    return [...(query('engagement-newsletter-performance-legend')?.querySelectorAll(':scope > span') ?? [])].map((span) => span.textContent?.trim() ?? '');
  }

  it('shows the metrics row, charts each newsletter’s rates and lists them latest first', async () => {
    await render();

    expect(text('engagement-newsletter-performance-metrics-subscribers-value')).toBe('1,490');
    expect(text('engagement-newsletter-performance-metrics-subscribers-description')).toBe('+21% since Aug');
    expect(text('engagement-newsletter-performance-metrics-sent-description')).toBe('96% delivered');
    expect(text('engagement-newsletter-performance-metrics-click-value')).toBe('5.7%');
    expect(text('engagement-newsletter-performance-metrics-click-description')).toBe('13% of opens');
    expect(query('engagement-newsletter-performance-metrics-cto')).toBeNull();
    expect(legend()).toEqual(['Open rate', 'Click rate', 'Click-to-open rate']);
    expect(query('engagement-newsletter-performance-chart-line-cto')?.getAttribute('stroke-dasharray')).toBe('5 4');
    // The click-to-open swatch is dashed like its line; the solid lines keep a solid swatch.
    const swatch = (key: string, kind: string) =>
      query(`engagement-newsletter-performance-legend-${key}`)?.querySelector(`[data-testid="engagement-newsletter-performance-legend-${kind}"]`);
    expect(swatch('cto', 'swatch-dashed')?.className).toContain('border-dashed');
    expect(swatch('cto', 'swatch')).toBeNull();
    expect(swatch('open', 'swatch')).not.toBeNull();
    expect(swatch('open', 'swatch-dashed')).toBeNull();
    const rows = [...fixture.nativeElement.querySelectorAll('[data-testid="engagement-newsletter-performance-table"] tbody tr')] as HTMLElement[];
    expect(rows.map((row) => row.getAttribute('data-testid'))).toEqual([
      'engagement-newsletter-performance-row-n2',
      'engagement-newsletter-performance-row-n1',
    ]);
    // Each cell's text and its description, joined with a space.
    const latest = [...(query('engagement-newsletter-performance-row-n2')?.children ?? [])].map((cell) =>
      [
        ...cell.querySelectorAll(
          '[data-testid="health-metrics-cell-text"], [data-testid="health-metrics-cell-description"], [data-testid$="-open-rate"] > span:first-child'
        ),
      ]
        .map((part) => part.textContent?.trim())
        .join(' ')
    );
    expect(latest).toEqual([`Monthly: Latest Sent Oct 26, ${YEAR}`, '1,490 61 failed', '647 997 total', '43%', '76 1,462 total', '5%', '12%']);
    expect((query('engagement-newsletter-performance-row-n2-open-rate')?.querySelector('.bg-blue-500') as HTMLElement).style.width).toBe('43%');
    expect(verdicts).toEqual([false]);
  });

  it.each([
    [0.5004, '60%'],
    [0.7, '70%'],
  ])('tops the rates axis at the next 10%% above the peak open rate (%s → %s)', async (openRate, top) => {
    await render({ ...PERFORMANCE, newsletters: [{ ...LATEST, openRate }] });

    expect(query('engagement-newsletter-performance-chart-y')?.querySelector('span')?.textContent).toBe(top);
  });

  it('switches the chart to recipients and unique opens, and keeps the choice in the URL', async () => {
    await render();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    fixture.componentInstance['onModeChange']('audience');
    fixture.detectChanges();

    expect(legend()).toEqual(['Recipients', 'Unique opens']);
    expect(query('engagement-newsletter-performance-modes')?.tagName).toBe('LFX-UI-SWITCH');
    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { nlMode: 'audience' }, queryParamsHandling: 'merge' }));
  });

  it('says so in place of the rates chart when no newsletter carries engagement data, while the table still lists them', async () => {
    await render({ ...PERFORMANCE, newsletters: PERFORMANCE.newsletters.map((newsletter) => ({ ...newsletter, hasEngagementData: false })) });

    expect(query('engagement-newsletter-performance-chart')).toBeNull();
    expect(query('engagement-newsletter-performance-chart-empty')).not.toBeNull();
    expect(query('engagement-newsletter-performance-row-n2')).not.toBeNull();
  });

  it('opens on the latest send with the Newsletter arrow, and sorts a rate highest first, a newsletter with no engagement data last', async () => {
    const quiet = { ...LATEST, key: 'n0', name: 'Monthly: Quiet', sentDate: `${YEAR}-08-01`, hasEngagementData: false };
    await render({ ...PERFORMANCE, newsletters: [...PERFORMANCE.newsletters, quiet] });
    const keys = (): string[] =>
      [...fixture.nativeElement.querySelectorAll('[data-testid="engagement-newsletter-performance-table"] tbody tr')].map(
        (row: Element) => row.getAttribute('data-testid') ?? ''
      );
    const header = (key: string): HTMLElement => fixture.nativeElement.querySelector(`[data-testid="engagement-newsletter-performance-sort-${key}"]`);

    expect(header('newsletter').closest('th')?.getAttribute('aria-sort')).toBe('descending');
    expect(keys()).toEqual([
      'engagement-newsletter-performance-row-n2',
      'engagement-newsletter-performance-row-n1',
      'engagement-newsletter-performance-row-n0',
    ]);

    (header('openRate').querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(keys()).toEqual([
      'engagement-newsletter-performance-row-n2',
      'engagement-newsletter-performance-row-n1',
      'engagement-newsletter-performance-row-n0',
    ]);
    (header('openRate').querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(keys()).toEqual([
      'engagement-newsletter-performance-row-n1',
      'engagement-newsletter-performance-row-n2',
      'engagement-newsletter-performance-row-n0',
    ]);
  });

  it('pages ten newsletters at a time with the numbered pager', async () => {
    const many = Array.from({ length: 12 }, (_, index) => ({ ...LATEST, key: `n${index}`, sentDate: `${YEAR}-0${(index % 9) + 1}-02` }));
    await render({ ...PERFORMANCE, newsletters: many });

    expect(fixture.nativeElement.querySelectorAll('[data-testid="engagement-newsletter-performance-table"] tbody tr')).toHaveLength(10);
    expect(text('ui-pagination-info')).toBe('Showing 1 to 10 of 12');
  });

  it('settles empty for a period with no newsletter sent', async () => {
    await render();

    TestBed.inject(HealthMetricsChromeService).selectedRange.set('COMPLETED_YEAR');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(verdicts.at(-1)).toBe(true);
    expect(query('engagement-newsletter-performance-table')).toBeNull();
  });

  it('says the read failed rather than reporting nothing sent', async () => {
    await render(new Error('boom'));

    expect(query('engagement-newsletter-performance-error')).not.toBeNull();
    expect(verdicts).toEqual([false]);
  });
});
