// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { NO_ERRORS_SCHEMA, PLATFORM_ID, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { PollStatus, VoteResponseStatus } from '@lfx-one/shared';
import { VOTE_INVITATION_COUNT_REFRESH_MS } from '@lfx-one/shared/constants';
import { Lens, MyVotesResponse, ProjectContext, Vote, VoteListResponse, VoteStatusCounts, VoteSummary } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { LensService } from '@services/lens.service';
import { MailingListService } from '@services/mailing-list.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { VoteService } from '@services/vote.service';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, MockInstance, vi } from 'vitest';

import { VotesTableComponent } from '../components/votes-table/votes-table.component';
import { VotesDashboardComponent } from './votes-dashboard.component';

const NOW = Date.parse('2026-01-10T12:00:00Z');
const vote = (uid: string, days: number, overrides: Partial<Vote> = {}): Vote => ({
  uid,
  name: `Ballot ${uid}`,
  status: PollStatus.ACTIVE,
  end_time: new Date(NOW + days * 86400000).toISOString(),
  project_uid: 'project-a',
  parent_project_uid: 'foundation-a',
  committee_name: 'Alpha Group',
  response_status: VoteResponseStatus.AWAITING_RESPONSE,
  ...overrides,
});
const feed = [
  vote('responded', 2, { response_status: VoteResponseStatus.RESPONDED }),
  vote('soon', 4),
  vote('later', 12),
  vote('beta', 1, { project_uid: 'project-b', committee_name: 'Beta Group' }),
  vote('blank', 3, { committee_name: '   ' }),
  vote('ended', 1, { status: PollStatus.ENDED }),
  vote('outside', 1, { project_uid: 'project-outside', parent_project_uid: 'foundation-b', committee_name: 'Outside Group' }),
];

