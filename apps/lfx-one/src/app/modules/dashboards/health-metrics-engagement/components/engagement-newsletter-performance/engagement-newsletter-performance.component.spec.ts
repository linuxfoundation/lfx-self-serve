// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { ChartComponent } from '@components/chart/chart.component';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

import { EngagementNewsletterPerformanceComponent } from './engagement-newsletter-performance.component';

import type { ChartData } from 'chart.js';
import type {
  HealthMetricsEngagementNewsletter,
  HealthMetricsEngagementNewsletterPerformance,
  HealthMetricsEngagementNewsletterPeriod,
} from '@lfx-one/shared/interfaces';

/** Chart.js needs a canvas jsdom does not have; the stub only records the datasets it is handed. */
@Component({ selector: 'lfx-chart', template: '' })
class ChartStubComponent {
  public readonly type = input<string>('');
  public readonly data = input<ChartData<'line'> | null>(null);
  public readonly options = input<unknown>({});
  public readonly height = input<string>('');
}

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
  let counts: (number | null)[];
  let verdicts: boolean[];

  async function render(payload: HealthMetricsEngagementNewsletterPerformance | Error = PERFORMANCE): Promise<void> {
    counts = [];
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
    })
      .overrideComponent(EngagementNewsletterPerformanceComponent, { remove: { imports: [ChartComponent] }, add: { imports: [ChartStubComponent] } })
      .compileComponents();

    fixture = TestBed.createComponent(EngagementNewsletterPerformanceComponent);
    fixture.componentInstance.countChange.subscribe((count) => counts.push(count));
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

  function datasetLabels(): string[] {
    const chart = fixture.debugElement.query(By.directive(ChartStubComponent))?.componentInstance as ChartStubComponent | undefined;
    return (chart?.data()?.datasets ?? []).map((dataset) => dataset.label ?? '');
  }

  it('shows the KPIs, charts each newsletter’s rates and lists them latest first', async () => {
    await render();

    expect(text('engagement-newsletter-performance-subscribers')).toBe('1,490');
    expect(text('engagement-newsletter-performance-growth')).toBe('+21% since Aug');
    expect(text('engagement-newsletter-performance-kpi-click')).toBe('5.7%');
    expect(datasetLabels()).toEqual(['Open rate', 'Click rate', 'Click-to-open rate']);
    const rows = [...fixture.nativeElement.querySelectorAll('[data-testid="engagement-newsletter-performance-table"] tbody tr')] as HTMLElement[];
    expect(rows.map((row) => row.getAttribute('data-testid'))).toEqual([
      'engagement-newsletter-performance-row-n2',
      'engagement-newsletter-performance-row-n1',
    ]);
    // Each cell's lines, joined with a space; textContent alone runs the stacked lines together.
    const latest = [...(query('engagement-newsletter-performance-row-n2')?.children ?? [])].map((cell) =>
      [...cell.querySelectorAll('span')]
        .filter((span) => !span.querySelector('span'))
        .map((span) => span.textContent?.trim())
        .join(' ')
    );
    expect(latest).toEqual([`Monthly: Latest Sent Oct 26, ${YEAR}`, '1,490 61 failed', '647 997 total', '43%', '76 1,462 total', '5%', '12%']);
    expect(counts.at(-1)).toBe(2);
    expect(verdicts).toEqual([false]);
  });

  it('switches the chart to recipients and unique opens, and keeps the choice in the URL', async () => {
    await render();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    fixture.componentInstance['onModeChange']('audience');
    fixture.detectChanges();

    expect(datasetLabels()).toEqual(['Recipients', 'Unique opens']);
    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { nlMode: 'audience' }, queryParamsHandling: 'merge' }));
  });

  it('settles empty and badges zero for a period with no newsletter sent', async () => {
    await render();

    TestBed.inject(HealthMetricsChromeService).selectedRange.set('COMPLETED_YEAR');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(counts.at(-1)).toBe(0);
    expect(verdicts.at(-1)).toBe(true);
    expect(query('engagement-newsletter-performance-table')).toBeNull();
  });

  it('says the read failed rather than reporting nothing sent, and badges nothing', async () => {
    await render(new Error('boom'));

    expect(query('engagement-newsletter-performance-error')).not.toBeNull();
    expect(counts.at(-1)).toBeNull();
    expect(verdicts).toEqual([false]);
  });
});
