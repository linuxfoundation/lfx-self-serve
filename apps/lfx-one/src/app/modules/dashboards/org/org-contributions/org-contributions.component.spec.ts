// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { CONTRIBUTIONS_MAX_FILTER_VALUES, EMPTY_ORG_CONTRIBUTIONS_RESPONSE } from '@lfx-one/shared/constants';
import type { Account, OrgContributionsResponse, OrgLensEmptyStateName } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensEmptyStateService } from '@services/org-lens-empty-state.service';
import { OrgRoleGrantsService } from '@services/org-role-grants.service';
import { PersonDetailDrawerService } from '@services/person-detail-drawer.service';
import { MessageService } from 'primeng/api';
import { of } from 'rxjs';
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

  await TestBed.configureTestingModule({
    imports: [OrgContributionsComponent],
    providers: [
      provideRouter([]),
      MessageService,
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(queryParams) } } },
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
  return { fixture, navigate, getContributions };
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

  it('reads the commit filters from the URL on load, an unknown value falling back to its default', async () => {
    const { fixture, getContributions } = await render(null, { queryParams: { projectScope: 'lf', commitScope: 'bogus', metric: 'code' } });
    const { projectScope, commitScope, metric } = fixture.componentInstance['filterForm'].controls;

    expect([projectScope.value, commitScope.value, metric.value]).toEqual(['lf', 'all', 'code']);
    expect(getContributions).toHaveBeenLastCalledWith('org-uid-1', expect.objectContaining({ projectScope: 'lf', commitScope: 'all', metric: 'code' }));
  });

  it('drops the unknown value from the URL on load', async () => {
    const { navigate } = await render(null, { queryParams: { projectScope: 'lf', commitScope: 'bogus' } });

    expect(navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ queryParams: expect.objectContaining({ projectScope: 'lf', commitScope: null, metric: null }), replaceUrl: true })
    );
  });

  it('sends changed filters to the service and writes them to the URL, dropping defaults', async () => {
    const { fixture, navigate, getContributions } = await render(null, { queryParams: { metric: 'code' } });
    const { projectScope, commitScope, metric } = fixture.componentInstance['filterForm'].controls;

    projectScope.setValue('non_lf');
    commitScope.setValue('merged');
    metric.setValue('commits');
    // Past the form's 250ms debounce.
    await new Promise((resolve) => setTimeout(resolve, 300));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(getContributions).toHaveBeenLastCalledWith(
      'org-uid-1',
      expect.objectContaining({ projectScope: 'non_lf', commitScope: 'merged', metric: 'commits' })
    );
    expect(navigate).toHaveBeenLastCalledWith(
      [],
      expect.objectContaining({ queryParams: expect.objectContaining({ projectScope: 'non_lf', commitScope: 'merged', metric: null }) })
    );
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
