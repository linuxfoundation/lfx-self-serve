// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ApplicationRef, computed, signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { EMPTY_ORG_TRAINING_FILTER_OPTIONS, EMPTY_ORG_TRAINING_GROUPS_RESPONSE } from '@lfx-one/shared/constants';
import type { Account, OrgLensEmptyStateName, OrgTrainingStats } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@shared/services/account-context.service';
import { OrgLensEmptyStateService } from '@shared/services/org-lens-empty-state.service';
import { OrgLensTrainingService } from '@shared/services/org-lens-training.service';
import { OrgRoleGrantsService } from '@shared/services/org-role-grants.service';
import { PersonDetailDrawerService } from '@shared/services/person-detail-drawer.service';
import { MessageService } from 'primeng/api';
import { HttpErrorResponse } from '@angular/common/http';
import { BehaviorSubject, Observable, of, Subject, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { OrgTrainingComponent } from './org-training.component';

const ACME: Account = { accountId: 'acc-1', accountName: 'Acme Motors, Inc.', membershipTier: '', uid: 'org-uid-1', slug: 'acme' };

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
    companyEmailsUnavailableReason: signal(null),
    companyEmailsResolved: signal(false),
    detail: signal(null),
    companyEmails: signal([]),
    open: vi.fn(),
    close: vi.fn(),
    setTab: vi.fn(),
  };
}

const STATS: OrgTrainingStats = {
  range: '730d',
  asOf: '2026-10-30T09:48:21.094Z',
  rosterMembers: 1250,
  rosterMembersAsOf: '2026-10-29T23:00:00.000Z',
  peopleWithTrainingActivity: 830,
  learnersOutsidePeopleList: 12,
  coursesTaken: 400,
  certifications: 190,
  certifiedPeople: 140,
  trainingsCompleted: 90,
  completionRatePct: 70,
  coursesInProgress: 120,
  peopleInTraining: 80,
};

interface RenderOptions {
  settled?: boolean;
  stats?: OrgTrainingStats | null;
  /** Answers the stats read per organization; defaults to `stats` for any. */
  statsFor?: (orgUid: string) => Observable<OrgTrainingStats | null>;
  selectedAccount?: WritableSignal<Account>;
  params?: Record<string, string>;
}

