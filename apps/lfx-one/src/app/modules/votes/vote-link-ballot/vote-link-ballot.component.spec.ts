// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { VoteBallotSubmission, VoteLinkBallot } from '@lfx-one/shared/interfaces';
import { VoteService } from '@services/vote.service';
import { Observable, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VoteLinkBallotComponent } from './vote-link-ballot.component';

// Synthetic fixtures only. The token is a placeholder, never a real credential.
const TOKEN = 'v1.synthetic.token';
const PATH = '/votes/v-1';

const BALLOT: VoteLinkBallot = {
  vote_uid: 'v-1',
  name: 'Synthetic board vote',
  description: 'Pick one',
  status: 'active',
  end_time: '2099-01-01T00:00:00Z',
  poll_type: 'generic',
  allow_abstain: true,
  pseudo_anonymity: false,
  poll_questions: [
    {
      question_id: 'q1',
      prompt: 'Who?',
      type: 'single_choice',
      choices: [
        { choice_id: 'c-a', choice_text: 'Alice' },
        { choice_id: 'c-b', choice_text: 'Bob' },
      ],
    },
  ],
  ballot: { vote_status: 'awaiting_response', already_voted: false, voter_removed: false },
};

const httpError = (status: number, message: string) => new HttpErrorResponse({ status, error: { error: message } });
const SUBMISSION: VoteBallotSubmission = { abstain: false, userVoteContent: [{ question_id: 'q1', choice_ids: ['c-a'] }] };

