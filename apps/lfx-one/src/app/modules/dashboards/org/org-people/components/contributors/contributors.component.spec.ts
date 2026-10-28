// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormGroup } from '@angular/forms';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import {
  DEFAULT_ORG_COMMIT_FILTERS,
  EMPTY_ORG_CONTRIBUTORS_RESPONSE,
  ORG_CODE_CONTRIBUTIONS_DEFINITION,
  ORG_COMMITS_DEFINITION,
  ORG_MAIN_BRANCH_COMMITS_DEFINITION,
} from '@lfx-one/shared/constants';
import type { OrgCommitFilters, OrgContributorsResponse, OrgEmploymentFilter, OrgLensTimeRange } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { PersonDetailDrawerService } from '@services/person-detail-drawer.service';
import { Tooltip } from 'primeng/tooltip';
import { Observable, of } from 'rxjs';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import { SYNTHETIC_ORG_ACCOUNT_ID, SYNTHETIC_ORG_NAME } from '../../../../../../../../e2e/fixtures/mock-data/synthetic-org.mock';
import { ContributorsService } from '../../services/contributors.service';
import { ContributorsComponent } from './contributors.component';

const ORG = SYNTHETIC_ORG_ACCOUNT_ID;

/** One person on two projects: commits favour Kubernetes, code contributions favour OpenTelemetry. */
function contributorsResponse(): OrgContributorsResponse {
  return {
    ...EMPTY_ORG_CONTRIBUTORS_RESPONSE,
    accountId: ORG,
    contributors: [
      {
        personKey: 'p-1',
        displayName: 'Ada Lovelace',
        title: null,
        lfid: null,
        lfUsername: null,
        cdpMemberId: 'cdp-1',
        role: 'Contributor',
        commits: 12,
        codeActivities: 340,
        lastActiveTs: '2026-04-12',
        projectsCount: 2,
        mostActiveProjectName: 'Kubernetes',
        mostActiveProjectFoundationName: 'CNCF',
      },
    ],
    projects: [
      {
        personKey: 'p-1',
        projectId: 'k8s',
        projectName: 'Kubernetes',
        projectSlug: 'k8s',
        foundationId: 'cncf',
        foundationName: 'CNCF',
        foundationSlug: 'cncf',
        role: 'Contributor',
        commits: 10,
        codeActivities: 40,
        lastActiveTs: '2026-04-12',
      },
      {
        personKey: 'p-1',
        projectId: 'otel',
        projectName: 'OpenTelemetry',
        projectSlug: 'otel',
        foundationId: 'cncf',
        foundationName: 'CNCF',
        foundationSlug: 'cncf',
        role: 'Contributor',
        commits: 2,
        codeActivities: 300,
        lastActiveTs: '2026-04-01',
      },
    ],
  };
}

