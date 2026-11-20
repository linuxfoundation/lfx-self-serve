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
    logoUrl: 'https://logos.example/acme.png',
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
  let lifecycle: string[];
  let verdicts: boolean[];

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

  function cell(column: string): HTMLElement | null {
    return query(`non-members-people-row-${ROW_KEY}-${column}`);
  }

  function cellText(column: string): string | undefined {
    return cell(column)?.querySelector('[data-testid="health-metrics-cell-text"]')?.textContent?.trim();
  }

  function cellDescription(column: string): string | undefined {
    return cell(column)?.querySelector('[data-testid="health-metrics-cell-description"]')?.textContent?.trim();
  }

  function sortBy(key: string): void {
    (query(`non-members-people-sort-${key}`)?.querySelector('button') as HTMLButtonElement).click();
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    selectedFoundation = signal<{ slug: string } | null>({ slug: 'acme' });
    lifecycle = [];
    verdicts = [];
  });

  it('reads the selected foundation and period in the default order, renders the page and settles', async () => {
    await render(response({ scopeTotal: 214, totalRecords: 214 }));

    expect(getNonMembersPeople).toHaveBeenCalledWith({ foundationSlug: 'acme', range: 'YTD', search: '', offset: 0, pageSize: 10, sort: null });
    expect(cellText('name')).toBe('Jane Doe');
    expect(lifecycle).toEqual(['reading', 'settled']);
    expect(verdicts).toEqual([false]);
  });

  it('draws the four columns, with Meetings attended marked as the default order', async () => {
    await render();

    const headers = [...(query('non-members-people-table')?.querySelectorAll('th') ?? [])].map((th) => th.textContent?.trim());
    expect(headers).toEqual(['Person', 'Company', 'Meetings attended', 'Last attended']);
    expect(query('non-members-people-sort-meetings')?.parentElement?.getAttribute('aria-sort')).toBe('descending');
  });

  it('renders a person the way the design draws it', async () => {
    await render();

    expect(cell('name')?.querySelector('[data-testid="health-metrics-cell-person"]')).not.toBeNull();
    expect(cellDescription('name')).toBe('Staff Engineer');
    expect(cell('company')?.querySelector('[data-testid="health-metrics-cell-company"]')).not.toBeNull();
    expect(cellText('company')).toBe('Acme Motors');
    expect(cellText('meetings')).toBe('42');
    expect(cellText('last-attended')).toBe('Mar 14, 2026');
    expect(cell('last-attended')?.querySelector('[data-testid="health-metrics-cell-text"]')?.className).not.toContain('text-gray-400');
  });

  it('gives a one-word name a single initial', async () => {
    await render(response({ rows: [person({ displayName: 'Jane' })] }));

    expect(cell('name')?.querySelector('[data-testid="health-metrics-cell-person"]')?.textContent?.trim()).toBe('J');
  });

  it('drops the description with no job title, and dashes a person with no company or date, with no logo', async () => {
    await render(response({ rows: [person({ jobTitle: null, accountId: null, accountName: null, lastAttendedDate: null })] }));

    expect(cellDescription('name')).toBeUndefined();
    expect(cellText('company')).toBe('—');
    expect(cell('company')?.querySelector('[data-testid="health-metrics-cell-company"]')).toBeNull();
    expect(cellText('last-attended')).toBe('—');
    expect(cell('last-attended')?.querySelector('[data-testid="health-metrics-cell-text"]')?.className).toContain('text-gray-400');
  });

  it('searches people and companies from a box that fills the row, with no count line or rows-per-page choice', async () => {
    await render(response({ totalRecords: 80, scopeTotal: 80 }));

    const input = query('non-members-people-search')?.querySelector('input');
    expect(query('non-members-people-search')?.classList).toContain('w-full');
    expect(input?.placeholder).toBe('Search person or company…');
    expect(input?.maxLength).toBe(100);
    expect(query('non-members-people-count')).toBeNull();
    expect(fixture.nativeElement.querySelector('lfx-ui-pagination')).not.toBeNull();
  });

  it('sorts on the server from page 1, keeping the search', async () => {
    await render(response({ totalRecords: 80, scopeTotal: 80 }), { nonPeoplePage: '3', nonPeopleSearch: 'acme' });
    getNonMembersPeople.mockClear();

    sortBy('last-attended');
    await settle();
    expect(getNonMembersPeople).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: 'acme', offset: 0, sort: { key: 'lastAttended', direction: 'desc' } })
    );

    sortBy('person');
    await settle();
    expect(getNonMembersPeople).toHaveBeenLastCalledWith(expect.objectContaining({ sort: { key: 'person', direction: 'asc' } }));
  });

  it('reverses the default on Meetings attended, and returns to the default order a click later', async () => {
    await render(response({ totalRecords: 80, scopeTotal: 80 }));

    sortBy('meetings');
    await settle();
    expect(getNonMembersPeople).toHaveBeenLastCalledWith(expect.objectContaining({ sort: { key: 'meetings', direction: 'asc' } }));

    sortBy('meetings');
    await settle();
    expect(getNonMembersPeople).toHaveBeenLastCalledWith(expect.objectContaining({ sort: null }));
  });

  it('re-reads a debounced, trimmed search from page 1, and writes it to the URL with the fragment kept', async () => {
    await render(response({ totalRecords: 80, scopeTotal: 80 }), { nonPeoplePage: '2' });
    getNonMembersPeople.mockClear();

    fixture.componentInstance['searchText'].set('  jane ');
    await new Promise((resolve) => setTimeout(resolve, 250));
    await settle();

    expect(getNonMembersPeople).toHaveBeenCalledTimes(1);
    expect(getNonMembersPeople).toHaveBeenCalledWith(expect.objectContaining({ search: 'jane', offset: 0 }));
    expect(navigate).toHaveBeenLastCalledWith(
      [],
      expect.objectContaining({ queryParams: { nonPeopleSearch: 'jane', nonPeoplePage: null }, preserveFragment: true, replaceUrl: true })
    );
  });

  it('pages through the table and writes the page to the URL', async () => {
    await render(response({ totalRecords: 80, scopeTotal: 80 }));
    getNonMembersPeople.mockClear();

    fixture.componentInstance['page'].set(2);
    await settle();

    expect(getNonMembersPeople).toHaveBeenCalledWith(expect.objectContaining({ offset: 20, pageSize: 10 }));
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { nonPeopleSearch: null, nonPeoplePage: 3 } }));
  });

  it('starts on the search and page the URL carries, in one read', async () => {
    await render(response({ totalRecords: 80, scopeTotal: 80 }), { nonPeopleSearch: 'jane', nonPeoplePage: '2' });

    expect(getNonMembersPeople).toHaveBeenCalledTimes(1);
    expect(getNonMembersPeople).toHaveBeenCalledWith(expect.objectContaining({ search: 'jane', offset: 10 }));
  });

  it('falls back to the first page for a URL page it cannot honour', async () => {
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
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { nonPeopleSearch: null, nonPeoplePage: 4 } }));
  });

  it('settles empty, with no body, when nobody took part in the period', async () => {
    await render(response({ rows: [], totalRecords: 0, scopeTotal: 0 }));

    expect(verdicts).toEqual([true]);
    expect(query('non-members-people-search')).toBeNull();
    expect(query('non-members-people-table')).toBeNull();
  });

  it('keeps the table for an unset total, which is not zero', async () => {
    await render(response({ scopeTotal: null }));

    expect(verdicts).toEqual([false]);
    expect(query('non-members-people-table')).not.toBeNull();
  });

  it('keeps the search when it matches nothing, and Reset filters clears the search and the page, not the sort', async () => {
    const noMatch = response({ rows: [], totalRecords: 0, scopeTotal: 40 });
    await render(response({ totalRecords: 40, scopeTotal: 40 }), { nonPeopleSearch: 'zeta', nonPeoplePage: '2' }, noMatch);
    sortBy('company');
    await settle();

    expect(text('non-members-people-no-match')).toContain('No matching people');
    expect(text('non-members-people-no-match')).toContain('No person matches this search.');
    expect(query('non-members-people-search')).not.toBeNull();
    // A search miss is not an empty period, so the shell must not take the section over.
    expect(verdicts.every((empty) => !empty)).toBe(true);

    getNonMembersPeople.mockClear();
    (query('non-members-people-no-match')?.querySelector('[data-testid="empty-state-reset-filters"]') as HTMLElement).click();
    await settle();

    expect(getNonMembersPeople).toHaveBeenCalledTimes(1);
    expect(getNonMembersPeople).toHaveBeenCalledWith(expect.objectContaining({ search: '', offset: 0, sort: { key: 'company', direction: 'asc' } }));
  });

  // A failed read must not render copy that asserts the foundation had no engaged people.
  it('separates a failed read from an empty one, settling it', async () => {
    await render();
    lifecycle.length = 0;
    getNonMembersPeople.mockReturnValue(throwError(() => new Error('gateway timeout')));

    sortBy('company');
    await settle();

    expect(query('non-members-people-error')).not.toBeNull();
    expect(lifecycle).toEqual(['reading', 'settled']);
    expect(verdicts).toEqual([false, false]);
  });

  it('holds the loading state and reads nothing while no foundation is selected', async () => {
    selectedFoundation.set(null);
    await render();

    expect(getNonMembersPeople).not.toHaveBeenCalled();
    expect(lifecycle).not.toContain('settled');
  });
});
