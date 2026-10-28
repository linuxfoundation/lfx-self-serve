// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import {
  CONTRIBUTIONS_MAX_FILTER_VALUES,
  EMPTY_ORG_CONTRIBUTIONS_RESPONSE,
  ORG_CODE_CONTRIBUTIONS_DEFINITION,
  ORG_COMMITS_DEFINITION,
  ORG_MAIN_BRANCH_COMMITS_DEFINITION,
} from '@lfx-one/shared/constants';
import type { Account, OrgContributionsResponse, OrgLensEmptyStateName } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensEmptyStateService } from '@services/org-lens-empty-state.service';
import { OrgRoleGrantsService } from '@services/org-role-grants.service';
import { PersonDetailDrawerService } from '@services/person-detail-drawer.service';
import { MessageService } from 'primeng/api';
import { BehaviorSubject, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { OrgContributionsComponent } from './org-contributions.component';
import { ContributionsService } from './services/contributions.service';

// <lfx-person-detail-drawer /> is mounted unconditionally, so it needs the signal surface it reads.
function personDrawerStub() {
  return {
    isOpen: signal(false),
    activeContext: signal(null),
    activeTab: signal('events'),
    loading: signal(false),
    error: signal(false),
    emailError: signal(false),
    emailsLoading: signal(false),
    identityUnavailable: signal(false),
    companyEmailsResolved: signal(false),
    detail: signal(null),
    companyEmails: signal([]),
    open: vi.fn(),
    close: vi.fn(),
    setTab: vi.fn(),
  };
}

async function render(
  state: OrgLensEmptyStateName | null,
  { settled = true, queryParams = {} as Record<string, string>, response = EMPTY_ORG_CONTRIBUTIONS_RESPONSE as OrgContributionsResponse } = {}
) {
  const pageState = signal<OrgLensEmptyStateName | null>(state);
  const getContributions = vi.fn(() => of(response));
  const selectedAccount = signal<Account>({ accountId: 'acc-1', accountName: 'Acme Motors, Inc.', membershipTier: '', uid: 'org-uid-1', slug: 'acme' });
  const queryParamMap = new BehaviorSubject(convertToParamMap(queryParams));

  await TestBed.configureTestingModule({
    imports: [OrgContributionsComponent],
    providers: [
      provideRouter([]),
      MessageService,
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: queryParamMap.value }, queryParamMap } },
      { provide: AccountContextService, useValue: { selectedAccount } },
      { provide: OrgRoleGrantsService, useValue: { correlationId: signal(null) } },
      {
        provide: OrgLensEmptyStateService,
        useValue: {
          pageState,
          hasPageState: computed(() => pageState() !== null),
          pageReady: signal(true),
          settled: signal(settled),
          retrying: signal(false),
          retry: vi.fn(),
        },
      },
      { provide: ContributionsService, useValue: { getContributions } },
      { provide: PersonDetailDrawerService, useValue: personDrawerStub() },
    ],
  }).compileComponents();

  const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  const fixture = TestBed.createComponent(OrgContributionsComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, navigate, getContributions, queryParamMap };
}

