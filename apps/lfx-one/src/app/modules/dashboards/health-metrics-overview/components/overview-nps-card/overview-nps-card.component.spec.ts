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

import { OverviewNpsCardComponent } from './overview-nps-card.component';

import type { HealthMetricsOverviewNps, HealthMetricsOverviewNpsPeriod } from '@lfx-one/shared/interfaces';

const PERIOD: HealthMetricsOverviewNpsPeriod = {
  npsScore: 80,
  scoreChangePp: 12,
  previousSurveyQuarter: 'Q4 2025',
  lastUpdatedQuarter: 'Q2 2026',
  recipientsCount: 24,
  responsesCount: 5,
  responseRatePct: 0.2083,
  promotersCount: 4,
  passivesCount: 1,
  detractorsCount: 0,
  noResponseCount: 19,
};
const NPS: HealthMetricsOverviewNps = { periods: { YTD: PERIOD, COMPLETED_YEAR: PERIOD, COMPLETED_YEAR_2: null, COMPLETED_YEAR_3: null } };

describe('OverviewNpsCardComponent', () => {
  let fixture: ComponentFixture<OverviewNpsCardComponent>;

  async function render(): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [OverviewNpsCardComponent],
      providers: [
        provideRouter([]),
        HealthMetricsChromeService,
        { provide: AnalyticsService, useValue: { getOverviewNps: vi.fn().mockReturnValue(of(NPS)) } },
        { provide: ProjectContextService, useValue: { selectedFoundation: signal({ slug: 'acme' }) } },
        { provide: UserService, useValue: { impersonating: signal(false) } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(OverviewNpsCardComponent);
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

  it('reads the latest survey, the change and the response split', async () => {
    await render();

    expect(text('overview-nps-subtitle')).toBe('Last survey: Q2 2026 · 5 of 24 responded (21%)');
    expect(text('overview-nps-score')).toBe('80');
    expect(text('overview-nps-delta')).toBe('Up12 pts vs Q4 2025');
    expect(cells('overview-nps-promoters')).toEqual(['Promoters scored 9–10', '4', '80%']);
    expect(cells('overview-nps-no-response')).toEqual(['No response', '19']);
    expect(fixture.nativeElement.querySelector('[data-testid="overview-nps-gauge"]').getAttribute('aria-label')).toBe(
      'Net Promoter Score 80 on a scale from -100 to 100'
    );
    expect(fixture.nativeElement.querySelector('[data-testid="overview-nps-segment-high"]').getAttribute('stroke-opacity')).toBe('1');
  });

  it('shows its empty state for a period with no survey sent', async () => {
    await render();

    TestBed.inject(HealthMetricsChromeService).selectedRange.set('COMPLETED_YEAR_2');
    fixture.detectChanges();

    expect(text('overview-nps-empty')).toContain('No survey results yet');
    expect(fixture.nativeElement.querySelector('[data-testid="overview-nps-subtitle"]')).toBeNull();
  });
});