describe('ContributorsComponent — commit filters (lfx-self-serve#4164)', () => {
  let fixture: ComponentFixture<ContributorsComponent>;
  let getContributors: Mock<
    (orgUid: string, timeRange: OrgLensTimeRange, filters: OrgCommitFilters, employment: OrgEmploymentFilter) => Observable<OrgContributorsResponse>
  >;

  const el = (): HTMLElement => fixture.nativeElement;
  const text = (testId: string): string => el().querySelector(`[data-testid="${testId}"]`)?.textContent?.trim() ?? '';
  const form = (): FormGroup => (fixture.componentInstance as unknown as { filterForm: FormGroup }).filterForm;

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function mount(initialUrl = '/'): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [ContributorsComponent],
      providers: [
        provideRouter([]),
        { provide: AccountContextService, useValue: { selectedAccount: signal({ uid: ORG, accountName: SYNTHETIC_ORG_NAME }) } },
        { provide: ContributorsService, useValue: { getContributors } },
        { provide: PersonDetailDrawerService, useValue: { open: vi.fn() } },
      ],
    }).compileComponents();

    await TestBed.inject(Router).navigateByUrl(initialUrl);
    fixture = TestBed.createComponent(ContributorsComponent);
    await settle();
  }

  beforeEach(() => {
    getContributors = vi.fn(() => of(contributorsResponse()));
  });

  // lfx-self-serve#4559 — All code contributions is the default code count.
  it('offers one code-count dropdown, All code contributions first and by default, and LF projects first and by default', async () => {
    await mount();

    const options = (fixture.componentInstance as unknown as { metricOptions: { label: string }[] }).metricOptions;
    expect(options.map((option) => option.label)).toEqual(['All code contributions', 'All commits', 'Only main branch commits']);
    expect(fixture.componentInstance['projectScopeOptions'].map((option) => option.label)).toEqual([
      'LF projects',
      'LF and non-LF projects',
      'Non-LF projects',
    ]);
    expect(fixture.componentInstance['projectScopeLabel']).toBe('Project type');
    expect(fixture.componentInstance['projectOptions']()[0]).toEqual({ label: 'Any project', value: '' });
    expect(form().controls['metric'].value).toBe('code');
    expect(form().controls['projectScope'].value).toBe('lf');
    expect(form().contains('commitScope')).toBe(false);
    expect(getContributors).toHaveBeenLastCalledWith(ORG, '365d', { projectScope: 'lf', commitScope: 'all', metric: 'code' }, 'all');
  });

  it('keeps an explicit ?metric=commits in the URL and drops it again for All code contributions', async () => {
    await mount('/?tab=contributors&metric=commits');

    expect(form().controls['metric'].value).toBe('commits');
    expect(getContributors).toHaveBeenLastCalledWith(ORG, '365d', { projectScope: 'lf', commitScope: 'all', metric: 'commits' }, 'all');
    expect(TestBed.inject(Router).url).toBe('/?tab=contributors&metric=commits');

    form().controls['metric'].setValue('code');
    await settle();

    expect(getContributors).toHaveBeenLastCalledWith(ORG, '365d', DEFAULT_ORG_COMMIT_FILTERS, 'all');
    expect(TestBed.inject(Router).url).toBe('/?tab=contributors');
  });

  it.each([
    ['merged', { commitScope: 'merged', metric: 'commits' }],
    ['code', { commitScope: 'all', metric: 'code' }],
  ] as const)('reads metric=%s from the URL and sends %o to the BFF', async (metric, params) => {
    await mount(`/?projectScope=lf&metric=${metric}`);

    expect(form().controls['metric'].value).toBe(metric);
    expect(getContributors).toHaveBeenLastCalledWith(ORG, '365d', { projectScope: 'lf', ...params }, 'all');
  });

  it('opens a legacy commitScope=merged link as Only main branch commits and rewrites it to metric=merged', async () => {
    await mount('/?tab=contributors&projectScope=lf&commitScope=merged');

    expect(form().controls['metric'].value).toBe('merged');
    expect(getContributors).toHaveBeenLastCalledWith(ORG, '365d', { projectScope: 'lf', commitScope: 'merged', metric: 'commits' }, 'all');
    const url = TestBed.inject(Router).url;
    expect(url).toContain('metric=merged');
    expect(url).not.toContain('commitScope=');
  });

  it('reads an unknown value as its default', async () => {
    await mount('/?projectScope=everything&metric=prs');

    expect(getContributors).toHaveBeenLastCalledWith(ORG, '365d', DEFAULT_ORG_COMMIT_FILTERS, 'all');
  });

  it('refetches on a filter change and writes it to the URL, dropping defaults', async () => {
    await mount('/?tab=contributors');

    form().controls['projectScope'].setValue('non_lf');
    await settle();

    expect(getContributors).toHaveBeenLastCalledWith(ORG, '365d', { ...DEFAULT_ORG_COMMIT_FILTERS, projectScope: 'non_lf' }, 'all');
    let url = TestBed.inject(Router).url;
    expect(url).toContain('projectScope=non_lf');
    expect(url).toContain('tab=contributors');
    expect(url).not.toContain('commitScope=');
    expect(url).not.toContain('metric=');

    form().controls['metric'].setValue('merged');
    await settle();

    expect(getContributors).toHaveBeenLastCalledWith(ORG, '365d', { projectScope: 'non_lf', commitScope: 'merged', metric: 'commits' }, 'all');
    url = TestBed.inject(Router).url;
    expect(url).toContain('metric=merged');
    expect(url).not.toContain('commitScope=');

    form().patchValue({ projectScope: 'all', metric: 'code' });
    await settle();

    expect(getContributors).toHaveBeenLastCalledWith(ORG, '365d', { ...DEFAULT_ORG_COMMIT_FILTERS, projectScope: 'all' }, 'all');
    url = TestBed.inject(Router).url;
    expect(url).toContain('projectScope=all');
    expect(url).not.toContain('metric=');

    form().patchValue({ projectScope: 'lf' });
    await settle();

    url = TestBed.inject(Router).url;
    expect(url).not.toContain('projectScope=');
    expect(url).not.toContain('metric=');
  });

  it('shows code contributions by default, commits and merged commits under Commits, with the matching definition', async () => {
    await mount();

    expect(text('org-people-contributors-count-header')).toBe('Code contributions');
    expect(el().querySelector('[data-testid="org-people-contributors-row-p-1"]')?.textContent).toContain('340');
    let info = fixture.debugElement.query(By.css('[data-testid="org-people-contributors-count-header-info"]'));
    expect(info.injector.get(Tooltip).content).toBe(ORG_CODE_CONTRIBUTIONS_DEFINITION);

    form().controls['metric'].setValue('merged');
    await settle();

    expect(getContributors).toHaveBeenLastCalledWith(ORG, '365d', { projectScope: 'lf', commitScope: 'merged', metric: 'commits' }, 'all');
    expect(text('org-people-contributors-count-header')).toBe('Commits');
    info = fixture.debugElement.query(By.css('[data-testid="org-people-contributors-count-header-info"]'));
    expect(info.injector.get(Tooltip).content).toBe(ORG_MAIN_BRANCH_COMMITS_DEFINITION);

    form().controls['metric'].setValue('commits');
    await settle();

    expect(getContributors).toHaveBeenLastCalledWith(ORG, '365d', { projectScope: 'lf', commitScope: 'all', metric: 'commits' }, 'all');
    expect(text('org-people-contributors-count-header')).toBe('Commits');
    expect(el().querySelector('[data-testid="org-people-contributors-row-p-1"]')?.textContent).toContain('12');
    info = fixture.debugElement.query(By.css('[data-testid="org-people-contributors-count-header-info"]'));
    expect(info.injector.get(Tooltip).content).toBe(ORG_COMMITS_DEFINITION);
  });

  it('orders the expanded projects by the metric', async () => {
    await mount('/?metric=code');

    (fixture.componentInstance as unknown as { toggleRow(personKey: string): void }).toggleRow('p-1');
    await settle();

    const detail = el().querySelector('[data-testid="org-people-contributors-row-p-1-detail-row"]')?.textContent ?? '';
    expect(detail.indexOf('OpenTelemetry')).toBeLessThan(detail.indexOf('Kubernetes'));
    expect(detail).toContain('300');
  });

  it('shows Clear filters only while a filter is non-default, the code-count option included', async () => {
    const clear = (): HTMLButtonElement | null => el().querySelector('[data-testid="org-people-contributors-clear-filters"]');
    await mount('/?tab=contributors');

    expect(clear()).toBeNull();

    form().controls['metric'].setValue('merged');
    await settle();

    expect(clear()?.textContent?.trim()).toBe('Clear filters');
  });

  it('clears every filter to its default and drops their URL params, keeping the tab', async () => {
    const clear = (): HTMLButtonElement | null => el().querySelector('[data-testid="org-people-contributors-clear-filters"]');
    await mount('/?tab=contributors&range=90d&projectScope=all&metric=commits');
    form().controls['search'].setValue('ada');
    // Past the filter bar's 150ms debounce.
    await new Promise((resolve) => setTimeout(resolve, 200));
    await settle();

    const callsBeforeClear = getContributors.mock.calls.length;
    clear()?.click();
    await new Promise((resolve) => setTimeout(resolve, 200));
    await settle();

    expect(form().getRawValue()).toEqual({ search: '', foundation: '', project: '', timeRange: '365d', projectScope: 'lf', metric: 'code', employment: 'all' });
    // The range and the commit filters reset together, so one read starts, not one per changed value.
    expect(getContributors).toHaveBeenCalledTimes(callsBeforeClear + 1);
    expect(getContributors).toHaveBeenLastCalledWith(ORG, '365d', DEFAULT_ORG_COMMIT_FILTERS, 'all');
    expect(TestBed.inject(Router).url).toBe('/?tab=contributors');
    expect(clear()).toBeNull();
  });

  it('follows the filter params on a query-only navigation without being recreated, and does not write them back', async () => {
    await mount('/?tab=contributors');
    const instance = fixture.componentInstance;
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate');

    await TestBed.inject(Router).navigateByUrl('/?tab=contributors&projectScope=all&metric=commits');
    await settle();

    expect(fixture.componentInstance).toBe(instance);
    expect(form().getRawValue()).toMatchObject({ projectScope: 'all', metric: 'commits' });
    expect(getContributors).toHaveBeenLastCalledWith(ORG, '365d', { projectScope: 'all', commitScope: 'all', metric: 'commits' }, 'all');
    expect(text('org-people-contributors-count-header')).toBe('Commits');

    await TestBed.inject(Router).navigateByUrl('/?tab=contributors');
    await settle();

    expect(form().getRawValue()).toMatchObject({ projectScope: 'lf', metric: 'code' });
    expect(getContributors).toHaveBeenLastCalledWith(ORG, '365d', DEFAULT_ORG_COMMIT_FILTERS, 'all');
    expect(navigate).not.toHaveBeenCalled();
    expect(TestBed.inject(Router).url).toBe('/?tab=contributors');
  });

  it('clears a picked project and foundation the new project scope no longer returns, so its contributors still show', async () => {
    const lfResponse: OrgContributorsResponse = {
      ...contributorsResponse(),
      foundationOptions: [{ foundationId: 'cncf', foundationName: 'CNCF' }],
      projectOptions: [{ projectId: 'k8s', projectName: 'Kubernetes', foundationName: 'CNCF' }],
    };
    const nonLfResponse: OrgContributorsResponse = {
      ...contributorsResponse(),
      contributors: [{ ...contributorsResponse().contributors[0], personKey: 'p-2', displayName: 'Alan Turing' }],
      projects: [
        { ...contributorsResponse().projects[0], personKey: 'p-2', projectId: 'rails', projectName: 'Rails', foundationId: null, foundationName: null },
      ],
      foundationOptions: [],
      projectOptions: [{ projectId: 'rails', projectName: 'Rails', foundationName: null }],
    };
    getContributors = vi.fn((_orgUid: string, _timeRange: OrgLensTimeRange, filters: OrgCommitFilters) =>
      of(filters.projectScope === 'non_lf' ? nonLfResponse : lfResponse)
    );
    await mount();
    form().patchValue({ foundation: 'cncf', project: 'k8s' });
    // Past the form's 150ms debounce.
    await new Promise((resolve) => setTimeout(resolve, 200));
    await settle();
    expect(el().querySelector('[data-testid="org-people-contributors-row-p-1"]')).not.toBeNull();

    form().controls['projectScope'].setValue('non_lf');
    await settle();

    expect(form().getRawValue()).toMatchObject({ foundation: '', project: '' });
    expect(el().querySelector('[data-testid="org-people-contributors-row-p-2"]')).not.toBeNull();
  });

  it('keeps a picked project the new response still returns', async () => {
    getContributors = vi.fn(() => of({ ...contributorsResponse(), projectOptions: [{ projectId: 'k8s', projectName: 'Kubernetes', foundationName: 'CNCF' }] }));
    await mount();
    form().patchValue({ project: 'k8s' });

    form().controls['projectScope'].setValue('lf');
    await settle();

    expect(form().getRawValue()).toMatchObject({ project: 'k8s' });
  });

  it('reads an empty non-LF result as filtered, not as an org with no contributors', async () => {
    getContributors = vi.fn((_orgUid: string, _timeRange: OrgLensTimeRange, filters: OrgCommitFilters) =>
      of(filters.projectScope === 'non_lf' ? { ...EMPTY_ORG_CONTRIBUTORS_RESPONSE, accountId: ORG } : contributorsResponse())
    );
    await mount('/?projectScope=non_lf');

    expect(text('org-people-contributors-empty')).toContain('No contributors match the current filters.');
  });

  // lfx-self-serve#4160 — the default is LF projects, so an empty default view names it and points at LF and non-LF projects.
  it('names LF projects when the default view is empty', async () => {
    getContributors = vi.fn(() => of({ ...EMPTY_ORG_CONTRIBUTORS_RESPONSE, accountId: ORG }));
    await mount();

    expect(text('org-people-contributors-empty')).toContain('No contributors found for this organization in LF projects.');
    expect(text('org-people-contributors-empty')).toContain('Choose LF and non-LF projects');
  });

  it('shows a dash on the Maintainer roles tile when the roles are unavailable, and the count otherwise', async () => {
    const response = contributorsResponse();
    getContributors = vi.fn(() => of({ ...response, stats: { ...response.stats, maintainerRoles: null } }));
    await mount();
    expect(text('org-people-contributors-stat-maintainers')).toContain('—');
    expect(text('org-people-contributors-stat-maintainers')).not.toMatch(/\d/);

    TestBed.resetTestingModule();
    getContributors = vi.fn(() => of({ ...response, stats: { ...response.stats, maintainerRoles: 1234 } }));
    await mount();
    expect(text('org-people-contributors-stat-maintainers')).toContain('1,234');
  });

  it('shows a dash instead of a Contributor badge on parent and project rows when the roles are unavailable', async () => {
    const response = contributorsResponse();
    getContributors = vi.fn(() => of({ ...response, stats: { ...response.stats, maintainerRoles: null } }));
    await mount();
    fixture.componentInstance['toggleRow']('p-1');
    await settle();

    expect(text('org-people-contributors-row-p-1-role-unavailable')).toBe('—');
    expect(text('org-people-contributors-row-p-1-k8s-role-unavailable')).toBe('—');
    expect(text('org-people-contributors-row-p-1-otel-role-unavailable')).toBe('—');
    expect([...el().querySelectorAll('tbody span')].some((span) => span.textContent?.trim() === 'Contributor')).toBe(false);
  });

  it('opens the person drawer for the range the tab lists the person in', async () => {
    await mount('/?range=90d');
    const open = (TestBed.inject(PersonDetailDrawerService) as unknown as { open: Mock }).open;

    (fixture.componentInstance as unknown as { onPersonClick(row: object, event: Event): void }).onPersonClick(
      { personKey: 'p-1', displayName: 'Ada', title: null, initials: 'A', avatarColorClass: '' },
      new Event('click')
    );

    expect(open).toHaveBeenCalledWith(expect.objectContaining({ personKey: 'p-1', range: '90d' }));
  });
});

