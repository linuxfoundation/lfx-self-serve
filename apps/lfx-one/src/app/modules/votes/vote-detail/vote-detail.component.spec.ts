// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgTemplateOutlet } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { NO_ERRORS_SCHEMA, PLATFORM_ID, REQUEST_CONTEXT, signal, Type } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap, ParamMap, Router } from '@angular/router';
import { ExpandableTextComponent } from '@components/expandable-text/expandable-text.component';
import { StatCardGridComponent } from '@components/stat-card-grid/stat-card-grid.component';
import { VOTE_DETAIL_RESULTS_FINALIZATION_MAX_ATTEMPTS, VOTE_DETAIL_RESULTS_POLL_OPTIONS } from '@lfx-one/shared/constants';
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
  VoteDetailTabOption,
  VoteResultsResponse,
} from '@lfx-one/shared/interfaces';
import { LinkifyHtmlPipe } from '@pipes/linkify-html.pipe';
import { VoteDescriptionPipe } from '../pipes/vote-description.pipe';
import { CommitteeService } from '@services/committee.service';
import { LensService } from '@services/lens.service';
import { ProjectService } from '@services/project.service';
import { VoteService } from '@services/vote.service';
import { UserService } from '@services/user.service';
import { ExternalLinksDirective } from '@shared/directives/external-links.directive';
import { voteSlideToast } from '@shared/utils/slide-export.util';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { BehaviorSubject, Observable, of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VoteAbstainResultComponent } from '../components/vote-abstain-result/vote-abstain-result.component';
import { VoteCommentItemComponent } from '../components/vote-comment-item/vote-comment-item.component';
import { VoteDetailFactsComponent } from '../components/vote-detail-facts/vote-detail-facts.component';
import { VoteDetailHeaderComponent } from '../components/vote-detail-header/vote-detail-header.component';
import { VoteOptionResultsComponent } from '../components/vote-option-results/vote-option-results.component';
import { VoteParticipationCardComponent } from '../components/vote-participation-card/vote-participation-card.component';
import { VoteRankedQuestionResultsComponent } from '../components/vote-ranked-question-results/vote-ranked-question-results.component';
import { VoteReminderDialogComponent } from '../components/vote-reminder-dialog/vote-reminder-dialog.component';
import { VoteVotersComponent } from '../components/vote-voters/vote-voters.component';
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
    getVote: ReturnType<typeof vi.fn>;
    updateMyResponse: ReturnType<typeof vi.fn>;
    getMyVoteResponse: ReturnType<typeof vi.fn>;
    getMyVoteBallot: ReturnType<typeof vi.fn>;
    getVoteResults: ReturnType<typeof vi.fn>;
    getReminderRecipients: ReturnType<typeof vi.fn>;
    getVoteVoters: ReturnType<typeof vi.fn>;
  };
  let projectService: { getProjectStrict: ReturnType<typeof vi.fn> };
  let committeeService: { fetchCommittee: ReturnType<typeof vi.fn> };
  let dialogService: { open: ReturnType<typeof vi.fn> };
  let messageService: { add: ReturnType<typeof vi.fn> };
  let router: { navigate: ReturnType<typeof vi.fn> };
  let paramMap: BehaviorSubject<ParamMap>;
  let queryParamMap: BehaviorSubject<ParamMap>;
  let reqContext: ServerRequestContext;
  const impersonating = signal(false);

  async function setup(platform: 'browser' | 'server' = 'browser', realImports: Type<unknown>[] = []): Promise<ComponentFixture<VoteDetailComponent>> {
    await TestBed.configureTestingModule({
      imports: [VoteDetailComponent],
      providers: [
        provideNoopAnimations(),
        { provide: VoteService, useValue: voteService },
        { provide: UserService, useValue: { impersonating } },
        { provide: ProjectService, useValue: projectService },
        { provide: CommitteeService, useValue: committeeService },
        { provide: Router, useValue: router },
        { provide: MessageService, useValue: messageService },
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
          imports: [NgTemplateOutlet, LinkifyHtmlPipe, VoteDescriptionPipe, ...realImports],
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
      getVote: vi.fn().mockReturnValue(of(makeVote())),
      updateMyResponse: vi.fn().mockReturnValue(of(undefined)),
      getMyVoteResponse: vi.fn().mockReturnValue(of(null)),
      getMyVoteBallot: vi.fn().mockReturnValue(of(null)),
      getVoteResults: vi.fn().mockReturnValue(of(makeResults())),
      getReminderRecipients: vi.fn().mockReturnValue(of([])),
      getVoteVoters: vi.fn().mockReturnValue(of([])),
    };
    projectService = { getProjectStrict: vi.fn().mockReturnValue(of({ writer: false } as Project)) };
    committeeService = { fetchCommittee: vi.fn().mockReturnValue(of({ writer: false })) };
    dialogService = { open: vi.fn() };
    messageService = { add: vi.fn() };
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

    it.each([
      ['voter, active', PollStatus.ACTIVE, false],
      ['voter, ended', PollStatus.ENDED, false],
      ['writer, active', PollStatus.ACTIVE, true],
      ['writer, ended', PollStatus.ENDED, true],
    ] as const)('preserves description whitespace and typography for the %s view (#4727)', async (_label, status, writer) => {
      const raw = '  First\n\n\n    - indented  bullet';
      voteService.fetchVote.mockReturnValue(of(makeVote({ status, description: raw })));
      projectService.getProjectStrict.mockReturnValue(of({ writer } as Project));
      voteService.getMyVoteResponse.mockReturnValue(of(makeResponse(IndexedVoteResponseStatus.RESPONDED)));
      const fixture = await setup();

      const description = testId(fixture, 'vote-detail-description')?.querySelector('div.prose');
      expect(description?.textContent).toBe(raw);
      expect(description?.classList.contains('prose')).toBe(true);
      expect(description?.querySelector('span.whitespace-pre-wrap')).toBeTruthy();
    });

    it('renders supported description HTML and strips unsafe content (#4727)', async () => {
      voteService.fetchVote.mockReturnValue(
        of(makeVote({ description: '<p>One</p><ul><li>A</li></ul><script>alert(1)</script><img src="x" onerror="alert(2)">' }))
      );
      voteService.getMyVoteResponse.mockReturnValue(of(makeResponse(IndexedVoteResponseStatus.RESPONDED)));
      const fixture = await setup();

      const description = testId(fixture, 'vote-detail-description')?.querySelector('div.prose');
      expect(description?.querySelector('p')?.textContent).toBe('One');
      expect(description?.querySelector('ul > li')?.textContent).toBe('A');
      expect(description?.querySelector('script')).toBeNull();
      expect(description?.innerHTML).not.toContain('onerror');
    });

    it('adds no description section for an empty description (#4727)', async () => {
      voteService.fetchVote.mockReturnValue(of(makeVote({ description: '' })));
      voteService.getMyVoteResponse.mockReturnValue(of(makeResponse(IndexedVoteResponseStatus.RESPONDED)));
      const fixture = await setup();

      expect(testId(fixture, 'vote-detail-description')).toBeNull();
    });

    it.each([
      { audience: 'manager', writer: true, response: null, html: '<p>Read the <a href="https://example.com/charter"><strong>charter</strong></a>.</p>' },
      {
        audience: 'voter',
        writer: false,
        response: makeResponse(IndexedVoteResponseStatus.RESPONDED),
        html: '<p>Read the <a href="https://example.com/charter"><strong>charter</strong></a>.</p>',
      },
      { audience: 'manager (plain URL)', writer: true, response: null, html: 'Read https://example.com/charter.' },
      { audience: 'voter (plain URL)', writer: false, response: makeResponse(IndexedVoteResponseStatus.RESPONDED), html: 'Read https://example.com/charter.' },
    ])('styles description links and opens them without leaving the $audience view (#4655)', async ({ writer, response, html }) => {
      voteService.fetchVote.mockReturnValue(of(makeVote({ description: html })));
      projectService.getProjectStrict.mockReturnValue(of({ writer } as Project));
      voteService.getMyVoteResponse.mockReturnValue(of(response));
      const fixture = await setup('browser', [ExternalLinksDirective]);
      const description = testId(fixture, 'vote-detail-description')!;
      const content = description.querySelector('[lfxExternalLinks]')!;
      const link = content.querySelector('a')!;
      const opened = vi.spyOn(window, 'open').mockReturnValue(null);

      try {
        expect(content.classList.contains('[&_a]:text-blue-600')).toBe(true);
        expect(content.classList.contains('[&_a]:underline')).toBe(true);

        const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
        (link.querySelector('strong') ?? link).dispatchEvent(event);

        expect(opened).toHaveBeenCalledExactlyOnceWith('https://example.com/charter', '_blank', 'noopener,noreferrer');
        expect(event.defaultPrevented).toBe(true);
        expect(read(fixture, 'activeTab')).toBe('overview');
        expect(testId(fixture, 'vote-detail-description')).toBe(description);
        expect(router.navigate).not.toHaveBeenCalled();
      } finally {
        opened.mockRestore();
      }
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

  describe.each([true, false])('ranked Results question positions (manager: %s)', (manager) => {
    it.each([1, 2])('renders %i full question headings and keeps vote-level totals separate', async (questionCount) => {
      queryParamMap.next(convertToParamMap({ tab: 'results' }));
      projectService.getProjectStrict.mockReturnValue(of({ writer: manager } as Project));
      voteService.fetchVote.mockReturnValue(
        of(makeVote({ poll_type: PollType.CONDORCET_IRV, status: PollStatus.ENDED, allow_abstain: true, pseudo_anonymity: false }))
      );
      voteService.getMyVoteResponse.mockReturnValue(of(makeResponse(IndexedVoteResponseStatus.RESPONDED)));
      const results = makeMethodResults();
      results.num_abstained = 1;
      results.poll_results = Array.from({ length: questionCount }, (_, index) => ({
        ...results.poll_results[0],
        question: { ...results.poll_results[0].question, question_id: `question-${index + 1}`, prompt: `Rank the synthetic proposals for group ${index + 1}` },
      }));
      voteService.getVoteResults.mockReturnValue(of(results));
      const fixture = await setup('browser', [VoteRankedQuestionResultsComponent, VoteParticipationCardComponent, VoteAbstainResultComponent]);
      await fixture.whenStable();

      const questions = fixture.debugElement.queryAll(By.directive(VoteRankedQuestionResultsComponent));
      expect(questions).toHaveLength(questionCount);
      questions.forEach((question, index) => {
        const prompt = results.poll_results[index].question.prompt;
        const heading = question.nativeElement.querySelector('h4') as HTMLElement;
        expect(heading.textContent?.replace(/\s+/g, ' ').trim()).toBe(`${questionCount > 1 ? `Q${index + 1}. ` : ''}${prompt}`);
        expect((question.componentInstance as VoteRankedQuestionResultsComponent).question().prompt).toBe(prompt);
        expect(question.nativeElement.querySelector('lfx-vote-abstain-result')).toBeNull();
        expect(question.nativeElement.querySelector('lfx-vote-participation-card')).toBeNull();
      });
      const abstain = testId(fixture, 'vote-detail-option-abstain')!;
      expect(fixture.debugElement.queryAll(By.directive(VoteAbstainResultComponent))).toHaveLength(1);
      expect(abstain.textContent).toContain('1');
      expect(questions.at(-1)!.nativeElement.compareDocumentPosition(abstain) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      const participation = fixture.debugElement.queryAll(By.directive(VoteParticipationCardComponent));
      expect(participation).toHaveLength(manager ? 1 : 0);
      if (manager) {
        expect(participation[0].nativeElement.compareDocumentPosition(questions[0].nativeElement) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      }
      expect(read(fixture, 'participationStats')).toMatchObject({ totalResponses: 3, abstainedVoters: 1 });
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

      expect(read<StatCardItem[]>(fixture, 'summaryCards')[2].value).toBe('—');

      results.next(makeResults());
      TestBed.tick();
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

    it('keeps the manager page focused on results without loading a personal ballot', async () => {
      projectService.getProjectStrict.mockReturnValue(of({ writer: true } as Project));
      voteService.getMyVoteResponse.mockReturnValue(of(makeResponse(IndexedVoteResponseStatus.RESPONDED)));
      const fixture = await setup();

      expect(read(fixture, 'audience')).toBe('creator');
      expect(voteService.getMyVoteBallot).not.toHaveBeenCalled();
      expect(testId(fixture, 'vote-detail-overview-results')).not.toBeNull();
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

  it.each([false, true])('never offers ballot-changing controls on the vote page (manager %s)', async (manager) => {
    projectService.getProjectStrict.mockReturnValue(of({ writer: manager } as Project));
    voteService.fetchVote.mockReturnValue(of(makeVote({ allow_vote_change: true })));
    voteService.getMyVoteResponse.mockReturnValue(of(makeResponse(IndexedVoteResponseStatus.RESPONDED)));
    const fixture = await setup();

    expect(testId(fixture, 'vote-detail-manager-ballot')).toBeNull();
    expect(testId(fixture, 'vote-detail-manager-change-vote')).toBeNull();
    expect(testId(fixture, 'vote-detail-voter-change-vote')).toBeNull();
    expect(read(fixture, 'castDrawerVisible')).toBe(false);
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
      expect(testId(fixture, 'vote-detail-overview-callout')).toBeNull();
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
      expect(testId(fixture, 'vote-detail-overview-callout')).toBeNull();
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

      fixture.debugElement.query(By.css('lfx-vote-detail-header')).triggerEventHandler('sendReminder');

      expect(dialogService.open).toHaveBeenCalledWith(VoteReminderDialogComponent, expect.objectContaining({ data: { vote: makeVote() } }));
    });

    it.each([false, true])('refreshes the voter list after a successful header reminder (pseudo-anonymous: %s)', async (pseudoAnonymity) => {
      projectService.getProjectStrict.mockReturnValue(of({ writer: true } as Project));
      voteService.fetchVote.mockReturnValue(of(makeVote({ pseudo_anonymity: pseudoAnonymity })));
      queryParamMap.next(convertToParamMap({ tab: 'voters' }));
      const closed = new Subject<unknown>();
      dialogService.open.mockReturnValue({ onClose: closed });
      const fixture = await setup('browser', [VoteVotersComponent]);
      expect(voteService.getVoteVoters).toHaveBeenCalledTimes(1);

      fixture.debugElement.query(By.css('lfx-vote-detail-header')).triggerEventHandler('sendReminder');
      closed.next(true);
      TestBed.tick();

      expect(voteService.getVoteVoters).toHaveBeenCalledTimes(2);
      expect(voteService.getVoteVoters).toHaveBeenLastCalledWith('vote-1');
      closed.next(true);
      TestBed.tick();
      expect(voteService.getVoteVoters).toHaveBeenCalledTimes(2);
    });

    it.each([false, undefined, 'true'])('does not refresh the voter list when the reminder closes with %s', async (result) => {
      projectService.getProjectStrict.mockReturnValue(of({ writer: true } as Project));
      queryParamMap.next(convertToParamMap({ tab: 'voters' }));
      const closed = new Subject<unknown>();
      dialogService.open.mockReturnValue({ onClose: closed });
      const fixture = await setup('browser', [VoteVotersComponent]);

      call(fixture, 'onSendReminder');
      closed.next(result);
      TestBed.tick();

      expect(voteService.getVoteVoters).toHaveBeenCalledTimes(1);
      closed.next(true);
      TestBed.tick();
      expect(voteService.getVoteVoters).toHaveBeenCalledTimes(1);
    });

    it('ignores a reminder completion after navigating to a different vote', async () => {
      projectService.getProjectStrict.mockReturnValue(of({ writer: true } as Project));
      voteService.fetchVote.mockImplementation((uid: string) => of(makeVote({ uid })));
      queryParamMap.next(convertToParamMap({ tab: 'voters' }));
      const closed = new Subject<unknown>();
      dialogService.open.mockReturnValue({ onClose: closed });
      const fixture = await setup('browser', [VoteVotersComponent]);

      call(fixture, 'onSendReminder');
      paramMap.next(convertToParamMap({ id: 'vote-2' }));
      TestBed.tick();
      expect(voteService.getVoteVoters).toHaveBeenLastCalledWith('vote-2');
      const requestCount = voteService.getVoteVoters.mock.calls.length;
      closed.next(true);
      TestBed.tick();

      expect(voteService.getVoteVoters).toHaveBeenCalledTimes(requestCount);
    });

    it('unsubscribes from reminder completion when the page is destroyed', async () => {
      projectService.getProjectStrict.mockReturnValue(of({ writer: true } as Project));
      const closed = new Subject<unknown>();
      dialogService.open.mockReturnValue({ onClose: closed });
      const fixture = await setup();

      call(fixture, 'onSendReminder');
      expect(closed.observed).toBe(true);
      fixture.destroy();

      expect(closed.observed).toBe(false);
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

  describe('manager actions: Present, Copy slide and Send ballots (#4441, #4363)', () => {
    it.each([
      [PollStatus.ACTIVE, true, true, true],
      [PollStatus.ENDED, true, true, false],
      [PollStatus.DISABLED, true, false, false],
      [PollStatus.ACTIVE, false, false, false],
    ])('for a %s vote, manager=%s: canPresent=%s, canSendBallots=%s', async (status, manager, canPresent, canSendBallots) => {
      projectService.getProjectStrict.mockReturnValue(of({ writer: manager } as Project));
      voteService.fetchVote.mockReturnValue(of(makeVote({ status })));
      const fixture = await setup();

      expect(read(fixture, 'canPresent')).toBe(canPresent);
      expect(read(fixture, 'canSendBallots')).toBe(canSendBallots);
      const header = fixture.debugElement.query(By.css('lfx-vote-detail-header'));
      expect(header.properties['canPresent']).toBe(canPresent);
      expect(header.properties['canSendBallots']).toBe(canSendBallots);
    });

    it('renders the off-screen slide artboard only for a manager who can present', async () => {
      projectService.getProjectStrict.mockReturnValue(of({ writer: true } as Project));
      const manager = await setup();
      expect(manager.nativeElement.querySelector('lfx-share-slide')).not.toBeNull();
      TestBed.resetTestingModule();

      projectService.getProjectStrict.mockReturnValue(of({ writer: false } as Project));
      const voter = await setup();
      expect(voter.nativeElement.querySelector('lfx-share-slide')).toBeNull();
    });

    it('opens the presenter for this vote in a new tab, without an opener', async () => {
      projectService.getProjectStrict.mockReturnValue(of({ writer: true } as Project));
      const open = vi.spyOn(window, 'open').mockReturnValue(null);
      try {
        const fixture = await setup();
        call(fixture, 'onPresent');

        expect(open).toHaveBeenCalledWith('/votes/vote-1/present', '_blank', 'noopener,noreferrer');
      } finally {
        open.mockRestore();
      }
    });

    it('reports a failed slide export as a toast and frees the button', async () => {
      projectService.getProjectStrict.mockReturnValue(of({ writer: true } as Project));
      const fixture = await setup();

      // The off-screen artboard is stubbed here (no real lfx-share-slide), so the QR never reports ready.
      await (fixture.componentInstance as unknown as { onCopySlide: () => Promise<void> }).onCopySlide();

      expect(messageService.add).toHaveBeenCalledWith(voteSlideToast('failed'));
      expect(read(fixture, 'slideBusy')).toBe(false);
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

    const notVotedCard = (fixture: ComponentFixture<VoteDetailComponent>): StatCardItem => read<StatCardItem[]>(fixture, 'summaryCards')[2];

    it('keeps Responded and Comments clickable and offers only View voters on the Not voted card', async () => {
      const fixture = await setup();

      expect(cardActions(fixture)).toEqual(['responses', 'comments', undefined]);
      expect(notVotedCard(fixture).ctas).toEqual([{ label: 'View voters', action: 'responses', text: true }]);
    });

    it('uses the darker caption class on every tile', async () => {
      const fixture = await setup();

      expect(read<StatCardItem[]>(fixture, 'summaryCards').map((card) => card.subLineClass)).toEqual(['text-gray-600', 'text-gray-600', 'text-gray-600']);
    });

    it('states what the Comments figure counts', async () => {
      const fixture = await setup();

      expect(read<StatCardItem[]>(fixture, 'summaryCards')[1].subLine).toBe('Written comments left by voters');
    });

    it('shows a participation bar that separates abstentions', async () => {
      voteService.getVoteResults.mockReturnValue(of({ ...makeResults(), num_abstained: 1 }));
      const fixture = await setup();

      expect(read<StatCardItem[]>(fixture, 'summaryCards')[0].progress).toEqual({
        segments: [
          { percentage: 50, className: 'bg-blue-600' },
          { percentage: 25, className: 'bg-gray-800' },
        ],
        ariaLabel: '2 voted, 1 abstained, 1 not voted yet of 4 eligible voters',
      });
    });

    it.each([
      { recipients: 5, responses: 2, abstained: 7, widths: ['0%', '40%'], label: '0 voted, 2 abstained, 3 not voted yet of 5 eligible voters' },
      { recipients: 5, responses: 8, abstained: 2, widths: ['60%', '40%'], label: '3 voted, 2 abstained, 0 not voted yet of 5 eligible voters' },
      { recipients: 0, responses: 3, abstained: 7, widths: ['0%', '0%'], label: '0 voted, 0 abstained, 0 not voted yet of 0 eligible voters' },
      { recipients: 5, responses: -2, abstained: 1, widths: ['0%', '0%'], label: '0 voted, 0 abstained, 5 not voted yet of 5 eligible voters' },
      { recipients: 5, responses: 2, abstained: -1, widths: ['40%', '0%'], label: '2 voted, 0 abstained, 3 not voted yet of 5 eligible voters' },
    ])(
      'keeps the progress label consistent with bounded counts ($recipients eligible, $responses responses, $abstained abstained)',
      async ({ recipients, responses, abstained, widths, label }) => {
        voteService.getVoteResults.mockReturnValue(of({ ...makeResults(), num_recipients: recipients, num_votes_cast: responses, num_abstained: abstained }));
        const fixture = await setup('browser', [StatCardGridComponent]);
        const bar = fixture.nativeElement.querySelector('[data-testid="vote-detail-summary"] [role="img"]') as HTMLElement;

        expect(bar.getAttribute('aria-label')).toBe(label);
        expect(Array.from(bar.children, (segment) => (segment as HTMLElement).style.width)).toEqual(widths);
      }
    );

    it.each([
      { recipients: 5, responses: 8, percentage: '100%', label: '5 of 5 eligible voters responded; abstention totals are withheld' },
      { recipients: 0, responses: 3, percentage: '0%', label: '0 of 0 eligible voters responded; abstention totals are withheld' },
    ])(
      'bounds held-results labels without revealing abstentions ($recipients eligible, $responses responses)',
      async ({ recipients, responses, percentage, label }) => {
        voteService.fetchVote.mockReturnValue(of(makeVote({ pseudo_anonymity: true })));
        voteService.getVoteResults.mockReturnValue(
          of({ ...makeResults(), num_recipients: recipients, num_votes_cast: responses, num_abstained: 7, results_held: true })
        );
        const fixture = await setup('browser', [StatCardGridComponent]);
        const bar = fixture.nativeElement.querySelector('[data-testid="vote-detail-summary"] [role="img"]') as HTMLElement;

        expect(bar.getAttribute('aria-label')).toBe(label);
        expect(bar.children).toHaveLength(1);
        expect((bar.firstElementChild as HTMLElement).style.width).toBe(percentage);
      }
    );

    it('keeps View voters but offers no reminder once everyone has voted', async () => {
      voteService.getVoteResults.mockReturnValue(of({ ...makeResults(), num_votes_cast: 4 }));
      const fixture = await setup('browser', [StatCardGridComponent]);

      expect(notVotedCard(fixture)).toMatchObject({ value: 0, subLine: 'Everyone has voted' });
      expect(notVotedCard(fixture).ctas).toEqual([{ label: 'View voters', action: 'responses', text: true }]);
      expect(fixture.nativeElement.querySelector('[data-testid="stat-card-cta-not-voted"]')).toBeNull();

      fixture.nativeElement.querySelector('[data-testid="stat-card-cta-responses"] button').click();

      expect(router.navigate).toHaveBeenLastCalledWith(
        [],
        expect.objectContaining({ queryParams: { tab: 'voters', voters_choice: null, voters_ballot: null } })
      );
      expect(dialogService.open).not.toHaveBeenCalled();
    });

    it('distinguishes no eligible voters from everyone having voted', async () => {
      voteService.fetchVote.mockReturnValue(of(makeVote({ total_voting_request_invitations: 0 })));
      voteService.getVoteResults.mockReturnValue(of({ ...makeResults(), num_recipients: 0, num_votes_cast: 0 }));
      const fixture = await setup('browser', [StatCardGridComponent]);

      expect(notVotedCard(fixture)).toMatchObject({ value: 0, subLine: 'No eligible voters' });
      expect(notVotedCard(fixture).ctas).toEqual([{ label: 'View voters', action: 'responses', text: true }]);
      expect(fixture.nativeElement.querySelector('[data-testid="vote-detail-summary"]').textContent).toContain('No eligible voters');
      expect(fixture.nativeElement.querySelector('[data-testid="stat-card-cta-not-voted"]')).toBeNull();

      fixture.nativeElement.querySelector('[data-testid="stat-card-cta-responses"] button').click();

      expect(router.navigate).toHaveBeenLastCalledWith(
        [],
        expect.objectContaining({ queryParams: { tab: 'voters', voters_choice: null, voters_ballot: null } })
      );
      expect(dialogService.open).not.toHaveBeenCalled();
    });

    it('shows no Not voted buttons on a draft vote', async () => {
      voteService.fetchVote.mockReturnValue(of(makeVote({ status: PollStatus.DISABLED })));
      const fixture = await setup();

      expect(notVotedCard(fixture).ctas).toBeUndefined();
    });

    it('keeps the Not voted card non-clickable without a reminder shortcut', async () => {
      const fixture = await setup('browser', [StatCardGridComponent]);
      const card = testId(fixture, 'stat-card-Not voted yet')!;

      expect(card.tagName).toBe('DIV');
      expect(card.textContent).toContain('1');
      expect(card.textContent).toContain('Eligible for a reminder');
      expect(card.textContent).not.toContain('Send reminder');
      expect(testId(fixture, 'stat-card-cta-not-voted')).toBeNull();

      card.click();
      clickCard(fixture, 'not-voted');

      expect(dialogService.open).not.toHaveBeenCalled();
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

    it('opens the Voters tab from the View voters button', async () => {
      const fixture = await setup('browser', [StatCardGridComponent]);

      fixture.nativeElement.querySelector('[data-testid="stat-card-cta-responses"] button').click();

      expect(router.navigate).toHaveBeenLastCalledWith(
        [],
        expect.objectContaining({ queryParams: { tab: 'voters', voters_choice: null, voters_ballot: null } })
      );
      expect(dialogService.open).not.toHaveBeenCalled();
    });

    it('offers only View voters on the Not voted card once the vote has ended', async () => {
      voteService.fetchVote.mockReturnValue(of(makeVote({ status: PollStatus.ENDED })));
      const fixture = await setup();

      expect(cardActions(fixture)).toEqual(['responses', 'comments', undefined]);
      expect(notVotedCard(fixture).ctas).toEqual([{ label: 'View voters', action: 'responses', text: true }]);
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

    it('resets comment expansion for a new vote even when its prompt ID matches', async () => {
      projectService.getProjectStrict.mockReturnValue(of({ writer: true } as Project));
      voteService.fetchVote.mockImplementation((id: string) => of(makeVote({ uid: id })));
      queryParamMap.next(convertToParamMap({ tab: 'comments' }));
      const fixture = await setup();
      const commentList = fixture.debugElement.query(By.css('lfx-vote-comment-results'));
      commentList.triggerEventHandler('expansionStateChange', new Map([['prompt-1', false]]));
      TestBed.tick();
      expect(read<Map<string, boolean>>(fixture, 'commentExpansionState').size).toBe(1);

      paramMap.next(convertToParamMap({ id: 'vote-2' }));
      TestBed.tick();

      expect(read<Map<string, boolean>>(fixture, 'commentExpansionState').size).toBe(0);
      expect(fixture.debugElement.query(By.css('lfx-vote-comment-results')).properties['expansionState']).toEqual(new Map());
    });

    it('preserves comment expansion across tab switches and a same-vote refresh', async () => {
      projectService.getProjectStrict.mockReturnValue(of({ writer: true } as Project));
      queryParamMap.next(convertToParamMap({ tab: 'comments' }));
      const fixture = await setup();
      const expansion = new Map([['prompt-1', false]]);
      fixture.debugElement.query(By.css('lfx-vote-comment-results')).triggerEventHandler('expansionStateChange', expansion);
      TestBed.tick();

      queryParamMap.next(convertToParamMap({ tab: 'results' }));
      TestBed.tick();
      queryParamMap.next(convertToParamMap({ tab: 'comments' }));
      TestBed.tick();
      expect(read(fixture, 'commentExpansionState')).toEqual(expansion);
      expect(fixture.debugElement.query(By.css('lfx-vote-comment-results')).properties['expansionState']).toEqual(expansion);

      call(fixture, 'onVoteSubmitted', 'vote-1');
      TestBed.tick();
      expect(read(fixture, 'commentExpansionState')).toEqual(expansion);
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

    it('re-arms the drawer auto-open when the route returns to an awaiting vote', async () => {
      voteService.fetchVote.mockImplementation((id: string) => of(makeVote({ uid: id })));
      voteService.getMyVoteResponse
        .mockReturnValueOnce(of(makeResponse(IndexedVoteResponseStatus.AWAITING_RESPONSE)))
        .mockReturnValueOnce(of(null))
        .mockReturnValueOnce(of(makeResponse(IndexedVoteResponseStatus.AWAITING_RESPONSE)));
      const fixture = await setup();
      expect(read(fixture, 'castDrawerVisible')).toBe(true);

      paramMap.next(convertToParamMap({ id: 'vote-2' }));
      TestBed.tick();
      expect(read(fixture, 'castDrawerVisible')).toBe(false);

      paramMap.next(convertToParamMap({ id: 'vote-1' }));
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
      expect(testId(fixture, 'vote-detail-overview-comment-prompt')).toBeNull();
      expect(rendered[0].querySelector('[data-testid="vote-results-comment-meta"]')?.textContent).toContain('Synthetic Voter r-4');
      expect(testId(fixture, 'vote-detail-overview-all-comments')).not.toBeNull();

      testId(fixture, 'vote-results-comment-view-ballot-r-4')!.querySelector('button')!.click();
      expect(router.navigate).toHaveBeenLastCalledWith(
        [],
        expect.objectContaining({ queryParams: { tab: 'voters', voters_choice: null, voters_ballot: 'r-4' } })
      );
    });

    it.each([
      { viewer: 'manager', anonymous: false },
      { viewer: 'manager', anonymous: true },
      { viewer: 'voter', anonymous: false },
    ])('shows the single comment question once below the heading for a $viewer (anonymous: $anonymous)', async ({ viewer, anonymous }) => {
      projectService.getProjectStrict.mockReturnValue(of({ writer: viewer === 'manager' } as Project));
      voteService.fetchVote.mockReturnValue(of(makeVote({ status: PollStatus.ENDED, pseudo_anonymity: anonymous, poll_comment_prompts: [prompts[0]] })));
      voteService.getMyVoteResponse.mockReturnValue(of(makeResponse(IndexedVoteResponseStatus.RESPONDED)));
      voteService.getVoteResults.mockReturnValue(
        of({ ...makeResults(), comment_results: [{ prompt: prompts[0], responses: [named('r-1', 22), named('r-2', 21)] }] })
      );
      const fixture = await setup('browser', [VoteCommentItemComponent]);

      const prompt = testId(fixture, 'vote-detail-overview-comment-prompt');
      expect(prompt?.textContent?.trim()).toBe('Any concerns?');
      expect(prompt?.previousElementSibling?.querySelector('h2')?.textContent).toBe('What voters are saying');
      expect(prompt?.nextElementSibling?.querySelectorAll('lfx-vote-comment-item')).toHaveLength(2);
      expect(items(fixture)).toHaveLength(2);
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

    describe('count badges (#4768)', () => {
      const tabFor = (fixture: ComponentFixture<VoteDetailComponent>, key: VoteDetailTabOption['key']): VoteDetailTabOption | undefined =>
        read<readonly VoteDetailTabOption[]>(fixture, 'tabs').find((tab) => tab.key === key);
      const twoComments = (): PollCommentResult[] => [
        {
          prompt: { prompt_id: 'prompt-1', prompt: 'Any concerns?' },
          responses: [
            { vote_id: 'response-1', comment_text: 'First synthetic comment', vote_creation_time: '2026-10-20T12:00:00Z', abstained: false },
            { vote_id: 'response-2', comment_text: 'Second synthetic comment', vote_creation_time: '2026-10-21T12:00:00Z', abstained: false },
          ],
        },
      ];

      beforeEach(() => {
        projectService.getProjectStrict.mockReturnValue(of({ writer: true } as Project));
      });

      it('counts the comments once results load and the invited voters', async () => {
        voteService.fetchVote.mockReturnValue(of(makeVote({ total_voting_request_invitations: 12 })));
        voteService.getVoteResults.mockReturnValue(of({ ...makeResults(), comment_results: twoComments() }));
        const fixture = await setup();

        expect(tabFor(fixture, 'comments')).toEqual(expect.objectContaining({ count: 2, countLabel: '2 comments' }));
        expect(tabFor(fixture, 'voters')).toEqual(expect.objectContaining({ count: 12, countLabel: '12 invited voters' }));
        expect(tabFor(fixture, 'overview')?.count).toBeUndefined();
        expect(tabFor(fixture, 'results')?.count).toBeUndefined();
      });

      it('uses singular screen-reader text for one comment and one invited voter', async () => {
        voteService.fetchVote.mockReturnValue(of(makeVote({ total_voting_request_invitations: 1 })));
        voteService.getVoteResults.mockReturnValue(
          of({ ...makeResults(), comment_results: [{ ...twoComments()[0], responses: twoComments()[0].responses.slice(0, 1) }] })
        );
        const fixture = await setup();

        expect(tabFor(fixture, 'comments')?.countLabel).toBe('1 comment');
        expect(tabFor(fixture, 'voters')?.countLabel).toBe('1 invited voter');
      });

      it('shows no badge for zero comments or a zero invited count', async () => {
        voteService.fetchVote.mockReturnValue(of(makeVote({ total_voting_request_invitations: 0 })));
        voteService.getVoteResults.mockReturnValue(of(makeResults()));
        const fixture = await setup();

        expect(tabFor(fixture, 'comments')?.count).toBeUndefined();
        expect(tabFor(fixture, 'voters')?.count).toBeUndefined();
      });

      it('shows no Voters badge when the invited count is missing', async () => {
        voteService.fetchVote.mockReturnValue(of(makeVote()));
        const fixture = await setup();

        expect(tabFor(fixture, 'voters')).toBeDefined();
        expect(tabFor(fixture, 'voters')?.count).toBeUndefined();
        expect(tabFor(fixture, 'voters')?.countLabel).toBeUndefined();
      });

      it('shows no Comments badge while results are loading', async () => {
        voteService.fetchVote.mockReturnValue(of(makeVote({ total_voting_request_invitations: 12 })));
        voteService.getVoteResults.mockReturnValue(new Subject<VoteResultsResponse>());
        const fixture = await setup();

        expect(tabFor(fixture, 'comments')?.count).toBeUndefined();
        expect(tabFor(fixture, 'voters')?.count).toBe(12);
      });

      it('shows no Comments badge when the results request fails', async () => {
        voteService.fetchVote.mockReturnValue(of(makeVote({ total_voting_request_invitations: 12 })));
        voteService.getVoteResults.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
        const fixture = await setup();

        expect(tabFor(fixture, 'comments')?.count).toBeUndefined();
      });

      it('hides the Comments badge while pseudo-anonymous comments are held', async () => {
        voteService.fetchVote.mockReturnValue(of(makeVote({ pseudo_anonymity: true, total_voting_request_invitations: 12 })));
        voteService.getVoteResults.mockReturnValue(of({ ...makeResults(), comment_results: twoComments(), results_held: true }));
        const fixture = await setup();

        expect(read(fixture, 'resultsHeld')).toBe(true);
        expect(tabFor(fixture, 'comments')?.count).toBeUndefined();
        expect(tabFor(fixture, 'voters')?.count).toBe(12);
      });
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
      expect(read<StatCardItem[]>(fixture, 'summaryCards').find((card) => card.label === 'Comments')?.subLine).toBe('Written comments left by voters');
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

    describe('Overview comment rows (#4771)', () => {
      const overviewComments: PollCommentResult[] = [
        {
          prompt: { prompt_id: 'result-prompt', prompt: 'Any concerns?' },
          responses: [{ vote_id: 'response-1', comment_text: 'Synthetic row comment', vote_creation_time: '2026-10-20T12:00:00Z', abstained: false }],
        },
      ];
      const rowItems = (fixture: ComponentFixture<VoteDetailComponent>) =>
        fixture.debugElement.queryAll(By.css('[data-testid="vote-detail-overview-comment"] lfx-vote-comment-item'));

      it('makes rows open the ballot for a manager on a named vote', async () => {
        projectService.getProjectStrict.mockReturnValue(of({ writer: true } as Project));
        voteService.fetchVote.mockReturnValue(of(makeVote({ pseudo_anonymity: false, poll_comment_prompts: [] })));
        voteService.getVoteResults.mockReturnValue(of({ ...makeResults(), comment_results: overviewComments }));
        const fixture = await setup();

        const items = rowItems(fixture);
        expect(items).toHaveLength(1);
        expect(items[0].attributes['linkStyle']).toBe('row');
        expect(items[0].properties['showBallotLink']).toBe(true);
        expect(items[0].properties['anonymous']).toBe(false);
        items[0].triggerEventHandler('viewBallot', 'response-1');
        expect(router.navigate).toHaveBeenLastCalledWith(
          [],
          expect.objectContaining({ queryParams: expect.objectContaining({ tab: 'voters', voters_ballot: 'response-1' }) })
        );
      });

      it('keeps rows inert and anonymous on a pseudo-anonymous vote', async () => {
        projectService.getProjectStrict.mockReturnValue(of({ writer: true } as Project));
        voteService.fetchVote.mockReturnValue(of(makeVote({ pseudo_anonymity: true, poll_comment_prompts: [] })));
        voteService.getVoteResults.mockReturnValue(of({ ...makeResults(), comment_results: overviewComments }));
        const fixture = await setup();

        const items = rowItems(fixture);
        expect(items).toHaveLength(1);
        expect(items[0].properties['showBallotLink']).toBe(false);
        expect(items[0].properties['anonymous']).toBe(true);
        items[0].triggerEventHandler('viewBallot', 'response-1');
        expect(router.navigate).not.toHaveBeenCalled();
      });
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
      expect(content?.classList.contains('lg:col-span-2')).toBe(false);
      expect(content?.parentElement?.classList.contains('lg:grid-cols-3')).toBe(false);
      expect(testId(fixture, 'vote-detail-description')).toBeNull();
      expect(testId(fixture, 'vote-detail-summary')).toBeNull();
      expect(fixture.nativeElement.querySelector('lfx-vote-comment-results')).toBeNull();
      expect(voteService.getVoteResults).not.toHaveBeenCalled();
    });

    it.each([null, makeResponse(IndexedVoteResponseStatus.RESPONDED, { voter_removed: true })])(
      'hides all non-basic metadata in the real header and Vote details for outsider response %j',
      async (response) => {
        voteService.fetchVote.mockReturnValue(of(namedClosedVote()));
        voteService.getMyVoteResponse.mockReturnValue(of(response));
        queryParamMap.next(convertToParamMap({ tab: 'comments' }));
        const fixture = await setup('browser', [VoteDetailHeaderComponent, VoteDetailFactsComponent]);

        expect(testId(fixture, 'vote-detail-header-title')?.textContent).toContain('Synthetic board election');
        expect(testId(fixture, 'vote-detail-header-status')?.textContent).toContain('Ended');
        for (const suffix of ['privacy', 'group', 'method', 'close-date', 'ended-early', 'invited', 'created', 'comments', 'view-results', 'tabs']) {
          expect(testId(fixture, `vote-detail-header-${suffix}`)).toBeNull();
        }
        expect(fixture.nativeElement.querySelector('[data-testid^="vote-detail-facts"]')).toBeNull();
        expect(testId(fixture, response ? 'vote-detail-voter-access-denied' : 'vote-detail-voter-not-participant')).not.toBeNull();
        expect(voteService.getVoteResults).not.toHaveBeenCalled();
      }
    );

    describe.each([PollStatus.ACTIVE, PollStatus.ENDED])('participation lookup failure on a %s vote', (status) => {
      it.each([0, 503])('keeps non-basic details hidden after a %i failure', async (failureStatus) => {
        voteService.fetchVote.mockReturnValue(of(makeVote({ ...namedClosedVote(), status, total_voting_request_invitations: 12 })));
        voteService.getMyVoteResponse.mockReturnValue(httpError(failureStatus));
        queryParamMap.next(convertToParamMap({ tab: 'comments' }));
        const fixture = await setup('browser', [VoteDetailHeaderComponent, VoteDetailFactsComponent]);

        expect(read(fixture, 'accessLoading')).toBe(false);
        expect(read(fixture, 'myResponseError')).toBe(true);
        expect(read(fixture, 'isOutsider')).toBe(false);
        expect(read(fixture, 'showVoteDetails')).toBe(false);
        expect(testId(fixture, 'vote-detail-voter-my-response-error')).not.toBeNull();
        expect(testId(fixture, 'vote-detail-header-title')?.textContent).toContain('Synthetic board election');
        expect(testId(fixture, 'vote-detail-header-status')).not.toBeNull();
        for (const suffix of ['privacy', 'group', 'method', 'close-date', 'ended-early', 'invited', 'created', 'comments', 'view-results', 'tabs']) {
          expect(testId(fixture, `vote-detail-header-${suffix}`)).toBeNull();
        }
        expect(read<{ key: string }[]>(fixture, 'tabs').map((tab) => tab.key)).toEqual(['overview']);
        expect(read(fixture, 'activeTab')).toBe('overview');
        const content = testId(fixture, 'vote-detail-panel-overview');
        expect(content?.hasAttribute('role')).toBe(false);
        expect(content?.hasAttribute('aria-labelledby')).toBe(false);
        expect(content?.classList.contains('lg:col-span-2')).toBe(false);
        expect(content?.parentElement?.classList.contains('lg:grid-cols-3')).toBe(false);
        expect(testId(fixture, 'vote-detail-description')).toBeNull();
        expect(fixture.nativeElement.querySelector('lfx-vote-detail-facts')).toBeNull();
        expect(fixture.nativeElement.textContent).not.toContain('12 invited voters');
        expect(fixture.nativeElement.querySelector('lfx-vote-comment-results')).toBeNull();
        expect(voteService.getVoteResults).not.toHaveBeenCalled();
      });

      it('keeps a verified manager view when the personal response lookup fails', async () => {
        projectService.getProjectStrict.mockReturnValue(of({ writer: true } as Project));
        voteService.fetchVote.mockReturnValue(of(makeVote({ ...namedClosedVote(), status })));
        voteService.getMyVoteResponse.mockReturnValue(httpError(503));
        const fixture = await setup('browser', [VoteDetailHeaderComponent, VoteDetailFactsComponent]);

        expect(read(fixture, 'showVoteDetails')).toBe(true);
        expect(testId(fixture, 'vote-detail-header-tabs')).not.toBeNull();
        expect(testId(fixture, 'vote-detail-description')).not.toBeNull();
        expect(fixture.nativeElement.querySelector('lfx-vote-detail-facts')).not.toBeNull();
        expect(testId(fixture, 'vote-detail-facts-close-date')).not.toBeNull();
        expect(testId(fixture, 'vote-detail-header-meta')).toBeNull();
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

    it('renders no vote metadata in the real header or Vote details while access is still loading', async () => {
      const myResponse = new Subject<MyVoteResponse | null>();
      voteService.fetchVote.mockReturnValue(of(makeVote({ committee_name: 'Synthetic Steering Committee', total_voting_request_invitations: 12 })));
      voteService.getMyVoteResponse.mockReturnValue(myResponse);
      const fixture = await setup('browser', [VoteDetailHeaderComponent, VoteDetailFactsComponent]);

      expect(read(fixture, 'accessLoading')).toBe(true);
      expect(fixture.nativeElement.querySelector('[data-testid^="vote-detail-facts"]')).toBeNull();
      expect(testId(fixture, 'vote-detail-header-meta')).toBeNull();
      expect(fixture.nativeElement.textContent).not.toContain('Synthetic Steering Committee');
      expect(fixture.nativeElement.textContent).not.toContain('12 invited voters');
    });

    // Group, method, close date, countdown, invited voters and the counts appear only in Vote details (#5022).
    it.each([
      { label: 'a manager', writer: true, response: null },
      { label: 'an invited voter', writer: false, response: makeResponse(IndexedVoteResponseStatus.RESPONDED) },
    ])('shows the vote metadata once, in Vote details, for $label', async ({ writer, response }) => {
      projectService.getProjectStrict.mockReturnValue(of({ writer } as Project));
      voteService.fetchVote.mockReturnValue(
        of(
          makeVote({
            committee_name: 'Synthetic Steering Committee',
            poll_type: PollType.GENERIC,
            total_voting_request_invitations: 12,
            poll_questions: [{ question_id: 'question-1', prompt: 'Approve the roadmap?', type: 'single_choice', choices: [] }],
          })
        )
      );
      voteService.getMyVoteResponse.mockReturnValue(of(response));
      const fixture = await setup('browser', [VoteDetailHeaderComponent, VoteDetailFactsComponent]);
      const row = (id: string): string => testId(fixture, `vote-detail-facts-${id}`)?.querySelector('dd')?.textContent?.trim() ?? '';

      expect(read(fixture, 'showVoteDetails')).toBe(true);
      const content = testId(fixture, 'vote-detail-panel-overview');
      expect(content?.classList.contains('lg:col-span-2')).toBe(true);
      expect(content?.parentElement?.classList.contains('lg:grid-cols-3')).toBe(true);
      expect(testId(fixture, 'vote-detail-header-meta')).toBeNull();
      expect(testId(fixture, 'vote-detail-facts-visibility')).toBeNull();
      expect(row('group')).toBe('Synthetic Steering Committee');
      expect(row('method')).toBe('Plurality vote');
      expect(row('close-date')).toMatch(/^Closes /);
      expect(row('invited')).toBe('12 invited voters');
      expect(row('vote-questions')).toBe('1');
      expect(row('comments')).toBe('Active');
      expect(row('comment-prompts')).toBe('1');
      expect(testId(fixture, 'vote-detail-header-privacy')).not.toBeNull();
      const text = fixture.nativeElement.textContent as string;
      expect(text.split('Synthetic Steering Committee')).toHaveLength(2);
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

    it('shows the held panel on Overview while the vote is open', async () => {
      const fixture = await setup();

      expect(read(fixture, 'resultsHeld')).toBe(true);
      expect(testId(fixture, 'vote-detail-results-held')?.textContent).toContain('Totals appear when voting closes');
      expect(testId(fixture, 'vote-detail-results-held')?.textContent).toContain('Totals, abstentions and comments stay hidden until voting closes.');
      expect(fixture.nativeElement.querySelector('lfx-vote-abstain-result')).toBeNull();
      expect(testId(fixture, 'vote-detail-results-empty')).toBeNull();
    });

    it.each(['2026-10-30T16:00:00Z', ''])('shows each vote fact once on held-results Overview (deadline: %s)', async (endTime) => {
      voteService.fetchVote.mockReturnValue(
        of(
          makeVote({
            pseudo_anonymity: true,
            end_time: endTime,
            committee_name: 'Synthetic Steering Committee',
            poll_type: PollType.GENERIC,
            total_voting_request_invitations: 12,
          })
        )
      );
      const fixture = await setup('browser', [VoteDetailHeaderComponent, VoteDetailFactsComponent]);
      const page = testId(fixture, 'vote-detail-page')!.cloneNode(true) as HTMLElement;
      page.querySelector('[data-testid="vote-detail-summary"]')?.remove();
      // The Voters tab badge carries its own screen-reader text (#4768); the tab strip is not a vote fact.
      page.querySelectorAll('[role="tab"] .sr-only').forEach((el) => el.remove());
      const text = page.textContent?.toLowerCase() ?? '';
      const facts = ['Synthetic Steering Committee', 'Plurality vote', '12 invited voters', 'pseudo-anonymous'];
      const deadline = testId(fixture, 'vote-detail-facts-close-date')
        ?.querySelector('dd')
        ?.textContent?.trim()
        .replace(/^Closes\s+/, '');
      if (endTime) {
        expect(deadline).toBeTruthy();
        facts.push(deadline!);
      } else {
        expect(deadline).toBeUndefined();
      }
      for (const fact of facts) {
        expect.soft(text.split(fact.toLowerCase()), `${fact} appears once outside the summary cards`).toHaveLength(2);
      }
      expect(testId(fixture, 'vote-detail-results-held')).not.toBeNull();
      expect(fixture.nativeElement.querySelector('lfx-vote-abstain-result')).toBeNull();
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

    it.each([PollStatus.ACTIVE, PollStatus.ENDED])('keeps held participation unsplit for %s votes', async (status) => {
      voteService.fetchVote.mockReturnValue(of(makeVote({ pseudo_anonymity: true, allow_abstain: true, status })));
      const fixture = await setup('browser', [StatCardGridComponent]);
      const progress = read<StatCardItem[]>(fixture, 'summaryCards')[0].progress;

      expect(progress).toEqual({
        segments: [{ percentage: 75, className: 'bg-blue-600' }],
        ariaLabel: '3 of 4 eligible voters responded; abstention totals are withheld',
      });
      const bar = fixture.nativeElement.querySelector('[data-testid="vote-detail-summary"] [role="img"]') as HTMLElement;
      expect(bar.getAttribute('aria-label')).toBe(progress?.ariaLabel);
      expect(bar.children).toHaveLength(1);
      expect((bar.firstElementChild as HTMLElement).style.width).toBe('75%');
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
      expect(testId(fixture, 'vote-detail-overview-callout')).toBeNull();
    });

    it.each(['creator', 'voter'] as const)('keeps held results gated and updates the header tooltip for %s', async (audience) => {
      projectService.getProjectStrict.mockReturnValue(of({ writer: audience === 'creator' } as Project));
      voteService.fetchVote.mockReturnValue(of(makeVote({ pseudo_anonymity: true, status: PollStatus.ENDED })));
      voteService.getMyVoteResponse.mockReturnValue(of(makeResponse(IndexedVoteResponseStatus.RESPONDED)));
      const results = new Subject<VoteResultsResponse>();
      voteService.getVoteResults.mockReturnValue(results);
      const fixture = await setup('browser', [VoteDetailFactsComponent]);

      results.next(heldResults());
      TestBed.tick();
      fixture.detectChanges();
      expect(fixture.debugElement.query(By.css('lfx-vote-detail-header')).properties['resultsHeld']).toBe(true);
      expect(read(fixture, 'resultsHeld')).toBe(true);
      expect(testId(fixture, 'vote-detail-results-held')).not.toBeNull();
      expect(testId(fixture, 'vote-detail-facts-details')).not.toBeNull();
      expect(fixture.nativeElement.querySelector('[data-testid^="vote-detail-facts-visibility"]')).toBeNull();
      expect(testId(fixture, 'vote-detail-facts-comments')?.textContent).toContain('Active');

      results.next(makeMethodResults());
      TestBed.tick();
      fixture.detectChanges();
      expect(fixture.debugElement.query(By.css('lfx-vote-detail-header')).properties['resultsHeld']).toBe(false);
      expect(read(fixture, 'resultsHeld')).toBe(false);
      expect(testId(fixture, 'vote-detail-results-held')).toBeNull();
    });

    it('never reads 100% participation on an open held vote as final', async () => {
      voteService.getVoteResults.mockReturnValue(of({ ...heldResults(), num_votes_cast: 4 }));
      const fixture = await setup();

      expect(read<{ value: string }>(fixture, 'resultsStatusTag').value).toBe('Voting in progress');
    });
  });

  describe('visible active results refresh (#4769)', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
      projectService.getProjectStrict.mockReturnValue(of({ writer: true } as Project));
      voteService.getVoteResults.mockReturnValue(of(makeMethodResults()));
    });

    afterEach(() => {
      TestBed.resetTestingModule();
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    it('updates real Overview bars from another response without a local ballot submission', async () => {
      const pending = new Subject<VoteResultsResponse>();
      voteService.getVoteResults.mockReturnValueOnce(of(makeMethodResults())).mockReturnValueOnce(pending);
      const fixture = await setup('browser', [VoteOptionResultsComponent, VoteAbstainResultComponent]);
      expect(testId(fixture, 'vote-detail-overview-option-choice-yes')?.textContent).toContain('2 votes');

      await vi.advanceTimersByTimeAsync(VOTE_DETAIL_RESULTS_POLL_OPTIONS.intervalMs);
      TestBed.tick();
      fixture.detectChanges();
      expect(voteService.getVoteResults).toHaveBeenCalledTimes(2);
      expect(testId(fixture, 'vote-detail-results-loading')).toBeNull();
      expect(testId(fixture, 'vote-detail-overview-option-choice-yes')?.textContent).toContain('2 votes');

      const updated = makeMethodResults();
      updated.num_votes_cast = 4;
      updated.poll_results[0].generic_choice_votes = [
        { choice_id: 'choice-yes', vote_count: 3, percentage: 75 },
        { choice_id: 'choice-no', vote_count: 1, percentage: 25 },
      ];
      pending.next(updated);
      pending.complete();
      TestBed.tick();
      fixture.detectChanges();
      expect(testId(fixture, 'vote-detail-overview-option-choice-yes')?.textContent).toContain('3 votes');
      expect(testId(fixture, 'vote-detail-overview-option-choice-yes')?.querySelector<HTMLElement>('.bg-emerald-500')?.style.width).toBe('75%');
      expect(read<StatCardItem[]>(fixture, 'summaryCards')[0].value).toBe('4 / 4');
    });

    it('does not overlap requests and cancels in-flight reads while hidden or destroyed', async () => {
      const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
      const pending = new Subject<VoteResultsResponse>();
      voteService.getVoteResults.mockReturnValueOnce(of(makeMethodResults())).mockReturnValueOnce(pending);
      const fixture = await setup();
      await vi.advanceTimersByTimeAsync(VOTE_DETAIL_RESULTS_POLL_OPTIONS.intervalMs * 3);
      expect(voteService.getVoteResults).toHaveBeenCalledTimes(2);
      expect(pending.observers).toHaveLength(1);

      visibility.mockReturnValue('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
      expect(pending.observers).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(VOTE_DETAIL_RESULTS_POLL_OPTIONS.intervalMs * 3);
      expect(voteService.getVoteResults).toHaveBeenCalledTimes(2);

      visibility.mockReturnValue('visible');
      document.dispatchEvent(new Event('visibilitychange'));
      TestBed.tick();
      expect(voteService.getVoteResults).toHaveBeenCalledTimes(3);
      fixture.destroy();
      await vi.advanceTimersByTimeAsync(VOTE_DETAIL_RESULTS_POLL_OPTIONS.intervalMs * 3);
      expect(voteService.getVoteResults).toHaveBeenCalledTimes(3);
    });

    it('backs off after errors and recovers without a route reload', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      voteService.getVoteResults.mockReturnValueOnce(httpError(503)).mockReturnValueOnce(httpError(503)).mockReturnValue(of(makeMethodResults()));
      const fixture = await setup('browser', [VoteOptionResultsComponent]);
      expect(testId(fixture, 'vote-detail-results-error')).not.toBeNull();

      await vi.advanceTimersByTimeAsync(VOTE_DETAIL_RESULTS_POLL_OPTIONS.backoffBaseMs);
      expect(voteService.getVoteResults).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(VOTE_DETAIL_RESULTS_POLL_OPTIONS.backoffBaseMs * 2 - 1);
      expect(voteService.getVoteResults).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      TestBed.tick();
      fixture.detectChanges();
      expect(voteService.getVoteResults).toHaveBeenCalledTimes(3);
      expect(testId(fixture, 'vote-detail-results-error')).toBeNull();
      expect(testId(fixture, 'vote-detail-overview-option-choice-yes')?.textContent).toContain('2 votes');
    });

    it.each([503, 401, 403, 404])('keeps an HTTP %s error visible throughout an in-flight background retry', async (status) => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const metadata = new Subject<Vote>();
      const results = new Subject<VoteResultsResponse>();
      voteService.fetchVote.mockReturnValueOnce(of(makeVote())).mockReturnValueOnce(metadata);
      voteService.getVoteResults.mockReturnValueOnce(httpError(status)).mockReturnValueOnce(results);
      const fixture = await setup('browser', [VoteOptionResultsComponent]);
      expect(testId(fixture, 'vote-detail-results-error')).not.toBeNull();

      await vi.advanceTimersByTimeAsync(VOTE_DETAIL_RESULTS_POLL_OPTIONS.backoffBaseMs);
      TestBed.tick();
      fixture.detectChanges();
      expect(metadata.observers).toHaveLength(1);
      expect(testId(fixture, 'vote-detail-results-error')).not.toBeNull();
      expect(testId(fixture, 'vote-detail-results-loading')).toBeNull();

      metadata.next(makeVote());
      metadata.complete();
      TestBed.tick();
      fixture.detectChanges();
      expect(results.observers).toHaveLength(1);
      expect(testId(fixture, 'vote-detail-results-error')).not.toBeNull();
      expect(testId(fixture, 'vote-detail-results-loading')).toBeNull();

      results.next(makeMethodResults());
      results.complete();
      TestBed.tick();
      fixture.detectChanges();
      expect(testId(fixture, 'vote-detail-results-error')).toBeNull();
      expect(testId(fixture, 'vote-detail-overview-bars')).not.toBeNull();
    });

    it.each([0, 503])('retains the last good results with a stale notice after transient HTTP %s, then recovers', async (status) => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const pending = new Subject<VoteResultsResponse>();
      voteService.getVoteResults.mockReturnValueOnce(of(makeMethodResults())).mockReturnValueOnce(httpError(status)).mockReturnValueOnce(pending);
      const fixture = await setup('browser', [VoteOptionResultsComponent]);

      await vi.advanceTimersByTimeAsync(VOTE_DETAIL_RESULTS_POLL_OPTIONS.intervalMs);
      TestBed.tick();
      fixture.detectChanges();
      expect(testId(fixture, 'vote-detail-overview-option-choice-yes')?.textContent).toContain('2 votes');
      expect(testId(fixture, 'vote-detail-results-error')).toBeNull();
      expect(testId(fixture, 'vote-detail-results-stale')?.textContent).toContain('Reconnecting automatically');
      expect(read<StatCardItem[]>(fixture, 'summaryCards')[0].value).toBe('3 / 4');

      await vi.advanceTimersByTimeAsync(VOTE_DETAIL_RESULTS_POLL_OPTIONS.backoffBaseMs);
      TestBed.tick();
      fixture.detectChanges();
      expect(testId(fixture, 'vote-detail-results-stale')).not.toBeNull();
      expect(testId(fixture, 'vote-detail-results-loading')).toBeNull();
      pending.next(makeMethodResults());
      pending.complete();
      TestBed.tick();
      fixture.detectChanges();
      expect(testId(fixture, 'vote-detail-results-stale')).toBeNull();
      expect(testId(fixture, 'vote-detail-overview-option-choice-yes')?.textContent).toContain('2 votes');
    });

    it.each([401, 403, 404])('clears previously loaded results after HTTP %s instead of retaining unauthorized data', async (status) => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      voteService.getVoteResults.mockReturnValueOnce(of(makeMethodResults())).mockReturnValueOnce(httpError(status)).mockReturnValue(httpError(503));
      const fixture = await setup('browser', [VoteOptionResultsComponent]);

      await vi.advanceTimersByTimeAsync(VOTE_DETAIL_RESULTS_POLL_OPTIONS.intervalMs);
      TestBed.tick();
      fixture.detectChanges();
      expect(testId(fixture, 'vote-detail-results-error')).not.toBeNull();
      expect(testId(fixture, 'vote-detail-results-stale')).toBeNull();
      expect(testId(fixture, 'vote-detail-overview-bars')).toBeNull();
      await vi.advanceTimersByTimeAsync(VOTE_DETAIL_RESULTS_POLL_OPTIONS.backoffBaseMs);
      TestBed.tick();
      fixture.detectChanges();
      expect(testId(fixture, 'vote-detail-overview-bars')).toBeNull();
    });

    it('retries transient metadata failures without discarding the last good results', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      voteService.fetchVote.mockReturnValueOnce(of(makeVote())).mockReturnValueOnce(httpError(503)).mockReturnValue(of(makeVote()));
      const fixture = await setup('browser', [VoteOptionResultsComponent]);

      await vi.advanceTimersByTimeAsync(VOTE_DETAIL_RESULTS_POLL_OPTIONS.intervalMs);
      TestBed.tick();
      fixture.detectChanges();
      expect(testId(fixture, 'vote-detail-results-stale')).not.toBeNull();
      expect(testId(fixture, 'vote-detail-overview-option-choice-yes')?.textContent).toContain('2 votes');
      expect(voteService.getVoteResults).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(VOTE_DETAIL_RESULTS_POLL_OPTIONS.backoffBaseMs);
      TestBed.tick();
      fixture.detectChanges();
      expect(testId(fixture, 'vote-detail-results-stale')).toBeNull();
      expect(voteService.getVoteResults).toHaveBeenCalledTimes(2);
    });

    it('cancels a delayed post-ballot metadata reload once the poll accepts newer ended metadata', async () => {
      const pendingMetadata = new Subject<Vote>();
      voteService.fetchVote
        .mockReturnValueOnce(of(makeVote()))
        .mockReturnValueOnce(pendingMetadata)
        .mockReturnValue(of(makeVote({ status: PollStatus.ENDED })));
      const fixture = await setup('browser', [VoteOptionResultsComponent]);

      call(fixture, 'onVoteSubmitted', 'vote-1');
      TestBed.tick();
      expect(pendingMetadata.observers).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(VOTE_DETAIL_RESULTS_POLL_OPTIONS.intervalMs);
      TestBed.tick();
      fixture.detectChanges();
      expect(read<Vote>(fixture, 'vote').status).toBe(PollStatus.ENDED);
      expect(testId(fixture, 'vote-detail-overview-option-choice-yes')?.textContent).toContain('Winner');
      expect(pendingMetadata.observers).toHaveLength(0);

      pendingMetadata.next(makeVote());
      pendingMetadata.complete();
      TestBed.tick();
      fixture.detectChanges();
      expect(read<Vote>(fixture, 'vote').status).toBe(PollStatus.ENDED);
      expect(read(fixture, 'canSendBallots')).toBe(false);
      expect(read<{ value: string }>(fixture, 'resultsStatusTag').value).toBe('Final results');
      const calls = voteService.getVoteResults.mock.calls.length;
      await vi.advanceTimersByTimeAsync(VOTE_DETAIL_RESULTS_POLL_OPTIONS.intervalMs * 3);
      expect(voteService.getVoteResults).toHaveBeenCalledTimes(calls);
    });

    it('detects a remotely ended vote, shows final results, and stops both polling reads', async () => {
      voteService.fetchVote.mockReturnValueOnce(of(makeVote())).mockReturnValue(of(makeVote({ status: PollStatus.ENDED })));
      const fixture = await setup('browser', [VoteOptionResultsComponent]);
      expect(testId(fixture, 'vote-detail-overview-option-choice-yes')?.textContent).not.toContain('Winner');

      await vi.advanceTimersByTimeAsync(VOTE_DETAIL_RESULTS_POLL_OPTIONS.intervalMs);
      TestBed.tick();
      fixture.detectChanges();
      expect(voteService.fetchVote).toHaveBeenLastCalledWith('vote-1', { uncached: true });
      expect(read<Vote>(fixture, 'vote').status).toBe(PollStatus.ENDED);
      expect(read<{ value: string }>(fixture, 'resultsStatusTag').value).toBe('Final results');
      expect(testId(fixture, 'vote-detail-overview-option-choice-yes')?.textContent).toContain('Winner');
      const resultCalls = voteService.getVoteResults.mock.calls.length;
      const metadataCalls = voteService.fetchVote.mock.calls.length;
      await vi.advanceTimersByTimeAsync(VOTE_DETAIL_RESULTS_POLL_OPTIONS.intervalMs * 3);
      expect(voteService.getVoteResults).toHaveBeenCalledTimes(resultCalls);
      expect(voteService.fetchVote).toHaveBeenCalledTimes(metadataCalls);
    });

    it('retries held results after remote closure and stops after final results are released', async () => {
      const held = { ...makeResults(), results_held: true };
      voteService.fetchVote.mockReturnValueOnce(of(makeVote())).mockReturnValue(of(makeVote({ status: PollStatus.ENDED })));
      voteService.getVoteResults.mockReturnValueOnce(of(held)).mockReturnValueOnce(of(held)).mockReturnValue(of(makeMethodResults()));
      const fixture = await setup('browser', [VoteOptionResultsComponent]);

      await vi.advanceTimersByTimeAsync(VOTE_DETAIL_RESULTS_POLL_OPTIONS.intervalMs);
      TestBed.tick();
      fixture.detectChanges();
      expect(testId(fixture, 'vote-detail-results-held')?.textContent).toContain('Totals are being finalized');
      expect(testId(fixture, 'vote-detail-overview-bars')).toBeNull();

      await vi.advanceTimersByTimeAsync(VOTE_DETAIL_RESULTS_POLL_OPTIONS.intervalMs);
      TestBed.tick();
      fixture.detectChanges();
      expect(testId(fixture, 'vote-detail-results-held')).toBeNull();
      expect(testId(fixture, 'vote-detail-overview-option-choice-yes')?.textContent).toContain('Winner');
      const calls = voteService.getVoteResults.mock.calls.length;
      await vi.advanceTimersByTimeAsync(VOTE_DETAIL_RESULTS_POLL_OPTIONS.intervalMs * 3);
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
      expect(voteService.getVoteResults).toHaveBeenCalledTimes(calls);
      expect(voteService.fetchVote).toHaveBeenCalledTimes(2);
    });

    it.each(['overview', 'results'].flatMap((tab) => ['leader', 'tie', 'complete'].map((kind) => ({ tab, kind }))))(
      'keeps retained $kind counts provisional on $tab while a post-closure read is pending',
      async ({ tab, kind }) => {
        const initial = makeMethodResults();
        if (kind === 'tie') {
          initial.num_votes_cast = 2;
          initial.poll_results[0].generic_choice_votes = [
            { choice_id: 'choice-yes', vote_count: 1, percentage: 50 },
            { choice_id: 'choice-no', vote_count: 1, percentage: 50 },
          ];
        } else if (kind === 'complete') {
          initial.num_recipients = 3;
        }
        const pending = new Subject<VoteResultsResponse>();
        voteService.fetchVote.mockReturnValueOnce(of(makeVote())).mockReturnValue(of(makeVote({ status: PollStatus.ENDED })));
        voteService.getVoteResults.mockReturnValueOnce(of(initial)).mockReturnValueOnce(pending);
        queryParamMap.next(convertToParamMap({ tab }));
        const fixture = await setup('browser', [VoteOptionResultsComponent]);

        await vi.advanceTimersByTimeAsync(VOTE_DETAIL_RESULTS_POLL_OPTIONS.intervalMs);
        TestBed.tick();
        fixture.detectChanges();
        const prefix = tab === 'overview' ? 'vote-detail-overview-option-' : 'vote-detail-option-';
        expect(read<Vote>(fixture, 'vote').status).toBe(PollStatus.ENDED);
        expect(read(fixture, 'canSendBallots')).toBe(false);
        expect(read(fixture, 'isVoteClosed')).toBe(false);
        expect(read(fixture, 'optionVariant')).toBe('live');
        expect(read<{ value: string }>(fixture, 'resultsStatusTag').value).toBe('Totals pending');
        expect(testId(fixture, prefix + 'choice-yes')?.textContent).toContain(kind === 'tie' ? '1 vote' : '2 votes');
        expect(fixture.nativeElement.textContent).not.toMatch(/Winner|Tied/);

        pending.next(makeMethodResults());
        pending.complete();
        TestBed.tick();
        fixture.detectChanges();
        expect(read(fixture, 'isVoteClosed')).toBe(true);
        expect(read<{ value: string }>(fixture, 'resultsStatusTag').value).toBe('Final results');
        expect(testId(fixture, prefix + 'choice-yes')?.textContent).toContain('Winner');
      }
    );

    it.each([0, 503])('retains provisional figures and retries HTTP %s during remote closure', async (status) => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const final = makeMethodResults();
      final.num_votes_cast = 4;
      final.poll_results[0].generic_choice_votes = [
        { choice_id: 'choice-yes', vote_count: 1, percentage: 25 },
        { choice_id: 'choice-no', vote_count: 3, percentage: 75 },
      ];
      voteService.fetchVote.mockReturnValueOnce(of(makeVote())).mockReturnValue(of(makeVote({ status: PollStatus.ENDED })));
      voteService.getVoteResults.mockReturnValueOnce(of(makeMethodResults())).mockReturnValueOnce(httpError(status)).mockReturnValue(of(final));
      const fixture = await setup('browser', [VoteOptionResultsComponent]);

      await vi.advanceTimersByTimeAsync(VOTE_DETAIL_RESULTS_POLL_OPTIONS.intervalMs);
      TestBed.tick();
      fixture.detectChanges();
      expect(testId(fixture, 'vote-detail-overview-option-choice-yes')?.textContent).toContain('2 votes');
      expect(testId(fixture, 'vote-detail-results-stale')).not.toBeNull();
      expect(testId(fixture, 'vote-detail-results-error')).toBeNull();
      expect(fixture.nativeElement.textContent).not.toMatch(/Winner|Tied/);
      expect(read<{ value: string }>(fixture, 'resultsStatusTag').value).toBe('Totals pending');

      await vi.advanceTimersByTimeAsync(VOTE_DETAIL_RESULTS_POLL_OPTIONS.backoffBaseMs);
      TestBed.tick();
      fixture.detectChanges();
      expect(testId(fixture, 'vote-detail-results-stale')).toBeNull();
      expect(testId(fixture, 'vote-detail-overview-option-choice-yes')?.textContent).not.toContain('Winner');
      expect(testId(fixture, 'vote-detail-overview-option-choice-no')?.textContent).toContain('Winner');
      expect(testId(fixture, 'vote-detail-overview-option-choice-no')?.textContent).toContain('3 votes');
      expect(read<{ value: string }>(fixture, 'resultsStatusTag').value).toBe('Final results');
      expect(voteService.getVoteResults).toHaveBeenCalledTimes(3);
      expect(voteService.fetchVote).toHaveBeenCalledTimes(2);
    });

    it('replaces retained figures with a held payload while finalization retries continue', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const held = { ...makeResults(), results_held: true };
      voteService.fetchVote.mockReturnValueOnce(of(makeVote())).mockReturnValue(of(makeVote({ status: PollStatus.ENDED })));
      voteService.getVoteResults.mockReturnValueOnce(of(makeMethodResults())).mockReturnValueOnce(httpError(503)).mockReturnValue(of(held));
      const fixture = await setup('browser', [VoteOptionResultsComponent, VoteAbstainResultComponent]);

      await vi.advanceTimersByTimeAsync(VOTE_DETAIL_RESULTS_POLL_OPTIONS.intervalMs);
      await vi.advanceTimersByTimeAsync(VOTE_DETAIL_RESULTS_POLL_OPTIONS.backoffBaseMs);
      TestBed.tick();
      fixture.detectChanges();
      expect(testId(fixture, 'vote-detail-results-held')).not.toBeNull();
      expect(testId(fixture, 'vote-detail-overview-bars')).toBeNull();
      expect(testId(fixture, 'vote-detail-overview-abstain')).toBeNull();
      expect(testId(fixture, 'vote-detail-results-stale')).toBeNull();
    });

    it('bounds held finalization reads across focus and visibility events', async () => {
      voteService.fetchVote.mockReturnValueOnce(of(makeVote())).mockReturnValue(of(makeVote({ status: PollStatus.ENDED })));
      voteService.getVoteResults.mockReturnValue(of({ ...makeResults(), results_held: true }));
      const fixture = await setup();

      await vi.advanceTimersByTimeAsync(VOTE_DETAIL_RESULTS_POLL_OPTIONS.intervalMs);
      TestBed.tick();
      for (let attempt = 1; attempt < VOTE_DETAIL_RESULTS_FINALIZATION_MAX_ATTEMPTS; attempt++) {
        document.dispatchEvent(new Event('visibilitychange'));
      }
      expect(voteService.getVoteResults).toHaveBeenCalledTimes(1 + VOTE_DETAIL_RESULTS_FINALIZATION_MAX_ATTEMPTS);
      await vi.advanceTimersByTimeAsync(VOTE_DETAIL_RESULTS_POLL_OPTIONS.intervalMs * 20);
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
      fixture.detectChanges();
      expect(voteService.getVoteResults).toHaveBeenCalledTimes(1 + VOTE_DETAIL_RESULTS_FINALIZATION_MAX_ATTEMPTS);
      expect(testId(fixture, 'vote-detail-results-held')?.textContent).toContain('reload this page');
      expect(testId(fixture, 'vote-detail-overview-bars')).toBeNull();
    });

    it('ends a failed finalization window with a reload error, not a reconnecting notice', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      voteService.fetchVote.mockReturnValueOnce(of(makeVote())).mockReturnValue(of(makeVote({ status: PollStatus.ENDED })));
      voteService.getVoteResults.mockReturnValueOnce(of(makeMethodResults())).mockReturnValue(httpError(503));
      const fixture = await setup('browser', [VoteOptionResultsComponent]);

      await vi.advanceTimersByTimeAsync(VOTE_DETAIL_RESULTS_POLL_OPTIONS.intervalMs);
      TestBed.tick();
      await vi.advanceTimersByTimeAsync(VOTE_DETAIL_RESULTS_POLL_OPTIONS.backoffMaxMs * VOTE_DETAIL_RESULTS_FINALIZATION_MAX_ATTEMPTS);
      TestBed.tick();
      fixture.detectChanges();
      expect(voteService.getVoteResults).toHaveBeenCalledTimes(1 + VOTE_DETAIL_RESULTS_FINALIZATION_MAX_ATTEMPTS);
      expect(testId(fixture, 'vote-detail-results-error')?.textContent).toContain('Try reloading this page');
      expect(testId(fixture, 'vote-detail-results-stale')).toBeNull();
      expect(testId(fixture, 'vote-detail-overview-bars')).toBeNull();
    });

    it.each([401, 403, 404])('clears retained figures and stops finalization recovery on HTTP %s', async (status) => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      voteService.fetchVote.mockReturnValueOnce(of(makeVote())).mockReturnValue(of(makeVote({ status: PollStatus.ENDED })));
      voteService.getVoteResults.mockReturnValueOnce(of(makeMethodResults())).mockReturnValue(httpError(status));
      const fixture = await setup('browser', [VoteOptionResultsComponent]);

      await vi.advanceTimersByTimeAsync(VOTE_DETAIL_RESULTS_POLL_OPTIONS.intervalMs);
      TestBed.tick();
      fixture.detectChanges();
      expect(testId(fixture, 'vote-detail-results-error')).not.toBeNull();
      expect(testId(fixture, 'vote-detail-results-stale')).toBeNull();
      expect(testId(fixture, 'vote-detail-overview-bars')).toBeNull();
      await vi.advanceTimersByTimeAsync(VOTE_DETAIL_RESULTS_POLL_OPTIONS.backoffMaxMs * 2);
      document.dispatchEvent(new Event('visibilitychange'));
      expect(voteService.getVoteResults).toHaveBeenCalledTimes(2);
    });

    it.each(['hidden', 'destroyed', 'route changed'] as const)('cancels a pending finalization read when %s', async (reason) => {
      const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
      const pending = new Subject<VoteResultsResponse>();
      voteService.fetchVote.mockReturnValueOnce(of(makeVote())).mockReturnValue(of(makeVote({ status: PollStatus.ENDED })));
      voteService.getVoteResults
        .mockReturnValueOnce(of(makeMethodResults()))
        .mockReturnValueOnce(of({ ...makeResults(), results_held: true }))
        .mockReturnValue(pending);
      const fixture = await setup();
      await vi.advanceTimersByTimeAsync(VOTE_DETAIL_RESULTS_POLL_OPTIONS.intervalMs);
      TestBed.tick();
      await vi.advanceTimersByTimeAsync(VOTE_DETAIL_RESULTS_POLL_OPTIONS.intervalMs);
      expect(pending.observers).toHaveLength(1);

      if (reason === 'hidden') {
        visibility.mockReturnValue('hidden');
        document.dispatchEvent(new Event('visibilitychange'));
        expect(pending.observers).toHaveLength(0);
        const calls = voteService.getVoteResults.mock.calls.length;
        await vi.advanceTimersByTimeAsync(VOTE_DETAIL_RESULTS_POLL_OPTIONS.intervalMs * 3);
        expect(voteService.getVoteResults).toHaveBeenCalledTimes(calls);
        visibility.mockReturnValue('visible');
        document.dispatchEvent(new Event('visibilitychange'));
        expect(pending.observers).toHaveLength(1);
      } else if (reason === 'destroyed') {
        fixture.destroy();
        expect(pending.observers).toHaveLength(0);
      } else {
        voteService.fetchVote.mockReturnValue(of(makeVote({ uid: 'vote-2' })));
        voteService.getVoteResults.mockReturnValue(of(makeMethodResults()));
        paramMap.next(convertToParamMap({ id: 'vote-2' }));
        TestBed.tick();
        fixture.detectChanges();
        expect(pending.observers).toHaveLength(0);
        expect(read<Vote>(fixture, 'vote').uid).toBe('vote-2');
      }
    });

    it('retries held results when a manager opens an already ended vote', async () => {
      voteService.fetchVote.mockReturnValue(of(makeVote({ status: PollStatus.ENDED })));
      voteService.getVoteResults.mockReturnValueOnce(of({ ...makeResults(), results_held: true })).mockReturnValue(of(makeMethodResults()));
      const fixture = await setup('browser', [VoteOptionResultsComponent]);
      await vi.advanceTimersByTimeAsync(VOTE_DETAIL_RESULTS_POLL_OPTIONS.intervalMs);
      TestBed.tick();
      fixture.detectChanges();
      expect(testId(fixture, 'vote-detail-results-held')).toBeNull();
      expect(testId(fixture, 'vote-detail-overview-option-choice-yes')?.textContent).toContain('Winner');
    });

    it.each([
      { error: new HttpErrorResponse({ status: 503, error: 'private payload' }), status: 503 },
      { error: new Error('private payload'), status: undefined },
    ])('logs only safe HTTP status metadata ($status)', async ({ error, status }) => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      voteService.getVoteResults.mockReturnValue(throwError(() => error));
      await setup();
      expect(log).toHaveBeenCalledWith('Failed to load vote results for detail page', { status });
    });

    it('does not infer an ended vote from an expired results deadline while server status is active', async () => {
      vi.setSystemTime(new Date('2026-10-31T00:00:00Z'));
      const fixture = await setup();
      await vi.advanceTimersByTimeAsync(VOTE_DETAIL_RESULTS_POLL_OPTIONS.intervalMs * 2);
      TestBed.tick();
      expect(read<{ value: string }>(fixture, 'resultsStatusTag').value).toBe('Voting in progress');
      expect(voteService.fetchVote).toHaveBeenCalledTimes(3);
      expect(voteService.getVoteResults).toHaveBeenCalledTimes(3);
    });

    it.each(['hidden', 'destroyed', 'route changed'] as const)('cancels a pending metadata refresh when %s', async (reason) => {
      const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
      const pending = new Subject<Vote>();
      voteService.fetchVote
        .mockReturnValueOnce(of(makeVote()))
        .mockReturnValueOnce(pending)
        .mockReturnValue(of(makeVote({ uid: 'vote-2' })));
      const fixture = await setup();
      await vi.advanceTimersByTimeAsync(VOTE_DETAIL_RESULTS_POLL_OPTIONS.intervalMs * 2);
      expect(pending.observers).toHaveLength(1);
      expect(voteService.fetchVote).toHaveBeenCalledTimes(2);
      expect(voteService.getVoteResults).toHaveBeenCalledTimes(1);

      if (reason === 'hidden') {
        visibility.mockReturnValue('hidden');
        document.dispatchEvent(new Event('visibilitychange'));
      } else if (reason === 'destroyed') {
        fixture.destroy();
      } else {
        paramMap.next(convertToParamMap({ id: 'vote-2' }));
        TestBed.tick();
        fixture.detectChanges();
        expect(read<Vote>(fixture, 'vote').uid).toBe('vote-2');
      }
      expect(pending.observers).toHaveLength(0);
    });

    it('disposes the previous vote loop on route changes', async () => {
      voteService.fetchVote.mockImplementation((uid: string) => of(makeVote({ uid })));
      const fixture = await setup();
      paramMap.next(convertToParamMap({ id: 'vote-2' }));
      TestBed.tick();
      fixture.detectChanges();
      const callsBeforePoll = voteService.getVoteResults.mock.calls.length;
      await vi.advanceTimersByTimeAsync(VOTE_DETAIL_RESULTS_POLL_OPTIONS.intervalMs);
      expect(voteService.getVoteResults.mock.calls.slice(callsBeforePoll)).toEqual([['vote-2']]);
    });

    it('switches to a one-shot result when refreshed metadata marks the vote ended', async () => {
      voteService.fetchVote.mockReturnValueOnce(of(makeVote())).mockReturnValue(of(makeVote({ status: PollStatus.ENDED })));
      const fixture = await setup();
      call(fixture, 'onVoteSubmitted', 'vote-1');
      TestBed.tick();
      fixture.detectChanges();
      const callsAfterClose = voteService.getVoteResults.mock.calls.length;
      await vi.advanceTimersByTimeAsync(VOTE_DETAIL_RESULTS_POLL_OPTIONS.intervalMs * 3);
      expect(voteService.getVoteResults).toHaveBeenCalledTimes(callsAfterClose);
    });

    it.each(['server', 'ended manager', 'closed voter'] as const)('does not poll for %s', async (reader) => {
      if (reader !== 'server') voteService.fetchVote.mockReturnValue(of(makeVote({ status: PollStatus.ENDED })));
      if (reader === 'closed voter') {
        projectService.getProjectStrict.mockReturnValue(of({ writer: false } as Project));
        voteService.getMyVoteResponse.mockReturnValue(of(makeResponse(IndexedVoteResponseStatus.RESPONDED)));
      }
      await setup(reader === 'server' ? 'server' : 'browser');
      const calls = voteService.getVoteResults.mock.calls.length;
      expect(calls).toBe(reader === 'server' ? 0 : 1);
      await vi.advanceTimersByTimeAsync(VOTE_DETAIL_RESULTS_POLL_OPTIONS.intervalMs * 3);
      expect(voteService.getVoteResults).toHaveBeenCalledTimes(calls);
    });
  });

  describe('stable result choice order (#5021)', () => {
    const ballotOrder: [string, number, number][] = [
      ['choice-yes', 88, 87],
      ['choice-no', 7, 7],
    ];
    const reversed = [...ballotOrder].reverse();

    /** The reported card — 101 responses of 120 invited with 6 abstentions — with tally rows in the given order. */
    function reportedResults(tallies: [string, number, number][]): VoteResultsResponse {
      const results = { ...makeMethodResults(), num_recipients: 120, num_votes_cast: 101, num_abstained: 6 };
      results.poll_results[0].generic_choice_votes = tallies.map(([choiceId, voteCount, percentage]) => ({
        choice_id: choiceId,
        vote_count: voteCount,
        percentage,
      }));
      return results;
    }

    /** Option and abstain rows inside a results region, in DOM order: [test id, text, leader-highlighted]. */
    const renderedRows = (fixture: ComponentFixture<VoteDetailComponent>, region: string, prefix: string, abstainId: string): [string, string, boolean][] =>
      Array.from(testId(fixture, region)?.querySelectorAll<HTMLElement>(`[data-testid^="${prefix}"], [data-testid="${abstainId}"]`) ?? [])
        .filter((row) => !row.dataset['testid']?.endsWith('-view-voters'))
        .map((row) => [row.dataset['testid'] ?? '', row.textContent?.replace(/\s+/g, ' ').trim() ?? '', row.querySelector('.bg-blue-500') !== null]);
    const overviewRows = (fixture: ComponentFixture<VoteDetailComponent>) =>
      renderedRows(fixture, 'vote-detail-overview-results', 'vote-detail-overview-option-', 'vote-detail-overview-abstain');

    const refresh = async (fixture: ComponentFixture<VoteDetailComponent>, pending: Subject<VoteResultsResponse>, next: VoteResultsResponse): Promise<void> => {
      await vi.advanceTimersByTimeAsync(VOTE_DETAIL_RESULTS_POLL_OPTIONS.intervalMs);
      pending.next(next);
      pending.complete();
      TestBed.tick();
      fixture.detectChanges();
    };

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
      projectService.getProjectStrict.mockReturnValue(of({ writer: true } as Project));
      voteService.fetchVote.mockReturnValue(of(makeVote({ allow_abstain: true })));
    });

    afterEach(() => {
      TestBed.resetTestingModule();
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    it('keeps Overview options in ballot order with Abstain last when a refresh reorders the tallies', async () => {
      const reorderedRefresh = new Subject<VoteResultsResponse>();
      const countRefresh = new Subject<VoteResultsResponse>();
      voteService.getVoteResults
        .mockReturnValueOnce(of(reportedResults(ballotOrder)))
        .mockReturnValueOnce(reorderedRefresh)
        .mockReturnValueOnce(countRefresh);
      const fixture = await setup('browser', [VoteOptionResultsComponent, VoteAbstainResultComponent]);
      const reported: [string, string, boolean][] = [
        ['vote-detail-overview-option-choice-yes', 'Yes 88 votes · 87%', true],
        ['vote-detail-overview-option-choice-no', 'No 7 votes · 7%', false],
        ['vote-detail-overview-abstain', 'Abstain 6 abstentions · 6%', false],
      ];
      expect(overviewRows(fixture)).toEqual(reported);

      // Same figures, only the tally rows reversed — the card must not swap Yes and No.
      await refresh(fixture, reorderedRefresh, reportedResults(reversed));
      expect(voteService.getVoteResults).toHaveBeenCalledTimes(2);
      expect(overviewRows(fixture)).toEqual(reported);

      // New counts in reversed tally order: rows stay put while the figures and highlight follow their choices.
      await refresh(
        fixture,
        countRefresh,
        reportedResults([
          ['choice-no', 54, 53],
          ['choice-yes', 41, 41],
        ])
      );
      expect(voteService.getVoteResults).toHaveBeenCalledTimes(3);
      expect(overviewRows(fixture)).toEqual([
        ['vote-detail-overview-option-choice-yes', 'Yes 41 votes · 41%', false],
        ['vote-detail-overview-option-choice-no', 'No 54 votes · 53%', true],
        ['vote-detail-overview-abstain', 'Abstain 6 abstentions · 6%', false],
      ]);
    });

    it('lists the full Results options in ballot order with Abstain last', async () => {
      voteService.getVoteResults.mockReturnValue(of(reportedResults(reversed)));
      queryParamMap.next(convertToParamMap({ tab: 'results' }));
      const fixture = await setup('browser', [VoteOptionResultsComponent, VoteAbstainResultComponent]);

      expect(read(fixture, 'activeTab')).toBe('results');
      expect(renderedRows(fixture, 'vote-detail-results', 'vote-detail-option-', 'vote-detail-option-abstain')).toEqual([
        ['vote-detail-option-choice-yes', 'Yes 88 votes · 87%', true],
        ['vote-detail-option-choice-no', 'No 7 votes · 7%', false],
        ['vote-detail-option-abstain', 'Abstain 6 abstentions · 6%', false],
      ]);
    });
  });

  describe('overview results summary (#4450)', () => {
    // Render the real option and abstain rows so the bars are asserted, not stubbed.
    const setupOverview = (): Promise<ComponentFixture<VoteDetailComponent>> => setup('browser', [VoteOptionResultsComponent, VoteAbstainResultComponent]);
    const summary = (fixture: ComponentFixture<VoteDetailComponent>): string =>
      testId(fixture, 'vote-detail-overview-summary-question-1')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    const optionRow = (fixture: ComponentFixture<VoteDetailComponent>, choiceId: string): string =>
      testId(fixture, `vote-detail-overview-option-${choiceId}`)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

    beforeEach(() => {
      projectService.getProjectStrict.mockReturnValue(of({ writer: true } as Project));
      voteService.getVoteResults.mockReturnValue(of(makeMethodResults()));
    });

    it('shows a bar per option with count and percentage for a single generic question', async () => {
      const fixture = await setupOverview();
      const overview = testId(fixture, 'vote-detail-overview-bars') as HTMLElement;

      expect(testId(fixture, 'vote-detail-overview-results')?.textContent).toContain('Approve the roadmap?');
      expect(overview.querySelector('lfx-vote-option-results')).not.toBeNull();
      expect(optionRow(fixture, 'choice-yes')).toMatch(/Yes \d+ votes? · \d+%/);
      expect(optionRow(fixture, 'choice-no')).toMatch(/No \d+ votes? · \d+%/);
      expect(summary(fixture)).toBe('');
      expect(fixture.nativeElement.querySelector('lfx-vote-ranked-question-results')).toBeNull();
    });

    it('shows the abstain row alongside the options when abstentions are allowed', async () => {
      voteService.fetchVote.mockReturnValue(of(makeVote({ allow_abstain: true })));
      voteService.getVoteResults.mockReturnValue(of({ ...makeMethodResults(), num_abstained: 1 }));
      const fixture = await setupOverview();

      expect(testId(fixture, 'vote-detail-overview-abstain')).not.toBeNull();
    });

    it('omits the abstain row when abstentions are not allowed and none were cast', async () => {
      voteService.fetchVote.mockReturnValue(of(makeVote({ allow_abstain: false })));
      const fixture = await setupOverview();

      expect(testId(fixture, 'vote-detail-overview-abstain')).toBeNull();
    });

    it('highlights the leader without Winner or Tied tags on an active vote', async () => {
      const fixture = await setupOverview();

      expect(optionRow(fixture, 'choice-yes')).not.toMatch(/Winner|Tied/);
      expect(testId(fixture, 'vote-detail-overview-option-choice-yes')?.querySelector('.bg-blue-500')).toBeTruthy();
    });

    it('preserves long leading-choice text with word-breaking protection', async () => {
      const results = makeMethodResults();
      const label = 'SyntheticPackageIdentifier'.repeat(20);
      results.poll_results[0].question.choices[0].choice_text = label;
      voteService.getVoteResults.mockReturnValue(of(results));
      const fixture = await setupOverview();

      expect(optionRow(fixture, 'choice-yes')).toContain(label);
      expect(testId(fixture, 'vote-detail-overview-option-choice-yes')?.querySelector('span')?.classList).toContain('break-words');
    });

    it.each([
      { status: PollStatus.ACTIVE, message: 'No votes recorded yet.' },
      { status: PollStatus.ENDED, message: 'No votes were submitted.' },
    ])('shows the empty state for $status votes without per-question results', async ({ status, message }) => {
      voteService.fetchVote.mockReturnValue(of(makeVote({ status })));
      voteService.getVoteResults.mockReturnValue(of({ ...makeResults(), num_votes_cast: 0 }));
      const fixture = await setupOverview();

      expect(testId(fixture, 'vote-detail-results-empty')?.textContent?.trim()).toBe(message);
    });

    it.each([
      { status: PollStatus.ACTIVE, pollType: PollType.GENERIC, message: 'No votes recorded yet.' },
      { status: PollStatus.ENDED, pollType: PollType.GENERIC, message: 'No votes were submitted.' },
      { status: PollStatus.ACTIVE, pollType: PollType.MAJORITY, message: 'No votes recorded yet.' },
      { status: PollStatus.ENDED, pollType: PollType.MAJORITY, message: 'No votes were submitted.' },
    ])('shows the empty state for $status $pollType votes with zero-count question results', async ({ status, pollType, message }) => {
      voteService.fetchVote.mockReturnValue(of(makeVote({ status, poll_type: pollType })));
      const results = makeMethodResults();
      voteService.getVoteResults.mockReturnValue(
        of({
          ...results,
          num_votes_cast: 0,
          num_abstained: 0,
          poll_results: results.poll_results.map((result) => ({
            ...result,
            generic_choice_votes: result.generic_choice_votes?.map((choice) => ({ ...choice, vote_count: 0, percentage: 0 })),
          })),
        })
      );
      const fixture = await setupOverview();

      expect(testId(fixture, 'vote-detail-results-empty')?.textContent?.trim()).toBe(message);
      expect(summary(fixture)).toBe('');
      expect(testId(fixture, 'vote-detail-overview-bars')).toBeNull();
    });

    it.each([
      { status: PollStatus.ACTIVE, pollType: PollType.GENERIC },
      { status: PollStatus.ENDED, pollType: PollType.GENERIC },
      { status: PollStatus.ACTIVE, pollType: PollType.MAJORITY },
      { status: PollStatus.ENDED, pollType: PollType.MAJORITY },
    ])('describes abstention-only $pollType results without denying recorded responses on an $status vote', async ({ status, pollType }) => {
      voteService.fetchVote.mockReturnValue(of(makeVote({ status, poll_type: pollType, pseudo_anonymity: false, allow_abstain: true })));
      const results = makeMethodResults();
      voteService.getVoteResults.mockReturnValue(
        of({
          ...results,
          num_votes_cast: 2,
          num_abstained: 2,
          poll_results: results.poll_results.map((result) => ({
            ...result,
            generic_choice_votes: result.generic_choice_votes?.map((choice) => ({ ...choice, vote_count: 0, percentage: 0 })),
          })),
        })
      );
      const fixture = await setupOverview();

      expect(optionRow(fixture, 'choice-yes')).toMatch(/Yes 0 votes · 0%/);
      expect(testId(fixture, 'vote-detail-overview-abstain')?.textContent).toContain('2');
      expect(testId(fixture, 'vote-detail-results-empty')).toBeNull();
      expect(read<StatCardItem[]>(fixture, 'summaryCards')[0]).toMatchObject({ value: '2 / 4', subLine: '50% participation · 2 abstentions' });
    });

    it.each([PollType.GENERIC, PollType.MAJORITY])('shows the closed %s winner with a green bar and Winner tag', async (pollType) => {
      voteService.fetchVote.mockReturnValue(of(makeVote({ status: PollStatus.ENDED, poll_type: pollType })));
      const fixture = await setupOverview();

      expect(optionRow(fixture, 'choice-yes')).toContain('Winner');
      expect(testId(fixture, 'vote-detail-overview-option-choice-yes')?.querySelector('.bg-emerald-500')).toBeTruthy();
      expect(optionRow(fixture, 'choice-no')).not.toContain('Winner');
    });

    it('shows tied options with amber bars and Tied tags on a closed vote', async () => {
      voteService.fetchVote.mockReturnValue(of(makeVote({ status: PollStatus.ENDED })));
      const results = makeMethodResults();
      results.poll_results[0].generic_choice_votes = [
        { choice_id: 'choice-yes', vote_count: 2, percentage: 50 },
        { choice_id: 'choice-no', vote_count: 2, percentage: 50 },
      ];
      voteService.getVoteResults.mockReturnValue(of(results));
      const fixture = await setupOverview();

      expect(optionRow(fixture, 'choice-yes')).toContain('Tied');
      expect(optionRow(fixture, 'choice-no')).toContain('Tied');
      expect(testId(fixture, 'vote-detail-overview-option-choice-no')?.querySelector('.bg-amber-500')).toBeTruthy();
    });

    it.each([PollType.GENERIC, PollType.MAJORITY])('shows the 40-percent %s leader with its share and the other options', async (pollType) => {
      voteService.fetchVote.mockReturnValue(of(makeVote({ status: PollStatus.ENDED, poll_type: pollType })));
      const results = makeMethodResults();
      results.num_recipients = 10;
      results.num_votes_cast = 10;
      results.poll_results[0].question.choices.push({ choice_id: 'choice-later', choice_text: 'Later' });
      results.poll_results[0].generic_choice_votes = [
        { choice_id: 'choice-yes', vote_count: 4, percentage: 40 },
        { choice_id: 'choice-no', vote_count: 3, percentage: 30 },
        { choice_id: 'choice-later', vote_count: 3, percentage: 30 },
      ];
      voteService.getVoteResults.mockReturnValue(of(results));
      const fixture = await setupOverview();

      expect(optionRow(fixture, 'choice-yes')).toContain('4 votes · 40%');
      expect(optionRow(fixture, 'choice-no')).toContain('3 votes · 30%');
      expect(optionRow(fixture, 'choice-later')).toContain('3 votes · 30%');
    });

    it('keeps the text summary and no bars for a multi-question vote', async () => {
      const results = makeMethodResults();
      results.poll_results = [
        results.poll_results[0],
        { ...results.poll_results[0], question: { ...results.poll_results[0].question, question_id: 'question-2', prompt: 'Second?' } },
      ];
      voteService.getVoteResults.mockReturnValue(of(results));
      const fixture = await setupOverview();

      expect(testId(fixture, 'vote-detail-overview-bars')).toBeNull();
      expect(testId(fixture, 'vote-detail-overview-summary-question-2')).not.toBeNull();
      expect(testId(fixture, 'vote-detail-overview-full-results')).not.toBeNull();
    });

    it.each([
      { ranked: false, abstentionOnly: false },
      { ranked: false, abstentionOnly: true },
      { ranked: true, abstentionOnly: false },
      { ranked: true, abstentionOnly: true },
    ])('includes one abstain row in a fallback summary (ranked: $ranked, abstention-only: $abstentionOnly)', async ({ ranked, abstentionOnly }) => {
      voteService.fetchVote.mockReturnValue(of(makeVote({ poll_type: ranked ? PollType.CONDORCET_IRV : PollType.GENERIC, allow_abstain: false })));
      const results = makeMethodResults();
      results.num_abstained = 2;
      if (abstentionOnly) {
        results.num_votes_cast = 2;
        results.poll_results[0].generic_choice_votes = results.poll_results[0].generic_choice_votes?.map((row) => ({ ...row, vote_count: 0, percentage: 0 }));
        results.poll_results[0].ranked_choice_votes = [];
      }
      if (!ranked) {
        results.poll_results.push({ ...results.poll_results[0], question: { ...results.poll_results[0].question, question_id: 'question-2' } });
      }
      voteService.getVoteResults.mockReturnValue(of(results));
      const fixture = await setupOverview();

      expect(testId(fixture, 'vote-detail-overview-bars')).toBeNull();
      expect(fixture.nativeElement.querySelectorAll('[data-testid="vote-detail-overview-abstain"]')).toHaveLength(1);
      expect(testId(fixture, 'vote-detail-overview-abstain')?.textContent).toContain('2 abstentions');
      expect(testId(fixture, 'vote-detail-overview-full-results')).not.toBeNull();
      expect(testId(fixture, 'vote-detail-results-empty')).toBeNull();
    });
    it('summarizes a ranked vote by first choices', async () => {
      voteService.fetchVote.mockReturnValue(of(makeVote({ poll_type: PollType.CONDORCET_IRV })));
      const fixture = await setupOverview();

      expect(summary(fixture)).toBe('Most first choices: Yes (2 voters)');
      expect(testId(fixture, 'vote-detail-overview-bars')).toBeNull();
      expect(fixture.nativeElement.querySelector('lfx-vote-ranked-question-results')).toBeNull();
    });

    it('shows only the held panel on a held pseudo-anonymous vote', async () => {
      voteService.fetchVote.mockReturnValue(of(makeVote({ pseudo_anonymity: true })));
      voteService.getVoteResults.mockReturnValue(of({ ...makeMethodResults(), results_held: true }));
      const fixture = await setupOverview();

      expect(testId(fixture, 'vote-detail-results-held')).not.toBeNull();
      expect(summary(fixture)).toBe('');
      expect(testId(fixture, 'vote-detail-overview-bars')).toBeNull();
      expect(testId(fixture, 'vote-detail-overview-abstain')).toBeNull();
      expect(testId(fixture, 'vote-detail-overview-results')?.textContent).not.toContain('Approve the roadmap?');
    });

    it('still tells a participant their vote is included', async () => {
      projectService.getProjectStrict.mockReturnValue(of({ writer: false } as Project));
      voteService.fetchVote.mockReturnValue(of(makeVote({ status: PollStatus.ENDED })));
      voteService.getMyVoteResponse.mockReturnValue(of(makeResponse(IndexedVoteResponseStatus.RESPONDED)));
      const fixture = await setupOverview();

      expect(testId(fixture, 'vote-detail-you-voted')?.textContent?.trim()).toBe('Your vote is included in these results.');
      expect(optionRow(fixture, 'choice-yes')).toContain('Winner');
    });

    it('opens the Results tab from "View full results"', async () => {
      const fixture = await setupOverview();
      const button = fixture.debugElement.query(By.css('[data-testid="vote-detail-overview-full-results"]'));

      expect(button.nativeElement.getAttribute('label')).toBe('View full results');
      button.triggerEventHandler('onClick', undefined);
      expect(router.navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: expect.objectContaining({ tab: 'results' }) }));
    });
  });
});