describe('VotesDashboardComponent personal summary', () => {
  let fixture: ComponentFixture<VotesDashboardComponent>;
  let dashboard: VotesDashboardComponent;
  let table: VotesTableComponent;
  let activeLens: WritableSignal<Lens>;
  let activeContext: WritableSignal<ProjectContext | null>;
  let canWrite: WritableSignal<boolean>;
  let getMyVotes: ReturnType<typeof vi.fn>;
  let hasVotesAwaitingInvitationCount: ReturnType<typeof vi.fn>;
  const cards = () => dashboard['myVoteStatCards']();
  const rows = () => table['displayedVotes']().map((row) => row.uid);
  const tabPills = () =>
    Array.from(fixture.nativeElement.querySelectorAll('[data-testid="votes-status-tabs"] [data-testid^="filter-pill-"]') as NodeListOf<HTMLElement>);
  const tabLabels = () => tabPills().map((pill) => pill.textContent!.trim());
  const tabAccessibleNames = () => tabPills().map((pill) => pill.getAttribute('aria-label'));
  const element = (id: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${id}"]`);
  const settle = async () => {
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(300);
    fixture.detectChanges();
    TestBed.tick();
    fixture.detectChanges();
  };
  const selectSummary = async (action: string) => {
    element(`stat-card-${action}`)!.click();
    await settle();
  };

  beforeEach(async () => {
    // Leave Angular's change-detection scheduling real; only RxJS debounce and the viewer clock are controlled.
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(NOW);
    activeLens = signal<Lens>('me');
    activeContext = signal<ProjectContext | null>(null);
    canWrite = signal(false);
    getMyVotes = vi.fn(() => of({ votes: feed, complete: true }));
    hasVotesAwaitingInvitationCount = vi.fn(() => false);
    TestBed.configureTestingModule({
      imports: [VotesDashboardComponent],
      providers: [
        provideRouter([]),
        MessageService,
        { provide: PLATFORM_ID, useValue: 'server' },
        {
          provide: VoteService,
          useValue: {
            getMyVotes,
            mergeRecentlyOpenedVotes: (votes: Vote[]) => votes,
            mergeRecentlyCreatedVotes: (votes: Vote[]) => votes,
            isAwaitingInvitationCount: () => false,
            hasVotesAwaitingInvitationCount,
            getVotesCountByProject: vi.fn(() => of(20)),
            getVotesSummaryByProject: vi.fn(() => of({ active_votes: 20, closing_soon: 3, as_of: new Date(NOW).toISOString() })),
            getVoteStatusCountsByProject: vi.fn(() => of({ all: 9, active: 4, disabled: 2, ended: 3 })),
            getVotesByProjectPaginated: vi.fn(
              (_uid: string, _rows: number, pageToken?: string, _search?: string, filters?: string[], closingOnly?: boolean) => {
                const pageUid = pageToken ? 'second-page' : 'first-page';
                const uid = filters?.includes(`status:${PollStatus.ENDED}`) ? 'ended-first-page' : pageUid;
                if (closingOnly) return of({ data: [vote('closing', 1)], total_records: 1, page_token: undefined });
                return of({ data: [vote(uid, 1)], page_token: pageToken ? undefined : 'page-two' });
              }
            ),
          },
        },
        { provide: CommitteeService, useValue: { getCommitteesByProject: vi.fn(() => of([])) } },
        { provide: LensService, useValue: { activeLens } },
        { provide: PersonaService, useValue: { personaLoaded: signal(true), hasBoardRole: signal(true), hasProjectRole: signal(true) } },
        { provide: ProjectContextService, useValue: { activeContext, canWrite } },
        { provide: DialogService, useValue: { open: vi.fn() } },
        { provide: MailingListService, useValue: {} },
      ],
    });
    // Keep the real dashboard, summary and table.
    TestBed.overrideComponent(VotesDashboardComponent, {
      add: { schemas: [NO_ERRORS_SCHEMA] },
    });
    await TestBed.compileComponents();
    fixture = TestBed.createComponent(VotesDashboardComponent);
    dashboard = fixture.componentInstance;
    await settle();
    table = fixture.debugElement.query(By.directive(VotesTableComponent)).componentInstance;
  });

  afterEach(() => {
    fixture?.destroy();
    vi.useRealTimers();
  });

  async function management(lens: Lens = 'project'): Promise<void> {
    activeContext.set({ uid: 'project-a', name: 'Synthetic Project', slug: 'synthetic-project' });
    activeLens.set(lens);
    await settle();
    table = fixture.debugElement.query(By.directive(VotesTableComponent)).componentInstance;
  }

  it.each<Lens>(['project', 'foundation'])('enables participation progress in the %s lens', async (lens) => {
    await management(lens);
    expect(table.showParticipationProgress()).toBe(true);
  });

  it('re-fetches the page and counts while a just-opened vote is still counting invitations (GH-4078)', async () => {
    const service = TestBed.inject(VoteService);
    await management();
    const list = vi.mocked(service.getVotesByProjectPaginated);
    const counts = vi.mocked(service.getVoteStatusCountsByProject);
    const fetchPage = list.getMockImplementation()!;
    // The first fetched page is still counting; the next one (the catch-up refetch) has converged.
    let fetches = 0;
    hasVotesAwaitingInvitationCount.mockImplementation((votes: Vote[]) => fetches === 1 && votes.length > 0);
    list.mockImplementation((...args: Parameters<typeof fetchPage>) => {
      fetches++;
      return fetchPage(...args);
    });
    dashboard['fetch$'].next();
    await settle();
    list.mockClear();
    counts.mockClear();

    await vi.advanceTimersByTimeAsync(VOTE_INVITATION_COUNT_REFRESH_MS);
    await settle();

    expect(list).toHaveBeenCalledTimes(1);
    expect(counts).toHaveBeenCalledTimes(1);

    list.mockClear();
    await vi.advanceTimersByTimeAsync(VOTE_INVITATION_COUNT_REFRESH_MS * 3);
    await settle();
    expect(list).not.toHaveBeenCalled();
  });

  it('polls silently, and a failed poll keeps the rows and retries (GH-4078)', async () => {
    const service = TestBed.inject(VoteService);
    await management();
    hasVotesAwaitingInvitationCount.mockReturnValue(true);
    dashboard['fetch$'].next();
    await settle();
    expect(rows()).toEqual(['first-page']);

    const setLoading = vi.spyOn(dashboard['loading'], 'set');
    const setSummaryLoading = vi.spyOn(dashboard['managementSummaryLoading'], 'set');
    const setCountsLoading = vi.spyOn(dashboard['managementStatusCountsLoading'], 'set');
    const setTotalReady = vi.spyOn(dashboard['totalCountReady'], 'set');
    const list = vi.mocked(service.getVotesByProjectPaginated);
    list.mockClear();

    await vi.advanceTimersByTimeAsync(VOTE_INVITATION_COUNT_REFRESH_MS);
    await settle();
    expect(list).toHaveBeenCalledTimes(1);
    expect(setLoading).not.toHaveBeenCalledWith(true);
    expect(setSummaryLoading).not.toHaveBeenCalledWith(true);
    expect(setCountsLoading).not.toHaveBeenCalledWith(true);
    expect(setTotalReady).not.toHaveBeenCalledWith(false);

    list.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    await vi.advanceTimersByTimeAsync(VOTE_INVITATION_COUNT_REFRESH_MS);
    await settle();
    expect(list).toHaveBeenCalledTimes(2);
    expect(rows()).toEqual(['first-page']);

    // The kept rows re-arm the poll, so it retries on the next tick.
    await vi.advanceTimersByTimeAsync(VOTE_INVITATION_COUNT_REFRESH_MS);
    await settle();
    expect(list).toHaveBeenCalledTimes(3);
  });

  it('clears earlier summary/count errors on a successful poll and keeps the total when a polled count fails (GH-4078)', async () => {
    const service = TestBed.inject(VoteService);
    await management();
    const summary = vi.mocked(service.getVotesSummaryByProject);
    const counts = vi.mocked(service.getVoteStatusCountsByProject);
    const total = vi.mocked(service.getVotesCountByProject);
    const succeedSummary = summary.getMockImplementation()!;
    const succeedCounts = counts.getMockImplementation()!;
    hasVotesAwaitingInvitationCount.mockReturnValue(true);
    summary.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    counts.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    dashboard['fetch$'].next();
    dashboard['refresh$'].next();
    await settle();
    expect(dashboard['managementSummaryError']()).toBe(true);
    expect(dashboard['managementStatusCountsError']()).toBe(true);
    expect(dashboard['totalRecords']()).toBe(20);

    summary.mockImplementation(succeedSummary);
    counts.mockImplementation(succeedCounts);
    total.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    await vi.advanceTimersByTimeAsync(VOTE_INVITATION_COUNT_REFRESH_MS);
    await settle();

    expect(dashboard['managementSummaryError']()).toBe(false);
    expect(dashboard['managementStatusCountsError']()).toBe(false);
    expect(dashboard['totalRecords']()).toBe(20);
    expect(dashboard['totalCountReady']()).toBe(true);
  });

  it('skips a poll tick while a foreground fetch is loading, so it cannot cancel it (GH-4078)', async () => {
    const service = TestBed.inject(VoteService);
    await management();
    hasVotesAwaitingInvitationCount.mockReturnValue(true);
    dashboard['fetch$'].next();
    await settle();

    // A foreground fetch (e.g. a scope or page change) is still in flight when the armed timer fires.
    const list = vi.mocked(service.getVotesByProjectPaginated);
    const pending = new Subject<VoteListResponse>();
    list.mockClear();
    list.mockReturnValue(pending);
    dashboard['fetch$'].next();
    await vi.advanceTimersByTimeAsync(VOTE_INVITATION_COUNT_REFRESH_MS);
    await settle();

    expect(list).toHaveBeenCalledTimes(1);
    expect(pending.observed).toBe(true);
    expect(dashboard['loading']()).toBe(true);
  });

  it('shows personal voting status in the Me lens', () => {
    expect(table.showParticipationProgress()).toBe(false);
  });

  it.each<Lens>(['project', 'foundation'])('shows %s totals for the entire Group scope, independent of search/status/page', async (lens) => {
    const service = TestBed.inject(VoteService);
    await management(lens);
    expect(element('votes-management-stats')).not.toBeNull();
    expect(element('votes-me-stats')).toBeNull();
    expect(dashboard['managementVoteStatCards']().map((card) => card.value)).toEqual([3, 20]);
    const summary = vi.mocked(service.getVotesSummaryByProject);
    summary.mockClear();
    table.searchForm.controls.search.setValue('Ballot');
    table['onStatusTabChange'](PollStatus.ENDED);
    await settle();
    dashboard['onPageChange']({ first: 10, rows: 10 });
    await settle();
    expect(summary).not.toHaveBeenCalled();
    table.searchForm.controls.group.setValue('Synthetic Board');
    await settle();
    expect(summary).toHaveBeenCalledExactlyOnceWith('project-a', 'Synthetic Board');
    expect(table.first()).toBe(0);
    expect(dashboard['managementVoteStatCards']().map((card) => card.value)).toEqual([3, 20]);
  });

  it.each<Lens>(['project', 'foundation'])('sends one list request per %s summary action and status-tab exit', async (lens) => {
    await management(lens);
    const service = TestBed.inject(VoteService);
    const list = vi.mocked(service.getVotesByProjectPaginated);
    const count = vi.mocked(service.getVotesCountByProject);

    for (const transition of [
      { action: 'closing-soon', count: 0 },
      { action: 'closing-soon', count: 1 },
      { action: 'active', count: 0 },
      { action: 'closing-soon', count: 0 },
    ]) {
      list.mockClear();
      count.mockClear();
      await selectSummary(transition.action);
      expect(list, transition.action).toHaveBeenCalledTimes(1);
      expect(count, transition.action).toHaveBeenCalledTimes(transition.count);
    }

    list.mockClear();
    count.mockClear();
    table['onStatusTabChange'](PollStatus.ACTIVE);
    await settle();
    expect(list).toHaveBeenCalledTimes(1);
    expect(count).toHaveBeenCalledTimes(1);

    dashboard['onPageChange']({ first: 10, rows: 10 });
    await settle();
    list.mockClear();
    count.mockClear();
    await selectSummary('active');
    expect(list).toHaveBeenCalledTimes(1);
    expect(count).not.toHaveBeenCalled();
    expect(table.first()).toBe(0);
    expect(rows()).toEqual(['first-page']);
  });

  it.each<Lens>(['project', 'foundation'])('only requests the selected status when leaving %s Closing Soon', async (lens) => {
    await management(lens);
    const service = TestBed.inject(VoteService);
    const list = vi.mocked(service.getVotesByProjectPaginated);
    const count = vi.mocked(service.getVotesCountByProject);
    for (const status of [PollStatus.ENDED, PollStatus.DISABLED, 'all']) {
      await selectSummary('closing-soon');
      list.mockClear();
      count.mockClear();
      table['onStatusTabChange'](status);
      await settle();
      const filters = status === 'all' ? undefined : [`status:${status}`];
      expect(list, status).toHaveBeenCalledExactlyOnceWith('project-a', 10, undefined, undefined, filters, undefined);
      expect(count, status).toHaveBeenCalledExactlyOnceWith('project-a', undefined, filters);
      expect(dashboard['managementClosingOnly']()).toBe(false);
      expect(table.first()).toBe(0);
    }
  });

  it.each<Lens>(['project', 'foundation'])('keeps the %s table mounted when leaving an empty Closing Soon list for All', async (lens) => {
    await management(lens);
    const service = TestBed.inject(VoteService);
    const list = vi.mocked(service.getVotesByProjectPaginated);
    const count = vi.mocked(service.getVotesCountByProject);
    list.mockReturnValueOnce(of({ data: [], total_records: 0 }));
    await selectSummary('closing-soon');
    expect(rows()).toEqual([]);
    const originalTable = table;
    const destroyed = vi.fn();
    table['destroyRef'].onDestroy(destroyed);
    const pending = new Subject<VoteListResponse>();
    list.mockReturnValueOnce(pending);
    list.mockClear();
    count.mockClear();
    element('filter-pill-all')!.click();
    fixture.detectChanges();
    expect(element('votes-empty-state-card')).toBeNull();
    expect(destroyed).not.toHaveBeenCalled();
    await settle();
    expect(fixture.debugElement.query(By.directive(VotesTableComponent)).componentInstance).toBe(originalTable);
    expect(destroyed).not.toHaveBeenCalled();
    expect(element('votes-empty-state-card')).toBeNull();
    expect(list).toHaveBeenCalledExactlyOnceWith('project-a', 10, undefined, undefined, undefined, undefined);
    expect(count).toHaveBeenCalledExactlyOnceWith('project-a', undefined, undefined);
    pending.next({ data: [vote('restored', 1)] });
    pending.complete();
    await settle();
    expect(rows()).toEqual(['restored']);
    expect(destroyed).not.toHaveBeenCalled();
  });

  it.each<Lens>(['project', 'foundation'])('hides the %s paginator until the closing list supplies its total', async (lens) => {
    await management(lens);
    const pending = new Subject<VoteListResponse>();
    vi.mocked(TestBed.inject(VoteService).getVotesByProjectPaginated).mockReturnValueOnce(pending);
    expect(fixture.nativeElement.querySelector('.p-paginator')).not.toBeNull();
    await selectSummary('closing-soon');
    expect(fixture.nativeElement.querySelector('.p-paginator')).toBeNull();
    expect(element('votes-search-input')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="votes-row-first-page"]')).toBeNull();
    pending.next({ data: [vote('closing', 1)], total_records: 1 });
    pending.complete();
    await settle();
    expect(table.totalRecords()).toBe(1);
    expect(fixture.nativeElement.querySelector('.p-paginator')).not.toBeNull();
  });

  for (const lens of ['project', 'foundation'] as const) {
    it.each(['list', 'count'] as const)(`waits for both %s-first responses before restoring the ${lens} Active paginator`, async (first) => {
      await management(lens);
      await selectSummary('closing-soon');
      const service = TestBed.inject(VoteService);
      const list = new Subject<VoteListResponse>();
      const count = new Subject<number>();
      vi.mocked(service.getVotesByProjectPaginated).mockReturnValueOnce(list);
      vi.mocked(service.getVotesCountByProject).mockReturnValueOnce(count);
      table['onStatusTabChange'](PollStatus.ACTIVE);
      await settle();
      expect(fixture.nativeElement.querySelector('.p-paginator')).toBeNull();
      const finishList = () => {
        list.next({ data: [vote('active', 1)] });
        list.complete();
      };
      const finishCount = () => {
        count.next(20);
        count.complete();
      };
      if (first === 'list') finishList();
      else finishCount();
      await settle();
      expect(fixture.nativeElement.querySelector('.p-paginator')).toBeNull();
      if (first === 'list') finishCount();
      else finishList();
      await settle();
      expect(table.totalRecords()).toBe(20);
      expect(fixture.nativeElement.querySelector('.p-paginator')).not.toBeNull();
    });
  }

  it('uses closing server rows/totals without count requests, retains pending controls and clears on explicit Active', async () => {
    await management();
    const service = TestBed.inject(VoteService);
    const count = vi.mocked(service.getVotesCountByProject);
    const list = vi.mocked(service.getVotesByProjectPaginated);
    table.searchForm.patchValue({ group: 'Synthetic Board', search: 'Ballot' });
    await selectSummary('closing-soon');
    expect(dashboard['managementClosingOnly']()).toBe(true);
    expect(table.statusTab()).toBe(PollStatus.ACTIVE);
    expect(table.first()).toBe(0);
    expect(table.totalRecords()).toBe(1);
    expect(rows()).toEqual(['closing']);
    expect(list).toHaveBeenLastCalledWith('project-a', 10, undefined, 'Ballot', ['status:active', 'committee_name:Synthetic Board'], true);
    expect(table.searchForm.controls.search.value).toBe('Ballot');
    count.mockClear();
    dashboard['refreshVotes']();
    await settle();
    expect(count).not.toHaveBeenCalled();
    table['onStatusTabChange'](PollStatus.ACTIVE);
    await settle();
    expect(dashboard['managementClosingOnly']()).toBe(false);
    expect(table.first()).toBe(0);
    expect(rows()).toEqual(['first-page']);
    dashboard['onPageChange']({ first: 10, rows: 10 });
    await settle();
    await selectSummary('active');
    expect(table.first()).toBe(0);
    expect(rows()).toEqual(['first-page']);
    await selectSummary('closing-soon');
    await selectSummary('closing-soon');
    expect(dashboard['managementClosingOnly']()).toBe(false);
    expect(table.statusTab()).toBe(PollStatus.ACTIVE);
    await selectSummary('closing-soon');
    table['resetFilters']();
    await settle();
    expect(dashboard['managementClosingOnly']()).toBe(false);
    expect(table.statusTab()).toBe('all');
  });

  it('keeps zero closing results recoverable through Reset without hiding controls', async () => {
    await management();
    vi.mocked(TestBed.inject(VoteService).getVotesByProjectPaginated).mockReturnValue(of({ data: [], total_records: 0 }));
    await selectSummary('closing-soon');
    expect(table.totalRecords()).toBe(0);
    expect(element('votes-search-input')).not.toBeNull();
    expect(element('votes-group-filter')).not.toBeNull();
    expect(element('votes-empty-state-card')).toBeNull();
    // Closing Soon is a shortcut on top of Active, so the copy must not claim there are no active votes.
    expect(element('votes-table-empty-state')?.textContent).toContain('No votes match your filters');
    expect(element('votes-table-empty-state')?.textContent).not.toContain('No active votes');
    expect(fixture.nativeElement.textContent).toContain('Reset filters');
  });

  it('isolates summary loading/failure/retry from the available list and publishes confirmed zero', async () => {
    const service = TestBed.inject(VoteService);
    const pending = new Subject<VoteSummary>();
    vi.mocked(service.getVotesSummaryByProject).mockReturnValueOnce(pending);
    await management();
    const button = element('stat-card-active') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain('—');
    expect(rows()).toEqual(['first-page']);
    pending.error(new Error('Summary failed'));
    await settle();
    expect(element('votes-management-summary-error')?.getAttribute('role')).toBe('alert');
    expect(dashboard['managementVoteStatCards']().map((card) => card.value)).toEqual(['—', '—']);
    expect(rows()).toEqual(['first-page']);
    vi.mocked(service.getVotesByProjectPaginated).mockClear();
    vi.mocked(service.getVotesCountByProject).mockClear();
    vi.mocked(service.getVotesSummaryByProject).mockReturnValueOnce(of({ active_votes: 0, closing_soon: 0, as_of: new Date(NOW).toISOString() }));
    element('votes-management-summary-retry')!.querySelector('button')!.click();
    await settle();
    expect(dashboard['managementVoteStatCards']().map((card) => card.value)).toEqual([0, 0]);
    expect(element('votes-management-summary-error')).toBeNull();
    expect(button.disabled).toBe(false);
    expect(service.getVotesByProjectPaginated).not.toHaveBeenCalled();
    expect(service.getVotesCountByProject).not.toHaveBeenCalled();
  });

  it('cancels obsolete summaries and resets closing mode/cursors on same-lens context changes', async () => {
    const service = TestBed.inject(VoteService);
    const old = new Subject<VoteSummary>();
    vi.mocked(service.getVotesSummaryByProject).mockReturnValueOnce(old);
    await management();
    activeContext.set({ uid: 'project-b', name: 'Synthetic B', slug: 'synthetic-b' });
    await settle();
    expect(old.observers).toHaveLength(0);
    old.next({ active_votes: 99, closing_soon: 99, as_of: new Date(NOW).toISOString() });
    expect(dashboard['managementSummary']()?.active_votes).toBe(20);
    await selectSummary('closing-soon');
    dashboard['onPageChange']({ first: 10, rows: 10 });
    activeContext.set({ uid: 'project-c', name: 'Synthetic C', slug: 'synthetic-c' });
    await settle();
    expect(dashboard['managementClosingOnly']()).toBe(false);
    expect(table.first()).toBe(0);
    expect(service.getVotesByProjectPaginated).toHaveBeenLastCalledWith('project-c', 10, undefined, undefined, ['status:active'], undefined);
    activeLens.set('org');
    await settle();
    expect(element('votes-management-stats')).toBeNull();
  });

  it('returns to the unshortcut Active personal list after leaving Me with a summary selected', async () => {
    await selectSummary('needs-vote');
    expect(rows()).toEqual(['soon', 'later', 'beta', 'blank', 'outside']);
    activeLens.set('project');
    await settle();
    expect(element('votes-me-stats')).toBeNull();
    activeLens.set('me');
    await settle();
    table = fixture.debugElement.query(By.directive(VotesTableComponent)).componentInstance;
    expect(element('stat-card-needs-vote')?.getAttribute('aria-pressed')).toBe('false');
    expect(table.statusTab()).toBe(PollStatus.ACTIVE);
    expect(rows()).toEqual(feed.filter((item) => item.status === PollStatus.ACTIVE).map((item) => item.uid));
  });

  it.each<Lens>(['project', 'foundation'])('keeps %s page rows aligned with the paginator when reselecting a status', async (lens) => {
    activeContext.set({ uid: 'project-a', name: 'Synthetic Project', slug: 'synthetic-project' });
    activeLens.set(lens);
    await settle();
    table = fixture.debugElement.query(By.directive(VotesTableComponent)).componentInstance;
    table['onStatusTabChange'](PollStatus.ACTIVE);
    await settle();
    dashboard['onPageChange']({ first: 10, rows: 10 });
    await settle();
    expect(rows()).toEqual(['second-page']);
    expect(table.first()).toBe(10);

    table['onStatusTabChange'](PollStatus.ACTIVE);
    await settle();
    expect(rows()).toEqual(['second-page']);
    expect(table.first()).toBe(10);

    table['onStatusTabChange'](PollStatus.ENDED);
    await settle();
    expect(rows()).toEqual(['ended-first-page']);
    expect(table.first()).toBe(0);
  });

  it('aggregates returned foundation/project/group scope, excluding search, status and page from totals', async () => {
    expect(cards().map((card) => card.value)).toEqual([5, 5]);
    dashboard['onFoundationFilterChange']('foundation-a');
    await settle();
    expect(cards().map((card) => card.value)).toEqual([4, 4]);
    dashboard['onProjectFilterChange']('project-a');
    await settle();
    expect(table.groupOptions().map((option) => option.value)).toEqual([null, 'Alpha Group']);
    table.searchForm.patchValue({ group: 'Alpha Group', search: 'not a ballot' });
    table['onStatusTabChange'](PollStatus.ENDED);
    dashboard['onPageChange']({ first: 25, rows: 25 });
    await settle();
    expect(rows()).toEqual([]);
    expect(cards().map((card) => [card.value, card.subLine])).toEqual([
      [2, 'Next: Jan 12, 2026'],
      [2, 'Earliest deadline: Jan 14, 2026'],
    ]);
    await selectSummary('needs-vote');
    expect(cards().map((card) => card.value)).toEqual([2, 2]);
    expect(element('votes-search-input')).not.toBeNull();
    expect(element('votes-table-empty-state')?.textContent).toContain('No votes match your filters');
  });

  it('coordinates Ended, summary toggles, explicit Active and Reset without losing pending controls', async () => {
    table.searchForm.patchValue({ group: 'Alpha Group', foundationFilter: 'foundation-a', projectFilter: 'project-a' });
    dashboard['onFoundationFilterChange']('foundation-a');
    dashboard['onProjectFilterChange']('project-a');
    table['onStatusTabChange'](PollStatus.ENDED);
    await settle();
    expect(rows()).toEqual(['ended']);
    dashboard['onPageChange']({ first: 0, rows: 25 });
    dashboard['onPageChange']({ first: 25, rows: 25 });
    table.searchForm.controls.search.setValue('Ballot'); // Still pending when the summary changes the tab.
    await selectSummary('closing-soon');
    expect(table.statusTab()).toBe(PollStatus.ACTIVE);
    expect(rows()).toEqual(['responded', 'soon']);
    expect(table.first()).toBe(0);
    expect(table.rowsPerPage()).toBe(25);
    expect(table.searchForm.getRawValue()).toEqual({ search: 'Ballot', group: 'Alpha Group', foundationFilter: 'foundation-a', projectFilter: 'project-a' });
    expect([dashboard['foundationFilter'](), dashboard['projectFilter']()]).toEqual(['foundation-a', 'project-a']);
    await selectSummary('closing-soon');
    expect(rows()).toEqual(['responded', 'soon', 'later']);
    expect(table.statusTab()).toBe(PollStatus.ACTIVE);
    await selectSummary('needs-vote');
    expect(rows()).toEqual(['soon', 'later']);
    await selectSummary('closing-soon');
    expect(rows()).toEqual(['responded', 'soon']);
    table['onStatusTabChange'](PollStatus.ACTIVE);
    await settle();
    expect(dashboard['myVotesQuickFilter']()).toBeNull();
    expect(rows()).toEqual(['responded', 'soon', 'later']);
    await selectSummary('needs-vote');
    getMyVotes.mockReturnValueOnce(
      of({ votes: feed.map((item) => (item.uid === 'soon' ? { ...item, response_status: VoteResponseStatus.RESPONDED } : item)), complete: true })
    );
    dashboard['refresh$'].next();
    await settle();
    expect(cards()[1].value).toBe(1);
    expect(rows()).toEqual(['later']);
    table['resetFilters']();
    await settle();
    expect(dashboard['myVotesQuickFilter']()).toBeNull();
    expect(table.statusTab()).toBe('all');
    expect(table.searchForm.controls.search.value).toBe('');
    expect([dashboard['foundationFilter'](), dashboard['projectFilter']()]).toEqual([null, null]);
    expect(rows()).toEqual(feed.map((item) => item.uid));
    expect(table.rowsPerPage()).toBe(25);
  });

  it.each([false, true])('keeps controls through loading/failure and retries to confirmed %s-empty success', async (empty) => {
    table.searchForm.patchValue({ search: 'Ballot', group: 'Alpha Group' });
    await settle();
    const request = new Subject<MyVotesResponse>();
    getMyVotes.mockReturnValueOnce(request);
    dashboard['refreshVotes']();
    await settle();
    const button = element('stat-card-needs-vote') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain('—');
    request.error(new HttpErrorResponse({ status: 503 }));
    await settle();
    expect(element('votes-load-error')?.textContent).toContain('Unable to load your votes');
    expect(cards().map((card) => card.value)).toEqual(['—', '—']);
    expect(button.disabled).toBe(true);
    expect(fixture.debugElement.query(By.directive(VotesTableComponent)).componentInstance).toBe(table);
    expect(table.searchForm.controls.group.value).toBe('Alpha Group');
    expect(table.searchForm.controls.search.value).toBe('Ballot');
    expect(fixture.nativeElement.textContent).not.toContain("Votes you've been invited to participate in will appear here.");
    getMyVotes.mockReturnValueOnce(of({ votes: empty ? [] : feed, complete: true }));
    element('votes-retry')!.querySelector('button')!.click();
    await settle();
    expect(element('votes-load-error')).toBeNull();
    expect(cards().map((card) => card.value)).toEqual(empty ? [0, 0] : [2, 2]);
    expect(button.disabled).toBe(false);
    expect(table.searchForm.controls.search.value).toBe('Ballot');
    // The default Active tab still applies after retry; the ended vote stays under Ended/All.
    expect(rows()).toEqual(empty ? [] : ['responded', 'soon', 'later']);
    expect(table.searchForm.controls.group.value).toBe(empty ? null : 'Alpha Group');
    if (empty) expect(element('votes-table-empty-state')?.textContent).toContain('No votes match your filters');
  });

  describe('Active default and empty states', () => {
    const activeFeed = () => feed.filter((item) => item.status === PollStatus.ACTIVE).map((item) => item.uid);

    /** Creates a dashboard already in the given management lens, as on a fresh page entry. */
    async function freshDashboard(lens: Lens): Promise<void> {
      fixture.destroy();
      const service = TestBed.inject(VoteService);
      vi.mocked(service.getVotesByProjectPaginated).mockClear();
      vi.mocked(service.getVotesCountByProject).mockClear();
      activeContext.set({ uid: 'project-a', name: 'Synthetic Project', slug: 'synthetic-project' });
      activeLens.set(lens);
      fixture = TestBed.createComponent(VotesDashboardComponent);
      dashboard = fixture.componentInstance;
      await settle();
      table = fixture.debugElement.query(By.directive(VotesTableComponent))?.componentInstance;
    }

    it('opens My Votes on Active without a Draft tab and keeps All selectable', async () => {
      expect(table.statusTab()).toBe(PollStatus.ACTIVE);
      expect(element(`filter-pill-${PollStatus.ACTIVE}`)?.getAttribute('aria-pressed')).toBe('true');
      expect(element(`filter-pill-${PollStatus.DISABLED}`)).toBeNull();
      expect(rows()).toEqual(activeFeed());
      expect(TestBed.inject(VoteService).getVotesByProjectPaginated).not.toHaveBeenCalled();
      element('filter-pill-all')!.click();
      await settle();
      expect(rows()).toEqual(feed.map((item) => item.uid));
    });

    it.each<Lens>(['project', 'foundation'])('opens %s Votes on Active with matching first list and count requests', async (lens) => {
      await freshDashboard(lens);
      const service = TestBed.inject(VoteService);
      const list = vi.mocked(service.getVotesByProjectPaginated);
      const count = vi.mocked(service.getVotesCountByProject);
      expect(table.statusTab()).toBe(PollStatus.ACTIVE);
      expect(element(`filter-pill-${PollStatus.ACTIVE}`)?.getAttribute('aria-pressed')).toBe('true');
      expect(element(`filter-pill-${PollStatus.DISABLED}`)).not.toBeNull();
      expect(list.mock.calls[0]).toEqual(['project-a', 10, undefined, undefined, ['status:active'], undefined]);
      expect(count.mock.calls[0]).toEqual(['project-a', undefined, ['status:active']]);
      // No request ever goes out for All while Active is shown.
      expect(list.mock.calls.every((call) => call[4]?.includes('status:active'))).toBe(true);
      expect(count.mock.calls.every((call) => call[2]?.includes('status:active'))).toBe(true);
      expect(rows()).toEqual(['first-page']);
    });

    it('omits whitespace-only search from management requests and trims meaningful search', async () => {
      await management();
      const service = TestBed.inject(VoteService);
      const list = vi.mocked(service.getVotesByProjectPaginated);
      const count = vi.mocked(service.getVotesCountByProject);
      list.mockClear();
      count.mockClear();
      table.searchForm.controls.search.setValue('   ');
      await settle();
      expect(list).not.toHaveBeenCalled();
      expect(count).not.toHaveBeenCalled();
      expect(rows()).toEqual(['first-page']);
      table.searchForm.controls.search.setValue('  Ballot  ');
      await settle();
      expect(list).toHaveBeenLastCalledWith('project-a', 10, undefined, 'Ballot', ['status:active'], undefined);
      expect(count).toHaveBeenLastCalledWith('project-a', 'Ballot', ['status:active']);
      expect(table.searchForm.controls.search.value).toBe('  Ballot  ');
    });

    it('re-enters management on Active, in both the tab and the request, after another My Votes status', async () => {
      table['onStatusTabChange'](PollStatus.ENDED);
      await settle();
      expect(dashboard['filters']().status).toBe(PollStatus.ENDED);
      const service = TestBed.inject(VoteService);
      vi.mocked(service.getVotesByProjectPaginated).mockClear();
      vi.mocked(service.getVotesCountByProject).mockClear();
      await management('foundation');
      expect(table.statusTab()).toBe(PollStatus.ACTIVE);
      expect(dashboard['filters']().status).toBe(PollStatus.ACTIVE);
      expect(service.getVotesByProjectPaginated).toHaveBeenLastCalledWith('project-a', 10, undefined, undefined, ['status:active'], undefined);
      expect(service.getVotesCountByProject).toHaveBeenLastCalledWith('project-a', undefined, ['status:active']);
      expect(rows()).toEqual(['first-page']);
    });

    it.each<Lens>(['project', 'foundation'])('keeps the %s table mounted from an empty Active view through All and Reset', async (lens) => {
      vi.mocked(TestBed.inject(VoteService).getVotesByProjectPaginated).mockImplementation((_uid, _rows, _token, _search, filters) =>
        filters?.includes(`status:${PollStatus.ACTIVE}`) ? of({ data: [], total_records: 0 }) : of({ data: [vote('first-page', 1)] })
      );
      await freshDashboard(lens);
      const originalTable = table;
      expect(element('votes-empty-state-card')).toBeNull();
      expect(element('votes-table-empty-state')?.textContent).toContain('No active votes');
      element('filter-pill-all')!.click();
      await settle();
      expect(fixture.debugElement.query(By.directive(VotesTableComponent)).componentInstance).toBe(originalTable);
      expect(rows()).toEqual(['first-page']);
      element(`filter-pill-${PollStatus.ACTIVE}`)!.click();
      await settle();
      expect(element('votes-table-empty-state')?.textContent).toContain('No active votes');
      element('votes-table-empty-state')!.querySelector('button')!.click();
      await settle();
      expect(table.statusTab()).toBe('all');
      expect(fixture.debugElement.query(By.directive(VotesTableComponent)).componentInstance).toBe(originalTable);
      expect(rows()).toEqual(['first-page']);
    });

    it.each([false, true])('limits create wording and actions to writers when no votes exist (writer: %s)', async (writer) => {
      canWrite.set(writer);
      vi.mocked(TestBed.inject(VoteService).getVotesByProjectPaginated).mockReturnValue(of({ data: [], total_records: 0 }));
      await freshDashboard('project');
      // Status copy stays neutral and inside the table for every viewer.
      expect(element('votes-table-empty-state')?.textContent).toContain('No active votes');
      expect(element('votes-table-empty-state')?.textContent).not.toContain('Create');
      element('filter-pill-all')!.click();
      await settle();
      const card = element('votes-empty-state-card');
      expect(card?.textContent).toContain('No votes yet');
      expect(card?.textContent).toContain(
        writer ? 'Create a vote to gather decisions from project groups.' : 'Votes for this project or foundation will appear here.'
      );
      expect(card?.textContent?.includes('Create')).toBe(writer);
      expect(element('votes-create-button') !== null).toBe(writer);
    });
  });

  it('preserves plain status labels in the Org lens where counts are not sourced', async () => {
    await management('org');
    const service = TestBed.inject(VoteService);

    expect(rows()).toEqual(['first-page']);
    expect(tabLabels()).toEqual(['All', 'Active', 'Draft', 'Ended']);
    expect(table.showStatusCounts()).toBe(false);
    expect(service.getVoteStatusCountsByProject).not.toHaveBeenCalled();
  });

  for (const lens of ['project', 'foundation'] as const) {
    it.each([
      { search: ' Steering ', expected: 'Steering' },
      { search: '   ', expected: undefined },
    ])(`uses the same normalized search for the ${lens} list, paginator and tab counts: %j`, async ({ search, expected }) => {
      await management(lens);
      table.searchForm.controls.search.setValue('Initial');
      await settle();
      const service = TestBed.inject(VoteService);
      const list = vi.mocked(service.getVotesByProjectPaginated);
      const count = vi.mocked(service.getVotesCountByProject);
      const statusCounts = vi.mocked(service.getVoteStatusCountsByProject);
      list.mockClear();
      count.mockClear();
      statusCounts.mockClear();

      table.searchForm.controls.search.setValue(search);
      await settle();

      expect(list).toHaveBeenCalledExactlyOnceWith('project-a', 10, undefined, expected, ['status:active'], undefined);
      expect(count).toHaveBeenCalledExactlyOnceWith('project-a', expected, ['status:active']);
      expect(statusCounts).toHaveBeenCalledExactlyOnceWith('project-a', expected, undefined);
      expect(table.searchForm.controls.search.value).toBe(search);
    });
  }

  it.each<Lens>(['project', 'foundation'])('requests %s tab counts by scope, search and Group only, and shows failures as plain labels', async (lens) => {
    const service = TestBed.inject(VoteService);
    const counts = vi.mocked(service.getVoteStatusCountsByProject);
    await management(lens);
    expect(counts).toHaveBeenLastCalledWith('project-a', undefined, undefined);
    expect(tabLabels()).toEqual(['All (9)', 'Active (4)', 'Draft (2)', 'Ended (3)']);

    counts.mockClear();
    counts.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 503 })));
    dashboard['refreshVotes']();
    await settle();
    expect(counts).toHaveBeenCalledOnce();
    expect(dashboard['tabStatusCounts']()).toBeNull();
    expect(tabLabels()).toEqual(['All', 'Active', 'Draft', 'Ended']);
    expect(tabAccessibleNames()).toEqual(tabLabels());
    expect(rows()).toEqual(['first-page']);
    dashboard['refreshVotes']();
    await settle();
    expect(tabLabels()).toEqual(['All (9)', 'Active (4)', 'Draft (2)', 'Ended (3)']);
    expect(tabAccessibleNames()).toEqual(tabLabels());

    counts.mockClear();
    table['onStatusTabChange'](PollStatus.ENDED);
    await settle();
    await selectSummary('closing-soon');
    dashboard['onPageChange']({ first: 10, rows: 10 });
    await settle();
    expect(counts).not.toHaveBeenCalled();
    table.searchForm.patchValue({ search: ' Ballot ', group: 'Synthetic Board' });
    await settle();
    expect(counts).toHaveBeenCalledExactlyOnceWith('project-a', 'Ballot', 'Synthetic Board');
  });

  it.each<Lens>(['project', 'foundation'])('shows plain %s tab labels while counts are pending, then only positive counts', async (lens) => {
    const service = TestBed.inject(VoteService);
    const counts = vi.mocked(service.getVoteStatusCountsByProject);
    await management(lens);
    const request = new Subject<VoteStatusCounts>();
    counts.mockReturnValueOnce(request);
    dashboard['refreshVotes']();
    await settle();
    expect(dashboard['tabStatusCounts']()).toBeNull();
    expect(tabLabels()).toEqual(['All', 'Active', 'Draft', 'Ended']);
    expect(tabAccessibleNames()).toEqual(tabLabels());
    expect(rows()).toEqual(['first-page']);

    request.next({ all: 5, active: 1, disabled: 0, ended: 4 });
    request.complete();
    await settle();
    expect(dashboard['tabStatusCounts']()).toEqual({ all: 5, active: 1, disabled: 0, ended: 4 });
    expect(tabLabels()).toEqual(['All (5)', 'Active (1)', 'Draft', 'Ended (4)']);
    expect(tabAccessibleNames()).toEqual(tabLabels());
    expect(element(`filter-pill-${PollStatus.DISABLED}`)).not.toBeNull();
  });

  it('counts the personal list by foundation/project/Group/search, ignoring quick filters and the status tab', async () => {
    const counts = () => dashboard['tabStatusCounts']();
    expect(counts()).toEqual({ all: 7, active: 6, disabled: 0, ended: 1 });
    expect(tabLabels()).toEqual(['All (7)', 'Active (6)', 'Ended (1)']);
    await selectSummary('needs-vote');
    expect(counts()).toEqual({ all: 7, active: 6, disabled: 0, ended: 1 });
    table['onStatusTabChange'](PollStatus.ENDED);
    await settle();
    expect(counts()).toEqual({ all: 7, active: 6, disabled: 0, ended: 1 });

    dashboard['onFoundationFilterChange']('foundation-a');
    await settle();
    expect(counts()).toEqual({ all: 6, active: 5, disabled: 0, ended: 1 });
    dashboard['onProjectFilterChange']('project-a');
    table.searchForm.patchValue({ group: 'Alpha Group', search: 'ballot ' });
    await settle();
    expect(counts()).toEqual({ all: 4, active: 3, disabled: 0, ended: 1 });
    for (const [tab, key] of [
      ['all', 'all'],
      [PollStatus.ACTIVE, 'active'],
      [PollStatus.ENDED, 'ended'],
    ] as const) {
      table['onStatusTabChange'](tab);
      await settle();
      expect(rows(), tab).toHaveLength(counts()![key]);
    }
  });

  it('withholds personal tab counts while loading or after a failure, then shows confirmed zeros', async () => {
    const request = new Subject<MyVotesResponse>();
    getMyVotes.mockReturnValueOnce(request);
    dashboard['refreshVotes']();
    await settle();
    expect(dashboard['tabStatusCounts']()).toBeNull();
    expect(tabLabels()).toEqual(['All', 'Active', 'Ended']);
    expect(tabAccessibleNames()).toEqual(tabLabels());
    request.error(new HttpErrorResponse({ status: 503 }));
    await settle();
    expect(dashboard['tabStatusCounts']()).toBeNull();
    expect(tabLabels()).toEqual(['All', 'Active', 'Ended']);
    getMyVotes.mockReturnValueOnce(of({ votes: [], complete: true }));
    dashboard['refreshVotes']();
    await settle();
    expect(dashboard['tabStatusCounts']()).toEqual({ all: 0, active: 0, disabled: 0, ended: 0 });
    expect(tabLabels()).toEqual(['All', 'Active', 'Ended']);
    expect(tabAccessibleNames()).toEqual(tabLabels());
  });

  it.each([false, true])('keeps partial personal rows usable without reporting exact tab totals (empty: %s)', async (empty) => {
    const votes = empty ? [] : [feed[0]];
    getMyVotes.mockReturnValueOnce(of({ votes, complete: false }));
    dashboard['refreshVotes']();
    await settle();

    expect(dashboard['myVotesError']()).toBe(false);
    expect(dashboard['tabStatusCounts']()).toBeNull();
    expect(tabLabels()).toEqual(['All', 'Active', 'Ended']);
    expect(rows()).toEqual(votes.map((vote) => vote.uid));
    expect(element('votes-load-error')).toBeNull();
    expect(table.resultsComplete()).toBe(false);
    expect(element('votes-table-empty-state')?.textContent ?? '').not.toContain('No active votes');
    expect(!!element('votes-table-empty-state')).toBe(empty);
    expect(tabAccessibleNames()).toEqual(['All', 'Active', 'Ended']);

    // Filtering the usable rows cannot turn an unknown scope into a confirmed zero.
    table.searchForm.patchValue({ search: 'no matching vote' });
    await settle();
    expect(dashboard['tabStatusCounts']()).toBeNull();
    expect(element('votes-table-empty-state')?.textContent).toContain('Some votes could not be loaded');
    const beforeRetry = getMyVotes.mock.calls.length;
    element('votes-table-empty-state')!.querySelector<HTMLButtonElement>('button')!.click();
    await settle();
    expect(getMyVotes).toHaveBeenCalledTimes(beforeRetry + 1);
    expect(table.resultsComplete()).toBe(true);
    expect(table.searchForm.controls.search.value).toBe('no matching vote');
    expect(table.statusTab()).toBe(PollStatus.ACTIVE);
    expect(element('votes-table-empty-state')?.textContent).toContain('No votes match your filters');
    table.searchForm.patchValue({ search: '' });
    await settle();
    expect(dashboard['tabStatusCounts']()).toEqual({ all: 7, active: 6, disabled: 0, ended: 1 });
    expect(tabLabels()).toEqual(['All (7)', 'Active (6)', 'Ended (1)']);
  });

  it('does not infer an empty Active status from an incomplete feed containing only ended votes', async () => {
    const ended = feed.find((item) => item.status === PollStatus.ENDED)!;
    getMyVotes.mockReturnValueOnce(of({ votes: [ended], complete: false }));
    dashboard['refreshVotes']();
    await settle();
    expect(rows()).toEqual([]);
    expect(element('votes-table-empty-state')?.textContent).toContain('Some votes could not be loaded');

    table['onStatusTabChange'](PollStatus.ENDED);
    await settle();
    expect(rows()).toEqual([ended.uid]);
    expect(element('votes-table-empty-state')).toBeNull();
  });

  for (const lens of ['project', 'foundation'] as const) {
    it.each([false, true])(`keeps the personal feed pending when returning from ${lens} until a response arrives (complete: %s)`, async (complete) => {
      await management(lens);
      expect(table.loading()).toBe(false);
      expect(table.resultsComplete()).toBe(true);
      const request = new Subject<MyVotesResponse>();
      getMyVotes.mockReturnValueOnce(request);
      const callsBeforeReturn = getMyVotes.mock.calls.length;

      activeLens.set('me');
      // The lens changes synchronously, before toObservable starts the personal request.
      expect(getMyVotes).toHaveBeenCalledTimes(callsBeforeReturn);
      expect(dashboard['myVotesLoading']()).toBe(true);
      fixture.changeDetectorRef.detectChanges();
      expect(table.loading()).toBe(true);
      expect(element('votes-table-empty-state')).toBeNull();
      expect(fixture.nativeElement.textContent).not.toContain('Some votes could not be loaded');

      await settle();
      expect(getMyVotes).toHaveBeenCalledTimes(callsBeforeReturn + 1);
      expect(table.loading()).toBe(true);
      expect(element('votes-table-empty-state')).toBeNull();
      request.next({ votes: [], complete });
      request.complete();
      await settle();

      expect(table.loading()).toBe(false);
      expect(table.resultsComplete()).toBe(complete);
      expect(element('votes-table-empty-state')?.textContent).toContain(complete ? 'No active votes' : 'Some votes could not be loaded');
    });
  }

  it('retries an incomplete empty All feed without showing a false no-invitations message', async () => {
    getMyVotes.mockReturnValueOnce(of({ votes: [], complete: false }));
    table['onStatusTabChange']('all');
    dashboard['refreshVotes']();
    await settle();
    expect(element('votes-table-empty-state')?.textContent).toContain('Some votes could not be loaded');
    expect(fixture.nativeElement.textContent).not.toContain("Votes you've been invited to participate in will appear here.");

    const request = new Subject<MyVotesResponse>();
    getMyVotes.mockReturnValueOnce(request);
    element('votes-table-empty-state')!.querySelector<HTMLButtonElement>('button')!.click();
    await settle();
    expect(dashboard['myVotesLoading']()).toBe(true);
    expect(element('votes-table-empty-state')).toBeNull();
    request.next({ votes: [], complete: true });
    request.complete();
    await settle();
    expect(table.statusTab()).toBe('all');
    expect(table.resultsComplete()).toBe(true);
    expect(element('votes-table-empty-state')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain("Votes you've been invited to participate in will appear here.");
  });

  describe('opening a vote', () => {
    let navigate: MockInstance<Router['navigate']>;

    beforeEach(() => {
      navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    });

    it("opens the vote page from a row, including a vote awaiting the viewer's ballot", () => {
      table.viewVote.emit('soon');

      expect(navigate).toHaveBeenLastCalledWith(['/votes', 'soon']);
    });

    it.each(['later', 'vote/invalid', 'vote?invalid', 'vote#invalid'])('opens Results with %s as one vote-id segment', (uid) => {
      dashboard['onViewResults'](uid);

      expect(navigate).toHaveBeenLastCalledWith(['/votes', uid], { queryParams: { tab: 'results' } });
    });

    it.each(['vote/invalid', 'vote?invalid', 'vote#invalid'])('opens a row with %s as one vote-id segment', (uid) => {
      table.viewVote.emit(uid);

      expect(navigate).toHaveBeenLastCalledWith(['/votes', uid]);
    });
  });
});