describe('ContributorsComponent — shared range (lfx-self-serve#4159)', () => {
  let fixture: ComponentFixture<ContributorsComponent>;
  let getContributors: Mock<
    (orgUid: string, timeRange: OrgLensTimeRange, filters: OrgCommitFilters, employment: OrgEmploymentFilter) => Observable<OrgContributorsResponse>
  >;

  const form = (): FormGroup => (fixture.componentInstance as unknown as { filterForm: FormGroup }).filterForm;
  const router = (): Router => TestBed.inject(Router);

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function mount(initialUrl: string): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [ContributorsComponent],
      providers: [
        provideRouter([]),
        { provide: AccountContextService, useValue: { selectedAccount: signal({ uid: ORG, accountName: SYNTHETIC_ORG_NAME }) } },
        { provide: ContributorsService, useValue: { getContributors } },
        { provide: PersonDetailDrawerService, useValue: { open: vi.fn() } },
      ],
    }).compileComponents();

    await router().navigateByUrl(initialUrl);
    fixture = TestBed.createComponent(ContributorsComponent);
    await settle();
  }

  beforeEach(() => {
    getContributors = vi.fn(() => of(contributorsResponse()));
  });

  it('opens on the range another tab left in the URL', async () => {
    await mount('/?tab=contributors&range=90d');

    expect(form().controls['timeRange'].value).toBe('90d');
    expect(getContributors).toHaveBeenLastCalledWith(ORG, '90d', DEFAULT_ORG_COMMIT_FILTERS, 'all');
  });

  it('reads a retired or unknown range as Past 365 days', async () => {
    await mount('/?tab=contributors&range=12mo');

    expect(getContributors).toHaveBeenLastCalledWith(ORG, '365d', DEFAULT_ORG_COMMIT_FILTERS, 'all');
  });

  it('writes a picked range to the URL, keeping the tab, and drops it at the default', async () => {
    await mount('/?tab=contributors');

    form().controls['timeRange'].setValue('30d');
    await settle();

    expect(router().url).toBe('/?tab=contributors&range=30d');
    expect(getContributors).toHaveBeenLastCalledWith(ORG, '30d', DEFAULT_ORG_COMMIT_FILTERS, 'all');

    form().controls['timeRange'].setValue('365d');
    await settle();

    expect(router().url).toBe('/?tab=contributors');
  });

  it('follows a range written by another tab or a nav link without navigating again', async () => {
    await mount('/?tab=contributors');
    const navigate = vi.spyOn(router(), 'navigate');

    await router().navigateByUrl('/?tab=contributors&range=all');
    await settle();

    expect(form().controls['timeRange'].value).toBe('all');
    expect(getContributors).toHaveBeenLastCalledWith(ORG, 'all', DEFAULT_ORG_COMMIT_FILTERS, 'all');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('reads the picked range for the filtering state and the tooltip without waiting for the search debounce', async () => {
    getContributors = vi.fn(() => of({ ...EMPTY_ORG_CONTRIBUTORS_RESPONSE, accountId: ORG }));
    await mount('/?tab=contributors');
    const component = fixture.componentInstance as unknown as { isFiltering: () => boolean; contributorsTooltip: () => string };
    expect(component.isFiltering()).toBe(false);

    form().controls['timeRange'].setValue('all');

    expect(component.isFiltering()).toBe(true);
    expect(component.contributorsTooltip()).toContain('across all recorded history');
  });

  it('keeps the range when the organization changes', async () => {
    await mount('/?tab=contributors&range=90d');
    (fixture.componentInstance as unknown as { resetAllState(): void }).resetAllState();
    await settle();

    expect(form().controls['timeRange'].value).toBe('90d');
    expect(router().url).toContain('range=90d');
  });
});

