// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgTemplateOutlet } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { NO_ERRORS_SCHEMA, PLATFORM_ID, REQUEST_CONTEXT, signal, Type } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, convertToParamMap, ParamMap, Router } from '@angular/router';
import { ExpandableTextComponent } from '@components/expandable-text/expandable-text.component';
import { StatCardGridComponent } from '@components/stat-card-grid/stat-card-grid.component';
import { IndexedVoteResponseStatus, PollStatus, PollType } from '@lfx-one/shared/enums';
import {
  CommentResponseView,
  MyVoteBallot,
  MyVoteResponse,
  PollCommentResult,
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
import { UserService } from '@services/user.service';
import { DialogService } from 'primeng/dynamicdialog';
import { BehaviorSubject, Observable, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { VoteCommentItemComponent } from '../components/vote-comment-item/vote-comment-item.component';
import { VoteDetailHeaderComponent } from '../components/vote-detail-header/vote-detail-header.component';
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
    getMyVoteBallot: ReturnType<typeof vi.fn>;
    getVoteResults: ReturnType<typeof vi.fn>;
  };
  let projectService: { getProjectStrict: ReturnType<typeof vi.fn> };
  let committeeService: { fetchCommittee: ReturnType<typeof vi.fn> };
  let dialogService: { open: ReturnType<typeof vi.fn> };
  let router: { navigate: ReturnType<typeof vi.fn> };
  let paramMap: BehaviorSubject<ParamMap>;
  let queryParamMap: BehaviorSubject<ParamMap>;
  let reqContext: ServerRequestContext;
  const impersonating = signal(false);

  async function setup(platform: 'browser' | 'server' = 'browser', realImports: Type<unknown>[] = []): Promise<ComponentFixture<VoteDetailComponent>> {
    await TestBed.configureTestingModule({
      imports: [VoteDetailComponent],
      providers: [
        { provide: VoteService, useValue: voteService },
        { provide: UserService, useValue: { impersonating } },
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
      // Keep the real page template; opt into real children for composed visibility and interaction assertions.
      .overrideComponent(VoteDetailComponent, {
        set: {
          imports: [NgTemplateOutlet, ...realImports],
          schemas: [NO_ERRORS_SCHEMA],
          providers: [{ provide: DialogService, useValue: dialogService }],
        },
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
  /** Responses bound to the Overview comment preview's items. */
  const previewComments = (fixture: ComponentFixture<VoteDetailComponent>): CommentResponseView[] =>
    fixture.debugElement
      .queryAll(By.css('[data-testid="vote-detail-overview-comment"] lfx-vote-comment-item'))
      .map((item) => item.properties['response'] as CommentResponseView);

  beforeEach(() => {
    impersonating.set(false);
    voteService = {
      fetchVote: vi.fn().mockReturnValue(of(makeVote())),
      getMyVoteResponse: vi.fn().mockReturnValue(of(null)),
      getMyVoteBallot: vi.fn().mockReturnValue(of(null)),
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

  describe('Admin Mode ballot policy (#4331)', () => {
    it.each([true, undefined, null])('does not request private recorded ballots for privacy %s', async (privacy) => {
      impersonating.set(true);
      const vote = makeVote();
      Reflect.set(vote, 'pseudo_anonymity', privacy); // Includes malformed runtime null metadata.
      voteService.fetchVote.mockReturnValue(of(vote));
      voteService.getMyVoteResponse.mockReturnValue(of(makeResponse(IndexedVoteResponseStatus.RESPONDED)));
      const fixture = await setup();
      expect(voteService.getMyVoteBallot).not.toHaveBeenCalled();
      expect(testId(fixture, 'vote-detail-impersonation-notice')?.textContent).toContain('This ballot is private');
      expect(testId(fixture, 'vote-detail-my-ballot-error')).toBeNull();
      expect(testId(fixture, 'vote-detail-my-ballot')).toBeNull();
    });

    it.each([false, true, undefined, null])('explains why an awaiting ballot cannot be cast during impersonation (privacy %s)', async (privacy) => {
      impersonating.set(true);
      const vote = makeVote();
      Reflect.set(vote, 'pseudo_anonymity', privacy);
      voteService.fetchVote.mockReturnValue(of(vote));
      voteService.getMyVoteResponse.mockReturnValue(of(makeResponse(IndexedVoteResponseStatus.AWAITING_RESPONSE)));
      const fixture = await setup();
      expect(read(fixture, 'canCastVote')).toBe(false);
      expect(read(fixture, 'castDrawerVisible')).toBe(false);
      call(fixture, 'onCastVote');
      expect(read(fixture, 'castDrawerVisible')).toBe(false);
      expect(testId(fixture, 'vote-detail-impersonation-notice')?.textContent).toContain('You cannot cast or change their vote.');
      expect(testId(fixture, 'vote-detail-impersonation-notice')?.textContent).not.toContain('This ballot is private');
    });

    it('still loads named recorded ballots during impersonation', async () => {
      impersonating.set(true);
      voteService.fetchVote.mockReturnValue(of(makeVote({ pseudo_anonymity: false })));
      voteService.getMyVoteResponse.mockReturnValue(of(makeResponse(IndexedVoteResponseStatus.RESPONDED)));
      await setup();
      expect(voteService.getMyVoteBallot).toHaveBeenCalledWith('vote-1');
    });

    it('does not demote a manager or change their normal results permissions', async () => {
      impersonating.set(true);
      projectService.getProjectStrict.mockReturnValue(of({ writer: true } as Project));
      const fixture = await setup();
      expect(read(fixture, 'audience')).toBe('creator');
      expect(voteService.getVoteResults).toHaveBeenCalledWith('vote-1');
    });
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
      voteService.getMyVoteResponse.mockReturnValue(of(makeResponse(IndexedVoteResponseStatus.RESPONDED)));
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
      expect(testId(fixture, 'vote-detail-you-voted')?.textContent?.trim()).toBe('Your vote is included in these results.');
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
      // No results means no count — the Not voted card reads as a dash, never 0.
      expect(read<StatCardItem[]>(fixture, 'summaryCards')[2].value).toBe('—');
    });

    it('shows no not-responded callout on an open vote, before or after the results load (#4447)', async () => {
      projectService.getProjectStrict.mockReturnValue(of({ writer: true } as Project));
      const results = new Subject<VoteResultsResponse>();
      voteService.getVoteResults.mockReturnValue(results);
      const fixture = await setup();

      expect(testId(fixture, 'vote-detail-overview-callout')).toBeNull();
      expect(read<StatCardItem[]>(fixture, 'summaryCards')[2].value).toBe('—');

      results.next(makeResults());
      TestBed.tick();
      expect(testId(fixture, 'vote-detail-overview-callout')).toBeNull();
      expect(read<StatCardItem[]>(fixture, 'summaryCards')[2]).toMatchObject({ value: 1, label: 'Not voted yet' });
    });
  });

  describe('your ballot (#4331)', () => {
    const ballot: MyVoteBallot = { vote_response_uid: 'resp-1', vote_uid: 'vote-1', abstained: false, poll_answers: [], comment_responses: [] };

    it.each([
      ['a named', false],
      ['a pseudo-anonymous', true],
    ])('shows a submitted voter their own ballot on %s vote', async (_label, pseudoAnonymity) => {
      voteService.fetchVote.mockReturnValue(of(makeVote({ pseudo_anonymity: pseudoAnonymity })));
      voteService.getMyVoteResponse.mockReturnValue(of(makeResponse(IndexedVoteResponseStatus.RESPONDED)));
      voteService.getMyVoteBallot.mockReturnValue(of(ballot));
      const fixture = await setup();

      expect(voteService.getMyVoteBallot).toHaveBeenCalledWith('vote-1');
      expect(read(fixture, 'myBallot')).toEqual(ballot);
      expect(testId(fixture, 'vote-detail-my-ballot')).not.toBeNull();
      expect(testId(fixture, 'vote-detail-voter-confirmation')).not.toBeNull();
    });

    it.each(['success', 'error', 'missing'])('shows a loading placeholder until the ballot read settles with %s', async (outcome) => {
      const pending = new Subject<MyVoteBallot | null>();
      voteService.getMyVoteResponse.mockReturnValue(of(makeResponse(IndexedVoteResponseStatus.RESPONDED)));
      voteService.getMyVoteBallot.mockReturnValue(pending);
      const fixture = await setup();

      expect(testId(fixture, 'vote-detail-my-ballot-loading')).not.toBeNull();
      expect(testId(fixture, 'vote-detail-my-ballot')).toBeNull();
      expect(testId(fixture, 'vote-detail-my-ballot-error')).toBeNull();

      if (outcome === 'success') {
        pending.next(ballot);
        pending.complete();
      } else if (outcome === 'missing') {
        pending.next(null);
        pending.complete();
      } else {
        pending.error(new HttpErrorResponse({ status: 500 }));
      }
      TestBed.tick();
      fixture.detectChanges();

      expect(testId(fixture, 'vote-detail-my-ballot-loading')).toBeNull();
      expect(testId(fixture, outcome === 'success' ? 'vote-detail-my-ballot' : 'vote-detail-my-ballot-error')).not.toBeNull();
    });

    it('shows a ballot error without losing submission confirmation when the recorded ballot is missing', async () => {
      voteService.getMyVoteResponse.mockReturnValue(of(makeResponse(IndexedVoteResponseStatus.RESPONDED)));
      voteService.getMyVoteBallot.mockReturnValue(of(null));
      const fixture = await setup();

      expect(voteService.getMyVoteBallot).toHaveBeenCalledWith('vote-1');
      expect(testId(fixture, 'vote-detail-my-ballot-loading')).toBeNull();
      expect(testId(fixture, 'vote-detail-my-ballot')).toBeNull();
      expect(testId(fixture, 'vote-detail-my-ballot-error')?.textContent).toContain("Couldn't load your ballot.");
      expect(testId(fixture, 'vote-detail-voter-confirmation')).not.toBeNull();
    });

    it('clears ballot loading when navigation cancels a pending read', async () => {
      const pending = new Subject<MyVoteBallot | null>();
      voteService.getMyVoteResponse.mockReturnValue(of(makeResponse(IndexedVoteResponseStatus.RESPONDED)));
      voteService.getMyVoteBallot.mockReturnValue(pending);
      const fixture = await setup();

      expect(testId(fixture, 'vote-detail-my-ballot-loading')).not.toBeNull();
      voteService.fetchVote.mockReturnValue(of(makeVote({ uid: 'vote-2' })));
      voteService.getMyVoteResponse.mockReturnValue(of(makeResponse(IndexedVoteResponseStatus.AWAITING_RESPONSE, { vote_uid: 'vote-2' })));
      paramMap.next(convertToParamMap({ id: 'vote-2' }));
      TestBed.tick();
      fixture.detectChanges();

      expect(pending.observed).toBe(false);
      expect(testId(fixture, 'vote-detail-my-ballot-loading')).toBeNull();
      expect(testId(fixture, 'vote-detail-my-ballot')).toBeNull();
    });

    it('does not read a ballot for a voter who has not voted', async () => {
      voteService.getMyVoteResponse.mockReturnValue(of(makeResponse(IndexedVoteResponseStatus.AWAITING_RESPONSE)));
      const fixture = await setup();

      expect(voteService.getMyVoteBallot).not.toHaveBeenCalled();
      expect(testId(fixture, 'vote-detail-my-ballot')).toBeNull();
    });

    it('does not read a ballot for a manager', async () => {
      projectService.getProjectStrict.mockReturnValue(of({ writer: true } as Project));
      voteService.getMyVoteResponse.mockReturnValue(of(makeResponse(IndexedVoteResponseStatus.RESPONDED)));
      const fixture = await setup();

      expect(read(fixture, 'audience')).toBe('creator');
      expect(voteService.getMyVoteBallot).not.toHaveBeenCalled();
      expect(testId(fixture, 'vote-detail-my-ballot')).toBeNull();
    });

    it('says the ballot could not load when the read fails', async () => {
      voteService.getMyVoteResponse.mockReturnValue(of(makeResponse(IndexedVoteResponseStatus.RESPONDED)));
      voteService.getMyVoteBallot.mockReturnValue(httpError(500));
      const fixture = await setup();

      expect(testId(fixture, 'vote-detail-my-ballot')).toBeNull();
      expect(testId(fixture, 'vote-detail-my-ballot-error')?.textContent).toContain("Couldn't load your ballot.");
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

      const notVotedCard = read<StatCardItem[]>(fixture, 'summaryCards')[2];
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

      expect(read<StatCardItem[]>(fixture, 'summaryCards')[2]).toMatchObject({ label: 'Did not vote', subLine: 'Voting is closed' });
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

  describe('summary card actions (#4447)', () => {
    const clickCard = (fixture: ComponentFixture<VoteDetailComponent>, action: string): void =>
      fixture.debugElement.query(By.css('[data-testid="vote-detail-summary"]')).triggerEventHandler('actionClick', action);
    const cardActions = (fixture: ComponentFixture<VoteDetailComponent>): (string | undefined)[] =>
      read<StatCardItem[]>(fixture, 'summaryCards').map((card) => card.action);

    beforeEach(() => {
      projectService.getProjectStrict.mockReturnValue(of({ writer: true } as Project));
    });

    it('merges responses and participation into one Responded card, noting abstentions', async () => {
      voteService.getVoteResults.mockReturnValue(of({ ...makeResults(), num_abstained: 1 }));
      const fixture = await setup();

      expect(read<StatCardItem[]>(fixture, 'summaryCards').map((card) => card.label)).toEqual(['Responded', 'Comments', 'Not voted yet']);
      expect(read<StatCardItem[]>(fixture, 'summaryCards')[0]).toMatchObject({ value: '3 / 4', subLine: '75% participation · 1 abstention' });
      expect(testId(fixture, 'vote-detail-summary')).toHaveProperty('columns', 3);
    });

    it('makes every card clickable on an open vote', async () => {
      const fixture = await setup();

      expect(cardActions(fixture)).toEqual(['responses', 'comments', 'not-voted']);
    });

    it('opens the reminder dialog from the Not voted card', async () => {
      const fixture = await setup();

      clickCard(fixture, 'not-voted');

      expect(dialogService.open).toHaveBeenCalledWith(VoteReminderDialogComponent, expect.objectContaining({ data: { vote: makeVote() } }));
    });

    it.each([
      ['comments', 'comments'],
      ['responses', 'voters'],
    ])('opens the matching tab from the %s card', async (action, tab) => {
      const fixture = await setup();

      clickCard(fixture, action);

      expect(router.navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { tab, voters_choice: null, voters_ballot: null } }));
      expect(dialogService.open).not.toHaveBeenCalled();
    });

    it('keeps Not voted display-only once the vote has ended', async () => {
      voteService.fetchVote.mockReturnValue(of(makeVote({ status: PollStatus.ENDED })));
      const fixture = await setup();

      expect(cardActions(fixture)).toEqual(['responses', 'comments', undefined]);
    });

    it('keeps Comments display-only while totals are held or when the vote has no prompts', async () => {
      voteService.getVoteResults.mockReturnValue(of({ ...makeResults(), results_held: true }));
      voteService.fetchVote.mockReturnValue(of(makeVote({ pseudo_anonymity: true })));
      const held = await setup();
      expect(cardActions(held)[1]).toBeUndefined();

      TestBed.resetTestingModule();
      voteService.getVoteResults.mockReturnValue(of(makeResults()));
      voteService.fetchVote.mockReturnValue(of(makeVote({ poll_comment_prompts: [] })));
      const noPrompts = await setup();
      expect(cardActions(noPrompts)[1]).toBeUndefined();
    });

    it.each(['initial load', 'ballot refresh'] as const)('disables the real summary buttons after a results error on %s', async (phase) => {
      const failedResults = new Subject<VoteResultsResponse>();
      if (phase === 'initial load') {
        voteService.getVoteResults.mockReturnValue(failedResults);
      } else {
        voteService.getVoteResults.mockReturnValueOnce(of(makeResults())).mockReturnValueOnce(failedResults);
      }
      const fixture = await setup('browser', [StatCardGridComponent]);
      const buttons = (): HTMLButtonElement[] =>
        Array.from<HTMLButtonElement>(fixture.nativeElement.querySelectorAll('[data-testid="vote-detail-summary"] button'));

      expect(buttons()).toHaveLength(3);
      expect(buttons().every((button) => button.disabled)).toBe(phase === 'initial load');
      if (phase === 'ballot refresh') {
        call(fixture, 'onVoteSubmitted', 'vote-1');
        TestBed.tick();
      }

      failedResults.error(new HttpErrorResponse({ status: 503 }));
      TestBed.tick();
      fixture.detectChanges();

      expect(read(fixture, 'voteResultsError')).toBe(true);
      expect(read(fixture, 'loadingVoteResults')).toBe(false);
      expect(buttons()).toHaveLength(3);
      expect(buttons().every((button) => button.disabled)).toBe(true);
      router.navigate.mockClear();
      dialogService.open.mockClear();
      for (const button of buttons()) button.click();
      expect(router.navigate).not.toHaveBeenCalled();
      expect(dialogService.open).not.toHaveBeenCalled();
    });

    it('ignores card clicks while the results load, and unknown actions', async () => {
      const results = new Subject<VoteResultsResponse>();
      voteService.getVoteResults.mockReturnValue(results);
      const fixture = await setup();
      router.navigate.mockClear();

      clickCard(fixture, 'not-voted');
      clickCard(fixture, 'responses');
      expect(dialogService.open).not.toHaveBeenCalled();
      expect(router.navigate).not.toHaveBeenCalled();

      results.next(makeResults());
      TestBed.tick();
      clickCard(fixture, 'closing-soon');
      expect(dialogService.open).not.toHaveBeenCalled();
      expect(router.navigate).not.toHaveBeenCalled();
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
      expect(read<StatCardItem[]>(fixture, 'summaryCards').map((card) => card.value)).toEqual(['3 / 4', 1, 1]);
      expect(testId(fixture, 'vote-detail-summary')).toHaveProperty('loading', false);
      expect(testId(fixture, 'vote-detail-results-loading')).toBeNull();
      expect(testId(fixture, 'vote-detail-comments-loading')).toBeNull();
      expect(testId(fixture, region)).not.toBeNull();

      const updatedResults = { ...previousResults, num_votes_cast: 4 };
      refreshed.next(updatedResults);
      refreshed.complete();
      TestBed.tick();

      expect(read(fixture, 'voteResults')).toEqual(updatedResults);
      expect(read<StatCardItem[]>(fixture, 'summaryCards').map((card) => card.value)).toEqual(['4 / 4', 1, 0]);
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
    it('waits for a fresh response when returning to a vote through a not-found route', async () => {
      const returningResponse = new Subject<MyVoteResponse>();
      voteService.fetchVote.mockImplementation((id: string) => (id === 'vote-1' ? of(makeVote({ status: PollStatus.ENDED })) : httpError(404)));
      voteService.getMyVoteResponse.mockReturnValueOnce(of(makeResponse(IndexedVoteResponseStatus.RESPONDED))).mockReturnValueOnce(returningResponse);
      const fixture = await setup();
      expect(read(fixture, 'accessLoading')).toBe(false);
      expect(voteService.getVoteResults).toHaveBeenCalledTimes(1);

      paramMap.next(convertToParamMap({ id: 'vote-missing' }));
      TestBed.tick();
      expect(fixture.nativeElement.querySelector('lfx-not-found')).not.toBeNull();
      expect(read(fixture, 'myResponse')).toBeNull();

      paramMap.next(convertToParamMap({ id: 'vote-1' }));
      TestBed.tick();
      expect(read(fixture, 'myResponseLoading')).toBe(true);
      expect(read(fixture, 'accessLoading')).toBe(true);
      expect(testId(fixture, 'vote-detail-access-loading')).not.toBeNull();
      expect(testId(fixture, 'vote-detail-results-empty')).toBeNull();
      expect(testId(fixture, 'vote-detail-voter-not-participant')).toBeNull();
      expect(voteService.getVoteResults).toHaveBeenCalledTimes(1);

      returningResponse.next(makeResponse(IndexedVoteResponseStatus.RESPONDED));
      returningResponse.complete();
      TestBed.tick();
      expect(read(fixture, 'accessLoading')).toBe(false);
      expect(testId(fixture, 'vote-detail-access-loading')).toBeNull();
      expect(voteService.getVoteResults).toHaveBeenCalledTimes(2);
    });

    it.each([
      { previous: 'success', tab: 'results' },
      { previous: 'error', tab: 'results' },
      { previous: 'success', tab: 'comments' },
      { previous: 'error', tab: 'comments' },
    ])('shows loading, not the previous $previous state, before the next $tab request starts', async ({ previous, tab }) => {
      let inspectAccess = (): void => undefined;
      projectService.getProjectStrict.mockImplementation(
        () =>
          new Observable<Project>((subscriber) => {
            subscriber.next({ writer: true } as Project);
            inspectAccess();
            subscriber.complete();
          })
      );
      voteService.fetchVote.mockImplementation((id: string) => of(makeVote({ uid: id })));
      const nextResults = new Subject<VoteResultsResponse>();
      voteService.getVoteResults.mockImplementation((id: string) => {
        if (id === 'vote-2') return nextResults;
        return previous === 'error' ? httpError(503) : of(makeResults());
      });
      queryParamMap.next(convertToParamMap({ tab }));
      const fixture = await setup();
      expect(read(fixture, 'voteResultsError')).toBe(previous === 'error');

      const snapshots: { accessLoading: boolean; loading: boolean; error: boolean; results: VoteResultsResponse | null }[] = [];
      inspectAccess = () => {
        snapshots.push({
          accessLoading: read(fixture, 'accessLoading'),
          loading: read(fixture, 'loadingVoteResults'),
          error: read(fixture, 'voteResultsError'),
          results: read(fixture, 'voteResults'),
        });
      };
      paramMap.next(convertToParamMap({ id: 'vote-2' }));
      TestBed.tick();

      // The new access result has landed, but the dependent results effect has not run yet.
      expect(snapshots).toEqual([{ accessLoading: false, loading: true, error: false, results: null }]);
      expect(testId(fixture, `vote-detail-${tab}-loading`)).not.toBeNull();
      expect(testId(fixture, `vote-detail-${tab}-error`)).toBeNull();
      expect(testId(fixture, 'vote-detail-results-empty')).toBeNull();

      nextResults.next(makeResults());
      nextResults.complete();
      TestBed.tick();
      expect(read(fixture, 'loadingVoteResults')).toBe(false);
      expect(read(fixture, 'voteResultsError')).toBe(false);
      expect(read(fixture, 'voteResults')).toEqual(makeResults());
    });

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
      expect(previewComments(fixture).map((response) => response.comment_text)).toEqual(['Synthetic comment for the previous vote']);
      expect(read<StatCardItem[]>(fixture, 'summaryCards')[2].value).toBe(1);

      paramMap.next(convertToParamMap({ id: 'vote-2' }));
      TestBed.tick();

      expect(voteService.getVoteResults).toHaveBeenCalledWith('vote-2');
      expect(read(fixture, 'loadingVoteResults')).toBe(true);
      expect(read(fixture, 'voteResults')).toBeNull();
      expect(testId(fixture, 'vote-detail-overview-comment')).toBeNull();
      expect(read<StatCardItem[]>(fixture, 'summaryCards').every((card) => card.value === '—')).toBe(true);

      nextResults.next({ ...makeResults(), num_recipients: 8, num_votes_cast: 2 });
      nextResults.complete();
      TestBed.tick();

      expect(read<StatCardItem[]>(fixture, 'summaryCards')[2].value).toBe(6);
      expect(testId(fixture, 'vote-detail-overview-comment')).toBeNull();
    });
  });

  describe('overview comment preview (#4448)', () => {
    const prompts = [
      { prompt_id: 'prompt-1', prompt: 'Any concerns?' },
      { prompt_id: 'prompt-2', prompt: 'Anything else?' },
    ];
    const named = (voteId: string, day: number) => ({
      vote_id: voteId,
      comment_text: `Synthetic comment ${voteId}`,
      user_name: `Synthetic Voter ${voteId}`,
      vote_creation_time: `2026-10-${day}T12:00:00Z`,
      abstained: false,
    });
    const namedResults = (): VoteResultsResponse => ({
      ...makeResults(),
      comment_results: [
        { prompt: prompts[0], responses: [named('r-1', 20), named('r-3', 22)] },
        { prompt: prompts[1], responses: [named('r-2', 21), named('r-4', 23)] },
      ],
    });
    const items = (fixture: ComponentFixture<VoteDetailComponent>): HTMLElement[] =>
      [...fixture.nativeElement.querySelectorAll('[data-testid="vote-detail-overview-comment"] [data-testid="vote-results-comment"]')] as HTMLElement[];
    const meta = (fixture: ComponentFixture<VoteDetailComponent>): Element | null =>
      testId(fixture, 'vote-detail-overview-comment')?.querySelector('[data-testid="vote-results-comment-meta"]') ?? null;
    const questionLabels = (fixture: ComponentFixture<VoteDetailComponent>): string[] =>
      [...fixture.nativeElement.querySelectorAll('[data-testid="vote-detail-overview-comment-question"]')].map((label) => label.textContent.trim());

    it('shows a manager the three newest comments across prompts, with names and ballot links', async () => {
      projectService.getProjectStrict.mockReturnValue(of({ writer: true } as Project));
      voteService.fetchVote.mockReturnValue(of(makeVote({ status: PollStatus.ENDED, pseudo_anonymity: false, poll_comment_prompts: prompts })));
      voteService.getVoteResults.mockReturnValue(of(namedResults()));
      const fixture = await setup('browser', [VoteCommentItemComponent]);

      const rendered = items(fixture);
      expect(rendered.map((item) => item.querySelector('lfx-expandable-text')?.textContent?.trim())).toEqual([
        'Synthetic comment r-4',
        'Synthetic comment r-3',
        'Synthetic comment r-2',
      ]);
      expect(questionLabels(fixture)).toEqual(['Anything else?', 'Any concerns?', 'Anything else?']);
      expect(rendered[0].querySelector('[data-testid="vote-results-comment-meta"]')?.textContent).toContain('Synthetic Voter r-4');
      expect(testId(fixture, 'vote-detail-overview-all-comments')).not.toBeNull();

      testId(fixture, 'vote-results-comment-view-ballot-r-4')!.querySelector('button')!.click();
      expect(router.navigate).toHaveBeenLastCalledWith(
        [],
        expect.objectContaining({ queryParams: { tab: 'voters', voters_choice: null, voters_ballot: 'r-4' } })
      );
    });

    it('omits redundant question labels when the vote has one comment question', async () => {
      projectService.getProjectStrict.mockReturnValue(of({ writer: true } as Project));
      voteService.fetchVote.mockReturnValue(of(makeVote({ status: PollStatus.ENDED, pseudo_anonymity: false, poll_comment_prompts: [prompts[0]] })));
      voteService.getVoteResults.mockReturnValue(of({ ...makeResults(), comment_results: [{ prompt: prompts[0], responses: [named('r-1', 22)] }] }));
      const fixture = await setup('browser', [VoteCommentItemComponent]);

      expect(items(fixture)).toHaveLength(1);
      expect(questionLabels(fixture)).toEqual([]);
    });

    it('renders answers from the same ballot across prompts without duplicate tracking keys', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      projectService.getProjectStrict.mockReturnValue(of({ writer: true } as Project));
      voteService.fetchVote.mockReturnValue(of(makeVote({ status: PollStatus.ENDED, pseudo_anonymity: false, poll_comment_prompts: prompts })));
      voteService.getVoteResults.mockReturnValue(
        of({
          ...makeResults(),
          comment_results: [
            { prompt: prompts[0], responses: [{ ...named('r-1', 22), comment_text: 'First answer' }, named('r-2', 21)] },
            { prompt: prompts[1], responses: [{ ...named('r-1', 22), comment_text: 'Second answer' }] },
          ],
        })
      );

      try {
        const fixture = await setup('browser', [VoteCommentItemComponent]);

        expect(items(fixture).map((item) => item.querySelector('lfx-expandable-text')?.textContent?.trim())).toEqual([
          'First answer',
          'Second answer',
          'Synthetic comment r-2',
        ]);
        // Ballot-scoped IDs intentionally repeat; each row still owns a separate link to the same ballot.
        vi.mocked(router.navigate).mockClear();
        items(fixture)
          .slice(0, 2)
          .forEach((item, index) => {
            const link = item.querySelector('[data-testid="vote-results-comment-view-ballot-r-1"]');
            expect(link).not.toBeNull();
            link!.querySelector('button')!.click();
            expect(router.navigate).toHaveBeenCalledTimes(index + 1);
            expect(router.navigate).toHaveBeenLastCalledWith(
              [],
              expect.objectContaining({ queryParams: { tab: 'voters', voters_choice: null, voters_ballot: 'r-1' } })
            );
          });
        expect(warn.mock.calls.flat().join('\n')).not.toContain('NG0955');
      } finally {
        warn.mockRestore();
      }
    });

    it('retains preview rows and expansion across a same-vote results refresh', async () => {
      const refreshed = new Subject<VoteResultsResponse>();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      projectService.getProjectStrict.mockReturnValue(of({ writer: true } as Project));
      voteService.fetchVote.mockReturnValue(of(makeVote({ pseudo_anonymity: false, poll_comment_prompts: prompts })));
      voteService.getVoteResults.mockReturnValueOnce(of(namedResults())).mockReturnValueOnce(refreshed);

      try {
        const fixture = await setup('browser', [VoteCommentItemComponent]);
        const before = items(fixture);
        const expanded = fixture.debugElement.query(By.directive(ExpandableTextComponent)).componentInstance as ExpandableTextComponent;
        expanded.isExpanded.set(true);
        TestBed.tick();

        call(fixture, 'onVoteSubmitted', 'vote-1');
        TestBed.tick();
        refreshed.next(namedResults());
        refreshed.complete();
        TestBed.tick();

        const after = items(fixture);
        expect(after).toHaveLength(before.length);
        after.forEach((item, index) => expect(item).toBe(before[index]));
        const retained = fixture.debugElement.query(By.directive(ExpandableTextComponent)).componentInstance as ExpandableTextComponent;
        expect(retained).toBe(expanded);
        expect(retained.isExpanded()).toBe(true);
        expect(warn.mock.calls.flat().join('\n')).not.toContain('NG0956');
      } finally {
        warn.mockRestore();
      }
    });

    it('shows text only on a pseudo-anonymous vote, in the server order', async () => {
      projectService.getProjectStrict.mockReturnValue(of({ writer: true } as Project));
      voteService.fetchVote.mockReturnValue(of(makeVote({ status: PollStatus.ENDED, pseudo_anonymity: true, poll_comment_prompts: prompts })));
      voteService.getVoteResults.mockReturnValue(
        of({
          ...makeResults(),
          comment_results: [
            { prompt: prompts[0], responses: [{ comment_text: 'Alpha' }, { comment_text: 'Charlie' }] },
            { prompt: prompts[1], responses: [{ comment_text: 'Bravo' }] },
          ],
        })
      );
      const fixture = await setup('browser', [VoteCommentItemComponent]);

      expect(items(fixture).map((item) => item.textContent?.trim())).toEqual(['Alpha', 'Charlie', 'Bravo']);
      expect(questionLabels(fixture)).toEqual(['Any concerns?', 'Any concerns?', 'Anything else?']);
      expect(meta(fixture)).toBeNull();
      expect(fixture.nativeElement.querySelector('[data-testid^="vote-results-comment-view-ballot-"]')).toBeNull();
    });

    it('shows a voter on a closed named vote text only', async () => {
      voteService.fetchVote.mockReturnValue(of(makeVote({ status: PollStatus.ENDED, pseudo_anonymity: false, poll_comment_prompts: prompts })));
      voteService.getMyVoteResponse.mockReturnValue(of(makeResponse(IndexedVoteResponseStatus.RESPONDED)));
      voteService.getVoteResults.mockReturnValue(
        of({ ...makeResults(), comment_results: [{ prompt: prompts[0], responses: [{ comment_text: 'Synthetic voter-view comment' }] }] })
      );
      const fixture = await setup('browser', [VoteCommentItemComponent]);

      expect(read(fixture, 'audience')).toBe('voter');
      expect(items(fixture).map((item) => item.textContent?.trim())).toEqual(['Synthetic voter-view comment']);
      expect(questionLabels(fixture)).toEqual(['Any concerns?']);
      expect(meta(fixture)).toBeNull();
    });

    it('hides the card when there are no comments', async () => {
      projectService.getProjectStrict.mockReturnValue(of({ writer: true } as Project));
      voteService.fetchVote.mockReturnValue(of(makeVote({ status: PollStatus.ENDED, pseudo_anonymity: false })));
      const fixture = await setup('browser', [VoteCommentItemComponent]);

      expect(testId(fixture, 'vote-detail-overview-comment')).toBeNull();
    });
  });

  describe('tabs', () => {
    // An invited viewer: someone never invited gets Overview alone (#4330), covered under "voter comments and outsiders".
    beforeEach(() => {
      voteService.getMyVoteResponse.mockReturnValue(of(makeResponse(IndexedVoteResponseStatus.RESPONDED)));
    });

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

    it.each([
      { label: 'omitted', prompts: undefined },
      { label: 'empty', prompts: [] },
    ])('keeps result-only comments reachable when detail prompts are $label', async ({ prompts }) => {
      projectService.getProjectStrict.mockReturnValue(of({ writer: true } as Project));
      voteService.fetchVote.mockReturnValue(of(makeVote({ poll_comment_prompts: prompts })));
      const comments: PollCommentResult[] = [
        {
          prompt: { prompt_id: 'result-prompt', prompt: 'Any concerns?' },
          responses: [
            { vote_id: 'response-1', comment_text: 'First synthetic comment', vote_creation_time: '2026-10-20T12:00:00Z', abstained: false },
            { vote_id: 'response-2', comment_text: 'Second synthetic comment', vote_creation_time: '2026-10-21T12:00:00Z', abstained: false },
          ],
        },
      ];
      voteService.getVoteResults.mockReturnValue(of({ ...makeResults(), comment_results: comments }));
      const fixture = await setup();

      expect(read<{ key: string }[]>(fixture, 'tabs').map((tab) => tab.key)).toContain('comments');
      expect(previewComments(fixture).map((response) => response.comment_text)).toEqual(['Second synthetic comment', 'First synthetic comment']);
      expect(read<StatCardItem[]>(fixture, 'summaryCards').find((card) => card.label === 'Comments')?.subLine).toBe('Optional written responses');
      expect(fixture.debugElement.query(By.css('lfx-vote-detail-facts')).properties['commentPromptCount']).toBe(1);
      const viewAll = fixture.debugElement.query(By.css('[data-testid="vote-detail-overview-all-comments"]'));
      expect(viewAll.properties['label']).toBe('View all 2 comments');
      viewAll.triggerEventHandler('onClick', undefined);
      expect(router.navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: expect.objectContaining({ tab: 'comments' }) }));

      queryParamMap.next(convertToParamMap({ tab: 'comments' }));
      TestBed.tick();
      expect(read(fixture, 'activeTab')).toBe('comments');
      expect(testId(fixture, 'vote-detail-comments')).not.toBeNull();
      const list = fixture.debugElement.query(By.css('lfx-vote-comment-results'));
      expect((list.properties['commentResults'] as PollCommentResult[])[0].responses.map((response) => response.comment_text)).toEqual([
        'Second synthetic comment',
        'First synthetic comment',
      ]);
    });

    it.each([
      { label: 'omitted', prompts: undefined },
      { label: 'empty', prompts: [] },
    ])('passes result-only prompts to the Voters tab when detail prompts are $label', async ({ prompts }) => {
      const vote = makeVote({ pseudo_anonymity: false, poll_comment_prompts: prompts });
      const prompt = { prompt_id: 'result-prompt', prompt: 'Any concerns?' };
      const results = new Subject<VoteResultsResponse>();
      projectService.getProjectStrict.mockReturnValue(of({ writer: true } as Project));
      voteService.fetchVote.mockReturnValue(of(vote));
      voteService.getVoteResults.mockReturnValue(results);
      queryParamMap.next(convertToParamMap({ tab: 'voters', voters_ballot: 'response-1' }));
      const fixture = await setup();

      results.next({
        ...makeResults(),
        comment_results: [{ prompt, responses: [{ vote_id: 'response-1', comment_text: 'Synthetic ballot comment', abstained: false }] }],
      });
      TestBed.tick();

      const voters = fixture.debugElement.query(By.css('lfx-vote-voters'));
      expect(voters.properties['commentPrompts']).toEqual([prompt]);
      expect(voters.properties['vote']).toBe(vote);
      expect(vote.poll_comment_prompts).toBe(prompts);
    });

    it.each([
      { label: 'omitted', prompts: undefined },
      { label: 'empty', prompts: [] },
    ])('resolves a direct Comments link when result-only prompts load ($label)', async ({ prompts }) => {
      voteService.fetchVote.mockReturnValue(of(makeVote({ status: PollStatus.ENDED, poll_comment_prompts: prompts })));
      voteService.getMyVoteResponse.mockReturnValue(of(makeResponse(IndexedVoteResponseStatus.RESPONDED)));
      const results = new Subject<VoteResultsResponse>();
      voteService.getVoteResults.mockReturnValue(results);
      queryParamMap.next(convertToParamMap({ tab: 'comments' }));
      const fixture = await setup();
      expect(read(fixture, 'activeTab')).toBe('overview');

      results.next({
        ...makeResults(),
        comment_results: [
          {
            prompt: { prompt_id: 'result-prompt', prompt: 'Any concerns?' },
            responses: [{ vote_id: 'response-1', comment_text: 'Synthetic linked comment', vote_creation_time: '2026-10-20T12:00:00Z', abstained: false }],
          },
        ],
      });
      results.complete();
      TestBed.tick();

      expect(read(fixture, 'audience')).toBe('voter');
      expect(read(fixture, 'activeTab')).toBe('comments');
      expect(testId(fixture, 'vote-detail-comments')).not.toBeNull();
      expect(fixture.debugElement.query(By.css('lfx-vote-detail-facts')).properties['commentPromptCount']).toBe(1);
      const list = fixture.debugElement.query(By.css('lfx-vote-comment-results'));
      expect((list.properties['commentResults'] as PollCommentResult[])[0].responses[0].comment_text).toBe('Synthetic linked comment');
    });

    it('writes the tab to the URL, omitting Overview', async () => {
      const fixture = await setup();

      call(fixture, 'switchTab', 'comments');
      expect(router.navigate).toHaveBeenLastCalledWith(
        [],
        expect.objectContaining({ queryParams: { tab: 'comments', voters_choice: null, voters_ballot: null }, queryParamsHandling: 'merge', replaceUrl: true })
      );

      queryParamMap.next(convertToParamMap({ tab: 'comments' }));
      TestBed.tick();
      call(fixture, 'switchTab', 'overview');
      expect(router.navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { tab: null, voters_choice: null, voters_ballot: null } }));
    });

    it('sends View results to the Results tab', async () => {
      const fixture = await setup();

      call(fixture, 'onViewResults');

      expect(router.navigate).toHaveBeenLastCalledWith(
        [],
        expect.objectContaining({ queryParams: { tab: 'results', voters_choice: null, voters_ballot: null } })
      );
    });
  });

  describe('voters tab (#3914)', () => {
    const tabKeys = (fixture: ComponentFixture<VoteDetailComponent>): string[] => read<{ key: string }[]>(fixture, 'tabs').map((tab) => tab.key);

    beforeEach(() => {
      projectService.getProjectStrict.mockReturnValue(of({ writer: true } as Project));
      voteService.fetchVote.mockReturnValue(of(makeVote({ pseudo_anonymity: false })));
    });

    it.each([PollStatus.ACTIVE, PollStatus.ENDED])('shows the tab to a manager on a named %s vote', async (status) => {
      voteService.fetchVote.mockReturnValue(of(makeVote({ pseudo_anonymity: false, status })));
      queryParamMap.next(convertToParamMap({ tab: 'voters' }));
      const fixture = await setup();

      expect(tabKeys(fixture)).toEqual(['overview', 'results', 'comments', 'voters']);
      expect(read(fixture, 'activeTab')).toBe('voters');
      expect(testId(fixture, 'vote-detail-voters')?.querySelector('lfx-vote-voters')).not.toBeNull();
    });

    it.each([
      ['a named draft', { pseudo_anonymity: false, status: PollStatus.DISABLED }],
      ['a pseudo-anonymous draft', { pseudo_anonymity: true, status: PollStatus.DISABLED }],
    ])('hides the tab on %s and falls back to Overview', async (_label, overrides) => {
      voteService.fetchVote.mockReturnValue(of(makeVote(overrides as Partial<Vote>)));
      queryParamMap.next(convertToParamMap({ tab: 'voters', voters_choice: 'question-1:choice-yes', voters_ballot: 'b-1' }));
      const fixture = await setup();

      expect(tabKeys(fixture)).not.toContain('voters');
      expect(read(fixture, 'activeTab')).toBe('overview');
      expect(read(fixture, 'votersChoice')).toBeNull();
      expect(read(fixture, 'votersBallot')).toBeNull();
      expect(testId(fixture, 'vote-detail-voters')).toBeNull();
    });

    it('hides the tab from a viewer without write access', async () => {
      projectService.getProjectStrict.mockReturnValue(of({ writer: false } as Project));
      queryParamMap.next(convertToParamMap({ tab: 'voters' }));
      const fixture = await setup();

      expect(read(fixture, 'showVotersTab')).toBe(false);
      expect(read(fixture, 'activeTab')).toBe('overview');
    });

    it('never shows the tab while the access check is running', async () => {
      projectService.getProjectStrict.mockReturnValue(new Subject<Project>());
      const fixture = await setup();

      expect(read(fixture, 'canManage')).toBeNull();
      expect(read(fixture, 'showVotersTab')).toBe(false);
      expect(tabKeys(fixture)).not.toContain('voters');
    });

    it('passes the deep-link params to the tab when it is shown', async () => {
      queryParamMap.next(convertToParamMap({ tab: 'voters', voters_choice: 'question-1:choice-yes', voters_ballot: 'b-1' }));
      const fixture = await setup();

      expect(read(fixture, 'votersChoice')).toBe('question-1:choice-yes');
      expect(read(fixture, 'votersBallot')).toBe('b-1');
    });

    it('opens the tab from the results and comment links', async () => {
      const fixture = await setup();

      call(fixture, 'onViewOptionVoters', 'question-1', 'choice-yes');
      expect(router.navigate).toHaveBeenLastCalledWith(
        [],
        expect.objectContaining({ queryParams: { tab: 'voters', voters_choice: 'question-1:choice-yes', voters_ballot: null } })
      );

      call(fixture, 'onViewAbstainedVoters');
      expect(router.navigate).toHaveBeenLastCalledWith(
        [],
        expect.objectContaining({ queryParams: { tab: 'voters', voters_choice: 'status:abstained', voters_ballot: null } })
      );

      call(fixture, 'onViewBallot', 'b-1');
      expect(router.navigate).toHaveBeenLastCalledWith(
        [],
        expect.objectContaining({ queryParams: { tab: 'voters', voters_choice: null, voters_ballot: 'b-1' } })
      );
    });

    it.each([
      ['a pseudo-anonymous vote', { pseudo_anonymity: true }],
      ['a vote without the anonymity flag', { pseudo_anonymity: undefined }],
    ])('shows the participation-only tab on %s but ignores its deep-link params (#3916)', async (_label, overrides) => {
      voteService.fetchVote.mockReturnValue(of(makeVote(overrides as Partial<Vote>)));
      queryParamMap.next(convertToParamMap({ tab: 'voters', voters_choice: 'question-1:choice-yes', voters_ballot: 'b-1' }));
      const fixture = await setup();

      expect(tabKeys(fixture)).toContain('voters');
      expect(read(fixture, 'activeTab')).toBe('voters');
      expect(read(fixture, 'showNamedBallotLinks')).toBe(false);
      const voters = fixture.debugElement.query(By.css('lfx-vote-voters'));
      expect(voters.properties['initialChoice']).toBeNull();
      expect(voters.properties['initialBallotUid']).toBeNull();
    });

    it('ignores the links on a pseudo-anonymous vote (#3916)', async () => {
      voteService.fetchVote.mockReturnValue(of(makeVote({ pseudo_anonymity: true })));
      const fixture = await setup();

      call(fixture, 'onViewVoters', 'question-1:choice-yes');
      call(fixture, 'onViewBallot', 'b-1');
      expect(router.navigate).not.toHaveBeenCalled();
    });

    it('binds no ballot or voter links on a closed pseudo-anonymous vote (#3916)', async () => {
      voteService.fetchVote.mockReturnValue(of(makeVote({ pseudo_anonymity: true, status: PollStatus.ENDED, allow_abstain: true })));
      voteService.getVoteResults.mockReturnValue(of({ ...makeMethodResults(), num_abstained: 1 }));
      queryParamMap.next(convertToParamMap({ tab: 'results' }));
      const fixture = await setup();

      expect(fixture.debugElement.query(By.css('lfx-vote-option-results')).properties['showVoterLinks']).toBe(false);
      expect(fixture.debugElement.query(By.css('lfx-vote-abstain-result')).properties['showVoterLinks']).toBe(false);

      queryParamMap.next(convertToParamMap({ tab: 'comments' }));
      TestBed.tick();
      fixture.detectChanges();
      const comments = fixture.debugElement.query(By.css('lfx-vote-comment-results'));
      expect(comments.properties['showBallotLinks']).toBe(false);
      expect(comments.properties['anonymous']).toBe(true);
    });

    it('binds the link inputs to the tab visibility', async () => {
      queryParamMap.next(convertToParamMap({ tab: 'results' }));
      voteService.getVoteResults.mockReturnValue(of(makeMethodResults()));
      const fixture = await setup();

      const options = fixture.debugElement.query(By.css('lfx-vote-option-results'));
      expect(options.properties['showVoterLinks']).toBe(true);
      expect(read(fixture, 'showNamedBallotLinks')).toBe(true);

      options.triggerEventHandler('viewVoters', 'choice-yes');
      expect(router.navigate).toHaveBeenLastCalledWith(
        [],
        expect.objectContaining({ queryParams: { tab: 'voters', voters_choice: 'question-1:choice-yes', voters_ballot: null } })
      );
    });
  });

  describe('voter comments and outsiders (#4330)', () => {
    const header = (fixture: ComponentFixture<VoteDetailComponent>) => fixture.debugElement.query(By.css('lfx-vote-detail-header'));
    const comments = (fixture: ComponentFixture<VoteDetailComponent>) => fixture.debugElement.query(By.css('lfx-vote-comment-results'));
    const namedClosedVote = () => makeVote({ status: PollStatus.ENDED, pseudo_anonymity: false, description: 'Synthetic description' });

    it('shows a voter the comments of a closed named vote as text only, with the voter-view notice', async () => {
      voteService.fetchVote.mockReturnValue(of(namedClosedVote()));
      voteService.getMyVoteResponse.mockReturnValue(of(makeResponse(IndexedVoteResponseStatus.RESPONDED)));
      queryParamMap.next(convertToParamMap({ tab: 'comments' }));
      const fixture = await setup();

      expect(read(fixture, 'audience')).toBe('voter');
      expect(comments(fixture).properties['anonymous']).toBe(true);
      expect(comments(fixture).properties['anonymousReason']).toBe('voter_view');
      expect(comments(fixture).properties['showBallotLinks']).toBe(false);
      expect(header(fixture).properties['limited']).toBe(false);
      const content = testId(fixture, 'vote-detail-panel-comments');
      expect(content?.getAttribute('role')).toBe('tabpanel');
      expect(content?.getAttribute('aria-labelledby')).toBe('vote-detail-tab-comments');
    });

    it('keeps names and ballot links for a manager on the same vote, even in the Me lens', async () => {
      projectService.getProjectStrict.mockReturnValue(of({ writer: true } as Project));
      voteService.fetchVote.mockReturnValue(of(namedClosedVote()));
      queryParamMap.next(convertToParamMap({ tab: 'comments' }));
      const fixture = await setup();

      expect(read(fixture, 'audience')).toBe('creator');
      expect(comments(fixture).properties['anonymous']).toBe(false);
      expect(comments(fixture).properties['showBallotLinks']).toBe(true);
      expect(header(fixture).properties['limited']).toBe(false);
      expect(read(fixture, 'isOutsider')).toBe(false);
    });

    it.each([
      { label: 'a viewer who was never invited', response: null, panel: 'vote-detail-voter-not-participant' },
      {
        label: 'a removed voter',
        response: makeResponse(IndexedVoteResponseStatus.RESPONDED, { voter_removed: true }),
        panel: 'vote-detail-voter-access-denied',
      },
    ])('trims the page to the header basics and the voter-state panel for $label', async ({ response, panel }) => {
      voteService.fetchVote.mockReturnValue(of(namedClosedVote()));
      voteService.getMyVoteResponse.mockReturnValue(of(response));
      queryParamMap.next(convertToParamMap({ tab: 'comments' }));
      const fixture = await setup();

      expect(read(fixture, 'isOutsider')).toBe(true);
      expect(header(fixture).properties['limited']).toBe(true);
      expect(read<{ key: string }[]>(fixture, 'tabs').map((tab) => tab.key)).toEqual(['overview']);
      expect(read(fixture, 'activeTab')).toBe('overview');
      expect(testId(fixture, panel)).not.toBeNull();
      const content = testId(fixture, 'vote-detail-panel-overview');
      expect(content?.hasAttribute('role')).toBe(false);
      expect(content?.hasAttribute('aria-labelledby')).toBe(false);
      expect(testId(fixture, 'vote-detail-description')).toBeNull();
      expect(fixture.nativeElement.querySelector('lfx-vote-detail-facts')).toBeNull();
      expect(testId(fixture, 'vote-detail-summary')).toBeNull();
      expect(fixture.nativeElement.querySelector('lfx-vote-comment-results')).toBeNull();
      expect(voteService.getVoteResults).not.toHaveBeenCalled();
    });

    it.each([null, makeResponse(IndexedVoteResponseStatus.RESPONDED, { voter_removed: true })])(
      'hides all non-basic metadata in the real header for outsider response %j',
      async (response) => {
        voteService.fetchVote.mockReturnValue(of(namedClosedVote()));
        voteService.getMyVoteResponse.mockReturnValue(of(response));
        queryParamMap.next(convertToParamMap({ tab: 'comments' }));
        const fixture = await setup('browser', [VoteDetailHeaderComponent]);

        expect(testId(fixture, 'vote-detail-header-title')?.textContent).toContain('Synthetic board election');
        expect(testId(fixture, 'vote-detail-header-status')?.textContent).toContain('Ended');
        for (const suffix of ['privacy', 'group', 'method', 'close-date', 'ended-early', 'invited', 'view-results', 'tabs']) {
          expect(testId(fixture, `vote-detail-header-${suffix}`)).toBeNull();
        }
        expect(testId(fixture, response ? 'vote-detail-voter-access-denied' : 'vote-detail-voter-not-participant')).not.toBeNull();
        expect(voteService.getVoteResults).not.toHaveBeenCalled();
      }
    );

    describe.each([PollStatus.ACTIVE, PollStatus.ENDED])('participation lookup failure on a %s vote', (status) => {
      it.each([0, 503])('keeps non-basic details hidden after a %i failure', async (failureStatus) => {
        voteService.fetchVote.mockReturnValue(of(makeVote({ ...namedClosedVote(), status, total_voting_request_invitations: 12 })));
        voteService.getMyVoteResponse.mockReturnValue(httpError(failureStatus));
        queryParamMap.next(convertToParamMap({ tab: 'comments' }));
        const fixture = await setup('browser', [VoteDetailHeaderComponent]);

        expect(read(fixture, 'accessLoading')).toBe(false);
        expect(read(fixture, 'myResponseError')).toBe(true);
        expect(read(fixture, 'isOutsider')).toBe(false);
        expect(read(fixture, 'showVoteDetails')).toBe(false);
        expect(testId(fixture, 'vote-detail-voter-my-response-error')).not.toBeNull();
        expect(testId(fixture, 'vote-detail-header-title')?.textContent).toContain('Synthetic board election');
        expect(testId(fixture, 'vote-detail-header-status')).not.toBeNull();
        for (const suffix of ['privacy', 'group', 'method', 'close-date', 'ended-early', 'invited', 'view-results', 'tabs']) {
          expect(testId(fixture, `vote-detail-header-${suffix}`)).toBeNull();
        }
        expect(read<{ key: string }[]>(fixture, 'tabs').map((tab) => tab.key)).toEqual(['overview']);
        expect(read(fixture, 'activeTab')).toBe('overview');
        const content = testId(fixture, 'vote-detail-panel-overview');
        expect(content?.hasAttribute('role')).toBe(false);
        expect(content?.hasAttribute('aria-labelledby')).toBe(false);
        expect(testId(fixture, 'vote-detail-description')).toBeNull();
        expect(fixture.nativeElement.querySelector('lfx-vote-detail-facts')).toBeNull();
        expect(fixture.nativeElement.querySelector('lfx-vote-comment-results')).toBeNull();
        expect(voteService.getVoteResults).not.toHaveBeenCalled();
      });

      it('keeps a verified manager view when the personal response lookup fails', async () => {
        projectService.getProjectStrict.mockReturnValue(of({ writer: true } as Project));
        voteService.fetchVote.mockReturnValue(of(makeVote({ ...namedClosedVote(), status })));
        voteService.getMyVoteResponse.mockReturnValue(httpError(503));
        const fixture = await setup('browser', [VoteDetailHeaderComponent]);

        expect(read(fixture, 'showVoteDetails')).toBe(true);
        expect(testId(fixture, 'vote-detail-header-tabs')).not.toBeNull();
        expect(testId(fixture, 'vote-detail-description')).not.toBeNull();
        expect(fixture.nativeElement.querySelector('lfx-vote-detail-facts')).not.toBeNull();
        expect(voteService.getVoteResults).toHaveBeenCalledWith('vote-1');
      });
    });

    it('keeps the limited header pieces hidden while access is still loading', async () => {
      const myResponse = new Subject<MyVoteResponse | null>();
      voteService.getMyVoteResponse.mockReturnValue(myResponse);
      const fixture = await setup();

      expect(read(fixture, 'accessLoading')).toBe(true);
      expect(header(fixture).properties['limited']).toBe(true);

      myResponse.next(makeResponse(IndexedVoteResponseStatus.RESPONDED));
      myResponse.complete();
      TestBed.tick();
      fixture.detectChanges();

      expect(header(fixture).properties['limited']).toBe(false);
    });
  });

  describe('held pseudo-anonymous results (#3916)', () => {
    const heldResults = (): VoteResultsResponse => ({
      poll_results: [],
      comment_results: [],
      num_recipients: 4,
      num_votes_cast: 3,
      poll_end_time: '2026-10-30T16:00:00Z',
      results_held: true,
    });

    beforeEach(() => {
      projectService.getProjectStrict.mockReturnValue(of({ writer: true } as Project));
      voteService.fetchVote.mockReturnValue(of(makeVote({ pseudo_anonymity: true, allow_abstain: true })));
      voteService.getVoteResults.mockReturnValue(of(heldResults()));
    });

    it('shows the held panel on Overview, with no manager callout while the vote is open', async () => {
      const fixture = await setup();

      expect(read(fixture, 'resultsHeld')).toBe(true);
      expect(testId(fixture, 'vote-detail-results-held')?.textContent).toContain('Totals appear when voting closes');
      expect(testId(fixture, 'vote-detail-results-held')?.textContent).toContain('until voting closes on');
      expect(fixture.nativeElement.querySelector('lfx-vote-abstain-result')).toBeNull();
      expect(testId(fixture, 'vote-detail-results-empty')).toBeNull();
      expect(testId(fixture, 'vote-detail-overview-callout')).toBeNull();
    });

    it('keeps participation numbers but shows "—" for comments and drops the abstention count from the summary', async () => {
      const fixture = await setup();

      const cards = read<StatCardItem[]>(fixture, 'summaryCards');
      expect(cards).toHaveLength(3);
      expect(cards[0]).toMatchObject({ value: '3 / 4', label: 'Responded', subLine: '75% participation', action: 'responses' });
      expect(cards[1]).toMatchObject({ value: '—', label: 'Comments' });
      // Held comments have nowhere to go, but the participation-only Voters tab stays reachable.
      expect(cards[1].action).toBeUndefined();
      expect(cards[2]).toMatchObject({ value: 1 });
    });

    it('shows the held panel on Results, with the abstention stat held', async () => {
      queryParamMap.next(convertToParamMap({ tab: 'results' }));
      const fixture = await setup();

      expect(testId(fixture, 'vote-detail-results-held')).not.toBeNull();
      expect(fixture.nativeElement.querySelector('lfx-vote-option-results')).toBeNull();
      const card = fixture.debugElement.query(By.css('lfx-vote-participation-card'));
      expect(card.properties['abstainedHeld']).toBe(true);
      expect(card.properties['showAbstained']).toBe(true);
    });

    it('shows the held panel on Comments in place of the comment list', async () => {
      queryParamMap.next(convertToParamMap({ tab: 'comments' }));
      const fixture = await setup();

      expect(testId(fixture, 'vote-detail-comments-held')).not.toBeNull();
      expect(fixture.nativeElement.querySelector('lfx-vote-comment-results')).toBeNull();
    });

    it('shows the held panel, not "No votes", on an ended vote whose totals are still held', async () => {
      voteService.fetchVote.mockReturnValue(of(makeVote({ pseudo_anonymity: true, status: PollStatus.ENDED })));
      const fixture = await setup();

      expect(testId(fixture, 'vote-detail-results-held')?.textContent).toContain('Voting has closed');
      expect(testId(fixture, 'vote-detail-results-held')?.textContent).toContain('Totals are being finalized');
      expect(testId(fixture, 'vote-detail-results-held')?.textContent).not.toContain('Totals appear when voting closes');
      expect(testId(fixture, 'vote-detail-results-empty')).toBeNull();
      expect(read<{ value: string }>(fixture, 'resultsStatusTag').value).toBe('Totals pending');
      expect(testId(fixture, 'vote-detail-overview-callout')?.textContent).toContain('Totals and comments will appear once they are finalized.');
      expect(testId(fixture, 'vote-detail-overview-callout')?.textContent).not.toContain('Final results are available');
    });

    it.each(['creator', 'voter'] as const)('passes held and released results to the facts card for %s', async (audience) => {
      projectService.getProjectStrict.mockReturnValue(of({ writer: audience === 'creator' } as Project));
      voteService.fetchVote.mockReturnValue(of(makeVote({ pseudo_anonymity: true, status: PollStatus.ENDED })));
      voteService.getMyVoteResponse.mockReturnValue(of(makeResponse(IndexedVoteResponseStatus.RESPONDED)));
      const results = new Subject<VoteResultsResponse>();
      voteService.getVoteResults.mockReturnValue(results);
      const fixture = await setup();

      results.next(heldResults());
      TestBed.tick();
      fixture.detectChanges();
      expect(fixture.debugElement.query(By.css('lfx-vote-detail-facts')).properties['resultsHeld']).toBe(true);

      results.next(makeMethodResults());
      TestBed.tick();
      fixture.detectChanges();
      expect(fixture.debugElement.query(By.css('lfx-vote-detail-facts')).properties['resultsHeld']).toBe(false);
    });

    it('never reads 100% participation on an open held vote as final', async () => {
      voteService.getVoteResults.mockReturnValue(of({ ...heldResults(), num_votes_cast: 4 }));
      const fixture = await setup();

      expect(read<{ value: string }>(fixture, 'resultsStatusTag').value).toBe('Voting in progress');
    });
  });
});