async function render(
  state: OrgLensEmptyStateName | null,
  { settled = true, stats = null, statsFor, selectedAccount = signal<Account>(ACME), params = {} }: RenderOptions = {}
) {
  const pageState = signal<OrgLensEmptyStateName | null>(state);
  const queryParamMap$ = new BehaviorSubject(convertToParamMap(params));
  const trainingService = {
    getTrainingStats: vi.fn(statsFor ?? (() => of(stats))),
    getFilterOptions: vi.fn(() => of(EMPTY_ORG_TRAINING_FILTER_OPTIONS)),
    getGroups: vi.fn(() => of(EMPTY_ORG_TRAINING_GROUPS_RESPONSE)),
    getGroupEmployees: vi.fn(() => of({ total: 0, data: [] })),
  };

  await TestBed.configureTestingModule({
    imports: [OrgTrainingComponent],
    providers: [
      provideRouter([]),
      MessageService,
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: queryParamMap$.value }, queryParamMap: queryParamMap$.asObservable() } },
      { provide: AccountContextService, useValue: { selectedAccount } },
      { provide: OrgRoleGrantsService, useValue: { correlationId: signal(null) } },
      {
        provide: OrgLensEmptyStateService,
        useValue: {
          pageState,
          hasPageState: computed(() => pageState() !== null),
          employerName: signal(null),
          pageReady: signal(true),
          settled: signal(settled),
          retrying: signal(false),
          retry: vi.fn(),
        },
      },
      { provide: OrgLensTrainingService, useValue: trainingService },
      { provide: PersonDetailDrawerService, useValue: personDrawerStub() },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(OrgTrainingComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { el: fixture.nativeElement as HTMLElement, trainingService, queryParamMap$, fixture };
}

describe('OrgTrainingComponent', () => {
  it('replaces the page with the contractor-no-grant state and renders none of its data sections or the org name', async () => {
    const { el } = await render('contractor-no-grant');

    expect(el.querySelector('[data-testid="org-training-no-access-state"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="org-training-stats"]')).toBeNull();
    expect(el.querySelector('[data-testid="org-training-content-card"]')).toBeNull();
    expect(el.textContent).not.toContain('Acme Motors, Inc.');
  });

  it('shows a skeleton instead of a blank area while the org context is still settling, without naming the org', async () => {
    const { el } = await render(null, { settled: false });

    expect(el.querySelector('[data-testid="org-training-skeleton"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="org-training-stats"]')).toBeNull();
    expect(el.querySelector('[data-testid="org-training-content-card"]')).toBeNull();
    expect(el.textContent).not.toContain('Acme Motors, Inc.');
  });

  it('renders the shared filter bar (with group-by), the shared stat tiles and the group table', async () => {
    const { el } = await render(null, { stats: STATS });

    expect(el.querySelector('lfx-org-training-filter-bar')).not.toBeNull();
    expect(el.querySelector('lfx-org-training-stats')).not.toBeNull();
    expect(el.querySelector('lfx-org-training-groups-table')).not.toBeNull();
    expect(el.querySelector('[data-testid="org-training-panel-certifications"]')).not.toBeNull();
    // The 12-month window notes are replaced by the range selector.
    expect(el.querySelector('[data-testid="org-certifications-window-note"]')).toBeNull();
    expect(el.querySelector('[data-testid="org-training-level-filter"]')).toBeNull();
  });

  it('shows the three people-list tiles first and reveals the other stats on the link, as People › Trainees does', async () => {
    const { el, fixture } = await render(null, { stats: STATS });
    const shown = (): string[] =>
      [...el.querySelectorAll<HTMLElement>('[data-testid^="org-training-stat-"][role="note"]')]
        .filter((node) => !node.classList.contains('hidden'))
        .map((node) => node.getAttribute('data-testid')!);
    const toggle = (): HTMLElement => el.querySelector<HTMLElement>('[data-testid="org-training-stats-toggle"]')!;

    expect(shown()).toEqual(['org-training-stat-people-with-training-activity', 'org-training-stat-courses-taken', 'org-training-stat-certified-people']);
    expect(toggle().textContent).toContain('Show 7 more stats');

    toggle().click();
    fixture.detectChanges();
    expect(shown()).toHaveLength(10);
    expect(toggle().textContent).toContain('Show fewer stats');
  });

  it('puts the one filter bar, with the name search first in its row, inside the content card and none above the stats', async () => {
    const { el } = await render(null, { stats: STATS });
    const card = el.querySelector('[data-testid="org-training-content-card"]') as HTMLElement;
    const bars = el.querySelectorAll('lfx-org-training-filter-bar');
    const primaryRow = card.querySelector('[data-testid="org-training-filter-primary"]') as HTMLElement;

    expect(bars).toHaveLength(1);
    expect(card.contains(bars[0])).toBe(true);
    expect(primaryRow.firstElementChild?.querySelector('[data-testid="org-training-search-input"]')).not.toBeNull();
    for (const name of ['range', 'group-by']) expect(primaryRow.querySelector(`[data-test="org-training-filter-${name}"]`), name).not.toBeNull();
    const secondary = card.querySelector('[data-testid="org-training-more-filters"]') as HTMLElement;
    for (const name of ['foundation', 'project', 'course', 'level', 'format'])
      expect(secondary.querySelector(`[data-test="org-training-filter-${name}"]`), name).not.toBeNull();
    expect(secondary.classList.contains('hidden')).toBe(true);
    expect(card.querySelector('[data-testid="org-training-more-filters-toggle"]')).not.toBeNull();
  });

  it('keeps the name search table-local: it refetches the groups, never the stats', async () => {
    const { el, fixture, trainingService } = await render(null, { stats: STATS });
    const input = el.querySelector('[data-testid="org-training-search-input"] input') as HTMLInputElement;

    input.value = 'kube';
    input.dispatchEvent(new Event('input'));
    await new Promise((resolve) => setTimeout(resolve, 350));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(trainingService.getGroups).toHaveBeenLastCalledWith('org-uid-1', expect.anything(), expect.objectContaining({ searchQuery: 'kube' }));
    expect(trainingService.getTrainingStats).toHaveBeenCalledTimes(1);
  });

  it('gives the name search an accessible name and clears it when the organization changes', async () => {
    const selectedAccount = signal<Account>(ACME);
    const { el, fixture, trainingService } = await render(null, { stats: STATS, selectedAccount });
    const input = el.querySelector('[data-testid="org-training-search-input"] input') as HTMLInputElement;
    expect(input.getAttribute('aria-label')).toBe('Search by name');

    input.value = 'kube';
    input.dispatchEvent(new Event('input'));
    await new Promise((resolve) => setTimeout(resolve, 350));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(trainingService.getGroups).toHaveBeenLastCalledWith('org-uid-1', expect.anything(), expect.objectContaining({ searchQuery: 'kube' }));

    selectedAccount.set({ ...ACME, accountId: 'acc-2', uid: 'org-uid-2', slug: 'globex' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(input.value).toBe('');
    expect(trainingService.getGroups).toHaveBeenLastCalledWith('org-uid-2', expect.anything(), expect.objectContaining({ searchQuery: undefined }));
  });

  it('states the selected range in the note under the card, not the old 12-month rule', async () => {
    const { el } = await render(null, { stats: STATS, params: { range: '90d' } });
    const note = el.querySelector('[data-testid="org-training-range-note"]')?.textContent ?? '';

    expect(note).toContain('Past 90 days');
    expect(note).toContain('no certificate in that range');
    expect(note).not.toContain('12 months');
  });
});

describe('OrgTrainingComponent — view state from the URL', () => {
  it('reads the stats for the URL range and filters, defaulting to Past 2 years without any', async () => {
    const defaults = await render(null, { stats: STATS });
    expect(defaults.trainingService.getTrainingStats).toHaveBeenCalledTimes(1);
    expect(defaults.trainingService.getTrainingStats).toHaveBeenCalledWith('org-uid-1', {
      range: '730d',
      foundation: null,
      project: null,
      course: null,
      level: null,
      format: null,
    });
    TestBed.resetTestingModule();

    const filtered = await render(null, { stats: STATS, params: { range: '365d', foundation: 'f-1', format: 'Online' } });
    expect(filtered.trainingService.getTrainingStats).toHaveBeenCalledWith(
      'org-uid-1',
      expect.objectContaining({ range: '365d', foundation: 'f-1', format: 'Online', course: null })
    );
  });

  it('applies ?range=365d&format=E-Learning to the tiles on first load, even when the loaded options do not list the format', async () => {
    const { trainingService } = await render(null, { stats: STATS, params: { range: '365d', format: 'E-Learning' } });

    expect(trainingService.getTrainingStats).toHaveBeenCalledTimes(1);
    expect(trainingService.getTrainingStats).toHaveBeenCalledWith('org-uid-1', {
      range: '365d',
      foundation: null,
      project: null,
      course: null,
      level: null,
      format: 'E-Learning',
    });
    expect(trainingService.getGroups).toHaveBeenLastCalledWith(
      'org-uid-1',
      expect.objectContaining({ format: 'E-Learning', range: '365d' }),
      expect.anything()
    );
  });

  it('never rewrites the URL on load: no filter is dropped by the options', async () => {
    const navigate = vi.spyOn(Router.prototype, 'navigate').mockResolvedValue(true);
    await render(null, { stats: STATS, params: { range: '365d', format: 'E-Learning' } });

    expect(navigate).not.toHaveBeenCalled();
    navigate.mockRestore();
  });

  it('follows in-page navigation: a new URL state refetches the stats and the table, and removing a filter restores the unfiltered query', async () => {
    const { fixture, trainingService, queryParamMap$ } = await render(null, { stats: STATS, params: { range: '365d', format: 'E-Learning' } });
    const appRef = TestBed.inject(ApplicationRef);

    queryParamMap$.next(convertToParamMap({ range: '365d', format: 'Instructor Led', level: 'Advanced' }));
    await appRef.whenStable();
    fixture.detectChanges();
    expect(trainingService.getTrainingStats).toHaveBeenLastCalledWith(
      'org-uid-1',
      expect.objectContaining({ range: '365d', format: 'Instructor Led', level: 'Advanced' })
    );
    expect(trainingService.getGroups).toHaveBeenLastCalledWith(
      'org-uid-1',
      expect.objectContaining({ format: 'Instructor Led', level: 'Advanced' }),
      expect.anything()
    );

    queryParamMap$.next(convertToParamMap({}));
    await appRef.whenStable();
    fixture.detectChanges();
    expect(trainingService.getTrainingStats).toHaveBeenLastCalledWith('org-uid-1', {
      range: '730d',
      foundation: null,
      project: null,
      course: null,
      level: null,
      format: null,
    });
  });

  it('feeds the table the URL group-by and loads the Trainings tab from ?tab=trainings', async () => {
    const { trainingService } = await render(null, { stats: STATS, params: { groupBy: 'foundation', tab: 'trainings' } });

    expect(trainingService.getGroups).toHaveBeenCalledWith(
      'org-uid-1',
      expect.anything(),
      expect.objectContaining({ groupBy: 'foundation', tab: 'trainings' })
    );
  });

  it('switching tabs keeps the URL filters and neither refetches the stats nor changes the filters', async () => {
    const { el, fixture, trainingService, queryParamMap$ } = await render(null, { stats: STATS, params: { range: '365d', foundation: 'f-1' } });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    (el.querySelector('[data-testid="filter-pill-trainings"]') as HTMLElement).click();
    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { tab: 'trainings' }, queryParamsHandling: 'merge', replaceUrl: true }));

    queryParamMap$.next(convertToParamMap({ range: '365d', foundation: 'f-1', tab: 'trainings' }));
    await TestBed.inject(ApplicationRef).whenStable();
    fixture.detectChanges();

    expect(trainingService.getTrainingStats).toHaveBeenCalledTimes(1);
    expect(el.querySelector('[data-testid="org-training-panel-trainings"]')).not.toBeNull();
  });
});

