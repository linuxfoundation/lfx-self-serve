// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Committee, MemberImportRunSummary, MemberImportSettlement, MyCommittee, MyGroupsFilterKey, ProjectContext } from '@lfx-one/shared/interfaces';
import { CommitteeMemberImportDialogService } from '@services/committee-member-import-dialog.service';
import { CommitteeMemberImportService } from '@services/committee-member-import.service';
import { CommitteeService } from '@services/committee.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { InvitationService } from '@services/invitation.service';
import { LensService } from '@services/lens.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { EMPTY, Observable, of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CommitteeInvitationsComponent } from '../components/committee-invitations/committee-invitations.component';
import { CommitteePendingApplicationsComponent } from '../components/committee-pending-applications/committee-pending-applications.component';
import { CommitteeDashboardComponent } from './committee-dashboard.component';

function group(uid: string, overrides: Partial<MyCommittee> = {}): MyCommittee {
  return {
    uid,
    name: 'Alpha working group',
    category: 'Working Group',
    description: 'Synthetic governance fixture',
    project_uid: 'project-a',
    project_name: 'Project A',
    parent_project_uid: 'foundation-a',
    is_foundation: false,
    enable_voting: true,
    public: true,
    sso_group_enabled: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    total_members: 3,
    my_role: 'Member',
    ...overrides,
  };
}

const groups: MyCommittee[] = [
  group('a-enabled'),
  group('a-disabled', { enable_voting: false }),
  group('a-board', { category: 'Board', name: 'Alpha board' }),
  group('b-enabled', { project_uid: 'project-b', project_name: 'Project B', parent_project_uid: 'foundation-b' }),
  group('foundation-a', { project_uid: 'foundation-a', project_name: 'Foundation A', is_foundation: true, parent_project_uid: undefined }),
  group('foundation-b', { project_uid: 'foundation-b', project_name: 'Foundation B', is_foundation: true, parent_project_uid: undefined }),
];
const allIds = groups.map((item) => item.uid);

/** Both live events and retained summaries drive reconciliation; status surfaces read counts only. */
function importProviders(
  settlements = new Subject<MemberImportSettlement>(),
  owner = signal<string | null>('synthetic-manager'),
  summaries = signal<ReadonlyMap<string, MemberImportRunSummary>>(new Map())
) {
  return [
    { provide: CommitteeMemberImportService, useValue: { viewerSubject: owner, getSummary: (uid: string) => summaries().get(uid), settlements$: settlements } },
    { provide: CommitteeMemberImportDialogService, useValue: { accessByUid: signal(new Map()), probeAccess: () => EMPTY, openRun: vi.fn() } },
  ];
}

