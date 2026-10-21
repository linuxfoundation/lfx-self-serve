// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass, NgTemplateOutlet } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { NO_ERRORS_SCHEMA, PLATFORM_ID, REQUEST_CONTEXT, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, ParamMap, Router } from '@angular/router';
import { IndexedVoteResponseStatus, PollStatus } from '@lfx-one/shared/enums';
import { MyVoteResponse, Project, ServerRequestContext, Vote, VoteDetailState, VoteResultsResponse } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { LensService } from '@services/lens.service';
import { ProjectService } from '@services/project.service';
import { VoteService } from '@services/vote.service';
import { DialogService } from 'primeng/dynamicdialog';
import { BehaviorSubject, Observable, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { VoteReminderDialogComponent } from '../components/vote-reminder-dialog/vote-reminder-dialog.component';
import { VoteDetailComponent } from './vote-detail.component';

function makeVote(overrides: Partial<Vote> = {}): Vote {
  return {
    uid: 'vote-1',
    name: 'Synthetic board election',
    status: PollStatus.ACTIVE,
    end_time: '2026-10-30T16:00:00Z',
    project_uid: 'proj-1',
    project_slug: 'synthetic-project',
    committee_uid: 'committee-1',
    poll_comment_prompts: [{ prompt_id: 'prompt-1', prompt: 'Any concerns?' }],
    ...overrides,
  } as Vote;
}

function makeResponse(status: IndexedVoteResponseStatus, overrides: Partial<MyVoteResponse> = {}): MyVoteResponse {
  return { uid: 'resp-1', vote_uid: 'vote-1', vote_status: status, ...overrides };
}

function makeResults(): VoteResultsResponse {
  return { poll_results: [], comment_results: [], num_recipients: 4, num_votes_cast: 3, num_abstained: 0, poll_end_time: '2026-10-30T16:00:00Z' };
}

function httpError(status: number): Observable<never> {
  return throwError(() => new HttpErrorResponse({ status }));
}

describe('VoteDetailComponent', () => {
  let voteService: {
    fetchVote: ReturnType<typeof vi.fn>;
    getMyVoteResponse: ReturnType<typeof vi.fn>;
    getVoteResults: ReturnType<typeof vi.fn>;
  };
  let projectService: { getProjectStrict: ReturnType<typeof vi.fn> };
  let committeeService: { fetchCommittee: ReturnType<typeof vi.fn> };
  let dialogService: { open: ReturnType<typeof vi.fn> };
  let router: { navigate: ReturnType<typeof vi.fn> };
  let queryParamMap: BehaviorSubject<ParamMap>;
  let reqContext: ServerRequestContext;

  async function setup(platform: 'browser' | 'server' = 'browser'): Promise<ComponentFixture<VoteDetailComponent>> {
    await TestBed.configureTestingModule({
      imports: [VoteDetailComponent],
      providers: [
        { provide: VoteService, useValue: voteService },
        { provide: ProjectService, useValue: projectService },
        { provide: CommitteeService, useValue: committeeService },
        { provide: Router, useValue: router },
        { provide: ActivatedRoute, useValue: { paramMap: new BehaviorSubject(convertToParamMap({ id: 'vote-1' })), queryParamMap } },
        // The page never reads the lens — a Me lens must not demote a writer to the voter view.
        { provide: LensService, useValue: { activeLens: signal('me') } },
        { provide: PLATFORM_ID, useValue: platform },
        { provide: REQUEST_CONTEXT, useValue: reqContext },
      ],
    })
      // Keep the real template (for the region assertions) but stub child components out.
      .overrideComponent(VoteDetailComponent, {
        set: { imports: [NgClass, NgTemplateOutlet], schemas: [NO_ERRORS_SCHEMA], providers: [{ provide: DialogService, useValue: dialogService }] },
      })
      .compileComponents();

    const fixture = TestBed.createComponent(VoteDetailComponent);
    TestBed.tick();
    fixture.detectChanges();
    return fixture;
  }

  const read = <T>(fixture: ComponentFixture<VoteDetailComponent>, key: string): T => (fixture.componentInstance as unknown as Record<string, () => T>)[key]();
  const call = (fixture: ComponentFixture<VoteDetailComponent>, key: string, ...args: unknown[]): void =>
    (fixture.componentInstance as unknown as Record<string, (...a: unknown[]) => void>)[key](...args);
  const testId = (fixture: ComponentFixture<VoteDetailComponent>, id: string): HTMLElement | null =>
    fixture.nativeElement.querySelector(`[data-testid="${id}"]`);

  beforeEach(() => {
    voteService = {
      fetchVote: vi.fn().mockReturnValue(of(makeVote())),
      getMyVoteResponse: vi.fn().mockReturnValue(of(null)),
      getVoteResults: vi.fn().mockReturnValue(of(makeResults())),
    };
    projectService = { getProjectStrict: vi.fn().mockReturnValue(of({ writer: false } as Project)) };
    committeeService = { fetchCommittee: vi.fn().mockReturnValue(of({ writer: false })) };
    dialogService = { open: vi.fn() };
    router = { navigate: vi.fn() };
    queryParamMap = new BehaviorSubject(convertToParamMap({}));
    reqContext = {} as ServerRequestContext;
  });

  describe('load state', () => {
    it.each([400, 403, 404])('renders the in-place not-found page for a %i', async (status) => {
      voteService.fetchVote.mockReturnValue(httpError(status));
      const fixture = await setup();

      expect(read<VoteDetailState>(fixture, 'state')).toEqual({ loading: false, notFound: true, error: false, vote: null });
      expect(fixture.nativeElement.querySelector('lfx-not-found')).not.toBeNull();
      expect(voteService.getMyVoteResponse).not.toHaveBeenCalled();
    });

    it.each([403, 404])('flags an SSR 404 for a %i', async (status) => {
      voteService.fetchVote.mockReturnValue(httpError(status));
      await setup('server');

      expect(reqContext.notFound).toBe(true);
    });

    it('shows the retry card on a transient failure with no SSR 404, and Retry reloads', async () => {
      const logError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      voteService.fetchVote.mockReturnValueOnce(httpError(503));
      try {
        const fixture = await setup('server');
        expect(read<VoteDetailState>(fixture, 'state').error).toBe(true);
        expect(reqContext.notFound).toBeUndefined();
        expect(testId(fixture, 'vote-detail-error')).not.toBeNull();

        call(fixture, 'retry');
        TestBed.tick();
        expect(voteService.fetchVote).toHaveBeenCalledTimes(2);
        expect(read<VoteDetailState>(fixture, 'state')).toEqual({ loading: true, notFound: false, error: false, vote: null });
      } finally {
        logError.mockRestore();
      }
    });

    it('stops after the vote fetch on the server and paints the shared skeleton', async () => {
      const fixture = await setup('server');

      expect(read<VoteDetailState>(fixture, 'state')).toEqual({ loading: true, notFound: false, error: false, vote: null });
      expect(testId(fixture, 'vote-detail-loading')).not.toBeNull();
      expect(voteService.getMyVoteResponse).not.toHaveBeenCalled();
      expect(projectService.getProjectStrict).not.toHaveBeenCalled();
      expect(voteService.getVoteResults).not.toHaveBeenCalled();
    });
  });

  describe('access', () => {
    it('gives a project writer the manager view even in the Me lens, with live results and summary cards', async () => {
      projectService.getProjectStrict.mockReturnValue(of({ writer: true } as Project));
      const fixture = await setup();

      expect(read(fixture, 'audience')).toBe('creator');
      expect(voteService.getVoteResults).toHaveBeenCalledWith('vote-1');
      expect(testId(fixture, 'vote-detail-summary')).not.toBeNull();
      expect(committeeService.fetchCommittee).not.toHaveBeenCalled();
    });

    it('gives a committee writer the manager view', async () => {
      committeeService.fetchCommittee.mockReturnValue(of({ writer: true }));
      const fixture = await setup();

      expect(read(fixture, 'audience')).toBe('creator');
    });

    it('keeps everyone else in the voter view with no summary cards', async () => {
      voteService.getMyVoteResponse.mockReturnValue(of(makeResponse(IndexedVoteResponseStatus.RESPONDED)));
      const fixture = await setup();

      expect(read(fixture, 'audience')).toBe('voter');
      expect(testId(fixture, 'vote-detail-summary')).toBeNull();
    });
  });

  describe('voter results', () => {
    it('never fetches results while the vote is open', async () => {
      voteService.getMyVoteResponse.mockReturnValue(of(makeResponse(IndexedVoteResponseStatus.RESPONDED)));
      const fixture = await setup();

      expect(voteService.getVoteResults).not.toHaveBeenCalled();
      expect(read(fixture, 'voterState')).toBe('submitted');
      expect(testId(fixture, 'vote-detail-voter-confirmation')).not.toBeNull();
    });

    it('fetches final results for a participant after close and says they voted', async () => {
      voteService.fetchVote.mockReturnValue(of(makeVote({ status: PollStatus.ENDED })));
      voteService.getMyVoteResponse.mockReturnValue(of(makeResponse(IndexedVoteResponseStatus.RESPONDED)));
      const fixture = await setup();

      expect(voteService.getVoteResults).toHaveBeenCalledWith('vote-1');
      expect(testId(fixture, 'vote-detail-overview-results')).not.toBeNull();
      expect(testId(fixture, 'vote-detail-you-voted')).not.toBeNull();
    });

    it('hides the "You voted" line on a pseudo-anonymous vote but still shows the totals', async () => {
      voteService.fetchVote.mockReturnValue(of(makeVote({ status: PollStatus.ENDED, pseudo_anonymity: true })));
      voteService.getMyVoteResponse.mockReturnValue(of(makeResponse(IndexedVoteResponseStatus.RESPONDED)));
      const fixture = await setup();

      expect(testId(fixture, 'vote-detail-overview-results')).not.toBeNull();
      expect(testId(fixture, 'vote-detail-you-voted')).toBeNull();
    });

    it('never fetches results for a viewer who was not invited', async () => {
      voteService.fetchVote.mockReturnValue(of(makeVote({ status: PollStatus.ENDED })));
      const fixture = await setup();

      expect(voteService.getVoteResults).not.toHaveBeenCalled();
      expect(testId(fixture, 'vote-detail-voter-not-participant')).not.toBeNull();
    });
  });

  describe('actions', () => {
    it('opens the cast drawer once on load for a voter awaiting a ballot', async () => {
      voteService.getMyVoteResponse.mockReturnValue(of(makeResponse(IndexedVoteResponseStatus.AWAITING_RESPONSE)));
      const fixture = await setup();

      expect(read(fixture, 'castDrawerVisible')).toBe(true);
      expect(read(fixture, 'canCastVote')).toBe(true);

      (fixture.componentInstance as unknown as { castDrawerVisible: { set(v: boolean): void } }).castDrawerVisible.set(false);
      TestBed.tick();
      expect(read(fixture, 'castDrawerVisible')).toBe(false);
      expect(testId(fixture, 'vote-detail-voter-locked')).not.toBeNull();
    });

    it('opens the cast drawer for a manager who is also awaiting a ballot, keeping the manager view', async () => {
      projectService.getProjectStrict.mockReturnValue(of({ writer: true } as Project));
      voteService.getMyVoteResponse.mockReturnValue(of(makeResponse(IndexedVoteResponseStatus.AWAITING_RESPONSE)));
      const fixture = await setup();

      expect(read(fixture, 'audience')).toBe('creator');
      expect(read(fixture, 'castDrawerVisible')).toBe(true);
    });

    it('does not open the cast drawer for a voter who already voted', async () => {
      voteService.getMyVoteResponse.mockReturnValue(of(makeResponse(IndexedVoteResponseStatus.RESPONDED)));
      const fixture = await setup();

      expect(read(fixture, 'castDrawerVisible')).toBe(false);
    });

    it('opens the reminder dialog with the vote', async () => {
      projectService.getProjectStrict.mockReturnValue(of({ writer: true } as Project));
      const fixture = await setup();

      call(fixture, 'onSendReminder');

      expect(dialogService.open).toHaveBeenCalledWith(VoteReminderDialogComponent, expect.objectContaining({ data: { vote: makeVote() } }));
    });

    it('reloads my response and results after a ballot is submitted', async () => {
      projectService.getProjectStrict.mockReturnValue(of({ writer: true } as Project));
      const fixture = await setup();

      call(fixture, 'onVoteSubmitted');
      TestBed.tick();

      expect(voteService.getMyVoteResponse).toHaveBeenCalledTimes(2);
      expect(voteService.getVoteResults).toHaveBeenCalledTimes(2);
      expect(voteService.fetchVote).toHaveBeenLastCalledWith('vote-1', { skipCache: true });
      expect(read<VoteDetailState>(fixture, 'state').vote).not.toBeNull();
    });
  });

  describe('tabs', () => {
    it('reads the tab from ?tab=', async () => {
      queryParamMap.next(convertToParamMap({ tab: 'results' }));
      const fixture = await setup();

      expect(read(fixture, 'activeTab')).toBe('results');
    });

    it('falls back to Overview for an unknown tab and for Comments on a vote without prompts', async () => {
      queryParamMap.next(convertToParamMap({ tab: 'activity' }));
      voteService.fetchVote.mockReturnValue(of(makeVote({ poll_comment_prompts: [] })));
      const fixture = await setup();
      expect(read(fixture, 'activeTab')).toBe('overview');

      queryParamMap.next(convertToParamMap({ tab: 'comments' }));
      TestBed.tick();
      expect(read(fixture, 'activeTab')).toBe('overview');
      expect(read<{ key: string }[]>(fixture, 'tabs').map((tab) => tab.key)).toEqual(['overview', 'results']);
    });

    it('writes the tab to the URL, omitting Overview', async () => {
      const fixture = await setup();

      call(fixture, 'switchTab', 'comments');
      expect(router.navigate).toHaveBeenLastCalledWith(
        [],
        expect.objectContaining({ queryParams: { tab: 'comments' }, queryParamsHandling: 'merge', replaceUrl: true })
      );

      queryParamMap.next(convertToParamMap({ tab: 'comments' }));
      TestBed.tick();
      call(fixture, 'switchTab', 'overview');
      expect(router.navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { tab: null } }));
    });

    it('sends View results to the Results tab', async () => {
      const fixture = await setup();

      call(fixture, 'onViewResults');

      expect(router.navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { tab: 'results' } }));
    });
  });
});
