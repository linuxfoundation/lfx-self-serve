// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HEALTH_METRICS_TRAINING_ENROLLMENT_UNMEASURED } from '@lfx-one/shared/constants';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

import { TrainingEnrollComponent } from './training-enroll.component';

import type { HealthMetricsTrainingEnrollment, HealthMetricsTrainingEnrollmentPeriod } from '@lfx-one/shared/interfaces';

const currentYear = new Date().getFullYear();

const PERIOD: HealthMetricsTrainingEnrollmentPeriod = {
  totals: { enrollments: 12000, certifications: 300, revenueUsd: 100000 },
  change: { enrollments: 0.2, certifications: 0, revenueUsd: -0.2 },
  byType: [
    { deliveryType: 'E-Learning', isListed: true, isListedRevenue: true, enrollments: 9000, revenueUsd: 30000 },
    { deliveryType: 'Certification Exam', isListed: true, isListedRevenue: true, enrollments: 3000, revenueUsd: 70000 },
  ],
};

/** The same period under every range; `period` overrides it, `overrides` the rest of the read. */
function enrollment(
  overrides: Partial<HealthMetricsTrainingEnrollment> = {},
  period: Partial<HealthMetricsTrainingEnrollmentPeriod> = {}
): HealthMetricsTrainingEnrollment {
  const merged = { ...PERIOD, ...period };
  return {
    measured: true,
    periods: { YTD: merged, COMPLETED_YEAR: merged, COMPLETED_YEAR_2: merged, COMPLETED_YEAR_3: merged },
    trend: [
      { year: currentYear, enrollments: 4000, certificationExams: 1000, microcourses: 200, instructorLed: 300 },
      { year: currentYear - 1, enrollments: 8000, certificationExams: 2000, microcourses: 400, instructorLed: 600 },
    ],
    goals: HEALTH_METRICS_TRAINING_ENROLLMENT_UNMEASURED.goals,
    ...overrides,
  };
}

