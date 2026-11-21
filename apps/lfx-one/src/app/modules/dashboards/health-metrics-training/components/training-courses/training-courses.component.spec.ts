// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { HEALTH_METRICS_TRAINING_COURSES_MAX_SEARCH_LENGTH } from '@lfx-one/shared/constants';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

import { TrainingCoursesComponent } from './training-courses.component';

import type { HealthMetricsTrainingCourse, HealthMetricsTrainingCourses, HealthMetricsTrainingCoursesType } from '@lfx-one/shared/interfaces';

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
  let lifecycle: string[];
  let verdicts: boolean[];

  // `payload` answers the first read; `followUpPayload` every read after it. `type` is the page's header select.
  async function render(
    payload: HealthMetricsTrainingCourses = response(),
    queryParams: Record<string, string> = {},
    followUpPayload?: HealthMetricsTrainingCourses,
    type: HealthMetricsTrainingCoursesType = 'all'
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
    fixture.componentRef.setInput('type', type);
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

  function text(testId: string): string | undefined {
    return query(testId)?.textContent?.replace(/\s+/g, ' ').trim();
  }

  function cell(column: string, key = COURSE_KEY): HTMLElement | null {
    return query(`training-courses-row-${key}-${column}`);
  }

  function cellText(column: string, key = COURSE_KEY): string | undefined {
    return cell(column, key)?.querySelector('[data-testid="health-metrics-cell-text"]')?.textContent?.trim();
  }

  function sortBy(key: string): void {
    (query(`training-courses-sort-${key}`)?.querySelector('button') as HTMLButtonElement).click();
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    selectedFoundation = signal<{ slug: string } | null>({ slug: 'acme' });
    lifecycle = [];
    verdicts = [];
  });

  it('reads the selected foundation and period in the default order, renders the page and settles', async () => {
    await render();

    expect(getTrainingCourses).toHaveBeenCalledWith({ foundationSlug: 'acme', range: 'YTD', type: 'all', search: '', offset: 0, pageSize: 10, sort: null });
    expect(cellText('name')).toBe('Widget Administrator Exam');
    expect(lifecycle).toEqual(['reading', 'settled']);
    expect(verdicts).toEqual([false]);
  });

  it('draws the four columns, with Enrollments marked as the default order', async () => {
    await render();

    const headers = [...(query('training-courses-table')?.querySelectorAll('th') ?? [])].map((th) => th.textContent?.trim());
    expect(headers).toEqual(['Course', 'Type', 'Enrollments', 'Revenue']);
    expect(query('training-courses-sort-enrollments')?.parentElement?.getAttribute('aria-sort')).toBe('descending');
  });

  it('renders a course the way the design draws it', async () => {
    await render();

    const type = cell('type');
    expect(type?.textContent?.trim()).toBe('Certification');
    expect(type?.classList).toContain('bg-blue-50');
    expect(type?.querySelector('i')?.className).toContain('fa-award');
    expect(cellText('enrollments')).toBe('1,204');
    expect(cellText('revenue')).toBe('$45K');
    expect(cell('revenue')?.querySelector('[data-testid="health-metrics-cell-text"]')?.className).not.toContain('text-gray-500');
  });

  it('reads a free course as Free in muted ink, and uncaptured revenue as a muted dash', async () => {
    await render(
      response({
        rows: [
          course({ courseKey: 'free-1', deliveryType: 'E-Learning', isFree: true, revenueUsd: null }),
          course({ courseKey: 'edx-1', deliveryType: 'edX', isFree: null, hasPurchaseCoverage: false, revenueUsd: null }),
        ],
        totalRecords: 2,
      })
    );

    expect(cellText('revenue', 'free-1')).toBe('Free');
    expect(cell('revenue', 'free-1')?.querySelector('[data-testid="health-metrics-cell-text"]')?.className).toContain('text-gray-500');
    expect(cellText('revenue', 'edx-1')).toBe('—');
    expect(cell('revenue', 'edx-1')?.querySelector('[data-testid="health-metrics-cell-text"]')?.className).toContain('text-gray-400');
    expect(cell('type', 'free-1')?.textContent?.trim()).toBe('eLearning');
    expect(cell('type', 'free-1')?.querySelector('i')?.className).toContain('fa-laptop');
  });

  it('searches courses from a box that fills the row, with no count line, pills or rows-per-page choice', async () => {
    await render(response({ totalRecords: 80, scopeTotal: 80 }));

    const input = query('training-courses-search')?.querySelector('input');
    expect(query('training-courses-search')?.classList).toContain('w-full');
    expect(input?.placeholder).toBe('Search course…');
    expect(input?.maxLength).toBe(HEALTH_METRICS_TRAINING_COURSES_MAX_SEARCH_LENGTH);
    expect(query('training-courses-count')).toBeNull();
    expect(query('training-courses-types')).toBeNull();
    expect(fixture.nativeElement.querySelector('lfx-ui-pagination')).not.toBeNull();
  });

  it('re-reads from page 1 when the type changes, and writes it to the URL with the fragment kept', async () => {
    await render(response({ totalRecords: 80, scopeTotal: 80 }), { trnPage: '3' });
    getTrainingCourses.mockClear();

    fixture.componentRef.setInput('type', 'instructor-led');
    await settle();

    expect(getTrainingCourses).toHaveBeenCalledWith(expect.objectContaining({ type: 'instructor-led', offset: 0 }));
    expect(navigate).toHaveBeenLastCalledWith(
      [],
      expect.objectContaining({ queryParams: { trnType: 'instructor-led', trnSearch: null, trnPage: null }, preserveFragment: true, replaceUrl: true })
    );
  });

  it('sorts on the server from page 1, keeping the search and type', async () => {
    await render(response({ totalRecords: 80, scopeTotal: 80 }), { trnPage: '3', trnSearch: 'widget' }, undefined, 'certification');
    getTrainingCourses.mockClear();

    sortBy('revenue');
    await settle();
    expect(getTrainingCourses).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'certification', search: 'widget', offset: 0, sort: { key: 'revenue', direction: 'desc' } })
    );

    sortBy('course');
    await settle();
    expect(getTrainingCourses).toHaveBeenLastCalledWith(expect.objectContaining({ sort: { key: 'course', direction: 'asc' } }));
  });

  it('reverses the default on Enrollments, and returns to the default order a click later', async () => {
    await render(response({ totalRecords: 80, scopeTotal: 80 }));

    sortBy('enrollments');
    await settle();
    expect(getTrainingCourses).toHaveBeenLastCalledWith(expect.objectContaining({ sort: { key: 'enrollments', direction: 'asc' } }));

    sortBy('enrollments');
    await settle();
    expect(getTrainingCourses).toHaveBeenLastCalledWith(expect.objectContaining({ sort: null }));
  });

  it('re-reads a debounced, trimmed search from page 1', async () => {
    await render(response({ totalRecords: 80, scopeTotal: 80 }), { trnPage: '2' });
    getTrainingCourses.mockClear();

    fixture.componentInstance['searchText'].set('  widget ');
    await new Promise((resolve) => setTimeout(resolve, 250));
    await settle();

    expect(getTrainingCourses).toHaveBeenCalledTimes(1);
    expect(getTrainingCourses).toHaveBeenCalledWith(expect.objectContaining({ search: 'widget', offset: 0 }));
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { trnType: null, trnSearch: 'widget', trnPage: null } }));
  });

  it('pages through the table and writes the 1-based page to the URL', async () => {
    await render(response({ totalRecords: 80, scopeTotal: 80 }));
    getTrainingCourses.mockClear();

    fixture.componentInstance['page'].set(2);
    await settle();

    expect(getTrainingCourses).toHaveBeenCalledWith(expect.objectContaining({ offset: 20, pageSize: 10 }));
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { trnType: null, trnSearch: null, trnPage: 3 } }));
  });

  it('starts on the search and page the URL carries, in one read', async () => {
    await render(response({ totalRecords: 80, scopeTotal: 80 }), { trnSearch: 'widget', trnPage: '2' }, undefined, 'elearning');

    expect(getTrainingCourses).toHaveBeenCalledTimes(1);
    expect(getTrainingCourses).toHaveBeenCalledWith(expect.objectContaining({ type: 'elearning', search: 'widget', offset: 10 }));
    expect(query('training-courses-search')?.querySelector('input')?.value).toBe('widget');
  });

  it.each(['-2', '0.5', 'two'])('falls back to the first page for the URL page %s', async (trnPage) => {
    await render(response(), { trnPage });

    expect(getTrainingCourses).toHaveBeenCalledWith(expect.objectContaining({ offset: 0 }));
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

    expect(getTrainingCourses).toHaveBeenNthCalledWith(1, expect.objectContaining({ offset: 80 }));
    expect(getTrainingCourses).toHaveBeenNthCalledWith(2, expect.objectContaining({ offset: 30 }));
    expect(getTrainingCourses).toHaveBeenCalledTimes(2);
    expect(lifecycle).toEqual(['reading', 'reading', 'settled']);
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { trnType: null, trnSearch: null, trnPage: 4 } }));
  });

  it('settles empty, with no body, when the period has no course with enrollments', async () => {
    await render(response({ rows: [], totalRecords: 0, scopeTotal: 0 }));

    expect(verdicts).toEqual([true]);
    expect(query('training-courses-table')).toBeNull();
    expect(query('training-courses-search')).toBeNull();
  });

  // The scope total counts every year, so an unfiltered period read with no row is still an empty period.
  it('settles empty, with no body, when the unfiltered period has no course though other years do', async () => {
    await render(response({ rows: [], totalRecords: 0, scopeTotal: 40 }));

    expect(verdicts).toEqual([true]);
    expect(query('training-courses-table')).toBeNull();
  });

  it('settles empty when the first unfiltered page holds courses from other years with nothing in this period', async () => {
    await render(response({ rows: [course({ enrollments: 0, revenueUsd: null })], totalRecords: 1, scopeTotal: 1 }));

    expect(verdicts).toEqual([true]);
    expect(query('training-courses-table')).toBeNull();
  });

  it('keeps the search when a cut matches nothing, and Reset filters clears the search, type and page, not the sort', async () => {
    const noMatch = response({ rows: [], totalRecords: 0, scopeTotal: 40 });
    await render(response({ totalRecords: 40, scopeTotal: 40 }), { trnSearch: 'zeta', trnPage: '2' }, noMatch, 'certification');
    sortBy('course');
    await settle();

    expect(text('training-courses-no-match')).toContain('No matching courses');
    expect(text('training-courses-no-match')).toContain('No course matches this search or filter.');
    expect(query('training-courses-search')).not.toBeNull();
    // A filter miss is not an empty period, so the shell must not take the section over.
    expect(verdicts.every((empty) => !empty)).toBe(true);

    getTrainingCourses.mockClear();
    (query('training-courses-no-match')?.querySelector('[data-testid="empty-state-reset-filters"]') as HTMLElement).click();
    await settle();

    expect(fixture.componentInstance.type()).toBe('all');
    expect(getTrainingCourses).toHaveBeenCalledTimes(1);
    expect(getTrainingCourses).toHaveBeenCalledWith(expect.objectContaining({ type: 'all', search: '', offset: 0, sort: { key: 'course', direction: 'asc' } }));
  });

  // A failed read must not render copy that asserts the foundation had no courses.
  it('separates a failed read from an empty one, settling it', async () => {
    await render();
    lifecycle.length = 0;
    getTrainingCourses.mockReturnValue(throwError(() => new Error('gateway timeout')));

    sortBy('course');
    await settle();

    expect(query('training-courses-error')).not.toBeNull();
    expect(lifecycle).toEqual(['reading', 'settled']);
    expect(verdicts).toEqual([false, false]);
  });

  it('holds the loading state and reads nothing while no foundation is selected', async () => {
    selectedFoundation.set(null);
    await render();

    expect(getTrainingCourses).not.toHaveBeenCalled();
    expect(lifecycle).not.toContain('settled');
  });
});