describe('OrgTrainingComponent — a URL filter with no rows in the selected range', () => {
  const ZERO_STATS: OrgTrainingStats = {
    ...STATS,
    range: '30d',
    peopleWithTrainingActivity: 0,
    learnersOutsidePeopleList: 0,
    coursesTaken: 0,
    certifications: 0,
    certifiedPeople: 0,
    trainingsCompleted: 0,
    completionRatePct: 0,
    coursesInProgress: 0,
    peopleInTraining: 0,
  };
  const value = (el: HTMLElement, tile: string) => el.querySelector(`[data-testid="org-training-stat-${tile}-value"]`)?.textContent?.trim();

  it('stays applied and renders the zeros the stats call returns, not an error state', async () => {
    // The mocked filter options for this range list nothing, so the picked foundation is a valid value with no rows.
    const { el, trainingService } = await render(null, { stats: ZERO_STATS, params: { range: '30d', foundation: 'no-rows-in-range' } });

    expect(trainingService.getTrainingStats).toHaveBeenCalledTimes(1);
    expect(trainingService.getTrainingStats).toHaveBeenCalledWith('org-uid-1', {
      range: '30d',
      foundation: 'no-rows-in-range',
      project: null,
      course: null,
      level: null,
      format: null,
    });
    expect(el.querySelector('[data-testid="org-training-stats-error"]')).toBeNull();
    expect(el.querySelector('lfx-org-training-stats')).not.toBeNull();
    for (const tile of ['courses-taken', 'certifications', 'certified-people', 'trainings-completed', 'courses-in-progress'])
      expect(value(el, tile), tile).toBe('0');
  });

  it('still shows the error state when the stats call fails with HTTP 400', async () => {
    const { el } = await render(null, {
      params: { range: '30d', foundation: 'no-rows-in-range' },
      statsFor: () => throwError(() => new HttpErrorResponse({ status: 400, statusText: 'Bad Request' })),
    });

    expect(el.querySelector('[data-testid="org-training-stats-error"]')).not.toBeNull();
    expect(el.querySelector('lfx-org-training-stats')).toBeNull();
  });

  it('never writes the name search to the URL', async () => {
    const navigate = vi.spyOn(Router.prototype, 'navigate').mockResolvedValue(true);
    const { el, fixture } = await render(null, { stats: ZERO_STATS, params: { range: '30d' } });
    const input = el.querySelector('[data-testid="org-training-search-input"] input') as HTMLInputElement;

    input.value = 'kube';
    input.dispatchEvent(new Event('input'));
    await new Promise((resolve) => setTimeout(resolve, 350));
    await fixture.whenStable();

    expect(navigate).not.toHaveBeenCalled();
    navigate.mockRestore();
  });
});

