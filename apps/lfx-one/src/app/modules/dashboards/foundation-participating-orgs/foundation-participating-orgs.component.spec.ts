// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { signal, type WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { FOUNDATION_PARTICIPATING_ORGS_STAT_SUBLINE_CLASS } from '@lfx-one/shared/constants';
import type {
  FoundationParticipatingOrg,
  FoundationParticipatingOrgBreakdown,
  FoundationParticipatingOrgProjectLine,
  FoundationParticipatingOrgsExportFilters,
  FoundationParticipatingOrgsExportKind,
  FoundationParticipatingOrgsPage,
  FoundationParticipatingOrgsProjectsResponse,
  FoundationParticipatingOrgsQuery,
  FoundationParticipatingOrgsRange,
  FoundationParticipatingOrgsSummary,
  FoundationParticipatingOrgsSummaryQuery,
  FoundationParticipatingOrgsSummaryResponse,
  ProjectContext,
} from '@lfx-one/shared/interfaces';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { type Observable, of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import { SYNTHETIC_ORG_NAME } from '../../../../../e2e/fixtures/mock-data/synthetic-org.mock';
import { FoundationParticipatingOrgsComponent } from './foundation-participating-orgs.component';
import { FoundationParticipatingOrgsService } from './services/foundation-participating-orgs.service';

const FOUNDATION_SLUG = 'synthetic-foundation';
const KEY = 'synthetic-company';

function summary(overrides: Partial<FoundationParticipatingOrgsSummary> = {}): FoundationParticipatingOrgsSummary {
  return {
    foundationSlug: FOUNDATION_SLUG,
    foundationName: 'Synthetic Foundation',
    projectCount: 12,
    projectSlug: null,
    projectName: null,
    range: '12mo',
    asOfDate: '2026-10-15',
    availableTiers: ['Platinum', 'Gold'],
    companiesCount: 5,
    membersCount: 9,
    contributingMembersCount: 3,
    nonMembersCount: 2,
    memberCommitShare: 0.6,
    ...overrides,
  };
}

function company(overrides: Partial<FoundationParticipatingOrg> = {}): FoundationParticipatingOrg {
  return {
    participantKey: KEY,
    accountId: null,
    name: SYNTHETIC_ORG_NAME,
    logoUrl: null,
    isMember: true,
    membershipTierClass: 'Gold',
    otherMemberships: ['Project member'],
    projectsInvolved: 12,
    commits: 1200,
    commitsChange: 0.2,
    contributors: 40,
    contributorsChange: -0.1,
    ...overrides,
  };
}

function line(index: number, share = 0.05): FoundationParticipatingOrgProjectLine {
  return {
    projectSlug: `project-${index}`,
    name: `Synthetic Project ${index}`,
    maturity: 'Graduated',
    commits: 100 - index,
    commitsChange: 0.1,
    contributors: 10,
    contributorsChange: 0,
    shareOfCompanyCommits: share,
  };
}

function breakdown(projectCount = 12): FoundationParticipatingOrgBreakdown {
  return {
    total: { ...line(0, 1), projectSlug: FOUNDATION_SLUG, name: 'Synthetic Foundation total', maturity: null, commits: 1200 },
    projects: Array.from({ length: projectCount }, (_, index) => line(index + 1)),
  };
}

describe('FoundationParticipatingOrgsComponent', () => {
  let fixture: ComponentFixture<FoundationParticipatingOrgsComponent>;
  let getSummary: Mock<(query: FoundationParticipatingOrgsSummaryQuery) => Observable<FoundationParticipatingOrgsSummaryResponse>>;
  let getPage: Mock<(query: FoundationParticipatingOrgsQuery) => Observable<FoundationParticipatingOrgsPage>>;
  let getProjects: Mock<(slug: string, range: FoundationParticipatingOrgsRange) => Observable<FoundationParticipatingOrgsProjectsResponse>>;
  let getBreakdown: Mock<(slug: string, range: FoundationParticipatingOrgsRange, key: string) => Observable<FoundationParticipatingOrgBreakdown>>;
  let exportCsv: Mock<(filters: FoundationParticipatingOrgsExportFilters, kind: FoundationParticipatingOrgsExportKind) => Observable<string | null>>;
  let selectedFoundation: WritableSignal<ProjectContext | null>;

  async function render(): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [FoundationParticipatingOrgsComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        MessageService,
        { provide: ProjectContextService, useValue: { selectedFoundation } },
        { provide: FoundationParticipatingOrgsService, useValue: { getSummary, getPage, getProjects, getBreakdown, exportCsv } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(FoundationParticipatingOrgsComponent);
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
    getSummary = vi.fn(() => of({ summary: summary() }));
    getPage = vi.fn(() => of({ rows: [company()], totalRecords: 1 }));
    getProjects = vi.fn(() => of({ projects: [{ slug: 'project-1', name: 'Synthetic Project 1', maturity: 'Graduated' }] }));
    getBreakdown = vi.fn(() => of(breakdown()));
    exportCsv = vi.fn(() => of(null));
    selectedFoundation = signal<ProjectContext | null>({ uid: 'foundation-uid', name: 'Synthetic Foundation', slug: FOUNDATION_SLUG });
  });

  afterEach(() => {
    // Destroy the page before the module resets, so pending reads and timers end with it rather than during teardown.
    fixture?.destroy();
    TestBed.resetTestingModule();
  });

  it('loads and renders the company table', async () => {
    await render();
    expect(getPage).toHaveBeenCalled();
    expect(text(`foundation-participating-orgs-row-${KEY}-name`)).toBe(SYNTHETIC_ORG_NAME);
    expect(text(`foundation-participating-orgs-row-${KEY}-commits`)).toBe('1,200');
    expect(text(`foundation-participating-orgs-row-${KEY}-membership`)).toContain('Gold Member');
    expect(text(`foundation-participating-orgs-row-${KEY}-membership`)).toContain('Project member');
  });

  it('dates the figures and names LFX Insights as the source', async () => {
    await render();
    expect(text('foundation-participating-orgs-data-line')).toContain('Source: LFX Insights');
    expect(text('foundation-participating-orgs-data-line')).not.toContain('demo');
  });

  it('counts the tabs from the filtered, contributing companies', async () => {
    await render();
    const labels = fixture.componentInstance['tabs']().map((tab) => tab.label);
    expect(labels).toEqual(['All (5)', 'Members (3)', 'Non-Members (2)']);
  });

  it('sends search and tier to the summary as well as the table', async () => {
    await render();
    fixture.componentInstance['filterForm'].controls.tier.setValue('Platinum');
    await settle();
    expect(getSummary).toHaveBeenLastCalledWith(expect.objectContaining({ foundationSlug: FOUNDATION_SLUG, tier: 'Platinum' }));
    expect(getPage).toHaveBeenLastCalledWith(expect.objectContaining({ tier: 'Platinum' }));
  });

  it('loads a company’s breakdown only when its row opens, and folds the tail into Other N projects', async () => {
    await render();
    expect(getBreakdown).not.toHaveBeenCalled();
    query(`foundation-participating-orgs-row-${KEY}-toggle`)?.click();
    await settle();
    expect(getBreakdown).toHaveBeenCalledWith(FOUNDATION_SLUG, '12mo', KEY);
    const panel = text(`foundation-participating-orgs-panel-${KEY}`) ?? '';
    expect(panel).toContain('Synthetic Foundation total');
    expect(panel).toContain('Synthetic Project 10');
    expect(panel).not.toContain('Synthetic Project 11');
    expect(panel).toContain('Other 2 projects');
    expect(panel).toContain('Show all 12 projects');
  });

  it('drops a breakdown that arrives after the range changed', async () => {
    const pending = new Subject<FoundationParticipatingOrgBreakdown>();
    getBreakdown.mockReturnValue(pending);
    await render();
    query(`foundation-participating-orgs-row-${KEY}-toggle`)?.click();
    await settle();
    fixture.componentInstance['filterForm'].controls.range.setValue('90d');
    await settle();
    pending.next(breakdown());
    await settle();
    expect(fixture.componentInstance['breakdowns']()[KEY]?.data ?? null).toBeNull();
  });

  it('offers only the tiers the foundation holds', async () => {
    await render();
    expect(fixture.componentInstance['tierOptions']().map((option) => option.value)).toEqual(['Platinum', 'Gold']);
  });

  it('clears the breakdown filter text along with the cache when the range changes', async () => {
    await render();
    query(`foundation-participating-orgs-row-${KEY}-toggle`)?.click();
    await settle();
    fixture.componentInstance['breakdownFilterForm'].controls[KEY].setValue('project 3');
    fixture.componentInstance['filterForm'].controls.range.setValue('90d');
    await settle();
    expect(fixture.componentInstance['breakdownFilterForm'].contains(KEY)).toBe(false);
  });

  it('drops a selected tier the foundation does not hold, on a foundation switch or a new summary', async () => {
    await render();
    fixture.componentInstance['filterForm'].controls.tier.setValue('Gold');
    await settle();
    selectedFoundation.set({ uid: 'other-uid', name: 'Other Foundation', slug: 'other-foundation' });
    await settle();
    expect(fixture.componentInstance['filterForm'].controls.tier.value).toBeNull();

    fixture.componentInstance['filterForm'].controls.tier.setValue('Silver');
    await settle();
    expect(fixture.componentInstance['filterForm'].controls.tier.value).toBeNull();
  });

  it('never sends a request that mixes the new foundation with the old foundation’s project or tier', async () => {
    await render();
    fixture.componentInstance['filterForm'].controls.project.setValue('project-1');
    fixture.componentInstance['filterForm'].controls.tier.setValue('Gold');
    await settle();
    getSummary.mockClear();
    getPage.mockClear();
    selectedFoundation.set({ uid: 'other-uid', name: 'Other Foundation', slug: 'other-foundation' });
    await settle();
    for (const [query] of [...getSummary.mock.calls, ...getPage.mock.calls]) {
      if (query.foundationSlug === 'other-foundation') {
        expect(query.projectSlug).toBeUndefined();
        expect(query.tier).toBeUndefined();
      }
    }
  });

  it('Clear all applies every cleared filter at once, with no intermediate request that keeps any of them', async () => {
    await render();
    const controls = fixture.componentInstance['filterForm'].controls;
    controls.search.setValue('acme');
    controls.project.setValue('project-1');
    controls.tier.setValue('Platinum');
    controls.range.setValue('90d');
    await new Promise((resolve) => setTimeout(resolve, 400));
    await settle();
    getPage.mockClear();
    fixture.componentInstance['clearFilters']();
    await settle();
    expect(getPage).toHaveBeenCalled();
    for (const [request] of getPage.mock.calls) {
      expect(request.search).toBeUndefined();
      expect(request.projectSlug).toBeUndefined();
      expect(request.tier).toBeUndefined();
      expect(request.range).toBe('12mo');
    }
    expect(fixture.componentInstance['hasActiveFilters']()).toBe(false);
  });

  it('tells a failed refresh of a list already shown from a list that never loaded', async () => {
    getProjects.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500 })));
    await render();
    expect(text('foundation-participating-orgs-projects-error')).toContain("can't scope to a project yet");

    getProjects.mockReturnValue(of({ projects: [{ slug: 'project-1', name: 'Synthetic Project 1', maturity: 'Graduated' }] }));
    fixture.componentInstance['retryProjects']();
    await settle();
    getProjects.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
    fixture.componentInstance['filterForm'].controls.range.setValue('90d');
    await settle();
    expect(text('foundation-participating-orgs-projects-error')).toContain('may be out of date');
  });

  it('names the scoped project by its slug, not as a foundation total, when the project list never loaded', async () => {
    getProjects.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
    await render();
    expect(fixture.componentInstance['projects']()).toEqual([]);
    fixture.componentInstance['filterForm'].controls.project.setValue('project-9');
    await settle();
    expect(fixture.componentInstance['selectedProjectName']()).toBe('project-9');
    expect(query('foundation-participating-orgs-totals-note')).toBeNull();
  });

  it('runs the export when a menu item is activated', async () => {
    await render();
    query('foundation-participating-orgs-export-csv')?.querySelector('button')?.click();
    await settle();
    const item = document.querySelector<HTMLElement>('[data-testid="foundation-participating-orgs-export-by-project"]');
    expect(item).not.toBeNull();
    item?.click();
    await settle();
    expect(exportCsv).toHaveBeenCalledTimes(1);
    expect(exportCsv.mock.calls[0][1]).toBe('by-project');
  });

  it('gives every stat card sub-line the accessible colour, including the Members card once its summary has loaded', async () => {
    await render();
    const tiles = fixture.componentInstance['tiles']();
    expect(tiles).toHaveLength(4);
    expect(tiles.map((tile) => tile.subLineClass)).toEqual(Array(4).fill(FOUNDATION_PARTICIPATING_ORGS_STAT_SUBLINE_CLASS));
  });

  it('names the source without a date when the warehouse reports no build date', async () => {
    getSummary.mockReturnValue(of({ summary: summary({ asOfDate: null }) }));
    await render();
    expect(text('foundation-participating-orgs-data-line')).toBe('Source: LFX Insights');
  });

  it('says nothing about the data source until a summary arrives', async () => {
    getSummary.mockReturnValue(new Subject<FoundationParticipatingOrgsSummaryResponse>());
    await render();
    expect(query('foundation-participating-orgs-data-line')).toBeNull();
  });

  it('drops the project scope when the foundation changes', async () => {
    await render();
    fixture.componentInstance['filterForm'].controls.project.setValue('project-1');
    await settle();
    selectedFoundation.set({ uid: 'other-uid', name: 'Other Foundation', slug: 'other-foundation' });
    await settle();
    expect(fixture.componentInstance['filterForm'].controls.project.value).toBeNull();
  });

  it('Clear all also returns the range to its default', async () => {
    await render();
    fixture.componentInstance['filterForm'].controls.range.setValue('90d');
    await settle();
    expect(fixture.componentInstance['hasActiveFilters']()).toBe(true);
    fixture.componentInstance['clearFilters']();
    await settle();
    expect(fixture.componentInstance['filterForm'].controls.range.value).toBe('12mo');
    expect(fixture.componentInstance['hasActiveFilters']()).toBe(false);
  });

  it('offers a retry when the project list fails, and refetches only that list', async () => {
    getProjects.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500 })));
    await render();
    expect(query('foundation-participating-orgs-projects-error')).not.toBeNull();
    const pageCalls = getPage.mock.calls.length;
    fixture.componentInstance['retryProjects']();
    await settle();
    expect(getProjects).toHaveBeenCalledTimes(2);
    expect(getPage.mock.calls.length).toBe(pageCalls);
    expect(query('foundation-participating-orgs-projects-error')).toBeNull();
  });

  it('shows the no-access state on a 403', async () => {
    getPage.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 403 })));
    await render();
    expect(query('foundation-participating-orgs-no-access')).not.toBeNull();
  });
});