describe('VoteLinkBallotComponent (#4363)', () => {
  let fixture: ComponentFixture<VoteLinkBallotComponent>;
  let getLinkBallot: ReturnType<typeof vi.fn>;
  let submitLinkResponse: ReturnType<typeof vi.fn>;

  const state = () => (fixture.componentInstance as unknown as { state: () => string }).state();
  const submit = (submission = SUBMISSION) => (fixture.componentInstance as unknown as { onSubmit: (s: VoteBallotSubmission) => void }).onSubmit(submission);
  const testId = (id: string) => fixture.nativeElement.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

  async function open(ballot: Observable<VoteLinkBallot>, hash = `#vote_token=${TOKEN}`): Promise<void> {
    window.history.replaceState(null, '', `${PATH}${hash}`);
    getLinkBallot.mockReturnValue(ballot);
    fixture = TestBed.createComponent(VoteLinkBallotComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(() => {
    getLinkBallot = vi.fn();
    submitLinkResponse = vi.fn(() => of(undefined));
    TestBed.configureTestingModule({
      imports: [VoteLinkBallotComponent],
      providers: [provideNoopAnimations(), { provide: VoteService, useValue: { getLinkBallot, submitLinkResponse } }],
    });
  });

  afterEach(() => window.history.replaceState(null, '', '/'));

  it('reads the fragment token once, sends it to the ballot call, and removes the fragment from the address bar', async () => {
    await open(of(BALLOT));

    expect(getLinkBallot).toHaveBeenCalledExactlyOnceWith(TOKEN);
    expect(window.location.hash).toBe('');
    expect(window.location.pathname).toBe(PATH);
    expect(state()).toBe('ready');
  });

  it('keeps the query string when it drops the fragment', async () => {
    await open(of(BALLOT), `?src=email#vote_token=${TOKEN}`);

    expect(window.location.search).toBe('?src=email');
    expect(window.location.hash).toBe('');
  });

  it('never writes the token to browser storage', async () => {
    const local = vi.spyOn(Storage.prototype, 'setItem');
    await open(of(BALLOT));
    submit();

    expect(local).not.toHaveBeenCalled();
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain(TOKEN);
  });

  it('shows the invalid-link state when there is no token, without calling the API', async () => {
    await open(of(BALLOT), '');

    expect(getLinkBallot).not.toHaveBeenCalled();
    expect(state()).toBe('invalid');
    expect(testId('vote-link-invalid')?.textContent).toContain('This link is invalid or has expired');
  });

  it('renders the vote and form for an active vote with title and description only, no identity chrome', async () => {
    await open(of(BALLOT));

    expect(testId('vote-link-title')?.textContent).toContain('Synthetic board vote');
    expect(testId('vote-link-description')).not.toBeNull();
    expect(testId('vote-link-ballot-form')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('lfx-header, lfx-navbar, [data-testid="user-menu"]')).toBeNull();
  });

  it('renders the loading state before the ballot arrives', async () => {
    window.history.replaceState(null, '', `${PATH}#vote_token=${TOKEN}`);
    getLinkBallot.mockReturnValue(new Observable<VoteLinkBallot>());
    fixture = TestBed.createComponent(VoteLinkBallotComponent);
    fixture.detectChanges();

    expect(state()).toBe('loading');
    expect(testId('vote-link-loading')).not.toBeNull();
  });

  it.each([
    ['not active', { ...BALLOT, status: 'disabled' }, 'not-open', "This vote isn't open yet"],
    ['ended', { ...BALLOT, status: 'ended' }, 'ended', 'This vote has ended'],
    ['voter removed', { ...BALLOT, ballot: { ...BALLOT.ballot, voter_removed: true } }, 'removed', "You're no longer a voter on this vote"],
  ])('shows no form for a %s vote', async (_label, ballot, expectedState, text) => {
    await open(of(ballot));

    expect(state()).toBe(expectedState);
    expect(fixture.nativeElement.textContent).toContain(text);
    expect(testId('vote-link-ballot-form')).toBeNull();
  });

  it.each([
    [404, 'invalid voting link', 'invalid'],
    [400, 'poll has ended', 'ended'],
    [400, 'voter has been removed', 'removed'],
    [503, 'service unavailable', 'error'],
    [413, 'payload too large', 'error'],
  ])('maps a %s ballot-read error (%s) to the %s state', async (status, message, expectedState) => {
    await open(throwError(() => httpError(status, message)));

    expect(state()).toBe(expectedState);
  });

  it('offers to update an already-submitted ballot, then shows the prefilled form and saves with PUT', async () => {
    await open(
      of({
        ...BALLOT,
        ballot: {
          vote_status: 'responded',
          already_voted: true,
          voter_removed: false,
          abstained: false,
          poll_answers: [{ question_id: 'q1', prompt: 'Who?', type: 'single_choice', user_choice: [{ choice_id: 'c-b', choice_text: 'Bob' }] }],
        },
      })
    );

    expect(testId('vote-link-update-prompt')?.textContent).toContain("You've already voted. Update your ballot?");
    expect(testId('vote-link-ballot-form')).toBeNull();

    testId('vote-link-update-button')?.querySelector('button')?.click();
    fixture.detectChanges();
    expect(testId('vote-link-ballot-form')).not.toBeNull();

    submit();
    expect(submitLinkResponse).toHaveBeenCalledWith({ vote_token: TOKEN, abstain: false, user_vote_content: SUBMISSION.userVoteContent }, true);
    expect(state()).toBe('updated');
  });

  it('submits a first ballot with POST, with the token only in the body, and confirms', async () => {
    await open(of(BALLOT));
    submit();

    expect(submitLinkResponse).toHaveBeenCalledExactlyOnceWith({ vote_token: TOKEN, abstain: false, user_vote_content: SUBMISSION.userVoteContent }, false);
    expect(state()).toBe('submitted');
    fixture.detectChanges();
    expect(testId('vote-link-submitted')).not.toBeNull();
  });

  it('switches to update mode and retries once with PUT when POST says the ballot is not awaiting a response', async () => {
    submitLinkResponse.mockReturnValueOnce(throwError(() => httpError(400, 'vote is not awaiting response'))).mockReturnValueOnce(of(undefined));
    await open(of(BALLOT));
    submit();

    expect(submitLinkResponse).toHaveBeenCalledTimes(2);
    expect(submitLinkResponse.mock.calls[0][1]).toBe(false);
    expect(submitLinkResponse.mock.calls[1][1]).toBe(true);
    expect(state()).toBe('updated');
  });

  it('retries only once: a second not-awaiting error is surfaced, not looped', async () => {
    submitLinkResponse.mockReturnValue(throwError(() => httpError(400, 'vote is not awaiting response')));
    await open(of(BALLOT));
    submit();

    expect(submitLinkResponse).toHaveBeenCalledTimes(2);
    expect(state()).not.toBe('updated');
  });

  it('switches to POST when PUT says no ballot has been submitted', async () => {
    submitLinkResponse.mockReturnValueOnce(throwError(() => httpError(400, 'vote is not responded'))).mockReturnValueOnce(of(undefined));
    await open(of({ ...BALLOT, ballot: { ...BALLOT.ballot, already_voted: true } }));
    submit();

    expect(submitLinkResponse.mock.calls.map(([, update]) => update)).toEqual([true, false]);
    expect(state()).toBe('submitted');
  });

  it.each([
    [404, 'invalid voting link', 'invalid'],
    [400, 'poll has ended', 'ended'],
    [400, 'voter has been removed', 'removed'],
  ])('maps a %s submit error (%s) to the %s state', async (status, message, expectedState) => {
    submitLinkResponse.mockReturnValue(throwError(() => httpError(status, message)));
    await open(of(BALLOT));
    submit();

    expect(state()).toBe(expectedState);
  });

  it('keeps the form and shows the upstream message for another 400', async () => {
    submitLinkResponse.mockReturnValue(throwError(() => httpError(400, 'choice is not valid')));
    await open(of(BALLOT));
    submit();
    fixture.detectChanges();

    expect(state()).toBe('ready');
    expect(testId('vote-link-inline-error')?.textContent).toContain('choice is not valid');
  });

  it('sets a no-referrer meta tag while mounted', async () => {
    await open(of(BALLOT));

    expect(document.head.querySelector('meta[name="referrer"]')?.getAttribute('content')).toBe('no-referrer');
    fixture.destroy();
    expect(document.head.querySelector('meta[name="referrer"]')).toBeNull();
  });
});
