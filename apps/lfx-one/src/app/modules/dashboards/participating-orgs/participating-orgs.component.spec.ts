// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { CardTabsBarComponent } from '@components/card-tabs-bar/card-tabs-bar.component';
import { PROJECT_PARTICIPATING_ORGS_NO_ORG_LENS_ACCESS_TOOLTIP, PROJECT_PARTICIPATING_ORGS_UNAVAILABLE_MESSAGE } from '@lfx-one/shared/constants';
import type {
  ProjectParticipatingOrg,
  ProjectParticipatingOrgsPage,
  ProjectParticipatingOrgsQuery,
  ProjectParticipatingOrgsRange,
  ProjectParticipatingOrgsSummary,
  ProjectParticipatingOrgsSummaryResponse,
} from '@lfx-one/shared/interfaces';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { type Observable, of, throwError } from 'rxjs';
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
    memberCommitShareOfAllCommits: 0.5,
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
    contributors: 8,
    contributorsPrev: 0,
    canOpenOrgLens: true,
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

  async function render(): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [ParticipatingOrgsComponent],
      providers: [
        provideRouter([]),
        MessageService,
        { provide: ProjectContextService, useValue: { activeContext: signal({ uid: 'project-uid', name: 'Synthetic Project', slug: PROJECT_SLUG }) } },
        { provide: ParticipatingOrgsService, useValue: { getSummary, getPage, exportCsv: vi.fn(() => of(undefined)) } },
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
  });

  it('links a member the viewer can open to its Org Lens membership page for the parent foundation', async () => {
    await render();

    const name = query(`participating-orgs-row-${SYNTHETIC_ORG_ACCOUNT_ID}-name`);
    expect(name?.tagName).toBe('A');
    expect(name?.getAttribute('href')).toBe(`/org/${SYNTHETIC_ORG_ACCOUNT_ID}/memberships/${FOUNDATION_SLUG}`);
    expect(text(`participating-orgs-row-${SYNTHETIC_ORG_ACCOUNT_ID}-membership`)).toBe('Gold');
    expect(getSummary).toHaveBeenCalledWith(PROJECT_SLUG, '12mo');
    expect(getPage).toHaveBeenCalledWith(PROJECT_SLUG, { range: '12mo', segment: 'all', sort: 'commits', dir: 'desc', pageSize: 25, offset: 0 });
  });

  it('renders a member the viewer cannot open as focusable plain text carrying the access hint', async () => {
    getPage.mockReturnValue(of(page([org({ canOpenOrgLens: false })])));
    await render();

    const name = query(`participating-orgs-row-${SYNTHETIC_ORG_ACCOUNT_ID}-name`);
    expect(name?.tagName).toBe('SPAN');
    expect(name?.getAttribute('tabindex')).toBe('0');
    expect(name?.textContent).toContain(PROJECT_PARTICIPATING_ORGS_NO_ORG_LENS_ACCESS_TOOLTIP);
    expect(query(`participating-orgs-row-${SYNTHETIC_ORG_ACCOUNT_ID}`)?.querySelector('a')).toBeNull();
  });

  it('tags an Unidentified company, never links it, and labels non-members', async () => {
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
            canOpenOrgLens: true,
          }),
        ])
      )
    );
    await render();

    expect(text(`participating-orgs-row-${UNIDENTIFIED_KEY}-unidentified`)).toBe('Unidentified');
    expect(query(`participating-orgs-row-${UNIDENTIFIED_KEY}`)?.querySelector('a')).toBeNull();
    expect(text(`participating-orgs-row-${UNIDENTIFIED_KEY}-membership`)).toBe('Non-member');
    // A non-member is never linked, even if the flag were set.
    expect(query(`participating-orgs-row-${SYNTHETIC_SECOND_ORG_ACCOUNT_ID}`)?.querySelector('a')).toBeNull();
  });

  it('shows the change against the previous window, "New" for a first-period company, and nothing for All Time', async () => {
    await render();

    expect(text(`participating-orgs-row-${SYNTHETIC_ORG_ACCOUNT_ID}-commits-delta`)).toContain('20.0%');
    expect(text(`participating-orgs-row-${SYNTHETIC_ORG_ACCOUNT_ID}-contributors`)).toMatch(/^8\s*New$/);

    getPage.mockReturnValue(of(page([org({ commitsPrev: null, contributorsPrev: null })])));
    fixture.componentInstance['rangeForm'].controls.range.setValue('all');
    await settle();

    expect(text(`participating-orgs-row-${SYNTHETIC_ORG_ACCOUNT_ID}-commits`)).toBe('120');
    expect(text(`participating-orgs-row-${SYNTHETIC_ORG_ACCOUNT_ID}-contributors`)).toBe('8');
  });

  it('clears and disables the tier filter on the Non-Members tab and requests that segment from the first page', async () => {
    await render();
    const tier = fixture.componentInstance['filterForm'].controls.tier;

    tier.setValue('Gold');
    fixture.componentInstance['offset'].set(25);
    await settle();
    expect(getPage).toHaveBeenLastCalledWith(PROJECT_SLUG, expect.objectContaining({ segment: 'all', tier: 'Gold', offset: 25 }));

    fixture.debugElement.query(By.directive(CardTabsBarComponent)).componentInstance.filterChange.emit('non_members');
    await settle();

    expect(tier.disabled).toBe(true);
    expect(tier.value).toBeNull();
    const [, lastQuery] = getPage.mock.lastCall ?? [];
    expect(lastQuery).toEqual({ range: '12mo', segment: 'non_members', sort: 'commits', dir: 'desc', pageSize: 25, offset: 0 });

    fixture.debugElement.query(By.directive(CardTabsBarComponent)).componentInstance.filterChange.emit('members');
    await settle();
    expect(tier.enabled).toBe(true);
  });

  it('switches the Member Commit Share tile between company and all commits, and dashes a missing share', async () => {
    getSummary.mockReturnValue(of({ summary: summary({ memberCommitShareOfAllCommits: null }) }));
    await render();
    const shareTile = (): string | undefined => text('stat-card-Member Commit Share');

    expect(shareTile()).toContain('75.0%');
    expect(text('stat-card-Non-Members')).toContain('1 Unidentified');

    fixture.componentInstance['shareForm'].controls.shareBase.setValue('all');
    await settle();

    expect(shareTile()).toContain('—');
    expect(shareTile()).not.toContain('75.0%');
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
