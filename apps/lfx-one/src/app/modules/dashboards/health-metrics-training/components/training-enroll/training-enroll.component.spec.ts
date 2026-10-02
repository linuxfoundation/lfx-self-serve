// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ChartComponent } from '@components/chart/chart.component';
import { HEALTH_METRICS_TRAINING_ENROLLMENT_UNMEASURED } from '@lfx-one/shared/constants';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

import { TrainingEnrollComponent } from './training-enroll.component';

import type { ChartData } from 'chart.js';
import type { HealthMetricsTrainingEnrollment } from '@lfx-one/shared/interfaces';

/** Chart.js needs a canvas jsdom does not have; the stub only records the datasets it is handed. */
@Component({ selector: 'lfx-chart', template: '<div data-testid="chart-stub"></div>' })
class ChartStubComponent {
  public readonly type = input<string>('');
  public readonly data = input<ChartData<'bar'> | null>(null);
  public readonly options = input<unknown>({});
  public readonly height = input<string>('');
}

const currentYear = new Date().getFullYear();

function enrollment(overrides: Partial<HealthMetricsTrainingEnrollment> = {}): HealthMetricsTrainingEnrollment {
  return {
    measured: true,
    totals: { enrollments: 12000, certifications: 300, revenueUsd: 100000 },
    baseline: { enrollments: 10000, certifications: 300, revenueUsd: 125000 },
    byType: [
      { deliveryType: 'E-Learning', enrollments: 9000, revenueUsd: 30000 },
      { deliveryType: 'Certification Exam', enrollments: 3000, revenueUsd: 70000 },
    ],
    trend: [
      { year: currentYear, enrollments: 4000 },
      { year: currentYear - 1, enrollments: 8000 },
    ],
    ...overrides,
  };
}