describe('OrgTrainingComponent — stat strip', () => {
  it('shows an error state instead of dashes when the stats read fails, leaving the table', async () => {
    const { el } = await render(null, { statsFor: () => throwError(() => new Error('boom')) });

    expect(el.querySelector('[data-testid="org-training-stats-error"]')?.textContent).toContain("Couldn't load training stats");
    expect(el.querySelector('lfx-org-training-stats')).toBeNull();
    expect(el.querySelector('[data-testid="org-training-content-card"]')).not.toBeNull();
  });

  it('logs the failure, announces it as an alert and retries the stats only (not the table)', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let attempts = 0;
    const { el, fixture, trainingService } = await render(null, {
      statsFor: () => (++attempts === 1 ? throwError(() => new Error('boom')) : of(STATS)),
    });
    const groupCalls = trainingService.getGroups.mock.calls.length;

    expect(error).toHaveBeenCalledWith('Failed to load training stats', expect.any(Error));
    expect(el.querySelector('[data-testid="org-training-stats-error"]')?.getAttribute('role')).toBe('alert');

    (el.querySelector('[data-testid="org-training-stats-retry"] button') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(trainingService.getTrainingStats).toHaveBeenCalledTimes(2);
    expect(trainingService.getGroups.mock.calls.length).toBe(groupCalls);
    expect(el.querySelector('[data-testid="org-training-stats-error"]')).toBeNull();
    expect(el.querySelector('lfx-org-training-stats')).not.toBeNull();
    error.mockRestore();
  });

  it('hands the stats component no numbers (null) while loading and again after an organization switch', async () => {
    const responses: Record<string, Subject<OrgTrainingStats | null>> = {
      'org-uid-1': new Subject<OrgTrainingStats | null>(),
      'org-uid-2': new Subject<OrgTrainingStats | null>(),
    };
    const selectedAccount = signal<Account>(ACME);
    const { el, fixture } = await render(null, { selectedAccount, statsFor: (orgUid) => responses[orgUid].asObservable() });
    const appRef = TestBed.inject(ApplicationRef);
    const rosterValue = () => el.querySelector('[data-testid="org-training-stat-roster-members-value"]')?.textContent?.trim();

    expect(rosterValue()).toBe('—');

    responses['org-uid-1'].next(STATS);
    responses['org-uid-1'].complete();
    await appRef.whenStable();
    fixture.detectChanges();
    expect(rosterValue()).toBe('1,250');

    // Switch to an organization whose stats are still on their way: the previous numbers go away.
    selectedAccount.set({ ...ACME, accountId: 'acc-2', accountName: 'Globex Corp.', uid: 'org-uid-2', slug: 'globex' });
    await appRef.whenStable();
    fixture.detectChanges();
    expect(rosterValue()).toBe('—');

    responses['org-uid-2'].next({ ...STATS, rosterMembers: 7 });
    responses['org-uid-2'].complete();
    await appRef.whenStable();
    fixture.detectChanges();
    expect(rosterValue()).toBe('7');
  });
});

describe('OrgTrainingComponent — organization switch', () => {
  it('clears the five filters from the URL when the organization changes, keeping range, group-by and tab', async () => {
    const navigate = vi.spyOn(Router.prototype, 'navigate').mockResolvedValue(true);
    const selectedAccount = signal<Account>(ACME);
    const { fixture } = await render(null, {
      selectedAccount,
      stats: STATS,
      params: { range: '90d', foundation: 'fa', trainingProject: 'pk', course: 'Linux Intro', level: 'Beginner', format: 'E-Learning', tab: 'trainings' },
    });
    navigate.mockClear();

    selectedAccount.set({ ...ACME, accountId: 'acc-2', accountName: 'Globex Corp.', uid: 'org-uid-2', slug: 'globex' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(navigate).toHaveBeenCalledTimes(1);
    const extras = navigate.mock.calls[0][1] as { queryParams: Record<string, unknown>; queryParamsHandling: string };
    expect(extras.queryParamsHandling).toBe('merge');
    expect(extras.queryParams).toMatchObject({ range: '90d', foundation: null, trainingProject: null, course: null, level: null, format: null });
    navigate.mockRestore();
  });
});
