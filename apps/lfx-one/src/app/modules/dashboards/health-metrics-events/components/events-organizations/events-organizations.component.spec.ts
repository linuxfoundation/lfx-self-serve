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

import { EventsOrganizationsComponent } from './events-organizations.component';

import type { HealthMetricsEventsOrganization, HealthMetricsEventsOrganizations } from '@lfx-one/shared/interfaces';

const ACCOUNT_ID = '0014100000AcmeAAAA';

function organization(overrides: Partial<HealthMetricsEventsOrganization> = {}): HealthMetricsEventsOrganization {
  return {
    accountId: ACCOUNT_ID,
    accountName: 'Acme Motors',
    logoUrl: null,
    isMember: true,
    registrations: 1204,
    registrationsShare: 1,
    sponsorshipUsd: 150000,
    proposals: 12,
    speakers: 4,
    events: 3,
    ...overrides,
  };
}

function response(overrides: Partial<HealthMetricsEventsOrganizations> = {}): HealthMetricsEventsOrganizations {
  return { rows: [organization()], totalRecords: 1, scopeTotal: 1, ...overrides };
}

describe('EventsOrganizationsComponent', () => {
  let fixture: ComponentFixture<EventsOrganizationsComponent>;
  let getEventsOrganizations: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;
  let selectedFoundation: ReturnType<typeof signal<{ slug: string } | null>>;
  let counts: (number | null)[];
  let lifecycle: string[];

  // `payload` answers the first read; `followUpPayload` every read after it.
  async function render(
    payload: HealthMetricsEventsOrganizations = response(),
    queryParams: Record<string, string> = {},
    followUpPayload?: HealthMetricsEventsOrganizations
  ): Promise<void> {
    getEventsOrganizations = vi
      .fn()
      .mockReturnValue(of(followUpPayload ?? payload))
      .mockReturnValueOnce(of(payload));
    navigate = vi.spyOn(Router.prototype, 'navigate').mockResolvedValue(true) as unknown as ReturnType<typeof vi.fn>;

    await TestBed.configureTestingModule({
      imports: [EventsOrganizationsComponent],
      providers: [
        provideRouter([]),
        HealthMetricsChromeService,
        { provide: UserService, useValue: { impersonating: signal(false) } },
        { provide: AnalyticsService, useValue: { getEventsOrganizations } },
        { provide: ProjectContextService, useValue: { selectedFoundation } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(queryParams) } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EventsOrganizationsComponent);
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

    expect(getEventsOrganizations).toHaveBeenCalledWith({ foundationSlug: 'acme', range: 'YTD', segment: 'all', search: '', offset: 0, pageSize: 25 });
    expect(query(`events-orgs-row-${ACCOUNT_ID}-name`)?.textContent?.trim()).toBe('Acme Motors');
    expect(query('events-orgs-count')?.textContent?.trim()).toBe('1 organization');
    expect(lifecycle).toEqual(['reading', 'settled']);
  });

  it('emits the in-scope total for the sub-nav badge, not the filtered count', async () => {
    await render(response({ totalRecords: 12, scopeTotal: 340 }));

    expect(counts).toEqual([null, 340]);
  });

  it('renders untracked sponsorship and proposals as a dash, and real zeroes for the counted columns', async () => {
    await render(response({ rows: [organization({ sponsorshipUsd: 0, proposals: null, speakers: 0, events: 0, registrations: 0 })] }));

    expect(query(`events-orgs-row-${ACCOUNT_ID}-sponsorship`)?.textContent?.trim()).toBe('—');
    expect(query(`events-orgs-row-${ACCOUNT_ID}-proposals`)?.textContent?.trim()).toBe('—');
    expect(query(`events-orgs-row-${ACCOUNT_ID}-speakers`)?.textContent?.trim()).toBe('0');
    expect(query(`events-orgs-row-${ACCOUNT_ID}-events`)?.textContent?.trim()).toBe('0');
    expect(query(`events-orgs-row-${ACCOUNT_ID}-registrations`)?.textContent?.trim()).toBe('0');
  });

  it('labels members and non-members', async () => {
    await render(
      response({ rows: [organization(), organization({ accountId: '0014100000BetaAAAA', accountName: 'Beta Coastal', isMember: false })], totalRecords: 2 })
    );

    expect(query(`events-orgs-row-${ACCOUNT_ID}-membership`)?.textContent?.trim()).toBe('Member');
    expect(query('events-orgs-row-0014100000BetaAAAA-membership')?.textContent?.trim()).toBe('Non-member');
  });

  it('re-reads from page 1 when the segment changes, and writes it to the URL with the fragment kept', async () => {
    await render(response({ totalRecords: 80, scopeTotal: 80 }), { orgPage: '3' });
    getEventsOrganizations.mockClear();

    fixture.componentInstance['onSegmentChange']('members');
    await settle();

    expect(getEventsOrganizations).toHaveBeenCalledWith(expect.objectContaining({ segment: 'members', offset: 0 }));
    expect(navigate).toHaveBeenLastCalledWith(
      [],
      expect.objectContaining({ queryParams: { orgSegment: 'members', orgSearch: null, orgPage: null }, preserveFragment: true, replaceUrl: true })
    );
  });

  it('re-reads a debounced, trimmed search from page 1', async () => {
    await render(response({ totalRecords: 80, scopeTotal: 80 }), { orgPage: '2' });
    getEventsOrganizations.mockClear();

    fixture.componentInstance['searchForm'].controls.search.setValue('  acme ');
    await new Promise((resolve) => setTimeout(resolve, 250));
    await settle();

    expect(getEventsOrganizations).toHaveBeenCalledTimes(1);
    expect(getEventsOrganizations).toHaveBeenCalledWith(expect.objectContaining({ search: 'acme', offset: 0 }));
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { orgSegment: null, orgSearch: 'acme', orgPage: null } }));
  });

  it('pages through the table and writes the page to the URL', async () => {
    await render(response({ totalRecords: 80, scopeTotal: 80 }));
    getEventsOrganizations.mockClear();

    fixture.componentInstance['onTablePage']({ first: 50, rows: 25 });
    await settle();

    expect(getEventsOrganizations).toHaveBeenCalledWith(expect.objectContaining({ offset: 50, pageSize: 25 }));
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { orgSegment: null, orgSearch: null, orgPage: 3 } }));
  });

  it('starts on the segment, search and page the URL carries', async () => {
    await render(response({ totalRecords: 80, scopeTotal: 80 }), { orgSegment: 'non-members', orgSearch: 'acme', orgPage: '2' });

    expect(getEventsOrganizations).toHaveBeenCalledWith(expect.objectContaining({ segment: 'non-members', search: 'acme', offset: 25 }));
    expect((fixture.nativeElement.querySelector('#events-orgs-search') as HTMLInputElement).value).toBe('acme');
  });

  it('falls back to the defaults for URL values it cannot honour', async () => {
    await render(response(), { orgSegment: 'partners', orgPage: '-2' });

    expect(getEventsOrganizations).toHaveBeenCalledWith(expect.objectContaining({ segment: 'all', offset: 0 }));
  });

  it('re-reads from page 1 when the period changes', async () => {
    await render(response({ totalRecords: 80, scopeTotal: 80 }), { orgPage: '3' });
    getEventsOrganizations.mockClear();

    TestBed.inject(HealthMetricsChromeService).selectedRange.set('COMPLETED_YEAR');
    await settle();

    expect(getEventsOrganizations).toHaveBeenCalledWith(expect.objectContaining({ range: 'COMPLETED_YEAR', offset: 0 }));
  });

  it('re-reads from page 1 for a newly selected foundation', async () => {
    await render(response({ totalRecords: 80, scopeTotal: 80 }), { orgPage: '3' });
    getEventsOrganizations.mockClear();

    selectedFoundation.set({ slug: 'beta' });
    await settle();

    expect(getEventsOrganizations).toHaveBeenCalledWith(expect.objectContaining({ foundationSlug: 'beta', offset: 0 }));
  });

  // The totals join still reports the real count past the end, so the page must move back.
  it('lands on the last page holding rows, settling once and rewriting the URL', async () => {
    await render(response({ rows: [], totalRecords: 34, scopeTotal: 34 }), { orgPage: '9' }, response({ totalRecords: 34, scopeTotal: 34 }));

    expect(getEventsOrganizations).toHaveBeenNthCalledWith(1, expect.objectContaining({ offset: 200 }));
    expect(getEventsOrganizations).toHaveBeenNthCalledWith(2, expect.objectContaining({ offset: 25 }));
    expect(getEventsOrganizations).toHaveBeenCalledTimes(2);
    expect(lifecycle).toEqual(['reading', 'reading', 'settled']);
    expect(counts).toEqual([null, null, 34]);
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { orgSegment: null, orgSearch: null, orgPage: 2 } }));
  });

  it('shows the no-activity state when the period has no active organization', async () => {
    await render(response({ rows: [], totalRecords: 0, scopeTotal: 0 }));

    expect(query('events-orgs-empty')).not.toBeNull();
    expect(query('events-orgs-table')).toBeNull();
    expect(query('events-orgs-search')).toBeNull();
  });

  it('keeps the controls and shows the no-match state when a filter matches nothing', async () => {
    await render(response({ rows: [], totalRecords: 0, scopeTotal: 40 }));

    expect(query('events-orgs-no-match')).not.toBeNull();
    expect(query('events-orgs-controls')).not.toBeNull();
    expect(query('events-orgs-empty')).toBeNull();
  });

  // A failed read must not render copy that asserts the foundation had no organizations.
  it('separates a failed read from an empty one, settling it without a count', async () => {
    await render();
    counts.length = 0;
    lifecycle.length = 0;
    getEventsOrganizations.mockReturnValue(throwError(() => new Error('gateway timeout')));

    fixture.componentInstance['onSegmentChange']('members');
    await settle();

    expect(query('events-orgs-error')).not.toBeNull();
    expect(query('events-orgs-empty')).toBeNull();
    expect(counts).toEqual([null, null]);
    expect(lifecycle).toEqual(['reading', 'settled']);
  });

  it('holds the loading state and reads nothing while no foundation is selected', async () => {
    selectedFoundation.set(null);
    await render();

    expect(getEventsOrganizations).not.toHaveBeenCalled();
    expect(counts.every((count) => count === null)).toBe(true);
    expect(lifecycle).not.toContain('settled');
    expect(query('events-orgs-count')?.textContent?.trim()).toBe('—');
    expect(query('events-orgs-empty')).toBeNull();
  });
});
