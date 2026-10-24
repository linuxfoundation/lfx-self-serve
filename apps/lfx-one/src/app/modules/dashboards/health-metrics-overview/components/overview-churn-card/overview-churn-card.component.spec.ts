// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

import { OverviewChurnCardComponent } from './overview-churn-card.component';

import type { HealthMetricsOverviewChurn, HealthMetricsOverviewChurnPeriod } from '@lfx-one/shared/interfaces';

const PERIOD: HealthMetricsOverviewChurnPeriod = {
  totals: {
    churnRatePct: 18,
    churnRatePctPriorYear: 19,
    churnRateChangePp: -1,
    membershipsLost: 282,
    membershipsLostPriorYear: 261,
    membershipsLostChangePct: 0.08,
    valueLostUsd: 1790000,
    valueLostUsdPriorYear: 2600000,
    valueLostChangePct: -0.31,
  },
  tiers: [
    { tier: 'Platinum Membership', label: 'Platinum', churnRatePct: 8, membershipsLost: 1, valueLostUsd: 480000 },
    { tier: 'Gold Membership', label: 'Gold', churnRatePct: 0, membershipsLost: 0, valueLostUsd: 0 },
  ],
};
const CHURN: HealthMetricsOverviewChurn = {
  periods: { YTD: PERIOD, COMPLETED_YEAR: { totals: null, tiers: [] }, COMPLETED_YEAR_2: PERIOD, COMPLETED_YEAR_3: PERIOD },
};

describe('OverviewChurnCardComponent', () => {
  let fixture: ComponentFixture<OverviewChurnCardComponent>;

  async function render(): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [OverviewChurnCardComponent],
      providers: [
        provideRouter([]),
        HealthMetricsChromeService,
        { provide: AnalyticsService, useValue: { getOverviewChurn: vi.fn().mockReturnValue(of(CHURN)) } },
        { provide: ProjectContextService, useValue: { selectedFoundation: signal({ slug: 'acme' }) } },
        { provide: UserService, useValue: { impersonating: signal(false) } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(OverviewChurnCardComponent);
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

  it('colours each change by whether it is good news', async () => {
    await render();

    expect(cells('overview-churn-kpis-rate')).toEqual(['Churn rate', '18%Down1 pt', '19% last year']);
    expect(fixture.nativeElement.querySelector('[data-testid="overview-churn-kpis-rate-delta"]').className).toContain('text-emerald-700');
    expect(fixture.nativeElement.querySelector('[data-testid="overview-churn-kpis-lost-delta"]').className).toContain('text-red-700');
  });

  it('lists every tier with a bar against the overall rate marker', async () => {
    await render();

    expect(cells('overview-churn-tier-Platinum Membership')).toEqual(['Platinum', '8%', '1', '$480K']);
    expect(cells('overview-churn-tier-Gold Membership')).toEqual(['Gold', '0%', '0', '$0']);
    const marker = fixture.nativeElement.querySelector('[data-testid="overview-churn-tier-Gold Membership"] [title]') as HTMLElement;
    expect(marker.style.left).toBe('18%');
    expect(marker.getAttribute('title')).toBe('Overall churn 18%');
  });

  it('shows its empty state for a period with no churn', async () => {
    await render();

    TestBed.inject(HealthMetricsChromeService).selectedRange.set('COMPLETED_YEAR');
    fixture.detectChanges();

    expect(text('overview-churn-empty')).toContain('No churn to report');
  });
});
