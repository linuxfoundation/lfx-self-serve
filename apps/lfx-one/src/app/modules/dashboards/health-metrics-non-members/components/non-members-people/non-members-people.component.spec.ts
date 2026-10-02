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

import { NonMembersPeopleComponent } from './non-members-people.component';

import type { HealthMetricsNonMembersPeople, HealthMetricsNonMembersPerson } from '@lfx-one/shared/interfaces';

const ROW_KEY = '1';

function person(overrides: Partial<HealthMetricsNonMembersPerson> = {}): HealthMetricsNonMembersPerson {
  return {
    rowKey: ROW_KEY,
    displayName: 'Jane Doe',
    jobTitle: 'Staff Engineer',
    accountId: '0014100000AcmeAAAA',
    accountName: 'Acme Motors',
    lastAttendedDate: '2026-03-14',
    meetingsAttended: 42,
    ...overrides,
  };
}

function response(overrides: Partial<HealthMetricsNonMembersPeople> = {}): HealthMetricsNonMembersPeople {
  return { rows: [person()], totalRecords: 1, scopeTotal: 1, ...overrides };
}

describe('NonMembersPeopleComponent', () => {
  let fixture: ComponentFixture<NonMembersPeopleComponent>;
  let getNonMembersPeople: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;
  let selectedFoundation: ReturnType<typeof signal<{ slug: string } | null>>;
  let counts: (number | null)[];
  let lifecycle: string[];

  // `payload` answers the first read; `followUpPayload` every read after it.
  async function render(
    payload: HealthMetricsNonMembersPeople = response(),
    queryParams: Record<string, string> = {},
    followUpPayload?: HealthMetricsNonMembersPeople
  ): Promise<void> {
    getNonMembersPeople = vi
      .fn()
      .mockReturnValue(of(followUpPayload ?? payload))
      .mockReturnValueOnce(of(payload));
    navigate = vi.spyOn(Router.prototype, 'navigate').mockResolvedValue(true) as unknown as ReturnType<typeof vi.fn>;

    await TestBed.configureTestingModule({
      imports: [NonMembersPeopleComponent],
      providers: [
        provideRouter([]),
        HealthMetricsChromeService,
        { provide: UserService, useValue: { impersonating: signal(false) } },
        { provide: AnalyticsService, useValue: { getNonMembersPeople } },
        { provide: ProjectContextService, useValue: { selectedFoundation } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(queryParams) } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(NonMembersPeopleComponent);
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

  function text(testId: string): string | undefined {
    return query(testId)?.textContent?.replace(/\s+/g, ' ').trim();
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    selectedFoundation = signal<{ slug: string } | null>({ slug: 'acme' });
    counts = [];
    lifecycle = [];
  });

  it('reads the selected foundation and period, renders the page, count and note, and settles', async () => {
    await render(response({ totalRecords: 388, scopeTotal: 388 }));

    expect(getNonMembersPeople).toHaveBeenCalledWith({ foundationSlug: 'acme', range: 'YTD', search: '', offset: 0, pageSize: 10 });
    expect(text(`non-members-people-row-${ROW_KEY}-name`)).toBe('Jane Doe');
    expect(text('non-members-people-count')).toBe('388 engaged individuals');
    expect(text('non-members-people-provisional')).toContain('provisional');
    expect(lifecycle).toEqual(['reading', 'settled']);
    expect(counts).toEqual([null, 388]);
  });

  it('renders a person row with title, organization, meetings and last attended', async () => {
    await render();
    const cell = (key: string) => text(`non-members-people-row-${ROW_KEY}-${key}`);

    expect(cell('title')).toBe('Staff Engineer');
    expect(cell('organization')).toBe('Acme Motors');
    expect(cell('meetings')).toBe('42');
    expect(cell('last-attended')).toBe('Mar 14, 2026');
  });

  it('omits the title line when a person has none', async () => {
    await render(response({ rows: [person({ jobTitle: null })] }));

    expect(query(`non-members-people-row-${ROW_KEY}-title`)).toBeNull();
    expect(text(`non-members-people-row-${ROW_KEY}-name`)).toBe('Jane Doe');
  });

  it('shows no contact details and renders rows as plain text, not links', async () => {
    await render();
    const row = query(`non-members-people-row-${ROW_KEY}`);

    expect(row?.querySelector('a')).toBeNull();
    expect(row?.textContent).not.toMatch(/@/);
  });

  it('caps the search box at the length the read honours and marks Last attended as all time', async () => {
    await render();
    const headers = [...(fixture.nativeElement as HTMLElement).querySelectorAll('th')].map((th) => th.textContent?.trim());
    const input = fixture.nativeElement.querySelector('#non-members-people-search') as HTMLInputElement;

    expect(input.maxLength).toBe(100);
    expect(input.placeholder).toBe('Search person or organization…');
    expect(headers).toEqual(['Person', 'Organization', 'Meetings attended', 'Last attended (all time)']);
  });

  it('re-reads a debounced, trimmed search from page 1 and writes it to the URL with the fragment kept', async () => {
    await render(response({ totalRecords: 80, scopeTotal: 80 }), { nonPeoplePage: '2' });
    getNonMembersPeople.mockClear();

    fixture.componentInstance['searchForm'].controls.search.setValue('  jane ');
    await new Promise((resolve) => setTimeout(resolve, 250));
    await settle();

    expect(getNonMembersPeople).toHaveBeenCalledTimes(1);
    expect(getNonMembersPeople).toHaveBeenCalledWith(expect.objectContaining({ search: 'jane', offset: 0 }));
    expect(navigate).toHaveBeenLastCalledWith(
      [],
      expect.objectContaining({
        queryParams: { nonPeopleSearch: 'jane', nonPeoplePage: null },
        queryParamsHandling: 'merge',
        preserveFragment: true,
        replaceUrl: true,
      })
    );
  });

  it('shows the matched count with a clear link that resets the search in one read', async () => {
    await render(response({ totalRecords: 3, scopeTotal: 388 }), { nonPeopleSearch: 'jane' });

    expect(text('non-members-people-count')).toBe('3 of 388 engaged individuals match · clear');

    getNonMembersPeople.mockClear();
    query('non-members-people-clear')?.click();
    await settle();
    await new Promise((resolve) => setTimeout(resolve, 250));
    await settle();

    expect(getNonMembersPeople).toHaveBeenCalledTimes(1);
    expect(getNonMembersPeople).toHaveBeenLastCalledWith(expect.objectContaining({ search: '' }));
  });

  it('keeps the matched count singular when one individual is in scope', async () => {
    await render(response({ totalRecords: 1, scopeTotal: 1 }), { nonPeopleSearch: 'jane' });

    expect(text('non-members-people-count')).toBe('1 of 1 engaged individual match · clear');
  });

  it('keeps the sub-nav count through page turns and searches, blanking it only for a new period', async () => {
    await render(response({ totalRecords: 80, scopeTotal: 80 }));
    counts.length = 0;

    fixture.componentInstance['onTablePage']({ first: 10, rows: 10 });
    await settle();
    expect(counts.every((count) => count === 80)).toBe(true);

    TestBed.inject(HealthMetricsChromeService).selectedRange.set('COMPLETED_YEAR');
    await settle();
    expect(counts.at(-2)).toBeNull();
    expect(counts.at(-1)).toBe(80);
  });

  it('pages through the table, including a new page size, and writes the page to the URL', async () => {
    await render(response({ totalRecords: 80, scopeTotal: 80 }));
    getNonMembersPeople.mockClear();

    fixture.componentInstance['onTablePage']({ first: 50, rows: 25 });
    await settle();

    expect(getNonMembersPeople).toHaveBeenCalledWith(expect.objectContaining({ offset: 50, pageSize: 25 }));
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { nonPeopleSearch: null, nonPeoplePage: 3 } }));
  });

  it('starts on the search and page the URL carries', async () => {
    await render(response({ totalRecords: 80, scopeTotal: 80 }), { nonPeopleSearch: 'jane', nonPeoplePage: '2' });

    expect(getNonMembersPeople).toHaveBeenCalledWith(expect.objectContaining({ search: 'jane', offset: 10 }));
    expect((fixture.nativeElement.querySelector('#non-members-people-search') as HTMLInputElement).value).toBe('jane');
  });

  it('falls back to page 1 for a page the URL cannot honour', async () => {
    await render(response(), { nonPeoplePage: '-2' });

    expect(getNonMembersPeople).toHaveBeenCalledWith(expect.objectContaining({ offset: 0 }));
  });

  it('re-reads from page 1 when the period changes', async () => {
    await render(response({ totalRecords: 80, scopeTotal: 80 }), { nonPeoplePage: '3' });
    getNonMembersPeople.mockClear();

    TestBed.inject(HealthMetricsChromeService).selectedRange.set('COMPLETED_YEAR');
    await settle();

    expect(getNonMembersPeople).toHaveBeenCalledWith(expect.objectContaining({ range: 'COMPLETED_YEAR', offset: 0 }));
  });

  it('re-reads from page 1 for a newly selected foundation', async () => {
    await render(response({ totalRecords: 80, scopeTotal: 80 }), { nonPeoplePage: '3' });
    getNonMembersPeople.mockClear();

    selectedFoundation.set({ slug: 'beta' });
    await settle();

    expect(getNonMembersPeople).toHaveBeenCalledWith(expect.objectContaining({ foundationSlug: 'beta', offset: 0 }));
  });

  // The totals join still reports the real count past the end, so the page must move back.
  it('lands on the last page holding rows, settling once and rewriting the URL', async () => {
    await render(response({ rows: [], totalRecords: 34, scopeTotal: 34 }), { nonPeoplePage: '9' }, response({ totalRecords: 34, scopeTotal: 34 }));

    expect(getNonMembersPeople).toHaveBeenNthCalledWith(1, expect.objectContaining({ offset: 80 }));
    expect(getNonMembersPeople).toHaveBeenNthCalledWith(2, expect.objectContaining({ offset: 30 }));
    expect(getNonMembersPeople).toHaveBeenCalledTimes(2);
    expect(lifecycle).toEqual(['reading', 'reading', 'settled']);
    expect(counts).toEqual([null, 34]);
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { nonPeopleSearch: null, nonPeoplePage: 4 } }));
  });

  it('shows the empty state when no non-member individual attended in the period', async () => {
    await render(response({ rows: [], totalRecords: 0, scopeTotal: 0 }));

    expect(query('non-members-people-empty')).not.toBeNull();
    expect(query('non-members-people-table')).toBeNull();
  });

  it('keeps the controls and names the search when it matches nothing', async () => {
    await render(response({ rows: [], totalRecords: 0, scopeTotal: 40 }), { nonPeopleSearch: 'zeta' });

    expect(text('non-members-people-no-match')).toBe('No person or organization matches “zeta”.');
    expect(query('non-members-people-controls')).not.toBeNull();
  });

  // A failed read must not render copy that asserts the foundation had no engaged individuals.
  it('separates a failed read from an empty one, settling it without a count', async () => {
    await render(response({ totalRecords: 80, scopeTotal: 80 }));
    counts.length = 0;
    lifecycle.length = 0;
    getNonMembersPeople.mockReturnValue(throwError(() => new Error('gateway timeout')));

    fixture.componentInstance['onTablePage']({ first: 10, rows: 10 });
    await settle();

    expect(query('non-members-people-error')).not.toBeNull();
    expect(query('non-members-people-empty')).toBeNull();
    expect(counts).toEqual([null]);
    expect(lifecycle).toEqual(['reading', 'settled']);
  });

  it('holds the loading state and reads nothing while no foundation is selected', async () => {
    selectedFoundation.set(null);
    await render();

    expect(getNonMembersPeople).not.toHaveBeenCalled();
    expect(counts.every((count) => count === null)).toBe(true);
    expect(lifecycle).not.toContain('settled');
    expect(text('non-members-people-count')).toBe('—');
    expect(query('non-members-people-empty')).toBeNull();
  });
});