describe('TrainingEnrollComponent', () => {
  let fixture: ComponentFixture<TrainingEnrollComponent>;
  let getTrainingEnrollment: ReturnType<typeof vi.fn>;
  let selectedFoundation: ReturnType<typeof signal<{ slug: string } | null>>;
  let lifecycle: string[];

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
    })
      .overrideComponent(TrainingEnrollComponent, { remove: { imports: [ChartComponent] }, add: { imports: [ChartStubComponent] } })
      .compileComponents();

    fixture = TestBed.createComponent(TrainingEnrollComponent);
    fixture.componentInstance.reading.subscribe(() => lifecycle.push('reading'));
    fixture.componentInstance.settled.subscribe(() => lifecycle.push('settled'));
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

  function chartData(): ChartData<'bar'> {
    const chart = fixture.debugElement.query(By.directive(ChartStubComponent)).componentInstance as ChartStubComponent;
    return chart.data() as ChartData<'bar'>;
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    selectedFoundation = signal<{ slug: string } | null>({ slug: 'acme' });
    lifecycle = [];
  });

  it('reads the foundation for the period and settles', async () => {
    await render();

    expect(getTrainingEnrollment).toHaveBeenCalledTimes(1);
    expect(getTrainingEnrollment).toHaveBeenCalledWith({ foundationSlug: 'acme', range: 'YTD' });
    expect(lifecycle).toEqual(['reading', 'settled']);
    expect(query('training-enroll-loading')).toBeNull();
  });

  it('renders the headline, side stats and their deltas against the named baseline', async () => {
    await render();

    expect(text('training-enroll-headline-value')).toBe('12,000');
    expect(text('training-enroll-headline-delta')).toBe('+20%');
    expect(query('training-enroll-headline-delta')?.classList).toContain('text-emerald-600');
    expect(text('training-enroll-side-certifications-value')).toBe('300');
    expect(text('training-enroll-side-certifications-delta')).toBe('0%');
    expect(text('training-enroll-side-revenue-value')).toBe('$100K');
    expect(text('training-enroll-side-revenue-delta')).toBe('−20%');
    expect(query('training-enroll-side-revenue-delta')?.classList).toContain('text-red-600');
    expect(text('training-enroll-baseline')).toBe('all against the same point last year');
    expect(text('training-enroll-type-count')).toBe('2 delivery types');
  });

  it('ranks delivery types by enrollments, then by revenue once the toggle flips', async () => {
    await render();

    expect(text('training-enroll-by-type-title')).toBe('Enrollments by type');
    expect(text('training-enroll-type-0')).toContain('eLearning');
    expect(text('training-enroll-type-0-value')).toBe('9,000');
    const bars = fixture.nativeElement.querySelectorAll('[data-testid^="training-enroll-type-"] .bg-blue-600');
    expect((bars[1] as HTMLElement).style.width).toBe(`${(3000 / 9000) * 100}%`);

    (query('filter-pill-revenue') as HTMLButtonElement).click();
    await settle();

    expect(text('training-enroll-by-type-title')).toBe('Revenue by type');
    expect(text('training-enroll-by-type-note')).toBe('highest revenue first');
    expect(text('training-enroll-type-0')).toContain('Certification exams');
    expect(text('training-enroll-type-0-value')).toBe('$70K');
    // The toggle reorders what is already loaded; it never re-reads.
    expect(getTrainingEnrollment).toHaveBeenCalledTimes(1);
  });

  it('charts enrollments per year in order, with the open year drawn lighter', async () => {
    await render();

    const data = chartData();
    expect(data.labels).toEqual([String(currentYear - 1), String(currentYear)]);
    expect(data.datasets[0].data).toEqual([8000, 4000]);
    const colors = data.datasets[0].backgroundColor as string[];
    expect(colors[0]).not.toBe(colors[1]);
    expect(colors[1]).toMatch(/^rgba\(.*0\.4\)$/);
    expect(text('training-enroll-trend-caption')).toBe('thousands per year');
  });

  it('captions a small programme per year and keeps its axis ticks as plain counts', async () => {
    await render(enrollment({ trend: [{ year: currentYear - 1, enrollments: 150 }] }));

    expect(text('training-enroll-trend-caption')).toBe('per year');
    const ticks = fixture.componentInstance['chartOptions'].scales?.['y']?.ticks as { callback: (value: number) => string };
    expect(ticks.callback(50)).toBe('50');
    expect(ticks.callback(2000)).toBe('2K');
  });

  it('says a delta is not available without a baseline, and names why', async () => {
    await render(enrollment({ baseline: null }));

    expect(text('training-enroll-headline-delta')).toBe('not available');
    expect(text('training-enroll-baseline')).toBe('no earlier year to compare against');
  });

  it('re-reads a period change and names the prior year as the baseline', async () => {
    await render();
    lifecycle = [];

    TestBed.inject(HealthMetricsChromeService).selectedRange.set('COMPLETED_YEAR');
    await settle();

    expect(getTrainingEnrollment).toHaveBeenCalledTimes(2);
    expect(getTrainingEnrollment).toHaveBeenLastCalledWith({ foundationSlug: 'acme', range: 'COMPLETED_YEAR' });
    expect(lifecycle).toEqual(['reading', 'settled']);
    expect(text('training-enroll-baseline')).toBe(`all against ${currentYear - 2}`);
  });

  it('shows the not-measured state when the foundation has no summary row', async () => {
    await render(HEALTH_METRICS_TRAINING_ENROLLMENT_UNMEASURED);

    expect(query('training-enroll-unmeasured')).not.toBeNull();
    expect(lifecycle).toEqual(['reading', 'settled']);
  });

  it('shows the error state and still settles when the read fails', async () => {
    await render(new Error('boom'));

    expect(query('training-enroll-error')).not.toBeNull();
    expect(lifecycle).toEqual(['reading', 'settled']);
  });

  it('holds the skeleton without reading or settling until a foundation is selected', async () => {
    selectedFoundation.set(null);
    await render();

    expect(getTrainingEnrollment).not.toHaveBeenCalled();
    expect(query('training-enroll-loading')).not.toBeNull();
    expect(lifecycle).toEqual(['reading']);
  });
});
