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

import type { HealthMetricsEventsOrganization, HealthMetricsEventsOrganizations, HealthMetricsEventsOrganizationsSegment } from '@lfx-one/shared/interfaces';

const ACCOUNT_ID = '0014100000AcmeAAAA';

function organization(overrides: Partial<HealthMetricsEventsOrganization> = {}): HealthMetricsEventsOrganization {
  return {
    accountId: ACCOUNT_ID,
    accountName: 'Acme Motors',
    logoUrl: null,
    isMember: true,
    membershipTier: 'Gold',
    registrations: 1204,
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
  let lifecycle: string[];
  let verdicts: boolean[];

  // `payload` answers the first read; `followUpPayload` every read after it.
  async function render(
    payload: HealthMetricsEventsOrganizations = response(),
    queryParams: Record<string, string> = {},
    followUpPayload?: HealthMetricsEventsOrganizations,
    segment: HealthMetricsEventsOrganizationsSegment = 'all'
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
    // The tab reads the segment off the URL and binds it in.
    fixture.componentRef.setInput('segment', segment);
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

  beforeEach(() => {
    vi.restoreAllMocks();
    selectedFoundation = signal<{ slug: string } | null>({ slug: 'acme' });
    lifecycle = [];
    verdicts = [];
  });

  function text(testId: string): string {
    return query(testId)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  it('reads the selected foundation and period ten rows at a time, renders the page, and settles', async () => {
    await render();

    expect(getEventsOrganizations).toHaveBeenCalledWith({
      foundationSlug: 'acme',
      range: 'YTD',
      segment: 'all',
      search: '',
      offset: 0,
      pageSize: 10,
      sort: null,
    });
    expect(query(`events-orgs-row-${ACCOUNT_ID}-name`)?.querySelector('[data-testid="health-metrics-cell-text"]')?.textContent?.trim()).toBe('Acme Motors');
    // The count caption is gone; the sub-nav and the pager carry the totals.
    expect(query('events-orgs-count')).toBeNull();
    expect(lifecycle).toEqual(['reading', 'settled']);
    expect(verdicts).toEqual([false]);
  });

  it('puts the design columns in order, at its 880px minimum', async () => {
    await render();
    const headers = [...fixture.nativeElement.querySelectorAll('[data-testid="events-orgs-table"] th')].map((th) => (th as HTMLElement).textContent?.trim());

    expect(headers).toEqual(['Company', 'Membership', 'Registrations', 'Sponsorship', 'Proposals', 'Speakers', 'Events']);
    expect((fixture.nativeElement.querySelector('[data-testid="events-orgs-table"] table') as HTMLElement | null)?.style.minWidth).toBe('880px');
  });

  it('renders untracked sponsorship and proposals as a dash, and real zeroes for the counted columns', async () => {
    await render(response({ rows: [organization({ sponsorshipUsd: 0, proposals: null, speakers: 0, events: 0, registrations: 0 })] }));

    expect(text(`events-orgs-row-${ACCOUNT_ID}-sponsorship`)).toBe('—');
    expect(text(`events-orgs-row-${ACCOUNT_ID}-proposals`)).toBe('—');
    expect(text(`events-orgs-row-${ACCOUNT_ID}-speakers`)).toBe('0');
    expect(text(`events-orgs-row-${ACCOUNT_ID}-events`)).toBe('0');
    expect(text(`events-orgs-row-${ACCOUNT_ID}-registrations`)).toBe('0');
  });

  it("labels a member by its tier in the row's ink and a non-member as Non-member in neutral-500", async () => {
    await render(
      response({
        rows: [
          organization(),
          organization({ accountId: '0014100000BetaAAAA', accountName: 'Beta Coastal', isMember: false }),
          organization({ accountId: '0014100000GammAAAA', accountName: 'Gamma Works', membershipTier: null }),
        ],
        totalRecords: 3,
      })
    );
    const label = (id: string) => query(`events-orgs-row-${id}-membership`)?.querySelector('[data-testid="health-metrics-cell-text"]');

    expect(label(ACCOUNT_ID)?.textContent?.trim()).toBe('Gold');
    expect(label(ACCOUNT_ID)?.classList).not.toContain('text-gray-500');
    expect(label('0014100000BetaAAAA')?.textContent?.trim()).toBe('Non-member');
    expect(label('0014100000BetaAAAA')?.classList).toContain('text-gray-500');
    expect(label('0014100000GammAAAA')?.textContent?.trim()).toBe('Member');
  });

  it('draws registrations as a plain number with no bar, and leads the name with its logo box', async () => {
    await render(response({ rows: [organization({ registrations: 640, logoUrl: 'https://acme-motors.example/logo.png' })] }));

    expect(text(`events-orgs-row-${ACCOUNT_ID}-registrations`)).toBe('640');
    expect(query(`events-orgs-row-${ACCOUNT_ID}-registrations`)?.querySelector('[class*="bg-blue"]')).toBeNull();
    expect(query(`events-orgs-row-${ACCOUNT_ID}-name`)?.querySelector('[data-testid="health-metrics-cell-company"]')).not.toBeNull();
  });

  it('links each name to Members or Non-Members, searched by name and named for where it opens', async () => {
    await render(
      response({ rows: [organization(), organization({ accountId: '0014100000BetaAAAA', accountName: 'Beta Coastal', isMember: false })], totalRecords: 2 })
    );

    const member = query(`events-orgs-row-${ACCOUNT_ID}-name`);
    const nonMember = query('events-orgs-row-0014100000BetaAAAA-name');
    expect(member?.getAttribute('href')).toBe('/foundation/health-metrics/members?memSearch=Acme%20Motors#list');
    expect(member?.getAttribute('aria-label')).toBe('Open Acme Motors in Members');
    expect(nonMember?.getAttribute('href')).toBe('/foundation/health-metrics/non-members?nonSearch=Beta%20Coastal#orgs');
    expect(nonMember?.getAttribute('aria-label')).toBe('Open Beta Coastal in Non-Members');
    expect(query(`events-orgs-row-${ACCOUNT_ID}`)?.getAttribute('tabindex')).toBeNull();
    // Plain row text at the cell's own size, not the table's blue 0.875rem link: the row itself carries the click affordance.
    expect(member?.classList).toContain('!text-gray-900');
    expect(member?.classList).toContain('!no-underline');
    expect(member?.classList).toContain('![font-size:inherit]');
  });

  it('opens the company from anywhere on its row', async () => {
    await render();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    query(`events-orgs-row-${ACCOUNT_ID}`)?.click();

    expect(navigate).toHaveBeenCalledWith(['/foundation/health-metrics', 'members'], {
      fragment: 'list',
      queryParams: { memSearch: 'Acme Motors', memTier: null, memNps: null, memPage: null },
      queryParamsHandling: 'merge',
    });
  });

  it('re-reads from page 1 when the header switch changes the segment, and writes it to the URL with the fragment kept', async () => {
    await render(response({ totalRecords: 80, scopeTotal: 80 }), { orgPage: '3' });
    getEventsOrganizations.mockClear();

    fixture.componentRef.setInput('segment', 'members');
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

    fixture.componentInstance['searchText'].set('  acme ');
    await new Promise((resolve) => setTimeout(resolve, 250));
    await settle();

    expect(getEventsOrganizations).toHaveBeenCalledTimes(1);
    expect(getEventsOrganizations).toHaveBeenCalledWith(expect.objectContaining({ search: 'acme', offset: 0 }));
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { orgSegment: null, orgSearch: 'acme', orgPage: null } }));
  });

  it('pages through the table with the numbered pager and writes the page to the URL', async () => {
    await render(response({ totalRecords: 80, scopeTotal: 80 }));
    getEventsOrganizations.mockClear();
    expect(fixture.nativeElement.querySelector('lfx-ui-pagination')).not.toBeNull();

    fixture.componentInstance['page'].set(2);
    await settle();

    expect(getEventsOrganizations).toHaveBeenCalledWith(expect.objectContaining({ offset: 20, pageSize: 10 }));
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { orgSegment: null, orgSearch: null, orgPage: 3 } }));
  });

  it("opens on Registrations sorted with the view's rank, and re-reads every page from the first in a picked order", async () => {
    await render(response({ totalRecords: 80, scopeTotal: 80 }));
    const header = (key: string): HTMLElement => fixture.nativeElement.querySelector(`[data-testid="events-organizations-sort-${key}"]`);
    expect(header('registrations').closest('th')?.getAttribute('aria-sort')).toBe('descending');

    fixture.componentInstance['page'].set(2);
    await settle();
    getEventsOrganizations.mockClear();
    (header('membership').querySelector('button') as HTMLButtonElement).click();
    await settle();

    expect(getEventsOrganizations).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 0, sort: { key: 'membership', direction: 'desc' } }));
    expect(header('membership').closest('th')?.getAttribute('aria-sort')).toBe('descending');
  });

  it('starts on the segment, search and page the URL carries', async () => {
    await render(response({ totalRecords: 80, scopeTotal: 80 }), { orgSearch: 'acme', orgPage: '2' }, undefined, 'non-members');

    expect(getEventsOrganizations).toHaveBeenCalledWith(expect.objectContaining({ segment: 'non-members', search: 'acme', offset: 10 }));
    expect(fixture.componentInstance['searchText']()).toBe('acme');
  });

  it('falls back to the first page for a URL page it cannot honour', async () => {
    await render(response(), { orgPage: '-2' });

    expect(getEventsOrganizations).toHaveBeenCalledWith(expect.objectContaining({ offset: 0 }));
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

    expect(getEventsOrganizations).toHaveBeenNthCalledWith(1, expect.objectContaining({ offset: 80 }));
    expect(getEventsOrganizations).toHaveBeenNthCalledWith(2, expect.objectContaining({ offset: 30 }));
    expect(getEventsOrganizations).toHaveBeenCalledTimes(2);
    expect(lifecycle).toEqual(['reading', 'reading', 'settled']);
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { orgSegment: null, orgSearch: null, orgPage: 4 } }));
  });

  it('settles empty, with no body, when the period has no active company', async () => {
    await render(response({ rows: [], totalRecords: 0, scopeTotal: 0 }));

    expect(verdicts).toEqual([true]);
    expect(query('events-orgs-table')).toBeNull();
    expect(query('events-orgs-search')).toBeNull();
  });

  it('keeps the search and shows the no-match state when a filter matches nothing', async () => {
    await render(response({ rows: [], totalRecords: 0, scopeTotal: 40 }));

    expect(text('events-orgs-no-match')).toContain('No matching companies');
    expect(query('events-orgs-search')).not.toBeNull();
    // A filter miss is not an empty period, so the shell must not take the section over.
    expect(verdicts).toEqual([false]);
  });

  it('resets both the search and the header switch from the no-match state', async () => {
    await render(response({ rows: [], totalRecords: 0, scopeTotal: 40 }), { orgSearch: 'zzz' }, undefined, 'members');
    const segmentChanges: string[] = [];
    fixture.componentInstance.segment.subscribe((segment) => segmentChanges.push(segment));

    (query('events-orgs-no-match')?.querySelector('[data-testid="empty-state-reset-filters"]') as HTMLElement).click();
    await settle();

    expect(fixture.componentInstance['searchText']()).toBe('');
    expect(segmentChanges).toEqual(['all']);
  });

  // A failed read must not render copy that asserts the foundation had no companies.
  it('separates a failed read from an empty one, settling it', async () => {
    await render();
    lifecycle.length = 0;
    getEventsOrganizations.mockReturnValue(throwError(() => new Error('gateway timeout')));

    fixture.componentRef.setInput('segment', 'members');
    await settle();

    expect(query('events-orgs-error')).not.toBeNull();
    expect(lifecycle).toEqual(['reading', 'settled']);
    expect(verdicts).toEqual([false, false]);
  });

  it('holds the loading state and reads nothing while no foundation is selected', async () => {
    selectedFoundation.set(null);
    await render();

    expect(getEventsOrganizations).not.toHaveBeenCalled();
    expect(lifecycle).not.toContain('settled');
    expect(query('events-orgs-table')).not.toBeNull();
  });
});
