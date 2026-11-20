// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HEALTH_METRICS_OVERVIEW_FILL_CLASSES } from '@lfx-one/shared/constants';
import { provideRouter } from '@angular/router';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';
import { OverviewBalanceCardComponent } from './overview-balance-card.component';

import type { HealthMetricsOverviewBalancePeriod, HealthMetricsOverviewOutstandingBalance } from '@lfx-one/shared/interfaces';

const PERIOD: HealthMetricsOverviewBalancePeriod = {
  outstandingUsd: 1105250,
  overdueMembers: 20,
  highRiskUsd: 1083250,
  highRiskMembers: 18,
  highRiskSharePct: 0.98,
  mediumRiskUsd: 22000,
  mediumRiskMembers: 2,
  mediumRiskSharePct: 0.02,
};

/** The same figures in every period, with `ytd` and `lastYear` overriding the year to date and last year. */
function balance(ytd: Partial<HealthMetricsOverviewBalancePeriod> = {}, lastYear: Partial<HealthMetricsOverviewBalancePeriod> = {}): HealthMetricsOverviewOutstandingBalance {
  return {
    measured: true,
    periods: { YTD: { ...PERIOD, ...ytd }, COMPLETED_YEAR: { ...PERIOD, ...lastYear }, COMPLETED_YEAR_2: PERIOD, COMPLETED_YEAR_3: PERIOD },
  };
}

describe('OverviewBalanceCardComponent', () => {
  let fixture: ComponentFixture<OverviewBalanceCardComponent>;

  async function render(payload: HealthMetricsOverviewOutstandingBalance): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [OverviewBalanceCardComponent],
      providers: [
        provideRouter([]),
        HealthMetricsChromeService,
        { provide: AnalyticsService, useValue: { getOverviewOutstandingBalance: vi.fn().mockReturnValue(of(payload)) } },
        { provide: ProjectContextService, useValue: { selectedFoundation: signal({ slug: 'acme' }) } },
        { provide: UserService, useValue: { impersonating: signal(false) } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(OverviewBalanceCardComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  /** Each grid cell's text, since Angular drops the whitespace between them. */
  function cells(testId: string): string[] {
    const row = fixture.nativeElement.querySelector(`[data-testid="${testId}"]`) as HTMLElement;
    return [...row.children].map((cell) => cell.textContent?.replace(/\s+/g, ' ').trim() ?? '');
  }

  function text(testId: string): string {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  it('reads the total, the members at risk and each risk band', async () => {
    await render(balance());

    expect(text('overview-balance-total')).toBe('$1,105,250');
    expect(text('overview-balance-overdue')).toBe('Overdue across 20 members · 18 members at risk of churn');
    expect(cells('overview-balance-high')).toEqual(['High risk90+ days overdue', '18', '$1,083,250']);
    expect(fixture.nativeElement.querySelectorAll('[data-testid="overview-balance-bar"] span')).toHaveLength(2);
    expect(fixture.nativeElement.querySelector('[data-testid="overview-balance-explore"]').getAttribute('href')).toContain('/members#risk');
  });

  it('heads the first column Risk and opens on the largest amount, keeping the bar in risk order', async () => {
    await render(balance({ highRiskUsd: 10000, mediumRiskUsd: 22000 }));
    const rows = (): string[] =>
      [...fixture.nativeElement.querySelectorAll('[role="row"][data-testid^="overview-balance-"]')].map(
        (row: Element) => row.getAttribute('data-testid') ?? ''
      );
    const header = (key: string): HTMLElement => fixture.nativeElement.querySelector(`[data-testid="overview-balance-sort-${key}"]`);

    expect(header('risk').textContent?.trim()).toBe('Risk');
    expect(header('risk').closest('[role="columnheader"]')?.querySelector('.sr-only')).toBeNull();
    expect(header('amount').parentElement?.getAttribute('aria-sort')).toBe('descending');
    expect(rows()).toEqual(['overview-balance-medium', 'overview-balance-high']);
    // The table is medium first; the bar stays high, then medium.
    expect([...fixture.nativeElement.querySelectorAll('[data-testid="overview-balance-bar"] span')].map((bar: Element) => bar.className)).toEqual([
      HEALTH_METRICS_OVERVIEW_FILL_CLASSES.low,
      HEALTH_METRICS_OVERVIEW_FILL_CLASSES.medium,
    ]);

    (header('risk').querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(rows()).toEqual(['overview-balance-high', 'overview-balance-medium']);
    expect(header('risk').parentElement?.getAttribute('aria-sort')).toBe('ascending');
  });

  it('reads as good news when nothing is overdue', async () => {
    await render(balance({ outstandingUsd: 0 }));

    expect(text('overview-balance-empty-title')).toBe('All invoices paid');
  });

  it('follows the period, with the past year empty state for a year with nothing overdue', async () => {
    await render(balance({}, { outstandingUsd: 0 }));

    TestBed.inject(HealthMetricsChromeService).selectedRange.set('COMPLETED_YEAR');
    fixture.detectChanges();

    expect(text('overview-balance-empty-title')).toBe(`Nothing overdue in ${new Date().getFullYear() - 1}`);
    expect(text('overview-balance-empty')).toContain('Every member invoice was paid within 60 days');
  });

  it('drops the at-risk tag and its separator when the period has no high-risk members', async () => {
    await render(balance({ highRiskMembers: 0, highRiskUsd: 0, highRiskSharePct: 0 }));

    expect(text('overview-balance-overdue')).toBe('Overdue across 20 members');
    expect(fixture.nativeElement.querySelector('[data-testid="overview-balance-at-risk"]')).toBeNull();
  });

  it('stays neutral when the balance was never measured', async () => {
    await render({ ...balance(), measured: false });

    expect(text('overview-balance-empty-title')).toBe('No balance data yet');
  });
});
