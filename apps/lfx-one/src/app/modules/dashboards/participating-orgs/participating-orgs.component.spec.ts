// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { signal, type WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { CardTabsBarComponent } from '@components/card-tabs-bar/card-tabs-bar.component';
import { PROJECT_PARTICIPATING_ORGS_NO_ORG_LENS_ACCESS_TOOLTIP, PROJECT_PARTICIPATING_ORGS_UNAVAILABLE_MESSAGE } from '@lfx-one/shared/constants';
import type {
  MembershipTierClass,
  ProjectContext,
  ProjectParticipatingOrg,
  ProjectParticipatingOrgsPage,
  ProjectParticipatingOrgsQuery,
  ProjectParticipatingOrgsRange,
  ProjectParticipatingOrgsSummary,
  ProjectParticipatingOrgsSummaryResponse,
} from '@lfx-one/shared/interfaces';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { type Observable, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import {
  SYNTHETIC_ORG_ACCOUNT_ID,
  SYNTHETIC_ORG_NAME,
  SYNTHETIC_SECOND_ORG_ACCOUNT_ID,
  SYNTHETIC_SECOND_ORG_LEGAL_NAME,
} from '../../../../../e2e/fixtures/mock-data/synthetic-org.mock';
import { ParticipatingOrgsComponent } from './participating-orgs.component';
import { ParticipatingOrgsService } from './services/participating-orgs.service';

const PROJECT_SLUG = 'synthetic-project';
const FOUNDATION_SLUG = 'synthetic-foundation';
const UNIDENTIFIED_KEY = 'cdev:00000000-0000-0000-0000-000000000001';

function summary(overrides: Partial<ProjectParticipatingOrgsSummary> = {}): ProjectParticipatingOrgsSummary {
  return {
    projectSlug: PROJECT_SLUG,
    foundationSlug: FOUNDATION_SLUG,
    foundationName: 'Synthetic Foundation',
    range: '12mo',
    asOfDate: '2026-10-15',
    orgsCount: 3,
    membersCount: 2,
    nonMembersCount: 1,
    unidentifiedCount: 1,
    memberCommits: 300,
    companyCommits: 400,
    allCommits: 600,
    memberCommitShareOfCompanyCommits: 0.75,
    ...overrides,
  };
}

function org(overrides: Partial<ProjectParticipatingOrg> = {}): ProjectParticipatingOrg {
  return {
    participantKey: SYNTHETIC_ORG_ACCOUNT_ID,
    accountId: SYNTHETIC_ORG_ACCOUNT_ID,
    name: SYNTHETIC_ORG_NAME,
    logoUrl: null,
    isUnidentified: false,
    isMember: true,
    membershipTierClass: 'Gold',
    commits: 120,
    commitsPrev: 100,
    commitsChange: 0.2,
    contributors: 8,
    contributorsPrev: 0,
    contributorsChange: null,
    ...overrides,
  };
}

function page(rows: ProjectParticipatingOrg[] = [org()]): ProjectParticipatingOrgsPage {
  return { rows, totalRecords: rows.length, foundationSlug: FOUNDATION_SLUG };
}

function httpError(status: number): Observable<never> {
  return throwError(() => new HttpErrorResponse({ status }));
}

describe('ParticipatingOrgsComponent', () => {
  let fixture: ComponentFixture<ParticipatingOrgsComponent>;
  let getSummary: Mock<(slug: string, range: ProjectParticipatingOrgsRange) => Observable<ProjectParticipatingOrgsSummaryResponse>>;
  let getPage: Mock<(slug: string, query: ProjectParticipatingOrgsQuery) => Observable<ProjectParticipatingOrgsPage>>;
  let getLinks: Mock<(slug: string, accountIds: string[]) => Observable<ReadonlySet<string> | null>>;
  let activeContext: WritableSignal<ProjectContext>;

  async function render(): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [ParticipatingOrgsComponent],
      providers: [
        provideRouter([]),
        MessageService,
        { provide: ProjectContextService, useValue: { activeContext } },
        {
          provide: ParticipatingOrgsService,
          useValue: { getSummary, getPage, getOrgLensReadableAccountIds: getLinks, exportCsv: vi.fn(() => of(undefined)) },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ParticipatingOrgsComponent);
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
    getSummary = vi.fn<(slug: string, range: ProjectParticipatingOrgsRange) => Observable<ProjectParticipatingOrgsSummaryResponse>>(() =>
      of({ summary: summary() })
    );
    getPage = vi.fn<(slug: string, query: ProjectParticipatingOrgsQuery) => Observable<ProjectParticipatingOrgsPage>>(() => of(page()));
    getLinks = vi.fn<(slug: string, accountIds: string[]) => Observable<ReadonlySet<string> | null>>(() => of(new Set([SYNTHETIC_ORG_ACCOUNT_ID])));
    activeContext = signal<ProjectContext>({ uid: 'project-uid', name: 'Synthetic Project', slug: PROJECT_SLUG });
  });

  it('never shows the previous project’s rows or tiles while the new project loads', async () => {
    await render();
    expect(query(`participating-orgs-row-${SYNTHETIC_ORG_ACCOUNT_ID}`)).not.toBeNull();
    getPage.mockReturnValue(new Subject<ProjectParticipatingOrgsPage>());
    getSummary.mockReturnValue(new Subject<ProjectParticipatingOrgsSummaryResponse>());

    activeContext.set({ uid: 'other-project-uid', name: 'Other Synthetic Project', slug: 'other-synthetic-project' });
    await settle();

    expect(query(`participating-orgs-row-${SYNTHETIC_ORG_ACCOUNT_ID}`)).toBeNull();
    expect(fixture.nativeElement.querySelector('.lfx-skeleton-row')).not.toBeNull();
    expect(text('participating-orgs-subtitle')).not.toContain('Synthetic Foundation');
  });

  it('returns to the first page when the viewer switches project', async () => {
    await render();
    fixture.componentInstance['offset'].set(50);
    await settle();
    expect(getPage).toHaveBeenLastCalledWith(PROJECT_SLUG, expect.objectContaining({ offset: 50 }));

    activeContext.set({ uid: 'other-project-uid', name: 'Other Synthetic Project', slug: 'other-synthetic-project' });
    await settle();

    expect(getPage).toHaveBeenLastCalledWith('other-synthetic-project', expect.objectContaining({ offset: 0 }));
    expect(getPage).not.toHaveBeenCalledWith('other-synthetic-project', expect.objectContaining({ offset: 50 }));
  });

  it('links a member the viewer can open to its Org Lens membership page and names the split in the subtitle', async () => {
    await render();

    const name = query(`participating-orgs-row-${SYNTHETIC_ORG_ACCOUNT_ID}-name`);
    expect(name?.tagName).toBe('A');
    expect(name?.getAttribute('href')).toBe(`/org/${SYNTHETIC_ORG_ACCOUNT_ID}/memberships/${FOUNDATION_SLUG}`);
    expect(text('participating-orgs-subtitle')).toBe(
      'Every organization contributing to Synthetic Project, ranked by activity and split by Synthetic Foundation membership.'
    );
    expect(getSummary).toHaveBeenCalledWith(PROJECT_SLUG, '12mo');
    expect(getPage).toHaveBeenCalledWith(PROJECT_SLUG, { range: '12mo', segment: 'all', sort: 'commits', dir: 'desc', pageSize: 10, offset: 0 });
  });

  it('renders a member the viewer cannot open as focusable plain text carrying the access hint', async () => {
    getLinks.mockReturnValue(of(new Set<string>()));
    await render();

    const name = query(`participating-orgs-row-${SYNTHETIC_ORG_ACCOUNT_ID}-name`);
    expect(name?.tagName).toBe('SPAN');
    expect(name?.getAttribute('tabindex')).toBe('0');
    expect(name?.getAttribute('role')).toBe('note');
    expect(name?.getAttribute('aria-label')).toBe(`${SYNTHETIC_ORG_NAME} — ${PROJECT_PARTICIPATING_ORGS_NO_ORG_LENS_ACCESS_TOOLTIP}`);
    expect(query(`participating-orgs-row-${SYNTHETIC_ORG_ACCOUNT_ID}`)?.querySelector('a')).toBeNull();
  });

  it('shows member names plain, without the access hint, until the viewer’s links arrive, asking only for members', async () => {
    const links = new Subject<ReadonlySet<string>>();
    getLinks.mockReturnValue(links);
    getPage.mockReturnValue(
      of(
        page([
          org(),
          org({ participantKey: SYNTHETIC_SECOND_ORG_ACCOUNT_ID, accountId: SYNTHETIC_SECOND_ORG_ACCOUNT_ID, isMember: false, membershipTierClass: null }),
        ])
      )
    );
    await render();

    const pending = query(`participating-orgs-row-${SYNTHETIC_ORG_ACCOUNT_ID}-name`);
    expect(pending?.tagName).toBe('SPAN');
    expect(pending?.getAttribute('role')).toBeNull();
    expect(getLinks).toHaveBeenCalledWith(PROJECT_SLUG, [SYNTHETIC_ORG_ACCOUNT_ID]);

    links.next(new Set([SYNTHETIC_ORG_ACCOUNT_ID]));
    await settle();

    expect(query(`participating-orgs-row-${SYNTHETIC_ORG_ACCOUNT_ID}-name`)?.tagName).toBe('A');
  });

  it('asks for links once per member set: a re-sort keeps them, and a malformed id is left out of the request', async () => {
    const second = org({ participantKey: SYNTHETIC_SECOND_ORG_ACCOUNT_ID, accountId: SYNTHETIC_SECOND_ORG_ACCOUNT_ID });
    const malformed = org({ participantKey: '001SHORT', accountId: '001SHORT' });
    getPage.mockReturnValue(of(page([org(), second, malformed])));
    await render();
    expect(getLinks).toHaveBeenCalledExactlyOnceWith(PROJECT_SLUG, [SYNTHETIC_ORG_ACCOUNT_ID, SYNTHETIC_SECOND_ORG_ACCOUNT_ID].sort());

    getPage.mockReturnValue(of(page([second, malformed, org()])));
    fixture.componentInstance['onSort']('name');
    await settle();

    expect(getLinks).toHaveBeenCalledOnce();
    expect(query(`participating-orgs-row-${SYNTHETIC_ORG_ACCOUNT_ID}-name`)?.tagName).toBe('A');
  });

  it('never applies the previous page’s links answer to a new page’s members', async () => {
    await render();
    expect(query(`participating-orgs-row-${SYNTHETIC_ORG_ACCOUNT_ID}-name`)?.tagName).toBe('A');

    getLinks.mockReturnValue(new Subject<ReadonlySet<string>>());
    getPage.mockReturnValue(of(page([org({ participantKey: SYNTHETIC_SECOND_ORG_ACCOUNT_ID, accountId: SYNTHETIC_SECOND_ORG_ACCOUNT_ID })])));
    fixture.componentInstance['offset'].set(10);
    await settle();

    const name = query(`participating-orgs-row-${SYNTHETIC_SECOND_ORG_ACCOUNT_ID}-name`);
    expect(name?.tagName).toBe('SPAN');
    expect(name?.getAttribute('role')).toBeNull();
  });

  it('keeps the current rows on screen, marked busy, while the next page loads', async () => {
    await render();
    const next = new Subject<ProjectParticipatingOrgsPage>();
    getPage.mockReturnValue(next);

    fixture.componentInstance['onSegmentChange']('members');
    await settle();

    expect(query(`participating-orgs-row-${SYNTHETIC_ORG_ACCOUNT_ID}`)).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.lfx-skeleton-row')).toBeNull();
    expect(query('participating-orgs-table')?.parentElement?.getAttribute('aria-busy')).toBe('true');
  });

  it('shows an Unidentified company as a plain, unlinked name, and badges non-members', async () => {
    getPage.mockReturnValue(
      of(
        page([
          org({ participantKey: UNIDENTIFIED_KEY, accountId: null, name: 'unmatched-org', isUnidentified: true, isMember: false, membershipTierClass: null }),
          org({
            participantKey: SYNTHETIC_SECOND_ORG_ACCOUNT_ID,
            accountId: SYNTHETIC_SECOND_ORG_ACCOUNT_ID,
            name: SYNTHETIC_SECOND_ORG_LEGAL_NAME,
            isMember: false,
            membershipTierClass: null,
          }),
        ])
      )
    );
    // Even if the access check named a non-member, it is never linked.
    getLinks.mockReturnValue(of(new Set([SYNTHETIC_SECOND_ORG_ACCOUNT_ID])));
    await render();

    expect(text(`participating-orgs-row-${UNIDENTIFIED_KEY}-name`)).toBe('unmatched-org');
    expect(query(`participating-orgs-row-${UNIDENTIFIED_KEY}`)?.textContent).not.toContain('Unidentified');
    expect(query(`participating-orgs-row-${UNIDENTIFIED_KEY}`)?.querySelector('a')).toBeNull();
    expect(text(`participating-orgs-row-${UNIDENTIFIED_KEY}-membership`)).toBe('Non-member');
    // A non-member is never linked.
    expect(query(`participating-orgs-row-${SYNTHETIC_SECOND_ORG_ACCOUNT_ID}`)?.querySelector('a')).toBeNull();
  });

  it('badges members "{Tier} Member" in the tier colour, falling back to slate for unlisted tiers', async () => {
    const member = (key: string, tier: MembershipTierClass): ProjectParticipatingOrg =>
      org({ participantKey: key, accountId: null, membershipTierClass: tier });
    getPage.mockReturnValue(of(page([member('cdev:platinum', 'Platinum'), member('cdev:gold', 'Gold'), member('cdev:premier', 'Premier')])));
    await render();
    const badge = (key: string): Element | null | undefined => query(`participating-orgs-row-${key}-membership`)?.firstElementChild;

    expect(text('participating-orgs-row-cdev:platinum-membership')).toBe('Platinum Member');
    expect(badge('cdev:platinum')?.classList).toContain('bg-emerald-100');
    expect(badge('cdev:gold')?.classList).toContain('bg-amber-100');
    expect(badge('cdev:premier')?.classList).toContain('bg-slate-100');
  });

  it('shows each change as a signed whole percent, "New" from zero, and a dash for All Time', async () => {
    getPage.mockReturnValue(
      of(
        page([
          org({
            participantKey: 'cdev:up',
            accountId: null,
            commits: 134,
            commitsPrev: 100,
            commitsChange: 0.34,
            contributors: 8,
            contributorsPrev: 0,
            contributorsChange: null,
          }),
          org({
            participantKey: 'cdev:down',
            accountId: null,
            commits: 92,
            commitsPrev: 100,
            commitsChange: -0.08,
            contributors: 5,
            contributorsPrev: 5,
            contributorsChange: 0,
          }),
        ])
      )
    );
    await render();
    const change = (key: string, metric: 'commits' | 'contributors'): HTMLElement | null => query(`participating-orgs-row-${key}-${metric}-change`);

    expect(change('cdev:up', 'commits')?.textContent?.trim()).toBe('+34%');
    expect(change('cdev:up', 'commits')?.classList).toContain('text-emerald-700');
    expect(change('cdev:up', 'contributors')?.textContent?.trim()).toBe('New');
    expect(change('cdev:down', 'commits')?.textContent?.trim()).toBe('-8%');
    expect(change('cdev:down', 'commits')?.classList).toContain('text-red-600');
    expect(change('cdev:down', 'contributors')?.textContent?.trim()).toBe('0%');

    getPage.mockReturnValue(
      of(page([org({ participantKey: 'cdev:up', accountId: null, commitsPrev: null, commitsChange: null, contributorsPrev: null, contributorsChange: null })]))
    );
    fixture.componentInstance['rangeForm'].controls.range.setValue('all');
    await settle();

    expect(change('cdev:up', 'commits')?.textContent?.trim()).toBe('—');
    expect(change('cdev:up', 'contributors')?.textContent?.trim()).toBe('—');
  });

  it('sorts by a change column, largest first, and marks it as the sorted header', async () => {
    await render();

    query('participating-orgs-sort-commits_change')?.click();
    await settle();

    expect(getPage).toHaveBeenLastCalledWith(PROJECT_SLUG, expect.objectContaining({ sort: 'commits_change', dir: 'desc', offset: 0 }));
    expect(query('participating-orgs-sort-commits_change')?.closest('th')?.getAttribute('aria-sort')).toBe('descending');
    expect(query('participating-orgs-sort-commits')?.closest('th')?.getAttribute('aria-sort')).toBe('none');
  });

  it('clears and disables the tier filter on the Non-Members tab in one request, from the first page', async () => {
    await render();
    const tier = fixture.componentInstance['filterForm'].controls.tier;

    tier.setValue('Gold');
    fixture.componentInstance['offset'].set(20);
    await settle();
    expect(getPage).toHaveBeenLastCalledWith(PROJECT_SLUG, expect.objectContaining({ segment: 'all', tier: 'Gold', offset: 20 }));
    getPage.mockClear();

    fixture.debugElement.query(By.directive(CardTabsBarComponent)).componentInstance.filterChange.emit('non_members');
    await settle();

    expect(tier.disabled).toBe(true);
    expect(tier.value).toBeNull();
    // Exactly one read: no stray `segment=non_members&tier=Gold` before the tier clears.
    expect(getPage).toHaveBeenCalledTimes(1);
    expect(getPage).toHaveBeenCalledWith(PROJECT_SLUG, { range: '12mo', segment: 'non_members', sort: 'commits', dir: 'desc', pageSize: 10, offset: 0 });

    fixture.debugElement.query(By.directive(CardTabsBarComponent)).componentInstance.filterChange.emit('members');
    await settle();
    expect(tier.enabled).toBe(true);
  });

  it('shows the Member Commit Share as a whole percent, or a dash when there are no company commits', async () => {
    getSummary.mockReturnValue(of({ summary: summary({ memberCommitShareOfCompanyCommits: 0.846 }) }));
    await render();

    expect(text('stat-card-Member Commit Share')).toContain('85%');
    expect(text('stat-card-Non-Members')).not.toContain('Unidentified');

    getSummary.mockReturnValue(of({ summary: summary({ memberCommitShareOfCompanyCommits: null }) }));
    fixture.componentInstance['rangeForm'].controls.range.setValue('90d');
    await settle();

    expect(text('stat-card-Member Commit Share')).toContain('—');
  });

  it('shows the no-access state on a 403', async () => {
    getSummary.mockReturnValue(httpError(403));
    getPage.mockReturnValue(httpError(403));
    await render();

    expect(text('participating-orgs-no-access')).toContain("You don't have access to this project's participating organizations");
    expect(query('participating-orgs-table')).toBeNull();
    expect(query('participating-orgs-error')).toBeNull();
  });

  it('shows a retryable alert on a 503 and recovers on Retry', async () => {
    getSummary.mockReturnValueOnce(httpError(503));
    await render();

    const alert = query('participating-orgs-error');
    expect(alert?.getAttribute('role')).toBe('alert');
    expect(alert?.textContent).toContain(PROJECT_PARTICIPATING_ORGS_UNAVAILABLE_MESSAGE);

    (alert?.querySelector('button') as HTMLButtonElement).click();
    await settle();

    expect(query('participating-orgs-error')).toBeNull();
    expect(query(`participating-orgs-row-${SYNTHETIC_ORG_ACCOUNT_ID}`)).not.toBeNull();
  });

  it('shows the empty state when the project has no company code activity in the range', async () => {
    getSummary.mockReturnValue(of({ summary: null }));
    getPage.mockReturnValue(of(page([])));
    await render();

    expect(text('participating-orgs-empty')).toContain('No code contributions from companies in this period');
    expect(query('participating-orgs-table')).toBeNull();
    // The range picker stays reachable so another window can be chosen.
    expect(query('participating-orgs-range')).not.toBeNull();
  });
});