describe('My Groups effective filters', () => {
  let fixture: ComponentFixture<CommitteeDashboardComponent>;
  let pending: Subject<MyCommittee[]>;

  beforeEach(async () => {
    localStorage.clear();
    pending = new Subject<MyCommittee[]>();
    await TestBed.configureTestingModule({
      imports: [CommitteeDashboardComponent],
      providers: [
        provideRouter([]),
        ConfirmationService,
        MessageService,
        { provide: LensService, useValue: { activeLens: signal('me') } },
        {
          provide: ProjectContextService,
          useValue: { activeContext: signal<ProjectContext | null>(null), isFoundationContext: signal(false), canWrite: signal(false) },
        },
        {
          provide: PersonaService,
          useValue: { currentPersona: signal('contributor'), personaLoaded: signal(true), hasBoardRole: signal(true), hasProjectRole: signal(true) },
        },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: () => signal(false) } },
        { provide: InvitationService, useValue: { loadPendingInvitations: () => of([]) } },
        { provide: CommitteeService, useValue: { getMyCommittees: () => pending } },
        ...importProviders(),
      ],
    })
      .overrideComponent(CommitteeDashboardComponent, {
        remove: { imports: [CommitteeInvitationsComponent, CommitteePendingApplicationsComponent] },
        add: { schemas: [NO_ERRORS_SCHEMA] },
      })
      .compileComponents();
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    fixture = TestBed.createComponent(CommitteeDashboardComponent);
    vi.advanceTimersByTime(300);
    vi.useRealTimers();
    await fixture.whenStable();
    pending.next(groups);
    pending.complete();
    await fixture.whenStable();
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  function ids(): string[] {
    return fixture.componentInstance.filteredMyCommittees().map((item) => item.uid);
  }

  function element(testId: string): HTMLElement {
    const result = fixture.nativeElement.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;
    expect(result, testId).not.toBeNull();
    return result!;
  }

  async function click(testId: string): Promise<void> {
    const host = element(testId);
    (host.matches('button') ? host : host.querySelector('button')!).click();
    await fixture.whenStable();
  }

  async function search(value: string): Promise<void> {
    // RxJS debounce uses asyncScheduler's interval and clock, not Angular's rendering timers.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    try {
      fixture.componentInstance.searchForm.get('search')!.setValue(value);
      vi.advanceTimersByTime(300);
    } finally {
      vi.useRealTimers();
    }
    await fixture.whenStable();
  }

  function selectScopes(): void {
    fixture.componentInstance.onFoundationFilterChange('foundation-a');
    fixture.componentInstance.onProjectFilterChange('project-a');
  }

  it('intersects effective search, category, scope and strict voting without changing raw summaries', async () => {
    const component = fixture.componentInstance;
    const summary = component.myStatCards();
    selectScopes();
    component.selectBehavioralClass('working-group');
    component.searchForm.get('votingStatus')!.setValue('enabled');
    await search('alpha');
    expect(ids()).toEqual(['a-enabled']);
    expect(component.activeMyGroupFilters().map((chip) => chip.key)).toEqual(['search', 'category', 'foundation', 'project', 'voting']);
    expect(component.myStatCards()).toEqual(summary);
    expect(component.myTotalGroups()).toBe(6);
    expect(component.myPublicGroups()).toBe(6);
    expect(component.myActiveVoting()).toBe(5);
    await search('governance');
    expect(ids()).toEqual(['a-enabled']);
  });

  it('counts only literal enabled capability while keeping malformed groups in the inventory', async () => {
    const malformed = group('malformed');
    Reflect.set(malformed, 'enable_voting', 'true');
    vi.spyOn(TestBed.inject(CommitteeService), 'getMyCommittees').mockReturnValue(
      of([group('enabled'), group('disabled', { enable_voting: false }), malformed])
    );
    fixture.componentInstance.refresh.update((value) => value + 1);
    await fixture.whenStable();
    expect(fixture.componentInstance.myTotalGroups()).toBe(3);
    expect(fixture.componentInstance.myStatCards().find((card) => card.label === 'Voting Enabled Groups')?.value).toBe(1);
    fixture.componentInstance.searchForm.get('votingStatus')!.setValue('enabled');
    await fixture.whenStable();
    expect(ids()).toEqual(['enabled']);
  });

  it.each<MyGroupsFilterKey>(['search', 'category', 'voting'])('removes only the %s constraint', async (key) => {
    const component = fixture.componentInstance;
    selectScopes();
    component.selectBehavioralClass('working-group');
    component.searchForm.get('votingStatus')!.setValue('enabled');
    await search('no-match');
    if (key === 'search') {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
      element('groups-remove-filter-search').click();
      vi.advanceTimersByTime(300);
      vi.useRealTimers();
      await fixture.whenStable();
      expect(ids()).toEqual(['a-enabled']);
    } else {
      await search('alpha');
      await click(`groups-remove-filter-${key}`);
      expect(ids()).toEqual(key === 'category' ? ['a-enabled', 'a-board'] : ['a-enabled', 'a-disabled']);
    }
    expect(component.activeMyGroupFilters().map((chip) => chip.key)).not.toContain(key);
    expect(component.foundationFilter()).toBe('foundation-a');
    expect(component.projectFilter()).toBe('project-a');
  });

  it('clears Project on Foundation removal and synchronizes both dropdowns with results', async () => {
    const component = fixture.componentInstance;
    selectScopes();
    await fixture.whenStable();
    expect(component.projectOptions().map((option) => option.value)).toEqual([null, 'project-a']);
    await click('groups-remove-filter-foundation');
    expect(component.searchForm.get('foundationFilter')!.value).toBeNull();
    expect(component.searchForm.get('projectFilter')!.value).toBeNull();
    expect(component.foundationFilter()).toBeNull();
    expect(component.projectFilter()).toBeNull();
    expect(ids()).toEqual(allIds);
    component.onProjectFilterChange('project-a');
    component.onFoundationFilterChange('foundation-b');
    expect(component.searchForm.get('projectFilter')!.value).toBeNull();
    expect(ids()).toEqual(['b-enabled', 'foundation-b']);
  });

  it('retains Foundation when Project is removed, revealing the foundation-owned group', async () => {
    selectScopes();
    await fixture.whenStable();
    await click('groups-remove-filter-project');
    const component = fixture.componentInstance;
    expect(component.searchForm.get('foundationFilter')!.value).toBe('foundation-a');
    expect(component.searchForm.get('projectFilter')!.value).toBeNull();
    expect(ids()).toEqual(['a-enabled', 'a-disabled', 'a-board', 'foundation-a']);
  });

  it.each(['toolbar', 'list', 'card'] as const)('fully resets from %s without changing the selected view', async (entry) => {
    const component = fixture.componentInstance;
    component.setViewMode(entry === 'card' ? 'card' : 'list');
    selectScopes();
    component.selectBehavioralClass('working-group');
    component.searchForm.get('votingStatus')!.setValue('disabled');
    component.searchForm.get('joinModeFilter')!.setValue('closed');
    await search('no-match');
    expect(ids()).toEqual([]);
    const resetHost =
      entry === 'toolbar'
        ? element('groups-reset-filters')
        : fixture.nativeElement.querySelector(entry === 'card' ? 'lfx-my-groups-card-grid lfx-empty-state' : 'lfx-committee-table lfx-empty-state');
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    resetHost.querySelector('button').click();
    vi.advanceTimersByTime(300);
    vi.useRealTimers();
    await fixture.whenStable();
    expect(component.searchForm.value).toEqual({ search: '', votingStatus: null, joinModeFilter: null, foundationFilter: null, projectFilter: null });
    expect(component.activeMyGroupFilters()).toEqual([]);
    expect(ids()).toEqual(allIds);
    expect(component.viewMode()).toBe(entry === 'card' ? 'card' : 'list');
  });
});