describe('ContributorsComponent — employment filter (lfx-self-serve#4627)', () => {
  let fixture: ComponentFixture<ContributorsComponent>;
  let getContributors: Mock<
    (orgUid: string, timeRange: OrgLensTimeRange, filters: OrgCommitFilters, employment: OrgEmploymentFilter) => Observable<OrgContributorsResponse>
  >;

  const el = (): HTMLElement => fixture.nativeElement;
  const form = (): FormGroup => (fixture.componentInstance as unknown as { filterForm: FormGroup }).filterForm;
  const router = (): Router => TestBed.inject(Router);
  const clear = (): HTMLButtonElement | null => el().querySelector('[data-testid="org-people-contributors-clear-filters"]');

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function mount(initialUrl: string): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [ContributorsComponent],
      providers: [
        provideRouter([]),
        { provide: AccountContextService, useValue: { selectedAccount: signal({ uid: ORG, accountName: SYNTHETIC_ORG_NAME }) } },
        { provide: ContributorsService, useValue: { getContributors } },
        { provide: PersonDetailDrawerService, useValue: { open: vi.fn() } },
      ],
    }).compileComponents();

    await router().navigateByUrl(initialUrl);
    fixture = TestBed.createComponent(ContributorsComponent);
    await settle();
  }

  beforeEach(() => {
    getContributors = vi.fn(() => of(contributorsResponse()));
  });

  it('offers an Employment dropdown showing All employees by default, so former employees are listed like on the Overview', async () => {
    await mount('/?tab=contributors');

    const select = el().querySelector('[data-test="org-people-contributors-employment-filter"]');
    const labelled = select?.querySelector('[aria-label="Employment"]');
    expect(labelled).not.toBeNull();
    expect(labelled?.textContent?.trim()).toBe('All employees');
    expect((fixture.componentInstance as unknown as { employmentOptions: { label: string }[] }).employmentOptions.map((option) => option.label)).toEqual([
      'Current employees',
      'Former employees',
      'All employees',
    ]);
    expect(form().controls['employment'].value).toBe('all');
    expect(getContributors).toHaveBeenLastCalledWith(ORG, '365d', DEFAULT_ORG_COMMIT_FILTERS, 'all');
    expect(router().url).toBe('/?tab=contributors');
    expect(clear()).toBeNull();
  });

  it('reads ?employment=current into the picker and the request, and keeps it in the URL', async () => {
    await mount('/?tab=contributors&employment=current');

    expect(form().controls['employment'].value).toBe('current');
    expect(getContributors).toHaveBeenLastCalledWith(ORG, '365d', DEFAULT_ORG_COMMIT_FILTERS, 'current');
    expect(router().url).toBe('/?tab=contributors&employment=current');
    expect(clear()?.textContent?.trim()).toBe('Clear filters');
  });

  it('refetches on a pick and writes it to the URL, dropping it again at All', async () => {
    await mount('/?tab=contributors');

    form().controls['employment'].setValue('current');
    await settle();

    expect(getContributors).toHaveBeenLastCalledWith(ORG, '365d', DEFAULT_ORG_COMMIT_FILTERS, 'current');
    expect(router().url).toBe('/?tab=contributors&employment=current');

    form().controls['employment'].setValue('all');
    await settle();

    expect(getContributors).toHaveBeenLastCalledWith(ORG, '365d', DEFAULT_ORG_COMMIT_FILTERS, 'all');
    expect(router().url).toBe('/?tab=contributors');
  });

  it('follows ?employment= on a query-only navigation without navigating again', async () => {
    await mount('/?tab=contributors');
    const navigate = vi.spyOn(router(), 'navigate');

    await router().navigateByUrl('/?tab=contributors&employment=former');
    await settle();

    expect(form().controls['employment'].value).toBe('former');
    expect(getContributors).toHaveBeenLastCalledWith(ORG, '365d', DEFAULT_ORG_COMMIT_FILTERS, 'former');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('reads an explicit or unknown ?employment= as All without rewriting the URL', async () => {
    await mount('/?tab=contributors&employment=everyone');

    expect(form().controls['employment'].value).toBe('all');
    expect(getContributors).toHaveBeenLastCalledWith(ORG, '365d', DEFAULT_ORG_COMMIT_FILTERS, 'all');
    expect(router().url).toBe('/?tab=contributors&employment=everyone');
  });

  it('Clear filters resets employment to All with the other filters, in one read, and drops the param', async () => {
    await mount('/?tab=contributors&range=90d&employment=current');
    const callsBeforeClear = getContributors.mock.calls.length;

    clear()?.click();
    await settle();

    expect(form().controls['employment'].value).toBe('all');
    expect(getContributors).toHaveBeenCalledTimes(callsBeforeClear + 1);
    expect(getContributors).toHaveBeenLastCalledWith(ORG, '365d', DEFAULT_ORG_COMMIT_FILTERS, 'all');
    expect(router().url).toBe('/?tab=contributors');
    expect(clear()).toBeNull();
  });

  it('reads an empty result under Current employees as filtered, not as an org with no contributors', async () => {
    getContributors = vi.fn(() => of({ ...EMPTY_ORG_CONTRIBUTORS_RESPONSE, accountId: ORG }));
    await mount('/?tab=contributors&employment=current');

    expect(el().querySelector('[data-testid="org-people-contributors-empty"]')?.textContent).toContain('No contributors match the current filters.');
  });

  it('says on the Maintainer roles tile that it does not follow the Employment filter', async () => {
    await mount('/?tab=contributors&employment=former');

    const info = fixture.debugElement.query(By.css('[data-testid="org-people-contributors-stat-maintainers-info"]'));
    expect(info.injector.get(Tooltip).content).toContain('It does not follow the Employment filter.');
  });
});
