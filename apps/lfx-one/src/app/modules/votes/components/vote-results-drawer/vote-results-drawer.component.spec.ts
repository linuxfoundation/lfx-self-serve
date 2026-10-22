// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { IndexedVoteResponseStatus, PollStatus, PollType } from '@lfx-one/shared/enums';
import { MyVoteResponse, PollCommentResponse, PollQuestionResult, Vote, VoteResultsResponse } from '@lfx-one/shared/interfaces';
import { VoteService } from '@services/vote.service';
import { Observable, of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { VoteResultsDrawerComponent } from './vote-results-drawer.component';

let fixture: ComponentFixture<VoteResultsDrawerComponent>;

afterEach(() => {
  fixture?.destroy();
  document.body.innerHTML = '';
});

function makeVote(status: PollStatus, uid = 'vote-1'): Vote {
  return { uid, name: 'Charter ratification', description: '<p>Approve the revised charter.</p>', project_uid: 'project-1', status } as Vote;
}

async function setupDrawer(vote: Vote, myResponse: Observable<MyVoteResponse | null> = of(null), audience: 'voter' | 'creator' = 'voter') {
  const service = {
    getVote: vi.fn(() => of(vote)),
    getMyVoteResponse: vi.fn(() => myResponse),
    getVoteResults: vi.fn(() => of(null)),
  };
  await TestBed.configureTestingModule({
    imports: [VoteResultsDrawerComponent],
    providers: [provideNoopAnimations(), provideRouter([]), { provide: VoteService, useValue: service }],
  }).compileComponents();
  fixture = TestBed.createComponent(VoteResultsDrawerComponent);
  fixture.componentRef.setInput('voteId', vote.uid);
  fixture.componentRef.setInput('audience', audience);
  fixture.componentRef.setInput('visible', true);
  await fixture.whenStable();
  fixture.detectChanges();
  return service;
}

describe('VoteResultsDrawerComponent — view-only permalink', () => {
  it.each([PollStatus.ACTIVE, PollStatus.ENDED])('shows vote details without casting or results for a non-voter (%s)', async (status) => {
    const service = await setupDrawer(makeVote(status));

    expect(document.querySelector('[data-testid="vote-results-voter-not-participant"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="vote-results-voter-description"]')?.textContent).toContain('Approve the revised charter.');
    expect(document.querySelector('[data-testid="vote-results-drawer-cast-button"]')).toBeNull();
    expect(document.querySelector('[data-testid="vote-results-voter-final"]')).toBeNull();
    expect(service.getVoteResults).not.toHaveBeenCalled();
  });

  it.each([PollStatus.ACTIVE, PollStatus.ENDED])('never fetches results for a removed voter (%s)', async (status) => {
    const service = await setupDrawer(makeVote(status), of({ uid: 'response-1', vote_uid: 'vote-1', voter_removed: true }));

    expect(document.querySelector('[data-testid="vote-results-voter-access-denied"]')).toBeTruthy();
    expect(service.getVoteResults).not.toHaveBeenCalled();
  });

  it.each([PollStatus.ACTIVE, PollStatus.ENDED])('fetches confirmed voter results only after close (%s)', async (status) => {
    const service = await setupDrawer(makeVote(status), of({ uid: 'response-1', vote_uid: 'vote-1' }));

    expect(service.getVoteResults).toHaveBeenCalledTimes(status === PollStatus.ENDED ? 1 : 0);
    if (status === PollStatus.ENDED) expect(service.getVoteResults).toHaveBeenCalledWith('vote-1');
  });

  it.each([PollStatus.ACTIVE, PollStatus.ENDED])('preserves creator results regardless of participation (%s)', async (status) => {
    const service = await setupDrawer(makeVote(status), of(null), 'creator');

    expect(service.getVoteResults).toHaveBeenCalledWith('vote-1');
    expect(service.getMyVoteResponse).not.toHaveBeenCalled();
  });

  it('waits for a pending participation check before requesting closed-vote results', async () => {
    const pending = new Subject<MyVoteResponse | null>();
    const service = await setupDrawer(makeVote(PollStatus.ENDED), pending);
    expect(service.getVoteResults).not.toHaveBeenCalled();

    pending.next({ uid: 'response-1', vote_uid: 'vote-1' });
    pending.complete();
    await fixture.whenStable();

    expect(service.getVoteResults).toHaveBeenCalledTimes(1);
    expect(service.getVoteResults).toHaveBeenCalledWith('vote-1');
  });

  it('does not request results when the participation check fails', async () => {
    const pending = new Subject<MyVoteResponse | null>();
    const service = await setupDrawer(makeVote(PollStatus.ENDED), pending);
    pending.error(new Error('Synthetic participation lookup failure'));
    await fixture.whenStable();

    expect(service.getVoteResults).not.toHaveBeenCalled();
    expect(fixture.componentInstance['myResponseError']()).toBe(true);
  });

  it('does not reuse the previous vote participation row while changing votes', async () => {
    const service = await setupDrawer(makeVote(PollStatus.ENDED), of({ uid: 'response-1', vote_uid: 'vote-1' }));
    expect(service.getVoteResults).toHaveBeenCalledTimes(1);

    const nextResponse = new Subject<MyVoteResponse | null>();
    service.getVote.mockReturnValue(of(makeVote(PollStatus.ENDED, 'vote-2')));
    service.getMyVoteResponse.mockReturnValue(nextResponse);
    fixture.componentRef.setInput('voteId', 'vote-2');
    await fixture.whenStable();
    expect(service.getVoteResults).toHaveBeenCalledTimes(1);

    nextResponse.next(null);
    nextResponse.complete();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(service.getVoteResults).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-testid="vote-results-voter-not-participant"]')).toBeTruthy();
  });

  // GH-3823 review (PRRT_kwDOPMiRQ86uAEES @cursor "Drawer reopen token double-fetches vote"): an effect()
  // bumping a reopen token fired in addition to combineLatest's own initial emission, so opening the drawer
  // called getVote twice. Pins the fix: initVote() keys off toObservable(visible) directly (the pattern
  // initMyResponse already used) instead of an effect()-driven counter, so opening fetches exactly once.
  it('fetches the vote exactly once when the drawer opens', async () => {
    const vote = makeVote(PollStatus.ACTIVE);
    const service = {
      getVote: vi.fn(() => of(vote)),
      getMyVoteResponse: vi.fn(() => of(null)),
      getVoteResults: vi.fn(() => of(null)),
    };
    await TestBed.configureTestingModule({
      imports: [VoteResultsDrawerComponent],
      providers: [provideNoopAnimations(), provideRouter([]), { provide: VoteService, useValue: service }],
    }).compileComponents();
    fixture = TestBed.createComponent(VoteResultsDrawerComponent);
    fixture.componentRef.setInput('voteId', vote.uid);
    fixture.componentRef.setInput('audience', 'voter');
    fixture.componentRef.setInput('visible', false);
    await fixture.whenStable();
    fixture.detectChanges();

    service.getVote.mockClear();
    fixture.componentRef.setInput('visible', true);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(service.getVote).toHaveBeenCalledTimes(1);
  });

  // GH-3823 review (PRRT_kwDOPMiRQ86uO6AL @greptile-apps, PRRT_kwDOPMiRQ86uO6wo @cursor,
  // PRRT_kwDOPMiRQ86uO-Du @copilot-pull-request-reviewer): the fix above forced initVote() to
  // re-emit on every visibility toggle but only destructured the id, so closing the drawer re-fetched
  // (and could clear) an already-loaded vote. Pins the fix: closing short-circuits with EMPTY instead,
  // so the last-loaded vote is retained through the close animation with no extra request.
  it('does not re-fetch the vote when the drawer closes', async () => {
    const vote = makeVote(PollStatus.ACTIVE);
    const service = {
      getVote: vi.fn(() => of(vote)),
      getMyVoteResponse: vi.fn(() => of(null)),
      getVoteResults: vi.fn(() => of(null)),
    };
    await TestBed.configureTestingModule({
      imports: [VoteResultsDrawerComponent],
      providers: [provideNoopAnimations(), provideRouter([]), { provide: VoteService, useValue: service }],
    }).compileComponents();
    fixture = TestBed.createComponent(VoteResultsDrawerComponent);
    fixture.componentRef.setInput('voteId', vote.uid);
    fixture.componentRef.setInput('audience', 'voter');
    fixture.componentRef.setInput('visible', true);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(service.getVote).toHaveBeenCalledTimes(1);

    service.getVote.mockClear();
    fixture.componentRef.setInput('visible', false);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(service.getVote).not.toHaveBeenCalled();
    expect(fixture.componentInstance['vote']()).toEqual(vote);
  });

  // GH-3823 review (PRRT_kwDOPMiRQ86uSzGw @cursor "Open drawer keeps stale deadline"): a manager extending
  // a vote's deadline from the table row while this drawer stays open on the same vote never re-fetched,
  // since neither voteId nor visible() changed — only the caller's listVote input updated once it re-fetched.
  // Pins the fix: initVote() also keys off listVote()'s end_time/end_time_timezone, so an extended deadline
  // re-fetches the vote while the drawer remains open.
  it('re-fetches the vote when the open listVote input gets an extended deadline', async () => {
    const vote = makeVote(PollStatus.ACTIVE);
    vote.end_time = '2026-01-01T00:00:00Z';
    const service = {
      getVote: vi.fn(() => of(vote)),
      getMyVoteResponse: vi.fn(() => of(null)),
      getVoteResults: vi.fn(() => of(null)),
    };
    await TestBed.configureTestingModule({
      imports: [VoteResultsDrawerComponent],
      providers: [provideNoopAnimations(), provideRouter([]), { provide: VoteService, useValue: service }],
    }).compileComponents();
    fixture = TestBed.createComponent(VoteResultsDrawerComponent);
    fixture.componentRef.setInput('voteId', vote.uid);
    fixture.componentRef.setInput('audience', 'voter');
    fixture.componentRef.setInput('visible', true);
    fixture.componentRef.setInput('listVote', vote);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(service.getVote).toHaveBeenCalledTimes(1);

    service.getVote.mockClear();
    const extended = { ...vote, end_time: '2026-02-01T00:00:00Z' };
    service.getVote.mockReturnValue(of(extended));
    fixture.componentRef.setInput('listVote', extended);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(service.getVote).toHaveBeenCalledTimes(1);
    expect(service.getVote).toHaveBeenCalledWith(vote.uid, { skipCache: true });
  });

  // GH-3823 review (PRRT_kwDOPMiRQ86uWkkK @copilot-pull-request-reviewer "stale cache on deadline
  // change"): getVote()/getVoteDetail() share a short-TTL request cache, so the re-fetch above could
  // still echo the pre-extension response if it landed within that TTL. Pins the fix against the real
  // VoteService (not the mock above): a deadline-change re-fetch passes skipCache so it always hits
  // the network, while a plain reopen on the same deadline still reuses the cached in-flight response.
  it('bypasses the real VoteService cache when the open listVote input gets an extended deadline', async () => {
    const vote = makeVote(PollStatus.ACTIVE);
    vote.end_time = '2026-01-01T00:00:00Z';

    await TestBed.configureTestingModule({
      imports: [VoteResultsDrawerComponent],
      providers: [provideNoopAnimations(), provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    const httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(VoteResultsDrawerComponent);
    fixture.componentRef.setInput('voteId', vote.uid);
    fixture.componentRef.setInput('audience', 'voter');
    fixture.componentRef.setInput('visible', true);
    fixture.componentRef.setInput('listVote', vote);
    await fixture.whenStable();
    fixture.detectChanges();

    const firstReq = httpMock.expectOne(`/api/votes/${vote.uid}`);
    firstReq.flush(vote);
    httpMock.expectOne((req) => req.url.includes('/my-response')).flush(null);

    const extended = { ...vote, end_time: '2026-02-01T00:00:00Z' };
    fixture.componentRef.setInput('listVote', extended);
    await fixture.whenStable();
    fixture.detectChanges();

    // A second real HTTP request — not the cached first response — proves skipCache worked.
    // (initMyResponse only keys off voteId/audience/visible, so it does not re-fire here.)
    const secondReq = httpMock.expectOne(`/api/votes/${vote.uid}`);
    secondReq.flush(extended);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance['vote']()).toEqual(extended);
    httpMock.verify();
  });

  it('does not re-fetch when listVote is replaced without a deadline change', async () => {
    const vote = makeVote(PollStatus.ACTIVE);
    vote.end_time = '2026-01-01T00:00:00Z';
    const service = {
      getVote: vi.fn(() => of(vote)),
      getMyVoteResponse: vi.fn(() => of(null)),
      getVoteResults: vi.fn(() => of(null)),
    };
    await TestBed.configureTestingModule({
      imports: [VoteResultsDrawerComponent],
      providers: [provideNoopAnimations(), provideRouter([]), { provide: VoteService, useValue: service }],
    }).compileComponents();
    fixture = TestBed.createComponent(VoteResultsDrawerComponent);
    fixture.componentRef.setInput('voteId', vote.uid);
    fixture.componentRef.setInput('audience', 'voter');
    fixture.componentRef.setInput('visible', true);
    fixture.componentRef.setInput('listVote', vote);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(service.getVote).toHaveBeenCalledTimes(1);

    service.getVote.mockClear();
    fixture.componentRef.setInput('listVote', { ...vote });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(service.getVote).not.toHaveBeenCalled();
  });

  // GH-3823 review (PRRT_kwDOPMiRQ86us6d4 @cursor "Null listVote clears open drawer"): a parent's list
  // re-fetch can momentarily drop the selected row (listVote -> null) while voteId/visible stay set, which
  // used to wipe the already-loaded vote via startWith(null). Pins the fix: initVote() falls back to the
  // last successfully-loaded vote for the same id while a new request is in flight.
  it('keeps the last-loaded vote visible when listVote goes null while the drawer stays open', async () => {
    const vote = makeVote(PollStatus.ACTIVE);
    const pending = new Subject<Vote>();
    const service = {
      getVote: vi.fn(() => of(vote)),
      getMyVoteResponse: vi.fn(() => of(null)),
      getVoteResults: vi.fn(() => of(null)),
    };
    await TestBed.configureTestingModule({
      imports: [VoteResultsDrawerComponent],
      providers: [provideNoopAnimations(), provideRouter([]), { provide: VoteService, useValue: service }],
    }).compileComponents();
    fixture = TestBed.createComponent(VoteResultsDrawerComponent);
    fixture.componentRef.setInput('voteId', vote.uid);
    fixture.componentRef.setInput('audience', 'voter');
    fixture.componentRef.setInput('visible', true);
    fixture.componentRef.setInput('listVote', vote);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.componentInstance['vote']()).toEqual(vote);

    service.getVote.mockReturnValue(pending);
    fixture.componentRef.setInput('listVote', null);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance['vote']()).toEqual(vote);
  });

  // GH-3823 review (PRRT_kwDOPMiRQ86us9by @copilot-pull-request-reviewer "independently emitting
  // observables... pair a newly selected vote B with vote A's previous listVote/deadline"): combineLatest's
  // three separately-emitting streams could interleave an id change with a stale listVote from the prior
  // selection. Pins the fix: initVote() observes one computed snapshot of id/visible/listVote together, so
  // switching straight to vote B (same equal deadline as A) and failing its detail fetch falls back to B's
  // own listVote row, never A's stale data.
  it('falls back to the newly selected vote on a failed detail fetch, never the previous selection', async () => {
    const voteA = makeVote(PollStatus.ACTIVE, 'vote-a');
    voteA.end_time = '2026-01-01T00:00:00Z';
    const voteB = makeVote(PollStatus.ACTIVE, 'vote-b');
    voteB.end_time = '2026-01-01T00:00:00Z';
    const service = {
      getVote: vi.fn(() => of(voteA)),
      getMyVoteResponse: vi.fn(() => of(null)),
      getVoteResults: vi.fn(() => of(null)),
    };
    await TestBed.configureTestingModule({
      imports: [VoteResultsDrawerComponent],
      providers: [provideNoopAnimations(), provideRouter([]), { provide: VoteService, useValue: service }],
    }).compileComponents();
    fixture = TestBed.createComponent(VoteResultsDrawerComponent);
    fixture.componentRef.setInput('voteId', voteA.uid);
    fixture.componentRef.setInput('audience', 'voter');
    fixture.componentRef.setInput('visible', true);
    fixture.componentRef.setInput('listVote', voteA);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.componentInstance['vote']()).toEqual(voteA);

    service.getVote.mockReturnValue(throwError(() => new Error('Synthetic vote-b detail failure')));
    fixture.componentRef.setInput('voteId', voteB.uid);
    fixture.componentRef.setInput('listVote', voteB);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance['vote']()).toEqual(voteB);
  });

  // GH-3823 review (PRRT_kwDOPMiRQ86us9by @copilot-pull-request-reviewer): with different deadlines, the
  // old combineLatest could fire a second request off the id-change emission, then another off the
  // listVote-change emission. Pins the fix: one atomic snapshot issues exactly one detail request when id
  // and listVote change together.
  it('issues exactly one detail request when switching to a vote with a different deadline', async () => {
    const voteA = makeVote(PollStatus.ACTIVE, 'vote-a');
    voteA.end_time = '2026-01-01T00:00:00Z';
    const voteB = makeVote(PollStatus.ACTIVE, 'vote-b');
    voteB.end_time = '2026-03-01T00:00:00Z';
    const service = {
      getVote: vi.fn(() => of(voteA)),
      getMyVoteResponse: vi.fn(() => of(null)),
      getVoteResults: vi.fn(() => of(null)),
    };
    await TestBed.configureTestingModule({
      imports: [VoteResultsDrawerComponent],
      providers: [provideNoopAnimations(), provideRouter([]), { provide: VoteService, useValue: service }],
    }).compileComponents();
    fixture = TestBed.createComponent(VoteResultsDrawerComponent);
    fixture.componentRef.setInput('voteId', voteA.uid);
    fixture.componentRef.setInput('audience', 'voter');
    fixture.componentRef.setInput('visible', true);
    fixture.componentRef.setInput('listVote', voteA);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(service.getVote).toHaveBeenCalledTimes(1);

    service.getVote.mockClear();
    service.getVote.mockReturnValue(of(voteB));
    fixture.componentRef.setInput('voteId', voteB.uid);
    fixture.componentRef.setInput('listVote', voteB);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(service.getVote).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance['vote']()).toEqual(voteB);
  });
});