describe('CSV import count reconciliation (#5731)', () => {
  const PROJECT = { uid: 'project-a', name: 'Project A', slug: 'project-a' } as ProjectContext;
  let fixture: ComponentFixture<CommitteeDashboardComponent>;
  let settlements: Subject<MemberImportSettlement>;
  let owner: ReturnType<typeof signal<string | null>>;
  let summaries: ReturnType<typeof signal<ReadonlyMap<string, MemberImportRunSummary>>>;
  let lens: ReturnType<typeof signal<string>>;
  /** Indexed totals for the group in the order the list endpoint returns them; the last value repeats. */
  let totals: number[];
  let committeeService: {
    getMyCommittees: ReturnType<typeof vi.fn>;
    getMyCommitteesOrError: ReturnType<typeof vi.fn>;
    getCommitteesByProject: ReturnType<typeof vi.fn>;
    getCommitteesByProjectOrThrow: ReturnType<typeof vi.fn>;
    getMyCommitteeUids: ReturnType<typeof vi.fn>;
  };

  function list(): Observable<MyCommittee[]> {
    const total = totals.length > 1 ? totals.shift()! : totals[0];
    return of([group('a-enabled', { total_members: total }), group('b-enabled', { total_members: 7 })]);
  }

  function settle(patch: Partial<MemberImportRunSummary> = {}): void {
    const summary: MemberImportRunSummary = {
      committeeUid: 'a-enabled',
      committeeName: 'Alpha working group',
      runId: 'member-import-1',
      attempt: 1,
      phase: 'settled',
      batchTotal: 2,
      batchSettled: 2,
      added: 2,
      failed: 0,
      unknown: 0,
      notSubmitted: 0,
      retryable: 0,
      stopReason: null,
      manualStopRequested: false,
      baselineMemberCount: 3,
      reconciliationTarget: 5,
      ...patch,
    };
    summaries.update((runs) => new Map(runs).set(summary.committeeUid, summary));
    settlements.next({ key: `${summary.runId}:${summary.attempt}`, summary });
  }

  function fetches(): number {
    return (
      committeeService.getMyCommittees.mock.calls.length +
      committeeService.getMyCommitteesOrError.mock.calls.length +
      committeeService.getCommitteesByProjectOrThrow.mock.calls.length
    );
  }

  function shownTotal(): number | undefined {
    const shown: readonly Committee[] = lens() === 'me' ? fixture.componentInstance.myCommittees() : fixture.componentInstance.committees();
    return shown.find((item) => item.uid === 'a-enabled')?.total_members;
  }

  async function setup(activeLens: 'me' | 'project', initialTotals: number[]): Promise<void> {
    localStorage.clear();
    totals = initialTotals;
    settlements = new Subject<MemberImportSettlement>();
    owner = signal<string | null>('synthetic-manager');
    summaries = signal<ReadonlyMap<string, MemberImportRunSummary>>(new Map());
    lens = signal<string>(activeLens);
    committeeService = {
      getMyCommittees: vi.fn(list),
      getMyCommitteesOrError: vi.fn(list),
      getCommitteesByProject: vi.fn(list),
      getCommitteesByProjectOrThrow: vi.fn(list),
      getMyCommitteeUids: vi.fn(() => of([])),
    };
    await TestBed.configureTestingModule({
      imports: [CommitteeDashboardComponent],
      providers: [
        provideRouter([]),
        ConfirmationService,
        MessageService,
        { provide: LensService, useValue: { activeLens: lens } },
        {
          provide: ProjectContextService,
          useValue: {
            activeContext: signal<ProjectContext | null>(activeLens === 'me' ? null : PROJECT),
            isFoundationContext: signal(false),
            canWrite: signal(false),
          },
        },
        {
          provide: PersonaService,
          useValue: { currentPersona: signal('contributor'), personaLoaded: signal(true), hasBoardRole: signal(false), hasProjectRole: signal(false) },
        },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: () => signal(false) } },
        { provide: InvitationService, useValue: { loadPendingInvitations: () => of([]) } },
        { provide: CommitteeService, useValue: committeeService },
        ...importProviders(settlements, owner, summaries),
      ],
    })
      .overrideComponent(CommitteeDashboardComponent, {
        remove: { imports: [CommitteeInvitationsComponent, CommitteePendingApplicationsComponent] },
        add: { schemas: [NO_ERRORS_SCHEMA] },
      })
      .compileComponents();
    // RxJS timers schedule through setInterval; Angular's own rendering timers stay real.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    fixture = TestBed.createComponent(CommitteeDashboardComponent);
    // The project lens resolves its scope over more than one render before loading the list.
    for (let pass = 0; pass < 3 && shownTotal() === undefined; pass++) {
      fixture.detectChanges();
      await fixture.whenStable();
    }
    committeeService.getMyCommittees.mockClear();
    committeeService.getMyCommitteesOrError.mockClear();
    committeeService.getCommitteesByProject.mockClear();
  }

  /** Refreshes run through signal effects, so let rendering settle after each step. */
  async function step(ms = 0): Promise<void> {
    vi.advanceTimersByTime(ms);
    await fixture.whenStable();
  }

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  it('refreshes, keeps stale indexed totals, then refreshes again once the retained target is reached', async () => {
    await setup('me', [3, 3, 3, 5]);
    expect(shownTotal()).toBe(3);
    settle();
    await step();
    // Initial refresh: still the stale index.
    expect(fetches()).toBe(1);
    expect(shownTotal()).toBe(3);

    await step(400);
    expect(fetches()).toBe(2);
    expect(shownTotal()).toBe(3);
    await step(400);
    // Reached on the second refetch, then one final refresh.
    expect(fetches()).toBe(4);
    expect(shownTotal()).toBe(5);

    await step(10_000);
    expect(fetches()).toBe(4);
  });

  it('reconciles a retained settlement after mounting into an initially loading list, only once per attempt', async () => {
    await setup('me', [3]);
    fixture.destroy();
    settle(); // No mounted subscriber observes this event.
    const initial = new Subject<MyCommittee[]>();
    committeeService.getMyCommittees.mockReturnValueOnce(initial);
    fixture = TestBed.createComponent(CommitteeDashboardComponent);
    await step();
    expect(fixture.componentInstance.myCommitteesLoading()).toBe(true);
    initial.next([group('a-enabled', { total_members: 3 })]);
    initial.complete();
    await step();
    expect(fixture.componentInstance.myCommitteesLoading()).toBe(false);
    await step(10_000);
    const afterReconciliation = fetches();
    fixture.componentInstance.reloadMyCommittees();
    await step();
    await step(10_000);
    expect(fetches()).toBe(afterReconciliation + 1);
    expect(shownTotal()).toBe(3);
  });

  it.each(['me', 'project'] as const)('keeps the %s list visible while an import refresh is pending', async (activeLens) => {
    await setup(activeLens, [3]);
    const response = new Subject<MyCommittee[]>();
    const method = activeLens === 'me' ? 'getMyCommitteesOrError' : 'getCommitteesByProjectOrThrow';
    committeeService[method].mockReturnValueOnce(response);
    settle();
    await step();
    expect(fixture.componentInstance.myCommitteesLoading()).toBe(false);
    expect(fixture.componentInstance.committeesLoading()).toBe(false);
    expect(shownTotal()).toBe(3);
    response.next([group('a-enabled', { total_members: 3 })]);
    response.complete();
    await step();
  });

  it.each(['me', 'project'] as const)('keeps the %s rows after both initial and final silent refreshes fail', async (activeLens) => {
    await setup(activeLens, [3]);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const method = activeLens === 'me' ? 'getMyCommitteesOrError' : 'getCommitteesByProjectOrThrow';
    const failed = () => throwError(() => new HttpErrorResponse({ status: 503, error: { message: 'private@example.com' } }));
    committeeService[method].mockReturnValueOnce(failed());
    committeeService[method].mockReturnValueOnce(of([group('a-enabled', { total_members: 5 })]));
    committeeService[method].mockReturnValueOnce(failed());
    settle();
    await step();
    expect(shownTotal()).toBe(3);
    expect(fixture.componentInstance.myCommitteesLoading()).toBe(false);
    expect(fixture.componentInstance.committeesLoading()).toBe(false);
    await step(400);
    expect(shownTotal()).toBe(3);
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls).toEqual([
      ['Failed to refresh groups after CSV import', { status: 503 }],
      ['Failed to refresh groups after CSV import', { status: 503 }],
    ]);
    log.mockRestore();
  });

  it('counts six completed refetches even when each request outlasts several timer ticks', async () => {
    await setup('me', [3]);
    settle();
    await step();
    for (let attempt = 0; attempt < 6; attempt++) {
      const response = new Subject<MyCommittee[]>();
      committeeService.getMyCommitteesOrError.mockReturnValueOnce(response);
      await step(400);
      const inFlightCount = fetches();
      await step(2_000);
      expect(fetches()).toBe(inFlightCount);
      response.next([group('a-enabled', { total_members: 3 })]);
      response.complete();
      await step();
    }
    expect(fetches()).toBe(1 + 6 + 1);
    await step(10_000);
    expect(fetches()).toBe(8);
  });

  it('refreshes once without polling when the shown total already reaches the target', async () => {
    await setup('me', [5]);
    settle();
    await step(10_000);

    expect(fetches()).toBe(1);
  });

  it('stops after six refetches with a final refresh and never raises the API total', async () => {
    await setup('me', [3]);
    settle();
    await step();
    await step(10_000);

    expect(fetches()).toBe(1 + 6 + 1);
    expect(shownTotal()).toBe(3);
  });

  it('shares one loop across settlements for several shown groups', async () => {
    await setup('me', [3]);
    settle();
    await step();
    await step(400);
    expect(fetches()).toBe(2);
    settle({ committeeUid: 'b-enabled', runId: 'member-import-2', baselineMemberCount: 6, reconciliationTarget: 7 });
    await step();
    expect(fetches()).toBe(3);
    await step(10_000);

    // The restarted loop keeps both targets: six refetches and one final refresh, not two loops.
    expect(fetches()).toBe(3 + 6 + 1);
  });

  it('refreshes skipped-only recovery once without polling or treating skipped rows as confirmed additions', async () => {
    await setup('me', [3, 5]);
    settle({ added: 0, unknown: 0, baselineMemberCount: 3, reconciliationTarget: 3 });
    await step();
    expect(fetches()).toBe(1);
    expect(shownTotal()).toBe(5);
    await step(10_000);
    expect(fetches()).toBe(1);
  });

  it.each([['a group that is not shown', { committeeUid: 'other-group' }]])('ignores a settlement for %s', async (_label, patch) => {
    await setup('me', [3]);
    settle(patch);
    await step(10_000);

    expect(fetches()).toBe(0);
  });

  it.each(['the observed user changes', 'the lens changes', 'the page is destroyed'])('cancels the loop when %s', async (change) => {
    await setup('me', [3]);
    settle();
    await step();
    await step(400);
    const before = fetches();
    if (change === 'the observed user changes') {
      owner.set('synthetic-replacement');
    } else if (change === 'the lens changes') {
      lens.set('project');
    } else {
      fixture.destroy();
    }
    if (change !== 'the page is destroyed') await fixture.whenStable();
    committeeService.getMyCommittees.mockClear();
    committeeService.getMyCommitteesOrError.mockClear();
    committeeService.getCommitteesByProjectOrThrow.mockClear();
    vi.advanceTimersByTime(10_000);

    expect(before).toBe(2);
    expect(fetches()).toBe(0);
  });

  it('reconciles the project lens list through the throwing project fetch', async () => {
    await setup('project', [3, 5]);
    expect(shownTotal()).toBe(3);
    settle();
    await step();
    expect(committeeService.getCommitteesByProject).not.toHaveBeenCalled();
    await step(400);

    expect(committeeService.getCommitteesByProjectOrThrow).toHaveBeenCalledTimes(3);
    expect(committeeService.getCommitteesByProject).not.toHaveBeenCalled();
    expect(shownTotal()).toBe(5);
  });

  it.each(['me', 'project'] as const)('logs only the status of each failed %s refetch and still ends at the bound', async (activeLens) => {
    await setup(activeLens, [3]);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const method = activeLens === 'me' ? 'getMyCommitteesOrError' : 'getCommitteesByProjectOrThrow';
    committeeService[method].mockImplementation(() => throwError(() => new HttpErrorResponse({ status: 503, error: { message: 'private@example.com' } })));
    settle();
    await step();
    await step(10_000);

    expect(committeeService[method]).toHaveBeenCalledTimes(8);
    expect(committeeService.getMyCommittees).not.toHaveBeenCalled();
    expect(committeeService.getCommitteesByProject).not.toHaveBeenCalled();
    expect(consoleError.mock.calls).toEqual([
      ['Failed to refresh groups after CSV import', { status: 503 }],
      ...Array.from({ length: 6 }, () => ['Failed to refetch committees after CSV import', { status: 503 }]),
      ['Failed to refresh groups after CSV import', { status: 503 }],
    ]);
    expect(shownTotal()).toBe(3);
    await step(10_000);
    expect(committeeService[method]).toHaveBeenCalledTimes(8);
    consoleError.mockRestore();
  });
});