describe('TrainingEnrollComponent', () => {
  let fixture: ComponentFixture<TrainingEnrollComponent>;
  let getTrainingEnrollment: ReturnType<typeof vi.fn>;
  let selectedFoundation: ReturnType<typeof signal<{ slug: string } | null>>;
  let lifecycle: string[];
  let verdicts: boolean[];

  async function render(payload: HealthMetricsTrainingEnrollment | Error = enrollment()): Promise<void> {
    getTrainingEnrollment = vi.fn().mockReturnValue(payload instanceof Error ? throwError(() => payload) : of(payload));

    await TestBed.configureTestingModule({
      imports: [TrainingEnrollComponent],
      providers: [
        HealthMetricsChromeService,
        { provide: AnalyticsService, useValue: { getTrainingEnrollment } },
        { provide: ProjectContextService, useValue: { selectedFoundation } },
        { provide: UserService, useValue: { impersonating: signal(false) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TrainingEnrollComponent);
    fixture.componentInstance.reading.subscribe(() => lifecycle.push('reading'));
    fixture.componentInstance.settled.subscribe((empty) => {
      lifecycle.push('settled');
      verdicts.push(empty);
    });
    await settle();
  }

  async function settle(): Promise<void> {
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

  function metricKeys(): string[] {
    return [...fixture.nativeElement.querySelectorAll('[data-testid$="-label"]')]
      .map((el) => (el as HTMLElement).getAttribute('data-testid') ?? '')
      .filter((id) => id.startsWith('training-enroll-metrics-'))
      .map((id) => id.replace('training-enroll-metrics-', '').replace('-label', ''));
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    selectedFoundation = signal<{ slug: string } | null>({ slug: 'acme' });
    lifecycle = [];
    verdicts = [];
  });

  it('reads every period for the foundation once and settles', async () => {
    await render();

    expect(getTrainingEnrollment).toHaveBeenCalledTimes(1);
    expect(getTrainingEnrollment).toHaveBeenCalledWith({ foundationSlug: 'acme' });
    expect(lifecycle).toEqual(['reading', 'settled']);
    expect(verdicts).toEqual([false]);
    expect(query('training-enroll-loading')).toBeNull();
  });

  it('shows the shared metrics row, Enrollments first, with no change, baseline or by-type list', async () => {
    await render();

    expect(metricKeys()).toEqual(['enrollments', 'certifications', 'revenue']);
    expect(text('training-enroll-metrics-enrollments-value')).toBe('12,000');
    expect(text('training-enroll-metrics-revenue-value')).toBe('$100K');
    expect(query('training-enroll-metrics-enrollments-trend')).toBeNull();
    expect(query('training-enroll-baseline')).toBeNull();
    expect(query('training-enroll-by-type')).toBeNull();
  });

  it('charts enrollments by type over six years under its sub-heading, with a screen-reader table', async () => {
    await render();

    expect(text('training-enroll-trend-heading')).toBe('Enrollments by type over the years');
    expect(fixture.nativeElement.querySelectorAll('[data-testid^="training-enroll-chart-column-"]')).toHaveLength(6);
    expect(query(`training-enroll-chart-column-${currentYear}`)?.getAttribute('aria-label')).toContain(`${currentYear} YTD · 4,000 enrollments`);
    const headers = [...(query('training-enroll-table')?.querySelectorAll('thead th') ?? [])].map((th) => th.textContent?.trim());
    expect(headers).toEqual(['Year', 'Certification exams', 'Microcourses', 'Instructor-led', 'Other', 'Total']);
  });

  it('follows the header switch to Revenue: the figure leads the row and the chart shows revenue', async () => {
    await render();

    fixture.componentRef.setInput('metric', 'revenue');
    await settle();

    expect(metricKeys()).toEqual(['revenue', 'enrollments', 'certifications']);
    expect(text('training-enroll-trend-heading')).toBe('Revenue by type over the years');
    expect(getTrainingEnrollment).toHaveBeenCalledTimes(1);
  });

  it('re-projects and re-settles a period change from the one read', async () => {
    const payload = enrollment();
    payload.periods.COMPLETED_YEAR = { ...PERIOD, totals: { enrollments: 15000, certifications: 400, revenueUsd: 90000 }, change: null };
    await render(payload);
    lifecycle = [];

    TestBed.inject(HealthMetricsChromeService).selectedRange.set('COMPLETED_YEAR');
    await settle();

    expect(getTrainingEnrollment).toHaveBeenCalledTimes(1);
    // Whether the period has anything to show moves with it, so it settles again without a read.
    expect(lifecycle).toEqual(['settled']);
    expect(verdicts).toEqual([false, false]);
    expect(text('training-enroll-metrics-enrollments-value')).toBe('15,000');
  });

  it('settles empty, with no body, when the foundation has no summary row', async () => {
    await render(HEALTH_METRICS_TRAINING_ENROLLMENT_UNMEASURED);

    expect(lifecycle).toEqual(['reading', 'settled']);
    expect(verdicts).toEqual([true]);
    expect(query('training-enroll-metrics')).toBeNull();
  });

  it('keeps the body for a period that only certified, with no enrollment or revenue', async () => {
    await render(enrollment({}, { totals: { enrollments: 0, certifications: 40, revenueUsd: 0 } }));

    expect(verdicts).toEqual([false]);
    expect(text('training-enroll-metrics-certifications-value')).toBe('40');
  });

  it('shows the error state and still settles when the read fails', async () => {
    await render(new Error('boom'));

    expect(query('training-enroll-error')).not.toBeNull();
    expect(lifecycle).toEqual(['reading', 'settled']);
    expect(verdicts).toEqual([false]);
  });

  it('holds the skeleton without reading or settling until a foundation is selected', async () => {
    selectedFoundation.set(null);
    await render();

    expect(getTrainingEnrollment).not.toHaveBeenCalled();
    expect(query('training-enroll-loading')).not.toBeNull();
    expect(lifecycle).toEqual(['reading']);
  });
});
