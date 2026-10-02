// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

import { TrainingCoursesComponent } from './training-courses.component';

import type { HealthMetricsTrainingCourse, HealthMetricsTrainingCourses } from '@lfx-one/shared/interfaces';

const COURSE_KEY = 'course-1';

function course(overrides: Partial<HealthMetricsTrainingCourse> = {}): HealthMetricsTrainingCourse {
  return {
    courseKey: COURSE_KEY,
    courseName: 'Widget Administrator Exam',
    deliveryType: 'Certification Exam',
    isFree: false,
    hasPurchaseCoverage: true,
    enrollments: 1204,
    revenueUsd: 45000,
    ...overrides,
  };
}

function response(overrides: Partial<HealthMetricsTrainingCourses> = {}): HealthMetricsTrainingCourses {
  return { rows: [course()], totalRecords: 1, scopeTotal: 1, ...overrides };
}

describe('TrainingCoursesComponent', () => {
  let fixture: ComponentFixture<TrainingCoursesComponent>;
  let getTrainingCourses: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;
  let selectedFoundation: ReturnType<typeof signal<{ slug: string } | null>>;
  let counts: (number | null)[];
  let lifecycle: string[];

  // `payload` answers the first read; `followUpPayload` every read after it.
  async function render(
    payload: HealthMetricsTrainingCourses = response(),
    queryParams: Record<string, string> = {},
    followUpPayload?: HealthMetricsTrainingCourses
  ): Promise<void> {
    getTrainingCourses = vi
      .fn()
      .mockReturnValue(of(followUpPayload ?? payload))
      .mockReturnValueOnce(of(payload));
    navigate = vi.spyOn(Router.prototype, 'navigate').mockResolvedValue(true) as unknown as ReturnType<typeof vi.fn>;

    await TestBed.configureTestingModule({
      imports: [TrainingCoursesComponent],
      providers: [
        provideRouter([]),
        HealthMetricsChromeService,
        { provide: UserService, useValue: { impersonating: signal(false) } },
        { provide: AnalyticsService, useValue: { getTrainingCourses } },
        { provide: ProjectContextService, useValue: { selectedFoundation } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(queryParams) } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TrainingCoursesComponent);
    fixture.componentInstance.countChange.subscribe((count) => counts.push(count));
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

  beforeEach(() => {
    vi.restoreAllMocks();
    selectedFoundation = signal<{ slug: string } | null>({ slug: 'acme' });
    counts = [];
    lifecycle = [];
  });

  it('reads the selected foundation and period, renders the page, and settles', async () => {
    await render();

    expect(getTrainingCourses).toHaveBeenCalledWith({ foundationSlug: 'acme', range: 'YTD', type: 'all', search: '', offset: 0, pageSize: 25 });
    expect(query(`training-courses-row-${COURSE_KEY}-name`)?.textContent?.trim()).toBe('Widget Administrator Exam');
    expect(query(`training-courses-row-${COURSE_KEY}-type`)?.textContent?.trim()).toBe('Certification');
    expect(query(`training-courses-row-${COURSE_KEY}-enrollments`)?.textContent?.trim()).toBe('1,204');
    expect(query(`training-courses-row-${COURSE_KEY}-revenue`)?.textContent?.trim()).toBe('$45K');
    expect(query('training-courses-count')?.textContent?.trim()).toBe('1 course');
    expect(lifecycle).toEqual(['reading', 'settled']);
  });

  it('emits the in-scope total for the sub-nav badge, not the filtered count', async () => {
    await render(response({ totalRecords: 12, scopeTotal: 340 }));

    expect(counts).toEqual([null, 340]);
  });

  it('reads free courses as free and uncaptured revenue as not available, both muted', async () => {
    await render(
      response({
        rows: [
          course({ courseKey: 'free-1', deliveryType: 'E-Learning', isFree: true, revenueUsd: null }),
          course({ courseKey: 'edx-1', deliveryType: 'edX', isFree: null, hasPurchaseCoverage: false, revenueUsd: null }),
        ],
        totalRecords: 2,
      })
    );

    const free = query('training-courses-row-free-1-revenue');
    const edx = query('training-courses-row-edx-1-revenue');
    expect(free?.textContent?.trim()).toBe('free');
    expect(edx?.textContent?.trim()).toBe('not available');
    expect(free?.classList).toContain('text-gray-400');
    expect(edx?.classList).toContain('text-gray-400');
    expect(query(`training-courses-row-free-1-type`)?.textContent?.trim()).toBe('eLearning');
  });

  it('re-reads from page 1 when the type changes, and writes it to the URL with the fragment kept', async () => {
    await render(response({ totalRecords: 80, scopeTotal: 80 }), { trnPage: '3' });
    getTrainingCourses.mockClear();

    fixture.componentInstance['onTypeChange']('certifications');
    await settle();

    expect(getTrainingCourses).toHaveBeenCalledWith(expect.objectContaining({ type: 'certifications', offset: 0 }));
    expect(navigate).toHaveBeenLastCalledWith(
      [],
      expect.objectContaining({ queryParams: { trnType: 'certifications', trnSearch: null, trnPage: null }, preserveFragment: true, replaceUrl: true })
    );
  });

  it('re-reads a debounced, trimmed search from page 1', async () => {
    await render(response({ totalRecords: 80, scopeTotal: 80 }), { trnPage: '2' });
    getTrainingCourses.mockClear();

    fixture.componentInstance['searchForm'].controls.search.setValue('  widget ');
    await new Promise((resolve) => setTimeout(resolve, 250));
    await settle();

    expect(getTrainingCourses).toHaveBeenCalledTimes(1);
    expect(getTrainingCourses).toHaveBeenCalledWith(expect.objectContaining({ search: 'widget', offset: 0 }));
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { trnType: null, trnSearch: 'widget', trnPage: null } }));
  });

  it('pages through the table and writes the page to the URL', async () => {
    await render(response({ totalRecords: 80, scopeTotal: 80 }));
    getTrainingCourses.mockClear();

    fixture.componentInstance['onTablePage']({ first: 50, rows: 25 });
    await settle();

    expect(getTrainingCourses).toHaveBeenCalledWith(expect.objectContaining({ offset: 50, pageSize: 25 }));
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { trnType: null, trnSearch: null, trnPage: 3 } }));
  });

  it('starts on the type, search and page the URL carries', async () => {
    await render(response({ totalRecords: 80, scopeTotal: 80 }), { trnType: 'elearning', trnSearch: 'widget', trnPage: '2' });

    expect(getTrainingCourses).toHaveBeenCalledWith(expect.objectContaining({ type: 'elearning', search: 'widget', offset: 25 }));
    expect((fixture.nativeElement.querySelector('#training-courses-search') as HTMLInputElement).value).toBe('widget');
  });

  it('falls back to the defaults for URL values it cannot honour', async () => {
    await render(response(), { trnType: 'bundles', trnPage: '-2' });

    expect(getTrainingCourses).toHaveBeenCalledWith(expect.objectContaining({ type: 'all', offset: 0 }));
  });

  it('re-reads from page 1 when the period changes', async () => {
    await render(response({ totalRecords: 80, scopeTotal: 80 }), { trnPage: '3' });
    getTrainingCourses.mockClear();

    TestBed.inject(HealthMetricsChromeService).selectedRange.set('COMPLETED_YEAR');
    await settle();

    expect(getTrainingCourses).toHaveBeenCalledWith(expect.objectContaining({ range: 'COMPLETED_YEAR', offset: 0 }));
  });

  it('re-reads from page 1 for a newly selected foundation', async () => {
    await render(response({ totalRecords: 80, scopeTotal: 80 }), { trnPage: '3' });
    getTrainingCourses.mockClear();

    selectedFoundation.set({ slug: 'beta' });
    await settle();

    expect(getTrainingCourses).toHaveBeenCalledWith(expect.objectContaining({ foundationSlug: 'beta', offset: 0 }));
  });

  // The totals join still reports the real count past the end, so the page must move back.
  it('lands on the last page holding rows, settling once and rewriting the URL', async () => {
    await render(response({ rows: [], totalRecords: 34, scopeTotal: 34 }), { trnPage: '9' }, response({ totalRecords: 34, scopeTotal: 34 }));

    expect(getTrainingCourses).toHaveBeenNthCalledWith(1, expect.objectContaining({ offset: 200 }));
    expect(getTrainingCourses).toHaveBeenNthCalledWith(2, expect.objectContaining({ offset: 25 }));
    expect(getTrainingCourses).toHaveBeenCalledTimes(2);
    expect(lifecycle).toEqual(['reading', 'reading', 'settled']);
    expect(counts).toEqual([null, null, 34]);
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { trnType: null, trnSearch: null, trnPage: 2 } }));
  });

  it('shows the no-enrollment state when the period has no course with enrollments', async () => {
    await render(response({ rows: [], totalRecords: 0, scopeTotal: 0 }));

    expect(query('training-courses-empty')).not.toBeNull();
    expect(query('training-courses-table')).toBeNull();
    expect(query('training-courses-search')).toBeNull();
  });

  it('keeps the controls and shows the no-match state when a filter matches nothing', async () => {
    await render(response({ rows: [], totalRecords: 0, scopeTotal: 40 }));

    expect(query('training-courses-no-match')).not.toBeNull();
    expect(query('training-courses-controls')).not.toBeNull();
    expect(query('training-courses-empty')).toBeNull();
  });

  // A failed read must not render copy that asserts the foundation had no courses.
  it('separates a failed read from an empty one, settling it without a count', async () => {
    await render();
    counts.length = 0;
    lifecycle.length = 0;
    getTrainingCourses.mockReturnValue(throwError(() => new Error('gateway timeout')));

    fixture.componentInstance['onTypeChange']('certifications');
    await settle();

    expect(query('training-courses-error')).not.toBeNull();
    expect(query('training-courses-empty')).toBeNull();
    expect(counts).toEqual([null, null]);
    expect(lifecycle).toEqual(['reading', 'settled']);
  });

  it('holds the loading state and reads nothing while no foundation is selected', async () => {
    selectedFoundation.set(null);
    await render();

    expect(getTrainingCourses).not.toHaveBeenCalled();
    expect(counts.every((count) => count === null)).toBe(true);
    expect(lifecycle).not.toContain('settled');
    expect(query('training-courses-count')?.textContent?.trim()).toBe('—');
    expect(query('training-courses-empty')).toBeNull();
  });
});
