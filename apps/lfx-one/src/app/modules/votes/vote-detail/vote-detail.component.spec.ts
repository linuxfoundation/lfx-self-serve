// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass, NgTemplateOutlet } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { NO_ERRORS_SCHEMA, PLATFORM_ID, REQUEST_CONTEXT, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, convertToParamMap, ParamMap, Router } from '@angular/router';
import { IndexedVoteResponseStatus, PollStatus, PollType } from '@lfx-one/shared/enums';
import {
  MyVoteResponse,
  PollQuestionResult,
  Project,
  ServerRequestContext,
  StatCardItem,
  Vote,
  VoteDetailState,
  VoteResultsResponse,
} from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { LensService } from '@services/lens.service';
import { ProjectService } from '@services/project.service';
import { VoteService } from '@services/vote.service';
import { DialogService } from 'primeng/dynamicdialog';
import { BehaviorSubject, Observable, of, Subject, throwError } from 'rxjs';
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

/** One question carrying both plurality and ranked tallies, so the voting method alone picks the layout. */
function makeMethodResults(): VoteResultsResponse {
  const question = {
    question_id: 'question-1',
    prompt: 'Approve the roadmap?',
    choices: [
      { choice_id: 'choice-yes', choice_text: 'Yes' },
      { choice_id: 'choice-no', choice_text: 'No' },
    ],
  } as PollQuestionResult['question'];
  return {
    ...makeResults(),
    poll_results: [
      {
        question,
        generic_choice_votes: [
          { choice_id: 'choice-yes', vote_count: 2 },
          { choice_id: 'choice-no', vote_count: 1 },
        ],
        ranked_choice_votes: [{ choice_id: 'choice-yes', rank_counts: [{ rank: 1, count: 2 }] }],
      } as PollQuestionResult,
    ],
  };
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
  let paramMap: BehaviorSubject<ParamMap>;
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
        { provide: ActivatedRoute, useValue: { paramMap, queryParamMap } },
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
    paramMap = new BehaviorSubject(convertToParamMap({ id: 'vote-1' }));
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

    it('keeps the line breaks of a plain-text description', async () => {
      voteService.fetchVote.mockReturnValue(of(makeVote({ description: 'First paragraph\n\nSecond paragraph' })));
      const fixture = await setup();

      const description = testId(fixture, 'vote-detail-description')?.querySelector('[class*="whitespace-pre-line"]');
      expect(description?.textContent).toBe('First paragraph\n\nSecond paragraph');
    });
  });

  describe('voting method', () => {
    const element = (fixture: ComponentFixture<VoteDetailComponent>, selector: string): Element | null => fixture.nativeElement.querySelector(selector);

    beforeEach(() => {
      queryParamMap.next(convertToParamMap({ tab: 'results' }));
      projectService.getProjectStrict.mockReturnValue(of({ writer: true } as Project));
      voteService.getVoteResults.mockReturnValue(of(makeMethodResults()));
    });

    it('renders a majority vote with the plurality option results, never the ranked layout', async () => {
      voteService.fetchVote.mockReturnValue(of(makeVote({ poll_type: PollType.MAJORITY })));
      const fixture = await setup();

      expect(element(fixture, 'lfx-vote-option-results')).not.toBeNull();
      expect(element(fixture, 'lfx-vote-ranked-question-results')).toBeNull();
      expect(testId(fixture, 'vote-detail-results-ranked-method')).toBeNull();
      expect(testId(fixture, 'vote-detail-results-empty')).toBeNull();
    });

    it('renders a ranked vote with the ranked note and distributions', async () => {
      voteService.fetchVote.mockReturnValue(of(makeVote({ poll_type: PollType.CONDORCET_IRV })));
      const fixture = await setup();

      expect(testId(fixture, 'vote-detail-results-ranked-method')).not.toBeNull();
      expect(element(fixture, 'lfx-vote-ranked-question-results')).not.toBeNull();
      expect(element(fixture, 'lfx-vote-option-results')).toBeNull();
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

    it('fetches final results for a participant when the ended status arrives in another case', async () => {
      voteService.fetchVote.mockReturnValue(of(makeVote({ status: 'ENDED' as PollStatus })));
      voteService.getMyVoteResponse.mockReturnValue(of(makeResponse(IndexedVoteResponseStatus.RESPONDED)));
      const fixture = await setup();

      expect(read(fixture, 'voterState')).toBe('closed');
      expect(voteService.getVoteResults).toHaveBeenCalledWith('vote-1');
      expect(testId(fixture, 'vote-detail-overview-results')).not.toBeNull();
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

    it('shows the participation error, not results, when my-response fails on a closed vote', async () => {
      voteService.fetchVote.mockReturnValue(of(makeVote({ status: PollStatus.ENDED })));
      voteService.getMyVoteResponse.mockReturnValue(httpError(500));
      const fixture = await setup();

      expect(voteService.getVoteResults).not.toHaveBeenCalled();
      expect(read(fixture, 'showsResults')).toBe(false);
      expect(testId(fixture, 'vote-detail-voter-my-response-error')).not.toBeNull();
      expect(testId(fixture, 'vote-detail-overview-results')).toBeNull();
    });

    it('shows the access-denied panel to a removed voter and never fetches results', async () => {
      voteService.fetchVote.mockReturnValue(of(makeVote({ status: PollStatus.ENDED })));
      voteService.getMyVoteResponse.mockReturnValue(of(makeResponse(IndexedVoteResponseStatus.RESPONDED, { voter_removed: true })));
      const fixture = await setup();

      expect(voteService.getVoteResults).not.toHaveBeenCalled();
      expect(read(fixture, 'voterState')).toBe('access_denied');
      expect(testId(fixture, 'vote-detail-voter-access-denied')).not.toBeNull();
    });

    it('shows the results error to a manager when the results fetch fails, never the empty state', async () => {
      projectService.getProjectStrict.mockReturnValue(of({ writer: true } as Project));
      voteService.getVoteResults.mockReturnValue(httpError(500));
      const fixture = await setup();

      expect(testId(fixture, 'vote-detail-results-error')?.textContent?.trim()).toBe("Couldn't load results. Try reloading this page.");
      expect(testId(fixture, 'vote-detail-results-empty')).toBeNull();
      // No results means no count — never "0 invited voters have not responded yet".
      expect(testId(fixture, 'vote-detail-overview-callout')).not.toBeNull();
      expect(testId(fixture, 'vote-detail-overview-callout-count')).toBeNull();
    });

    it('shows the not-responded count only once the results have loaded', async () => {
      projectService.getProjectStrict.mockReturnValue(of({ writer: true } as Project));
      const results = new Subject<VoteResultsResponse>();
      voteService.getVoteResults.mockReturnValue(results);
      const fixture = await setup();

      expect(testId(fixture, 'vote-detail-overview-callout-count')).toBeNull();

      results.next(makeResults());
      TestBed.tick();
      expect(testId(fixture, 'vote-detail-overview-callout-count')?.textContent?.trim()).toBe('1 invited voter has not responded yet');
    });
  });

  describe('participation card', () => {
    const participationCard = (fixture: ComponentFixture<VoteDetailComponent>): Element | null =>
      fixture.nativeElement.querySelector('lfx-vote-participation-card');

    beforeEach(() => {
      projectService.getProjectStrict.mockReturnValue(of({ writer: true } as Project));
      queryParamMap.next(convertToParamMap({ tab: 'results' }));
    });

    it('waits for the results before showing a manager the participation totals', async () => {
      const results = new Subject<VoteResultsResponse>();
      voteService.getVoteResults.mockReturnValue(results);
      const fixture = await setup();
      TestBed.tick();

      expect(testId(fixture, 'vote-detail-results-loading')).not.toBeNull();
      expect(participationCard(fixture)).toBeNull();

      results.next(makeResults());
      results.complete();
      TestBed.tick();
      expect(participationCard(fixture)).not.toBeNull();
    });

    it('never shows zero participation beside a results error', async () => {
      voteService.getVoteResults.mockReturnValue(httpError(500));
      const fixture = await setup();

      expect(testId(fixture, 'vote-detail-results-error')).not.toBeNull();
      expect(participationCard(fixture)).toBeNull();
    });
  });

  describe('draft vote', () => {
    it('never tells a manager a draft is closed', async () => {
      projectService.getProjectStrict.mockReturnValue(of({ writer: true } as Project));
      voteService.fetchVote.mockReturnValue(of(makeVote({ status: PollStatus.DISABLED })));
      const fixture = await setup();

      const notVotedCard = read<StatCardItem[]>(fixture, 'summaryCards')[3];
      expect(notVotedCard).toMatchObject({ label: 'Not voted yet', subLine: 'Voting not open yet' });
      const callout = testId(fixture, 'vote-detail-overview-callout')?.textContent ?? '';
      expect(callout).toContain('This vote is a draft');
      expect(callout).not.toContain('This vote is closed');
      expect(read(fixture, 'resultsStatusTag')).toEqual({ value: 'Not open yet', severity: 'secondary' });
    });

    it('tags an open vote as in progress', async () => {
      projectService.getProjectStrict.mockReturnValue(of({ writer: true } as Project));
      voteService.fetchVote.mockReturnValue(of(makeVote({ status: PollStatus.ACTIVE })));
      const fixture = await setup();

      expect(read(fixture, 'resultsStatusTag')).toEqual({ value: 'Voting in progress', severity: 'success' });
    });

    it('keeps the closed copy for an ended vote', async () => {
      projectService.getProjectStrict.mockReturnValue(of({ writer: true } as Project));
      voteService.fetchVote.mockReturnValue(of(makeVote({ status: PollStatus.ENDED })));
      const fixture = await setup();

      expect(read<StatCardItem[]>(fixture, 'summaryCards')[3]).toMatchObject({ label: 'Did not vote', subLine: 'Voting is closed' });
      expect(testId(fixture, 'vote-detail-overview-callout')?.textContent).toContain('This vote is closed');
      expect(read(fixture, 'resultsStatusTag')).toEqual({ value: 'Final results', severity: 'secondary' });
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

      call(fixture, 'onVoteSubmitted', 'vote-1');
      TestBed.tick();

      expect(voteService.getMyVoteResponse).toHaveBeenCalledTimes(2);
      expect(voteService.getVoteResults).toHaveBeenCalledTimes(2);
      expect(voteService.fetchVote).toHaveBeenLastCalledWith('vote-1', { skipCache: true });
      expect(read<VoteDetailState>(fixture, 'state').vote).not.toBeNull();
    });
  });

  describe('ballot refresh', () => {
    it.each([
      { tab: 'overview', region: 'vote-detail-overview-comment' },
      { tab: 'results', region: 'vote-detail-results' },
      { tab: 'comments', region: 'vote-detail-comments' },
    ])('keeps same-vote results visible on $tab during a ballot refresh', async ({ tab, region }) => {
      const refreshed = new Subject<VoteResultsResponse>();
      const previousResults: VoteResultsResponse = {
        ...makeMethodResults(),
        comment_results: [
          {
            prompt: { prompt_id: 'prompt-1', prompt: 'Any concerns?' },
            responses: [{ vote_id: 'response-1', comment_text: 'Synthetic ballot comment', vote_creation_time: '2026-10-20T12:00:00Z', abstained: false }],
          },
        ],
      };
      projectService.getProjectStrict.mockReturnValue(of({ writer: true } as Project));
      voteService.getMyVoteResponse.mockReturnValue(of(makeResponse(IndexedVoteResponseStatus.AWAITING_RESPONSE)));
      voteService.getVoteResults.mockReturnValueOnce(of(previousResults)).mockReturnValueOnce(refreshed);
      queryParamMap.next(convertToParamMap({ tab }));
      const fixture = await setup();
      expect(testId(fixture, region)).not.toBeNull();

      call(fixture, 'onVoteSubmitted', 'vote-1');
      TestBed.tick();

      expect(voteService.getVoteResults).toHaveBeenCalledTimes(2);
      expect(read(fixture, 'voteResults')).toEqual(previousResults);
      expect(read(fixture, 'loadingVoteResults')).toBe(false);
      expect(read(fixture, 'hasLoadedResults')).toBe(true);
      expect(read<StatCardItem[]>(fixture, 'summaryCards').map((card) => card.value)).toEqual([3, '75%', 1, 1]);
      expect(testId(fixture, 'vote-detail-summary')).toHaveProperty('loading', false);
      expect(testId(fixture, 'vote-detail-results-loading')).toBeNull();
      expect(testId(fixture, 'vote-detail-comments-loading')).toBeNull();
      expect(testId(fixture, region)).not.toBeNull();

      const updatedResults = { ...previousResults, num_votes_cast: 4 };
      refreshed.next(updatedResults);
      refreshed.complete();
      TestBed.tick();

      expect(read(fixture, 'voteResults')).toEqual(updatedResults);
      expect(read<StatCardItem[]>(fixture, 'summaryCards').map((card) => card.value)).toEqual([4, '100%', 1, 0]);
      expect(testId(fixture, region)).not.toBeNull();
    });

    it('clears retained same-vote results and shows the error when a ballot refresh fails', async () => {
      const refreshed = new Subject<VoteResultsResponse>();
      projectService.getProjectStrict.mockReturnValue(of({ writer: true } as Project));
      voteService.getVoteResults.mockReturnValueOnce(of(makeResults())).mockReturnValueOnce(refreshed);
      const fixture = await setup();

      call(fixture, 'onVoteSubmitted', 'vote-1');
      TestBed.tick();
      expect(read(fixture, 'voteResults')).toEqual(makeResults());

      refreshed.error(new HttpErrorResponse({ status: 503 }));
      TestBed.tick();

      expect(read(fixture, 'voteResults')).toBeNull();
      expect(read(fixture, 'loadingVoteResults')).toBe(false);
      expect(testId(fixture, 'vote-detail-results-error')).not.toBeNull();
      expect(testId(fixture, 'vote-detail-overview-callout-count')).toBeNull();
      expect(read<StatCardItem[]>(fixture, 'summaryCards').every((card) => card.value === '—')).toBe(true);
    });

    it('keeps the body in place while my response reloads after a ballot, then shows the confirmation', async () => {
      const refreshed = new Subject<MyVoteResponse>();
      voteService.getMyVoteResponse.mockReturnValueOnce(of(makeResponse(IndexedVoteResponseStatus.AWAITING_RESPONSE))).mockReturnValueOnce(refreshed);
      const fixture = await setup();
      expect(testId(fixture, 'vote-detail-voter-not-voted')).not.toBeNull();

      call(fixture, 'onVoteSubmitted', 'vote-1');
      TestBed.tick();
      expect(read(fixture, 'myResponseLoading')).toBe(true);
      expect(testId(fixture, 'vote-detail-access-loading')).toBeNull();
      expect(testId(fixture, 'vote-detail-voter-locked')).not.toBeNull();
      // The old row still says awaiting, but the ballot went in: no "haven't responded" and no second Cast vote.
      expect(testId(fixture, 'vote-detail-voter-confirmation')).not.toBeNull();
      expect(testId(fixture, 'vote-detail-voter-not-voted')).toBeNull();
      expect(read(fixture, 'canCastVote')).toBe(false);

      refreshed.next(makeResponse(IndexedVoteResponseStatus.RESPONDED));
      refreshed.complete();
      TestBed.tick();
      expect(testId(fixture, 'vote-detail-voter-confirmation')).not.toBeNull();
    });

    it('keeps the ballot submitted when the refreshed response still lags behind', async () => {
      voteService.getMyVoteResponse.mockReturnValue(of(makeResponse(IndexedVoteResponseStatus.AWAITING_RESPONSE)));
      const fixture = await setup();
      expect(read(fixture, 'canCastVote')).toBe(true);

      call(fixture, 'onVoteSubmitted', 'vote-1');
      TestBed.tick();

      expect(read(fixture, 'myResponseLoading')).toBe(false);
      expect(testId(fixture, 'vote-detail-voter-confirmation')).not.toBeNull();
      expect(read(fixture, 'canCastVote')).toBe(false);
    });

    it('keeps the page when the post-ballot refresh fails, instead of the retry card', async () => {
      const logError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      voteService.fetchVote.mockReturnValueOnce(of(makeVote())).mockReturnValueOnce(httpError(503));
      try {
        const fixture = await setup();

        call(fixture, 'onVoteSubmitted', 'vote-1');
        TestBed.tick();

        expect(voteService.fetchVote).toHaveBeenCalledTimes(2);
        expect(logError).toHaveBeenCalled();
        expect(read<VoteDetailState>(fixture, 'state')).toEqual({ loading: false, notFound: false, error: false, vote: makeVote() });
        expect(testId(fixture, 'vote-detail-error')).toBeNull();
        expect(testId(fixture, 'vote-detail-page')).not.toBeNull();
      } finally {
        logError.mockRestore();
      }
    });

    it("never shows the previous vote's response while a cached next vote's response is loading", async () => {
      const nextResponse = new Subject<MyVoteResponse>();
      // A cached vote replays synchronously, so the page never passes through an empty vote between the two.
      voteService.fetchVote.mockImplementation((id: string) => of(makeVote({ uid: id })));
      voteService.getMyVoteResponse.mockReturnValueOnce(of(makeResponse(IndexedVoteResponseStatus.RESPONDED))).mockReturnValueOnce(nextResponse);
      const fixture = await setup();
      expect(testId(fixture, 'vote-detail-voter-confirmation')).not.toBeNull();

      paramMap.next(convertToParamMap({ id: 'vote-2' }));
      TestBed.tick();
      expect(read(fixture, 'myResponseLoading')).toBe(true);
      expect(testId(fixture, 'vote-detail-access-loading')).not.toBeNull();
      expect(testId(fixture, 'vote-detail-voter-confirmation')).toBeNull();

      nextResponse.next(makeResponse(IndexedVoteResponseStatus.AWAITING_RESPONSE, { vote_uid: 'vote-2' }));
      nextResponse.complete();
      TestBed.tick();
      expect(testId(fixture, 'vote-detail-access-loading')).toBeNull();
      expect(testId(fixture, 'vote-detail-voter-not-voted')).not.toBeNull();
    });
  });

  describe('cached vote transitions', () => {
    it.each([
      { label: 'manager with a response', writer: true, response: makeResponse(IndexedVoteResponseStatus.RESPONDED) },
      { label: 'manager without a response', writer: true, response: null },
      { label: 'voter with a response', writer: false, response: makeResponse(IndexedVoteResponseStatus.RESPONDED) },
    ])('hides retained state before dependent effects settle for a $label', async ({ writer, response }) => {
      let inspectNextVote = (): void => undefined;
      voteService.fetchVote.mockImplementation(
        (id: string) =>
          new Observable<Vote>((subscriber) => {
            subscriber.next(makeVote({ uid: id, status: PollStatus.ENDED }));
            if (id === 'vote-2') inspectNextVote();
            subscriber.complete();
          })
      );
      projectService.getProjectStrict.mockReturnValue(of({ writer } as Project));
      voteService.getMyVoteResponse.mockReturnValueOnce(of(response)).mockReturnValueOnce(of(null));
      const fixture = await setup();
      expect(read(fixture, 'accessLoading')).toBe(false);
      expect(read(fixture, 'voteResults')).not.toBeNull();

      const snapshots: {
        vote: Vote | null;
        loading: boolean;
        manager: boolean | null;
        response: MyVoteResponse | null;
        results: VoteResultsResponse | null;
      }[] = [];
      inspectNextVote = () => {
        snapshots.push({
          vote: read(fixture, 'vote'),
          loading: read(fixture, 'accessLoading'),
          manager: read(fixture, 'canManage'),
          response: read(fixture, 'myResponse'),
          results: read(fixture, 'voteResults'),
        });
      };
      paramMap.next(convertToParamMap({ id: 'vote-2' }));

      // The route signal changes before any toObservable effect gets a chance to run.
      expect(read(fixture, 'accessLoading')).toBe(true);
      expect(read(fixture, 'vote')).toBeNull();
      expect(read(fixture, 'voteResults')).toBeNull();
      TestBed.tick();

      // A cached vote can then emit inside the load effect, before access/response/results effects.
      expect(snapshots).toEqual([{ vote: makeVote({ uid: 'vote-2', status: PollStatus.ENDED }), loading: true, manager: null, response: null, results: null }]);
      expect(read(fixture, 'accessLoading')).toBe(false);
      expect(read(fixture, 'myResponse')).toBeNull();
    });

    it('starts a new vote on the first comments page even when its prompt ID matches', async () => {
      projectService.getProjectStrict.mockReturnValue(of({ writer: true } as Project));
      voteService.fetchVote.mockImplementation((id: string) => of(makeVote({ uid: id })));
      queryParamMap.next(convertToParamMap({ tab: 'comments' }));
      const fixture = await setup();
      const commentList = fixture.debugElement.query(By.css('lfx-vote-comment-results'));
      commentList.triggerEventHandler('pageStateChange', new Map([['prompt-1', { first: 20, rows: 20 }]]));
      TestBed.tick();
      expect(read<Map<string, unknown>>(fixture, 'commentPaginatorState').size).toBe(1);

      paramMap.next(convertToParamMap({ id: 'vote-2' }));
      TestBed.tick();

      expect(read<Map<string, unknown>>(fixture, 'commentPaginatorState').size).toBe(0);
      expect(fixture.debugElement.query(By.css('lfx-vote-comment-results')).properties['pageState']).toEqual(new Map());
    });

    it('preserves the comments page across tab switches and a same-vote refresh', async () => {
      projectService.getProjectStrict.mockReturnValue(of({ writer: true } as Project));
      queryParamMap.next(convertToParamMap({ tab: 'comments' }));
      const fixture = await setup();
      const page = new Map([['prompt-1', { first: 20, rows: 20 }]]);
      fixture.debugElement.query(By.css('lfx-vote-comment-results')).triggerEventHandler('pageStateChange', page);
      TestBed.tick();

      queryParamMap.next(convertToParamMap({ tab: 'results' }));
      TestBed.tick();
      queryParamMap.next(convertToParamMap({ tab: 'comments' }));
      TestBed.tick();
      expect(read(fixture, 'commentPaginatorState')).toEqual(page);

      call(fixture, 'onVoteSubmitted', 'vote-1');
      TestBed.tick();
      expect(read(fixture, 'commentPaginatorState')).toEqual(page);
    });

    it('discards retained results after visiting a vote without results access', async () => {
      const returningResults = new Subject<VoteResultsResponse>();
      voteService.fetchVote.mockImplementation((id: string) => of(makeVote({ uid: id, project_slug: id, status: PollStatus.ENDED })));
      projectService.getProjectStrict.mockImplementation((slug: string) => of({ writer: slug === 'vote-1' } as Project));
      voteService.getMyVoteResponse.mockImplementation((id: string) =>
        of(makeResponse(IndexedVoteResponseStatus.RESPONDED, { vote_uid: id, voter_removed: id === 'vote-2' }))
      );
      voteService.getVoteResults.mockReturnValueOnce(of(makeResults())).mockReturnValueOnce(returningResults);
      const fixture = await setup();
      expect(read(fixture, 'voteResults')).toEqual(makeResults());

      paramMap.next(convertToParamMap({ id: 'vote-2' }));
      TestBed.tick();

      expect(read(fixture, 'voteResults')).toBeNull();
      expect(testId(fixture, 'vote-detail-voter-access-denied')).not.toBeNull();
      expect(voteService.getVoteResults).toHaveBeenCalledTimes(1);

      paramMap.next(convertToParamMap({ id: 'vote-1' }));
      TestBed.tick();

      expect(voteService.getVoteResults).toHaveBeenCalledTimes(2);
      expect(read(fixture, 'voteResults')).toBeNull();
      expect(read(fixture, 'loadingVoteResults')).toBe(true);

      returningResults.next(makeResults());
      returningResults.complete();
      TestBed.tick();
      expect(read(fixture, 'voteResults')).toEqual(makeResults());
    });

    it('uses the emitted ballot ID and ignores a late submission from the previous vote', async () => {
      voteService.fetchVote.mockImplementation((id: string) => of(makeVote({ uid: id })));
      voteService.getMyVoteResponse.mockImplementation((id: string) => of(makeResponse(IndexedVoteResponseStatus.AWAITING_RESPONSE, { vote_uid: id })));
      const fixture = await setup();

      paramMap.next(convertToParamMap({ id: 'vote-2' }));
      TestBed.tick();
      const drawer = fixture.debugElement.query(By.css('lfx-vote-cast-drawer'));
      voteService.fetchVote.mockClear();
      voteService.getMyVoteResponse.mockClear();

      drawer.triggerEventHandler('voteSubmitted', 'vote-1');
      TestBed.tick();

      expect(testId(fixture, 'vote-detail-voter-confirmation')).toBeNull();
      expect(testId(fixture, 'vote-detail-voter-not-voted')).not.toBeNull();
      expect(read(fixture, 'canCastVote')).toBe(true);
      expect(voteService.fetchVote).not.toHaveBeenCalled();
      expect(voteService.getMyVoteResponse).not.toHaveBeenCalled();

      drawer.triggerEventHandler('voteSubmitted', 'vote-2');
      TestBed.tick();

      expect(testId(fixture, 'vote-detail-voter-confirmation')).not.toBeNull();
      expect(read(fixture, 'canCastVote')).toBe(false);
      expect(voteService.fetchVote).toHaveBeenLastCalledWith('vote-2', { skipCache: true });
    });

    it.each([
      {
        label: 'closed',
        vote: makeVote({ uid: 'vote-2', status: PollStatus.ENDED }),
        response: makeResponse(IndexedVoteResponseStatus.AWAITING_RESPONSE, { vote_uid: 'vote-2' }),
      },
      {
        label: 'already answered',
        vote: makeVote({ uid: 'vote-2' }),
        response: makeResponse(IndexedVoteResponseStatus.RESPONDED, { vote_uid: 'vote-2' }),
      },
      { label: 'uninvited', vote: makeVote({ uid: 'vote-2' }), response: null },
      {
        label: 'removed',
        vote: makeVote({ uid: 'vote-2' }),
        response: makeResponse(IndexedVoteResponseStatus.AWAITING_RESPONSE, { vote_uid: 'vote-2', voter_removed: true }),
      },
    ])('closes the previous ballot drawer when the cached next vote is $label', async ({ vote, response }) => {
      voteService.fetchVote.mockReturnValueOnce(of(makeVote())).mockReturnValueOnce(of(vote));
      voteService.getMyVoteResponse.mockReturnValueOnce(of(makeResponse(IndexedVoteResponseStatus.AWAITING_RESPONSE))).mockReturnValueOnce(of(response));
      const fixture = await setup();
      expect(read(fixture, 'castDrawerVisible')).toBe(true);

      paramMap.next(convertToParamMap({ id: 'vote-2' }));
      TestBed.tick();

      expect(read(fixture, 'castDrawerVisible')).toBe(false);
      expect(read(fixture, 'canCastVote')).toBe(false);
    });

    it('reopens the drawer for the next vote only after its eligibility check settles', async () => {
      const nextResponse = new Subject<MyVoteResponse>();
      voteService.fetchVote.mockImplementation((id: string) => of(makeVote({ uid: id })));
      voteService.getMyVoteResponse.mockReturnValueOnce(of(makeResponse(IndexedVoteResponseStatus.AWAITING_RESPONSE))).mockReturnValueOnce(nextResponse);
      const fixture = await setup();
      expect(read(fixture, 'castDrawerVisible')).toBe(true);

      paramMap.next(convertToParamMap({ id: 'vote-2' }));
      TestBed.tick();
      expect(read(fixture, 'castDrawerVisible')).toBe(false);

      nextResponse.next(makeResponse(IndexedVoteResponseStatus.AWAITING_RESPONSE, { vote_uid: 'vote-2' }));
      nextResponse.complete();
      TestBed.tick();
      expect(read(fixture, 'castDrawerVisible')).toBe(true);
    });

    it('clears another vote’s totals and comments while cached next-vote results are loading', async () => {
      const nextResults = new Subject<VoteResultsResponse>();
      const previousResults: VoteResultsResponse = {
        ...makeResults(),
        comment_results: [
          {
            prompt: { prompt_id: 'prompt-1', prompt: 'Any concerns?' },
            responses: [
              { vote_id: 'response-1', comment_text: 'Synthetic comment for the previous vote', vote_creation_time: '2026-10-20T12:00:00Z', abstained: false },
            ],
          },
        ],
      };
      projectService.getProjectStrict.mockReturnValue(of({ writer: true } as Project));
      voteService.fetchVote.mockImplementation((id: string) =>
        of(makeVote({ uid: id, poll_comment_prompts: id === 'vote-1' ? makeVote().poll_comment_prompts : [] }))
      );
      voteService.getVoteResults.mockImplementation((id: string) => (id === 'vote-1' ? of(previousResults) : nextResults));
      const fixture = await setup();
      expect(testId(fixture, 'vote-detail-overview-comment')?.textContent).toContain('Synthetic comment for the previous vote');
      expect(testId(fixture, 'vote-detail-overview-callout-count')?.textContent).toContain('1 invited voter');

      paramMap.next(convertToParamMap({ id: 'vote-2' }));
      TestBed.tick();

      expect(voteService.getVoteResults).toHaveBeenCalledWith('vote-2');
      expect(read(fixture, 'loadingVoteResults')).toBe(true);
      expect(read(fixture, 'voteResults')).toBeNull();
      expect(testId(fixture, 'vote-detail-overview-callout-count')).toBeNull();
      expect(testId(fixture, 'vote-detail-overview-comment')).toBeNull();
      expect(read<StatCardItem[]>(fixture, 'summaryCards').every((card) => card.value === '—')).toBe(true);

      nextResults.next({ ...makeResults(), num_recipients: 8, num_votes_cast: 2 });
      nextResults.complete();
      TestBed.tick();

      expect(testId(fixture, 'vote-detail-overview-callout-count')?.textContent).toContain('6 invited voters');
      expect(testId(fixture, 'vote-detail-overview-comment')).toBeNull();
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
