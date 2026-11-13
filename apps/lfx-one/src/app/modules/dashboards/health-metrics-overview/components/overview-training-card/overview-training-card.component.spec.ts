// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { lfxColors } from '@lfx-one/shared/constants';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

import { OverviewTrainingCardComponent } from './overview-training-card.component';

import type { HealthMetricsTrainingEnrollment, HealthMetricsTrainingEnrollmentPeriod } from '@lfx-one/shared/interfaces';

const PERIOD: HealthMetricsTrainingEnrollmentPeriod = {
  totals: { enrollments: 120000, certifications: 0, revenueUsd: 4000000 },
  change: null,
  byType: [
    { deliveryType: 'E-Learning', isListed: true, isListedRevenue: true, enrollments: 100000, revenueUsd: 1600000 },
    { deliveryType: 'Bundle', isListed: false, isListedRevenue: true, enrollments: 0, revenueUsd: 400000 },
  ],
};
const ENROLLMENT: HealthMetricsTrainingEnrollment = {
  measured: true,
  periods: { YTD: PERIOD, COMPLETED_YEAR: PERIOD, COMPLETED_YEAR_2: PERIOD, COMPLETED_YEAR_3: PERIOD },
  trend: [],
  goals: { enrollments: 150000, revenueUsd: 5000000, enrollmentsProgressYtd: null, revenueProgressYtd: null },
};

describe('OverviewTrainingCardComponent', () => {
  let fixture: ComponentFixture<OverviewTrainingCardComponent>;

  async function render(enrollment: HealthMetricsTrainingEnrollment = ENROLLMENT): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [OverviewTrainingCardComponent],
      providers: [
        provideRouter([]),
        HealthMetricsChromeService,
        { provide: AnalyticsService, useValue: { getTrainingEnrollment: vi.fn().mockReturnValue(of(enrollment)) } },
        { provide: ProjectContextService, useValue: { selectedFoundation: signal({ slug: 'acme' }) } },
        { provide: UserService, useValue: { impersonating: signal(false) } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(OverviewTrainingCardComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function query(testId: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  }

  function option(metric: string): HTMLInputElement | null {
    return query('overview-training-toggle')?.querySelector<HTMLInputElement>(`input[value="${metric}"]`) ?? null;
  }

  function arcStrokes(): string[] {
    return [...(query('overview-training-arc')?.querySelectorAll('path') ?? [])].map(
      (path) => `${path.getAttribute('stroke')}/${path.getAttribute('stroke-width')}`
    );
  }

  it('shows enrollments against the goal, by enrollment program', async () => {
    await render();

    expect(query('overview-training-total')?.textContent?.trim()).toBe('120K');
    expect(query('overview-training-goal')?.textContent?.trim()).toBe('80% of 150K goal');
    expect(arcStrokes()).toEqual([`${lfxColors.gray[100]}/8`, `${lfxColors.blue[500]}/8`]);
    expect(query('overview-training-program-E-Learning')).not.toBeNull();
    expect(query('overview-training-program-Bundle')).toBeNull();
    expect(query('overview-training-toggle')?.querySelector('[aria-label="Measure"]')).not.toBeNull();
    expect(option('enrollments')?.checked).toBe(true);
  });

  it('switches to revenue, which adds Bundle', async () => {
    await render();

    option('revenue')?.click();
    fixture.detectChanges();

    expect(query('overview-training-total')?.textContent?.trim()).toBe('$4M');
    expect(query('overview-training-program-Bundle')).not.toBeNull();
    expect(option('revenue')?.checked).toBe(true);
  });

  it('drops the goal outside YTD', async () => {
    await render();

    TestBed.inject(HealthMetricsChromeService).selectedRange.set('COMPLETED_YEAR');
    fixture.detectChanges();

    expect(query('overview-training-goal')).toBeNull();
    expect(arcStrokes()).toEqual([`${lfxColors.gray[100]}/8`]);
  });

  it('outlines the track and says no goal is set when YTD has none', async () => {
    await render({ ...ENROLLMENT, goals: { ...ENROLLMENT.goals, enrollments: null } });

    expect(query('overview-training-goal')?.textContent?.trim()).toBe('No goal set');
    expect(arcStrokes()).toEqual([`${lfxColors.gray[200]}/8`, `${lfxColors.white}/6`]);
    expect(query('overview-training-arc')?.querySelector('svg')?.getAttribute('aria-label')).toBe('Enrollments 120K, no goal set');
  });
});