describe('OrgContributionsComponent', () => {
  it('replaces the page with the contractor-no-grant state and renders none of its data sections', async () => {
    const el = (await render('contractor-no-grant')).fixture.nativeElement as HTMLElement;

    expect(el.querySelector('[data-testid="org-contributions-no-access-state"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="org-contributions-kpis"]')).toBeNull();
    expect(el.querySelector('[data-testid="org-contributions-content-card"]')).toBeNull();
    expect(el.querySelector('[data-testid="org-contributions-no-company-empty-state"]')).toBeNull();
  });

  it('shows a skeleton instead of a blank area while the org context is still settling', async () => {
    const el = (await render(null, { settled: false })).fixture.nativeElement as HTMLElement;

    expect(el.querySelector('[data-testid="org-contributions-skeleton"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="org-contributions-kpis"]')).toBeNull();
    expect(el.querySelector('[data-testid="org-contributions-content-card"]')).toBeNull();
    expect(el.querySelector('[data-testid="org-contributions-no-company-empty-state"]')).toBeNull();
  });

  it('trims an over-cap filter selection (e.g. keyboard select-all past selectionLimit) to the cap in the form itself', async () => {
    const { fixture } = await render(null);
    const { projects, employees } = fixture.componentInstance['filterForm'].controls;
    const overCap = Array.from({ length: CONTRIBUTIONS_MAX_FILTER_VALUES + 10 }, (_, i) => `value-${i}`);

    projects.setValue(overCap);
    employees.setValue(overCap);

    expect(projects.value).toEqual(overCap.slice(0, CONTRIBUTIONS_MAX_FILTER_VALUES));
    expect(employees.value).toEqual(overCap.slice(0, CONTRIBUTIONS_MAX_FILTER_VALUES));
  });

  it('rewrites an oversized deep link to the trimmed filters so the URL matches the form and request', async () => {
    const overCap = Array.from({ length: CONTRIBUTIONS_MAX_FILTER_VALUES + 10 }, (_, i) => `value-${i}`);
    const { fixture, navigate } = await render(null, { queryParams: { projects: overCap.join(',') } });
    const capped = overCap.slice(0, CONTRIBUTIONS_MAX_FILTER_VALUES);

    expect(fixture.componentInstance['filterForm'].controls.projects.value).toEqual(capped);
    expect(navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ queryParams: expect.objectContaining({ projects: capped.join(',') }), replaceUrl: true })
    );
  });

  it('leaves an already-canonical deep link untouched on load', async () => {
    const { navigate } = await render(null, { queryParams: { projects: 'alpha,beta' } });

    expect(navigate).not.toHaveBeenCalled();
  });

  it('offers one code-count dropdown, Commits by default, LF projects first and by default, and sends the default BFF params', async () => {
    const { fixture, getContributions } = await render(null);
    const { controls } = fixture.componentInstance['filterForm'];

    expect(fixture.componentInstance['metricOptions'].map((option) => option.label)).toEqual([
      'All commits',
      'Only main branch commits',
      'All code contributions',
    ]);
    expect(fixture.componentInstance['projectScopeOptions'].map((option) => option.label)).toEqual([
      'LF projects',
      'LF and non-LF projects',
      'Non-LF projects',
    ]);
    expect(controls.metric.value).toBe('commits');
    expect(controls.projectScope.value).toBe('lf');
    expect('commitScope' in controls).toBe(false);
    expect(getContributions).toHaveBeenLastCalledWith('org-uid-1', expect.objectContaining({ projectScope: 'lf', commitScope: 'all', metric: 'commits' }));
  });

  // lfx-self-serve#4160 — LF projects is the default, so it stays out of the URL; LF and non-LF projects (the Insights comparison) is written.
  it('opens ?projectScope=all on every project and keeps it in the URL, then drops it again for LF projects', async () => {
    const { fixture, navigate, getContributions } = await render(null, { queryParams: { projectScope: 'all' } });
    const { projectScope } = fixture.componentInstance['filterForm'].controls;

    expect(projectScope.value).toBe('all');
    expect(getContributions).toHaveBeenLastCalledWith('org-uid-1', expect.objectContaining({ projectScope: 'all' }));
    expect(navigate).not.toHaveBeenCalled();
    expect(fixture.componentInstance['windowCaption']()).toContain(' in LF and non-LF projects, ');

    projectScope.setValue('lf');
    // Past the form's 250ms debounce.
    await new Promise((resolve) => setTimeout(resolve, 300));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(getContributions).toHaveBeenLastCalledWith('org-uid-1', expect.objectContaining({ projectScope: 'lf' }));
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: expect.objectContaining({ projectScope: null }) }));
    expect(fixture.componentInstance['windowCaption']()).toContain(' in LF projects, ');
  });

  it.each([
    ['merged', { commitScope: 'merged', metric: 'commits' }, 'Commits', 'only commits on the main branch', ORG_MAIN_BRANCH_COMMITS_DEFINITION],
    ['code', { commitScope: 'all', metric: 'code' }, 'Code contributions', 'Code contributions (commits, pull requests', ORG_CODE_CONTRIBUTIONS_DEFINITION],
    ['commits', { commitScope: 'all', metric: 'commits' }, 'Commits', 'on any branch', ORG_COMMITS_DEFINITION],
  ] as const)('maps metric=%s to the BFF params %o, labels, tooltip and caption, and writes it to the URL', async (picked, params, label, caption, tooltip) => {
    const { fixture, navigate, getContributions } = await render(null, { queryParams: picked === 'commits' ? { metric: 'code' } : {} });
    const { projectScope, metric } = fixture.componentInstance['filterForm'].controls;

    projectScope.setValue('non_lf');
    metric.setValue(picked);
    // Past the form's 250ms debounce.
    await new Promise((resolve) => setTimeout(resolve, 300));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(getContributions).toHaveBeenLastCalledWith('org-uid-1', expect.objectContaining({ projectScope: 'non_lf', ...params }));
    expect(navigate).toHaveBeenLastCalledWith(
      [],
      expect.objectContaining({
        queryParams: expect.objectContaining({ projectScope: 'non_lf', commitScope: null, metric: picked === 'commits' ? null : picked }),
      })
    );
    expect(fixture.componentInstance['kpiCards']().map((card) => card.label)).toContain(label);
    expect(fixture.componentInstance['windowCaption']()).toContain(caption);
    expect(fixture.componentInstance['metricDefinition']()).toBe(tooltip);
  });

  it('reads an unknown metric as Commits and drops it from the URL on load, keeping ?projectScope=all', async () => {
    const { fixture, navigate, getContributions } = await render(null, { queryParams: { projectScope: 'all', metric: 'bogus' } });

    expect(fixture.componentInstance['filterForm'].controls.metric.value).toBe('commits');
    expect(getContributions).toHaveBeenLastCalledWith('org-uid-1', expect.objectContaining({ projectScope: 'all', commitScope: 'all', metric: 'commits' }));
    expect(navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ queryParams: expect.objectContaining({ projectScope: 'all', commitScope: null, metric: null }), replaceUrl: true })
    );
  });

  it('opens a legacy commitScope=merged link as Only main branch commits and rewrites it to metric=merged', async () => {
    const { fixture, navigate, getContributions } = await render(null, { queryParams: { commitScope: 'merged' } });

    expect(fixture.componentInstance['filterForm'].controls.metric.value).toBe('merged');
    expect(getContributions).toHaveBeenLastCalledWith('org-uid-1', expect.objectContaining({ commitScope: 'merged', metric: 'commits' }));
    expect(navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ queryParams: expect.objectContaining({ commitScope: null, metric: 'merged' }), replaceUrl: true })
    );
  });

  it('opens a legacy commitScope=merged&metric=code link as All code contributions', async () => {
    const { fixture, getContributions } = await render(null, { queryParams: { commitScope: 'merged', metric: 'code' } });

    expect(fixture.componentInstance['filterForm'].controls.metric.value).toBe('code');
    expect(getContributions).toHaveBeenLastCalledWith('org-uid-1', expect.objectContaining({ commitScope: 'all', metric: 'code' }));
  });

  it('shows Clear filters at the end of the filter bar only while a filter is non-default, the code-count option included', async () => {
    const clear = (el: HTMLElement): HTMLButtonElement | null => el.querySelector('[data-testid="org-contributions-filter-bar-clear-filters"]');

    expect(clear((await render(null)).fixture.nativeElement)).toBeNull();
    TestBed.resetTestingModule();
    const { fixture } = await render(null, { queryParams: { metric: 'merged' } });
    expect(clear(fixture.nativeElement)?.textContent?.trim()).toBe('Clear filters');
  });

  it('clears every filter to its default and drops their URL params, keeping the tab', async () => {
    const { fixture, navigate, getContributions } = await render(null, {
      queryParams: { view: 'commits', q: 'kube', range: '90d', projectScope: 'all', metric: 'code', foundation: 'f-cncf', projects: 'alpha', employees: 'e-1' },
    });
    const el = fixture.nativeElement as HTMLElement;
    const clear = (): HTMLButtonElement | null => el.querySelector('[data-testid="org-contributions-filter-bar-clear-filters"]');

    clear()?.click();
    // Past the form's 250ms debounce.
    await new Promise((resolve) => setTimeout(resolve, 300));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance['filterForm'].getRawValue()).toEqual({
      search: '',
      dateRange: '365d',
      foundation: '',
      projects: [],
      employees: [],
      projectScope: 'lf',
      metric: 'commits',
    });
    expect(getContributions).toHaveBeenLastCalledWith(
      'org-uid-1',
      expect.objectContaining({
        view: 'commits',
        search: '',
        dateRange: '365d',
        foundation: '',
        projects: [],
        employees: [],
        projectScope: 'lf',
        commitScope: 'all',
        metric: 'commits',
      })
    );
    expect(navigate).toHaveBeenLastCalledWith(
      [],
      expect.objectContaining({
        queryParams: expect.objectContaining({
          view: 'commits',
          q: null,
          range: null,
          projectScope: null,
          commitScope: null,
          metric: null,
          foundation: null,
          projects: null,
          employees: null,
        }),
      })
    );
    expect(clear()).toBeNull();
  });

  it('follows the commit filters on a query-only navigation without being recreated, ignoring the echo of its own URL write', async () => {
    const { fixture, navigate, getContributions, queryParamMap } = await render(null);
    const instance = fixture.componentInstance;

    queryParamMap.next(convertToParamMap({ projectScope: 'non_lf', metric: 'code' }));
    // Past the form's 250ms debounce.
    await new Promise((resolve) => setTimeout(resolve, 300));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance).toBe(instance);
    const { projectScope, metric } = fixture.componentInstance['filterForm'].controls;
    expect([projectScope.value, metric.value]).toEqual(['non_lf', 'code']);
    expect(getContributions).toHaveBeenLastCalledWith('org-uid-1', expect.objectContaining({ projectScope: 'non_lf', commitScope: 'all', metric: 'code' }));
    expect(fixture.componentInstance['kpiCards']().map((card) => card.label)).toContain('Code contributions');

    // The page's own write of the same params comes back through the URL; it must not patch the form again.
    const patchValue = vi.spyOn(fixture.componentInstance['filterForm'], 'patchValue');
    queryParamMap.next(convertToParamMap({ projectScope: 'non_lf', metric: 'code', page: '1' }));
    expect(patchValue).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenLastCalledWith(
      [],
      expect.objectContaining({ queryParams: expect.objectContaining({ projectScope: 'non_lf', commitScope: null, metric: 'code' }) })
    );
  });

  // `?range=` is shared with the People tabs and carried by the nav links, so the page opens on and follows it.
  it('opens on the range carried from People, with the Insights-style options narrowest first', async () => {
    const { fixture, getContributions, navigate } = await render(null, { queryParams: { range: '90d' } });

    expect(fixture.componentInstance['filterForm'].controls.dateRange.value).toBe('90d');
    expect(getContributions).toHaveBeenLastCalledWith('org-uid-1', expect.objectContaining({ dateRange: '90d' }));
    expect(fixture.componentInstance['dateRangeOptions'].map((option) => option.label)).toEqual([
      'Past 30 days',
      'Past 90 days',
      'Past 365 days',
      'Past 2 years',
      'All time',
    ]);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('opens on Past 2 years and keeps ?range=730d in the URL', async () => {
    const { fixture, getContributions, navigate } = await render(null, { queryParams: { range: '730d' } });

    expect(fixture.componentInstance['filterForm'].controls.dateRange.value).toBe('730d');
    expect(getContributions).toHaveBeenLastCalledWith('org-uid-1', expect.objectContaining({ dateRange: '730d' }));
    expect(navigate).not.toHaveBeenCalled();
  });

  it.each(['12mo', '365d', '2y'])('reads a retired, default or unknown ?range=%s as Past 365 days and drops it from the URL on load', async (range) => {
    const { getContributions, navigate } = await render(null, { queryParams: { range } });

    expect(getContributions).toHaveBeenLastCalledWith('org-uid-1', expect.objectContaining({ dateRange: '365d' }));
    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: expect.objectContaining({ range: null }), replaceUrl: true }));
  });

  it.each([
    ['commits', { one: '1 commit', other: '25 commits' }],
    ['code', { one: '1 contribution', other: '25 contributions' }],
  ] as const)('labels the project and employee filter options with a singular or plural %s unit', async (metric, expected) => {
    const response: OrgContributionsResponse = {
      ...EMPTY_ORG_CONTRIBUTIONS_RESPONSE,
      accountId: 'org-uid-1',
      projectOptions: [
        { slug: 'one', projectId: 'p-1', name: 'One', commits: 1, foundationId: null },
        { slug: 'many', projectId: 'p-2', name: 'Many', commits: 25, foundationId: null },
      ],
      employeeOptions: [
        { id: 'e-1', displayName: 'Ada', commits: 1 },
        { id: 'e-2', displayName: 'Grace', commits: 25 },
      ],
    };
    const { fixture } = await render(null, { queryParams: { metric }, response });

    expect(fixture.componentInstance['projectOptions']().map((option) => option.sublabel)).toEqual([expected.one, expected.other]);
    expect(fixture.componentInstance['employeeOptions']().map((option) => option.sublabel)).toEqual([expected.one, expected.other]);
  });

  // lfx-self-serve#4559 — a Foundation filter that means what it means on People → Contributors.
  it('opens ?foundation= into the Foundation dropdown and request, writes a new pick and drops it when cleared', async () => {
    const response: OrgContributionsResponse = {
      ...EMPTY_ORG_CONTRIBUTIONS_RESPONSE,
      accountId: 'org-uid-1',
      foundationOptions: [
        { foundationId: 'f-cncf', foundationName: 'CNCF' },
        { foundationId: 'f-lfai', foundationName: 'LF AI & Data' },
      ],
    };
    const { fixture, navigate, getContributions } = await render(null, { queryParams: { foundation: 'f-cncf' }, response });
    const { foundation } = fixture.componentInstance['filterForm'].controls;
    const settle = async () => {
      // Past the form's 250ms debounce.
      await new Promise((resolve) => setTimeout(resolve, 300));
      fixture.detectChanges();
      await fixture.whenStable();
    };

    expect(foundation.value).toBe('f-cncf');
    expect(fixture.componentInstance['foundationOptions']()).toEqual([
      { label: 'All Foundations', value: '' },
      { label: 'CNCF', value: 'f-cncf' },
      { label: 'LF AI & Data', value: 'f-lfai' },
    ]);
    expect(getContributions).toHaveBeenLastCalledWith('org-uid-1', expect.objectContaining({ foundation: 'f-cncf' }));
    expect(navigate).not.toHaveBeenCalled();

    foundation.setValue('f-lfai');
    await settle();
    expect(getContributions).toHaveBeenLastCalledWith('org-uid-1', expect.objectContaining({ foundation: 'f-lfai' }));
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: expect.objectContaining({ foundation: 'f-lfai' }) }));

    foundation.setValue('');
    await settle();
    expect(getContributions).toHaveBeenLastCalledWith('org-uid-1', expect.objectContaining({ foundation: '' }));
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: expect.objectContaining({ foundation: null }) }));
  });

  it('rewrites an untrimmed ?foundation= on load', async () => {
    const { fixture, navigate } = await render(null, { queryParams: { foundation: ' f-cncf ' } });

    expect(fixture.componentInstance['filterForm'].controls.foundation.value).toBe('f-cncf');
    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: expect.objectContaining({ foundation: 'f-cncf' }), replaceUrl: true }));
  });

  describe('projects and the picked foundation', () => {
    const response: OrgContributionsResponse = {
      ...EMPTY_ORG_CONTRIBUTIONS_RESPONSE,
      accountId: 'org-uid-1',
      foundationOptions: [
        { foundationId: 'f-cncf', foundationName: 'CNCF' },
        { foundationId: 'f-lfai', foundationName: 'LF AI & Data' },
      ],
      projectOptions: [
        { slug: 'k8s', projectId: 'p-k8s', name: 'Kubernetes', commits: 5, foundationId: 'f-cncf' },
        { slug: 'onnx', projectId: 'p-onnx', name: 'ONNX', commits: 3, foundationId: 'f-lfai' },
        { slug: 'solo', projectId: 'p-solo', name: 'Solo', commits: 1, foundationId: null },
      ],
    };

    it("lists only the picked foundation's projects, and every project for All Foundations", async () => {
      const { fixture } = await render(null, { queryParams: { foundation: 'f-lfai' }, response });
      expect(fixture.componentInstance['projectOptions']().map((option) => option.label)).toEqual(['ONNX']);
      TestBed.resetTestingModule();

      const all = await render(null, { response });
      expect(all.fixture.componentInstance['projectOptions']().map((option) => option.label)).toEqual(['Kubernetes', 'ONNX', 'Solo']);
    });

    it('drops the selected projects the options place in another foundation, keeps unlisted ones, and keeps them all for All Foundations', async () => {
      const { fixture } = await render(null, { queryParams: { projects: 'k8s,p-onnx,solo,ghost' }, response });
      const { foundation, projects } = fixture.componentInstance['filterForm'].controls;

      foundation.setValue('');
      expect(projects.value).toEqual(['k8s', 'p-onnx', 'solo', 'ghost']);

      foundation.setValue('f-lfai');
      expect(projects.value).toEqual(['p-onnx', 'ghost']);
    });

    it('reconciles a deep link once the first response brings the options, and refetches without the dropped pick', async () => {
      const { fixture, getContributions } = await render(null, { queryParams: { foundation: 'f-lfai', projects: 'k8s,ghost' }, response });

      expect(getContributions).toHaveBeenCalledWith('org-uid-1', expect.objectContaining({ foundation: 'f-lfai', projects: ['k8s', 'ghost'] }));
      expect(fixture.componentInstance['filterForm'].controls.projects.value).toEqual(['ghost']);

      // Past the form's 250ms debounce.
      await new Promise((resolve) => setTimeout(resolve, 300));
      fixture.detectChanges();
      await fixture.whenStable();
      expect(getContributions).toHaveBeenLastCalledWith('org-uid-1', expect.objectContaining({ foundation: 'f-lfai', projects: ['ghost'] }));
    });

    it('fetches nothing more when the response drops no pick', async () => {
      const { fixture, getContributions } = await render(null, { queryParams: { foundation: 'f-lfai', projects: 'onnx,ghost' }, response });
      const calls = getContributions.mock.calls.length;

      await new Promise((resolve) => setTimeout(resolve, 300));
      fixture.detectChanges();
      await fixture.whenStable();
      expect(fixture.componentInstance['filterForm'].controls.projects.value).toEqual(['onnx', 'ghost']);
      expect(getContributions).toHaveBeenCalledTimes(calls);
    });
  });

  it('follows ?foundation= on a query-only navigation, its removal included, ignoring the echo of its own URL write', async () => {
    const { fixture, getContributions, queryParamMap } = await render(null, { queryParams: { foundation: 'f-cncf' } });
    const { foundation } = fixture.componentInstance['filterForm'].controls;
    const settle = async () => {
      // Past the form's 250ms debounce.
      await new Promise((resolve) => setTimeout(resolve, 300));
      fixture.detectChanges();
      await fixture.whenStable();
    };

    queryParamMap.next(convertToParamMap({ foundation: 'f-lfai' }));
    await settle();
    expect(foundation.value).toBe('f-lfai');
    expect(getContributions).toHaveBeenLastCalledWith('org-uid-1', expect.objectContaining({ foundation: 'f-lfai' }));

    const patchValue = vi.spyOn(fixture.componentInstance['filterForm'], 'patchValue');
    queryParamMap.next(convertToParamMap({ foundation: 'f-lfai', page: '1' }));
    expect(patchValue).not.toHaveBeenCalled();

    queryParamMap.next(convertToParamMap({}));
    await settle();
    expect(foundation.value).toBe('');
    expect(getContributions).toHaveBeenLastCalledWith('org-uid-1', expect.objectContaining({ foundation: '' }));
  });

  it('follows a range on a query-only navigation and drops the default from the URL it writes', async () => {
    const { fixture, navigate, getContributions, queryParamMap } = await render(null);

    queryParamMap.next(convertToParamMap({ range: 'all' }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(getContributions).toHaveBeenLastCalledWith('org-uid-1', expect.objectContaining({ dateRange: 'all' }));
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: expect.objectContaining({ range: 'all' }) }));

    fixture.componentInstance['filterForm'].controls.dateRange.setValue('365d');
    await new Promise((resolve) => setTimeout(resolve, 300));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: expect.objectContaining({ range: null }) }));
  });

  it('labels the KPI and repository columns by the metric', async () => {
    // The table renders its header only with at least one row.
    const response: OrgContributionsResponse = {
      ...EMPTY_ORG_CONTRIBUTIONS_RESPONSE,
      accountId: 'org-uid-1',
      totalRecords: 1,
      repositories: [
        {
          repositoryId: 'https://github.com/acme/widgets',
          repositoryPath: 'acme/widgets',
          projectId: 'p-1',
          projectName: 'Widgets',
          projectSlug: 'widgets',
          projectLogoUrl: null,
          source: 'github',
          upstreamUrl: 'https://github.com/acme/widgets',
          commits: 7,
          firstCommitTs: '2025-01-01T00:00:00Z',
          lastCommitTs: '2026-01-01T00:00:00Z',
        },
      ],
    };
    const commits = (await render(null, { response })).fixture;
    expect(commits.componentInstance['kpiCards']().map((card) => card.label)).toContain('Commits');
    expect((commits.nativeElement as HTMLElement).textContent).toContain('First Commit');
    TestBed.resetTestingModule();

    const code = (await render(null, { queryParams: { metric: 'code' }, response })).fixture;
    const el = code.nativeElement as HTMLElement;
    expect(code.componentInstance['kpiCards']().map((card) => card.label)).toContain('Code contributions');
    expect(code.componentInstance['kpiCards']().map((card) => card.label)).not.toContain('Commits');
    expect(el.textContent).toContain('First contribution');
    expect(el.textContent).toContain('Last contribution');
    expect(el.textContent).not.toContain('First Commit');
    expect(el.querySelector('[data-testid="org-contributions-window-caption"]')?.textContent).toContain(
      'Code contributions (commits, pull requests, reviews and comments)'
    );
  });
});