// Characterization tests for GH-3912: pin the rendered results (participation, option bars, abstain row,
// ranked breakdown, comments) so extracting them into reusable components changes nothing visible.
function makeResultsVote(overrides: Partial<Vote> = {}): Vote {
  return { ...makeVote(PollStatus.ACTIVE), poll_type: PollType.GENERIC, allow_abstain: true, ...overrides } as Vote;
}

function makeResults(overrides: Partial<VoteResultsResponse> = {}): VoteResultsResponse {
  return {
    poll_results: [],
    comment_results: [],
    num_recipients: 10,
    num_votes_cast: 5,
    num_abstained: 1,
    poll_end_time: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

/** Builds a generic question from [choiceId, voteCount, apiPercentage] tuples. */
function makeGenericQuestion(questionId: string, counts: [string, number, number][]): PollQuestionResult {
  return {
    question: {
      question_id: questionId,
      prompt: `Synthetic question ${questionId}`,
      type: 'single_choice',
      choices: counts.map(([choiceId]) => ({ choice_id: choiceId, choice_text: `Synthetic option ${choiceId}` })),
    },
    generic_choice_votes: counts.map(([choiceId, voteCount, percentage]) => ({ choice_id: choiceId, vote_count: voteCount, percentage })),
    ranked_choice_votes: [],
  };
}

/** Builds a ranked question from choiceId → [rank, count] pairs. */
function makeRankedQuestion(questionId: string, choices: Record<string, [number, number][]>, withRoundSummary = false): PollQuestionResult {
  const choiceIds = Object.keys(choices);
  return {
    question: {
      question_id: questionId,
      prompt: `Synthetic ranked question ${questionId}`,
      type: 'single_choice',
      choices: choiceIds.map((choiceId) => ({ choice_id: choiceId, choice_text: `Synthetic candidate ${choiceId}` })),
    },
    generic_choice_votes: [],
    ranked_choice_votes: choiceIds.map((choiceId) => ({
      choice_id: choiceId,
      rank_counts: choices[choiceId].map(([rank, count]) => ({ rank, count })),
      condorcet_matrix: [],
    })),
    irv_round_summary: withRoundSummary ? { rounds: [] } : undefined,
  };
}

/** Newest-first synthetic comments: index 1 is the most recent. */
function makeComments(promptId: string, count: number): PollCommentResponse[] {
  return Array.from({ length: count }, (_, i) => ({
    vote_id: `${promptId}-response-${i + 1}`,
    comment_text: `Synthetic ${promptId} comment ${String(i + 1).padStart(2, '0')}`,
    user_name: `Synthetic Voter ${i + 1}`,
    vote_creation_time: new Date(Date.UTC(2026, 0, 31) - i * 60_000).toISOString(),
    abstained: false,
  }));
}

async function setupResultsDrawer(
  vote: Vote,
  results: VoteResultsResponse,
  audience: 'voter' | 'creator' = 'creator',
  myResponse: MyVoteResponse | null = null
) {
  const service = {
    getVote: vi.fn(() => of(vote)),
    getMyVoteResponse: vi.fn(() => of(myResponse)),
    getVoteResults: vi.fn(() => of(results)),
  };
  await TestBed.configureTestingModule({
    imports: [VoteResultsDrawerComponent],
    providers: [provideNoopAnimations(), provideRouter([]), { provide: VoteService, useValue: service }],
  }).compileComponents();
  fixture = TestBed.createComponent(VoteResultsDrawerComponent);
  fixture.componentRef.setInput('voteId', vote.uid);
  fixture.componentRef.setInput('audience', audience);
  fixture.componentRef.setInput('visible', true);
  await fixture.whenStable();
  fixture.detectChanges();
  return service;
}

function byTestId(testId: string): HTMLElement | null {
  return document.querySelector(`[data-testid="${testId}"]`);
}

/** Strips all whitespace: Angular drops inter-element whitespace, so adjacent elements' text runs together. */
function squash(text: string): string {
  return text.replace(/\s+/g, '');
}

function textOf(testId: string): string {
  return squash(byTestId(testId)?.textContent ?? '');
}

const RESPONDED_VOTER: MyVoteResponse = { uid: 'response-1', vote_uid: 'vote-1', vote_status: IndexedVoteResponseStatus.RESPONDED };

describe('VoteResultsDrawerComponent — rendered results', () => {
  it('renders live option bars, the abstain row and the participation card for an active generic vote', async () => {
    await setupResultsDrawer(
      makeResultsVote(),
      makeResults({
        poll_results: [
          makeGenericQuestion('q1', [
            ['c1', 3, 60],
            ['c2', 1, 20],
          ]),
        ],
      })
    );

    expect(textOf('vote-results-option-c1')).toContain(squash('Synthetic option c1'));
    expect(textOf('vote-results-option-c1')).toContain(squash('3 votes · 60%'));
    expect(textOf('vote-results-option-c2')).toContain(squash('1 vote · 20%'));
    // Leading option gets the blue bar and bold text; the trailing option stays muted.
    expect(byTestId('vote-results-option-c1')?.querySelector('.bg-blue-500')).toBeTruthy();
    expect(byTestId('vote-results-option-c1')?.querySelector('.font-semibold')).toBeTruthy();
    expect(byTestId('vote-results-option-c2')?.querySelector('.bg-slate-300')).toBeTruthy();
    expect(byTestId('vote-results-option-c1')?.textContent).not.toContain('Winner');

    expect(textOf('vote-results-option-abstain')).toContain(squash('Abstain'));
    expect(textOf('vote-results-option-abstain')).toContain(squash('1 abstention · 20%'));

    const participation = textOf('vote-results-participation');
    expect(participation).toContain(squash('Total Participants 10'));
    expect(participation).toContain(squash('Total Responses 5'));
    expect(participation).toContain(squash('Response Rate 50%'));
    expect(textOf('vote-results-abstained-stat')).toBe(squash('Abstained 1'));
    expect(byTestId('vote-results-participation')?.querySelector<HTMLElement>('.bg-blue-500')?.style.width).toBe('50%');
  });

  it('marks the winner on an ended generic vote and keeps the white bar track', async () => {
    await setupResultsDrawer(
      makeResultsVote({ status: PollStatus.ENDED }),
      makeResults({
        num_abstained: 2,
        poll_results: [
          makeGenericQuestion('q1', [
            ['c1', 3, 60],
            ['c2', 0, 0],
          ]),
        ],
      })
    );

    expect(textOf('vote-results-option-c1')).toContain(squash('Winner'));
    expect(textOf('vote-results-option-c1')).toContain(squash('3 votes (60%)'));
    expect(byTestId('vote-results-option-c1')?.classList).toContain('border-green-300');
    expect(byTestId('vote-results-option-c1')?.querySelector('.bg-white')).toBeTruthy();
    expect(textOf('vote-results-option-c2')).not.toContain(squash('Winner'));
    expect(textOf('vote-results-option-c2')).toContain(squash('0 votes (0%)'));

    expect(textOf('vote-results-option-abstain')).toContain(squash('2 abstentions (40%)'));
    expect(byTestId('vote-results-option-abstain')?.querySelector('.bg-white')).toBeTruthy();
    expect(byTestId('vote-results-participation')).toBeTruthy();
  });

  it('marks tied options on an ended generic vote', async () => {
    await setupResultsDrawer(
      makeResultsVote({ status: PollStatus.ENDED }),
      makeResults({
        poll_results: [
          makeGenericQuestion('q1', [
            ['c1', 2, 40],
            ['c2', 2, 40],
          ]),
        ],
      })
    );

    expect(textOf('vote-results-option-c1')).toContain(squash('Tied'));
    expect(textOf('vote-results-option-c2')).toContain(squash('Tied'));
    expect(textOf('vote-results-option-c1')).not.toContain(squash('Winner'));
    expect(byTestId('vote-results-option-c1')?.classList).toContain('border-amber-300');
  });

  it('falls back to num_votes_cast when the API omits a percentage', async () => {
    await setupResultsDrawer(
      makeResultsVote({ status: PollStatus.ENDED }),
      makeResults({
        poll_results: [
          makeGenericQuestion('q1', [
            ['c1', 2, 0],
            ['c2', 2, 0],
          ]),
        ],
      })
    );

    expect(textOf('vote-results-option-c1')).toContain(squash('2 votes (40%)'));
  });

  it('renders the voter final results with the slate-100 bar track and voter test ids', async () => {
    await setupResultsDrawer(
      makeResultsVote({ status: PollStatus.ENDED }),
      makeResults({
        poll_results: [
          makeGenericQuestion('q1', [
            ['c1', 3, 60],
            ['c2', 1, 20],
          ]),
        ],
      }),
      'voter',
      RESPONDED_VOTER
    );

    expect(byTestId('vote-results-voter-final')).toBeTruthy();
    expect(textOf('vote-results-voter-option-c1')).toContain(squash('Winner'));
    expect(textOf('vote-results-voter-option-c1')).toContain(squash('3 votes (60%)'));
    expect(byTestId('vote-results-voter-option-c1')?.querySelector('.bg-slate-100')).toBeTruthy();
    expect(byTestId('vote-results-voter-option-c1')?.querySelector('.bg-white')).toBeNull();
    expect(textOf('vote-results-voter-option-abstain')).toContain(squash('1 abstention (20%)'));
    // Voters never see the creator participation card or creator option ids.
    expect(byTestId('vote-results-participation')).toBeNull();
    expect(byTestId('vote-results-option-c1')).toBeNull();
  });

  it('shows "No votes were submitted." to a voter when the closed vote has zero responses', async () => {
    await setupResultsDrawer(
      makeResultsVote({ status: PollStatus.ENDED, allow_abstain: false }),
      makeResults({ num_votes_cast: 0, num_abstained: 0, poll_results: [makeGenericQuestion('q1', [['c1', 0, 0]])] }),
      'voter',
      RESPONDED_VOTER
    );

    expect(textOf('vote-results-voter-zero-responses')).toBe(squash('No votes were submitted.'));
    expect(byTestId('vote-results-voter-option-abstain')).toBeNull();
  });

  // #4075: majority is not in isRankedPollType's allowlist, so it must render through the plurality
  // results block (like generic), not the ranked one, and get its own voting-method label.
  it('renders a majority vote through the plurality results block, not the ranked one', async () => {
    await setupResultsDrawer(
      makeResultsVote({ poll_type: PollType.MAJORITY }),
      makeResults({
        poll_results: [
          makeGenericQuestion('q1', [
            ['c1', 3, 60],
            ['c2', 1, 20],
          ]),
        ],
      })
    );

    expect(byTestId('vote-results-participation')).toBeTruthy();
    expect(byTestId('vote-results-ranked')).toBeNull();
    expect(textOf('vote-results-drawer-header')).toContain(squash('Majority Vote'));
  });

  it('renders the creator ranked breakdown with test ids, empty states and the round-summary banner', async () => {
    await setupResultsDrawer(
      makeResultsVote({ status: PollStatus.ENDED, poll_type: PollType.INSTANT_RUNOFF_VOTE }),
      makeResults({
        poll_results: [
          makeRankedQuestion(
            'q1',
            {
              c1: [
                [1, 3],
                [2, 1],
              ],
              c2: [],
            },
            true
          ),
          makeRankedQuestion('q2', {}),
        ],
      })
    );

    expect(textOf('vote-results-ranked-participation')).toContain(squash('Total Participants 10'));
    expect(textOf('vote-results-ranked-question-q1')).toContain(squash('Synthetic ranked question q1'));
    const c1 = textOf('vote-results-ranked-choice-c1');
    expect(c1).toContain(squash('Synthetic candidate c1'));
    expect(c1).toContain(squash('4 voters'));
    expect(c1).toContain(squash('Rank 1 3 75%'));
    expect(c1).toContain(squash('Rank 2 1 25%'));
    expect(textOf('vote-results-ranked-choice-c2')).toContain(squash('0 voters'));
    expect(textOf('vote-results-ranked-choice-c2')).toContain(squash('No rankings recorded yet.'));
    expect(byTestId('vote-results-ranked-rounds-q1')).toBeTruthy();
    expect(byTestId('vote-results-ranked-rounds-q2')).toBeNull();
    expect(textOf('vote-results-ranked-question-empty-q2')).toBe(squash('No ranked results recorded yet for this question.'));
  });

  it('renders the voter ranked breakdown without the creator test ids', async () => {
    await setupResultsDrawer(
      makeResultsVote({ status: PollStatus.ENDED, poll_type: PollType.INSTANT_RUNOFF_VOTE }),
      makeResults({
        poll_results: [
          makeRankedQuestion(
            'q1',
            {
              c1: [
                [1, 3],
                [2, 1],
              ],
            },
            true
          ),
        ],
      }),
      'voter',
      RESPONDED_VOTER
    );

    const ranked = textOf('vote-results-voter-final-ranked');
    expect(ranked).toContain(squash('Synthetic ranked question q1'));
    expect(ranked).toContain(squash('Synthetic candidate c1 4 voters'));
    expect(ranked).toContain(squash('Rank 1 3 75%'));
    expect(textOf('vote-results-voter-option-abstain')).toContain(squash('1 abstention (20%)'));
    expect(byTestId('vote-results-ranked-question-q1')).toBeNull();
    expect(byTestId('vote-results-ranked-choice-c1')).toBeNull();
    expect(byTestId('vote-results-ranked-rounds-q1')).toBeNull();
    expect(byTestId('vote-results-ranked-participation')).toBeNull();
  });

  describe('comments', () => {
    const commentVote = () =>
      makeResultsVote({
        status: PollStatus.ENDED,
        poll_comment_prompts: [
          { prompt_id: 'p1', prompt: 'Synthetic prompt one' },
          { prompt_id: 'p2', prompt: 'Synthetic prompt two' },
          { prompt_id: 'p3', prompt: 'Synthetic prompt three' },
        ],
      });
    const commentResults = () =>
      makeResults({
        poll_results: [makeGenericQuestion('q1', [['c1', 4, 80]])],
        comment_results: [
          { prompt: { prompt_id: 'p1', prompt: 'Synthetic prompt one' }, responses: makeComments('p1', 30), total_responses: 40 },
          {
            prompt: { prompt_id: 'p3', prompt: 'Synthetic prompt three' },
            responses: [...makeComments('p3', 1), { ...makeComments('p3', 2)[1], user_name: undefined }],
          },
        ],
      });

    it('renders prompts, empty states, the paginator above the page size and the truncation notice', async () => {
      await setupResultsDrawer(commentVote(), commentResults());

      const comments = textOf('vote-results-comments');
      expect(comments).toContain(squash('Synthetic prompt one'));
      expect(comments).toContain(squash('Synthetic p1 comment 01'));
      expect(comments).toContain(squash('Synthetic p1 comment 25'));
      expect(comments).not.toContain(squash('Synthetic p1 comment 26'));
      expect(comments).toContain(squash('Synthetic Voter 1'));
      expect(comments).toContain(squash('Anonymous'));

      expect(textOf('vote-results-comments-empty-p2')).toBe(squash('No responses yet.'));
      expect(byTestId('vote-results-comments-paginator-p1')).toBeTruthy();
      expect(byTestId('vote-results-comments-paginator-p3')).toBeNull();
      expect(textOf('vote-results-comments-truncated-p1')).toBe(squash('Showing the 30 most recent of 40 responses.'));
      expect(byTestId('vote-results-comments-truncated-p3')).toBeNull();
      // Comment cards keep the class the slate-50 fade rule (now in the comment-results stylesheet) targets.
      expect(byTestId('vote-results-comments')?.querySelector('lfx-expandable-text.comment-text')).toBeTruthy();
    });

    it('keeps the comment page across a close and reopen', async () => {
      await setupResultsDrawer(commentVote(), commentResults());

      byTestId('vote-results-comments-paginator-p1')?.querySelector<HTMLButtonElement>('.p-paginator-next')?.click();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(textOf('vote-results-comments')).toContain(squash('Synthetic p1 comment 26'));
      expect(textOf('vote-results-comments')).not.toContain(squash('Synthetic p1 comment 01'));
      // The page lives in the drawer (two-way pageState binding), so it outlives any teardown of the comment-results child.
      expect(fixture.componentInstance['commentPaginatorState']().get('p1')).toEqual({ first: 25, rows: 25 });

      fixture.componentRef.setInput('visible', false);
      await fixture.whenStable();
      fixture.detectChanges();
      fixture.componentRef.setInput('visible', true);
      await fixture.whenStable();
      fixture.detectChanges();

      expect(textOf('vote-results-comments')).toContain(squash('Synthetic p1 comment 26'));
      expect(textOf('vote-results-comments')).not.toContain(squash('Synthetic p1 comment 01'));
    });

    it('keeps the voter comment page when the reopen reload recreates the comment list', async () => {
      const service = await setupResultsDrawer(commentVote(), commentResults(), 'voter', RESPONDED_VOTER);

      byTestId('vote-results-comments-paginator-p1')?.querySelector<HTMLButtonElement>('.p-paginator-next')?.click();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(textOf('vote-results-voter-comments')).toContain(squash('Synthetic p1 comment 26'));

      // Reopening refetches the voter's response; while it is pending the skeleton replaces (destroys) the comment list.
      const reload = new Subject<MyVoteResponse | null>();
      service.getMyVoteResponse.mockReturnValue(reload);
      fixture.componentRef.setInput('visible', false);
      await fixture.whenStable();
      fixture.detectChanges();
      fixture.componentRef.setInput('visible', true);
      await fixture.whenStable();
      fixture.detectChanges();
      expect(byTestId('vote-results-drawer-voter-loading')).toBeTruthy();
      expect(byTestId('vote-results-voter-comments')).toBeNull();

      reload.next(RESPONDED_VOTER);
      reload.complete();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(textOf('vote-results-voter-comments')).toContain(squash('Synthetic p1 comment 26'));
      expect(textOf('vote-results-voter-comments')).not.toContain(squash('Synthetic p1 comment 01'));
    });

    it('hides comments when the results load fails', async () => {
      const service = await setupResultsDrawer(commentVote(), commentResults());
      service.getVoteResults.mockReturnValue(throwError(() => new Error('Synthetic results failure')));
      fixture.componentRef.setInput('voteId', 'vote-2');
      await fixture.whenStable();
      fixture.detectChanges();

      expect(byTestId('vote-results-comments')).toBeNull();
    });
  });
});
