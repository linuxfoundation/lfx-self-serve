// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { VOTE_PRESENTER_RESULTS_HOLD_MAX_ATTEMPTS, VOTE_PRESENTER_RESULTS_HOLD_RETRY_MS } from '@lfx-one/shared/constants';
import { PollStatus, PollType } from '@lfx-one/shared/enums';
import { Vote, VoteResultsResponse } from '@lfx-one/shared/interfaces';
import { VoteService } from '@services/vote.service';
import { MessageService } from 'primeng/api';
import { BehaviorSubject, NEVER, of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VotePresenterComponent } from './vote-presenter.component';

const baseVote = (overrides: Partial<Vote> = {}): Vote =>
  ({
    uid: 'v1',
    name: 'Approve the 2027 budget',
    status: PollStatus.ACTIVE,
    poll_type: PollType.GENERIC,
    committee_name: 'Governing Board',
    end_time: '2026-12-01T17:00:00Z',
    num_response_received: 3,
    total_voting_request_invitations: 10,
    allow_abstain: false,
    ...overrides,
  }) as Vote;

const results = (): VoteResultsResponse =>
  ({
    num_recipients: 10,
    num_votes_cast: 9,
    num_abstained: 1,
    generic_choice_votes: [],
  }) as unknown as VoteResultsResponse;

describe('VotePresenterComponent', () => {
  let fetchVote: ReturnType<typeof vi.fn>;
  let getVoteResults: ReturnType<typeof vi.fn>;
  let navigateByUrl: ReturnType<typeof vi.fn>;
  let fixture: ComponentFixture<VotePresenterComponent>;

  const text = (testId: string): string => (fixture.nativeElement.querySelector(`[data-testid="${testId}"]`)?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const has = (testId: string): boolean => !!fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const tick = async (ms: number): Promise<void> => {
    await vi.advanceTimersByTimeAsync(ms);
    fixture.detectChanges();
  };

  const mount = async (): Promise<void> => {
    fixture = TestBed.createComponent(VotePresenterComponent);
    fixture.detectChanges();
    await tick(0);
  };

  beforeEach(() => {
    vi.useFakeTimers();
    fetchVote = vi.fn(() => of(baseVote()));
    getVoteResults = vi.fn(() => of(results()));
    navigateByUrl = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: VoteService, useValue: { fetchVote, getVoteResults } },
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ id: 'v1' })) } },
        { provide: Router, useValue: { navigateByUrl } },
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    });
  });

  afterEach(() => vi.useRealTimers());

  it('renders the count, link-first share panel and a disabled Close with the #4370 tooltip while open', async () => {
    await mount();
    expect(text('vote-presenter-count')).toBe('3 of 10 voters have cast');
    expect(text('vote-presenter-link')).toContain('/votes/v1');
    expect(has('vote-presenter-copy-link')).toBe(true);
    expect(has('vote-qr')).toBe(true);
    expect(fixture.nativeElement.querySelector('[data-testid="vote-presenter-close"] button')?.disabled).toBe(true);
    expect(getVoteResults).not.toHaveBeenCalled();
  });

  it('offers Send ballots now and the updated QR copy while the vote is active (#4363)', async () => {
    await mount();
    expect(has('vote-presenter-send-ballots')).toBe(true);
    expect(text('vote-presenter-share')).toContain("Didn't get the email? Scan to open your ballot");
    expect(text('vote-presenter-share')).not.toContain('In the room? Scan instead');
  });

  it('does not offer Send ballots now once the vote has ended (#4363)', async () => {
    fetchVote.mockReturnValue(of(baseVote({ status: PollStatus.ENDED })));
    await mount();
    expect(has('vote-presenter-send-ballots')).toBe(false);
  });

  it('never requests results, and shows no tallies, while the vote is active across many polls', async () => {
    await mount();
    await tick(30_000);
    expect(fetchVote.mock.calls.length).toBeGreaterThan(3);
    expect(getVoteResults).not.toHaveBeenCalled();
    expect(has('vote-presenter-results')).toBe(false);
  });

  it('updates the count from the next poll without a reload', async () => {
    fetchVote.mockReturnValueOnce(of(baseVote())).mockReturnValue(of(baseVote({ num_response_received: 7 })));
    await mount();
    await tick(5000);
    expect(text('vote-presenter-count')).toBe('7 of 10 voters have cast');
  });

  it('requests results exactly once while the vote stays ended, though polling continues', async () => {
    fetchVote.mockReturnValueOnce(of(baseVote())).mockReturnValue(of(baseVote({ status: PollStatus.ENDED, early_end_time: '2026-11-01T10:00:00Z' })));
    await mount();
    await tick(5000);
    await tick(30_000);
    expect(getVoteResults).toHaveBeenCalledTimes(1);
    expect(getVoteResults).toHaveBeenCalledWith('v1');
    expect(has('vote-presenter-result')).toBe(true);
    expect(text('vote-presenter-closed-at')).toContain('Closed automatically at');
    expect(fetchVote.mock.calls.length).toBeGreaterThan(2);
  });

  it.each([PollType.GENERIC, PollType.MAJORITY, PollType.MEEK_STV, PollType.INSTANT_RUNOFF_VOTE, PollType.CONDORCET_IRV])(
    'renders the ended state for %s with the right banner',
    async (pollType) => {
      fetchVote.mockReturnValue(of(baseVote({ status: PollStatus.ENDED, poll_type: pollType })));
      await mount();
      const ranked = [PollType.MEEK_STV, PollType.INSTANT_RUNOFF_VOTE, PollType.CONDORCET_IRV].includes(pollType);
      expect(text('vote-presenter-banner')).toContain(ranked ? 'Ranked result' : 'Vote ended');
      expect(text('vote-presenter-banner')).not.toMatch(/approved/i);
    }
  );

  it('shows Abstain only when the vote allows it', async () => {
    fetchVote.mockReturnValue(of(baseVote({ status: PollStatus.ENDED, allow_abstain: true })));
    await mount();
    expect(has('vote-presenter-abstain')).toBe(true);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: VoteService, useValue: { fetchVote: vi.fn(() => of(baseVote({ status: PollStatus.ENDED, allow_abstain: false }))), getVoteResults } },
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ id: 'v1' })) } },
        { provide: Router, useValue: { navigateByUrl } },
      ],
    });
    await mount();
    expect(has('vote-presenter-abstain')).toBe(false);
  });

  it('returns to the open state when a reopen is seen on the next visible event, and re-requests results only if it ends again', async () => {
    fetchVote
      .mockReturnValueOnce(of(baseVote({ status: PollStatus.ENDED })))
      .mockReturnValueOnce(of(baseVote({ status: PollStatus.ACTIVE })))
      .mockReturnValue(of(baseVote({ status: PollStatus.ENDED })));
    await mount();
    expect(getVoteResults).toHaveBeenCalledTimes(1);

    document.dispatchEvent(new Event('visibilitychange'));
    await tick(0);
    expect(has('vote-presenter-open')).toBe(true);
    expect(getVoteResults).toHaveBeenCalledTimes(1);

    await tick(5000);
    expect(has('vote-presenter-result')).toBe(true);
    expect(getVoteResults).toHaveBeenCalledTimes(2);
  });

  it('shows the empty state for a zero electorate and only offers Exit', async () => {
    fetchVote.mockReturnValue(of(baseVote({ total_voting_request_invitations: 0, num_response_received: 0 })));
    await mount();
    expect(text('vote-presenter-empty')).toContain('No eligible voters are assigned to this vote');
    expect(has('vote-presenter-close')).toBe(false);
  });

  it('degrades missing counts to "Count unavailable"', async () => {
    fetchVote.mockReturnValue(of(baseVote({ num_response_received: undefined, total_voting_request_invitations: undefined })));
    await mount();
    expect(text('vote-presenter-count')).toBe('Count unavailable');
  });

  it('keeps the last count on a failed poll, shows Reconnecting, and recovers', async () => {
    fetchVote
      .mockReturnValueOnce(of(baseVote()))
      .mockReturnValueOnce(throwError(() => new Error('down')))
      .mockReturnValue(of(baseVote({ num_response_received: 5 })));
    await mount();
    await tick(5000);
    expect(has('vote-presenter-reconnecting')).toBe(true);
    expect(text('vote-presenter-count')).toBe('3 of 10 voters have cast');
    await tick(5000);
    expect(has('vote-presenter-reconnecting')).toBe(false);
    expect(text('vote-presenter-count')).toBe('5 of 10 voters have cast');
  });

  it('shows the error state with Exit when the first load fails', async () => {
    fetchVote.mockReturnValue(throwError(() => new Error('down')));
    await mount();
    expect(has('vote-presenter-error')).toBe(true);
  });

  it('uses the handoff copy and a one-row footer: Updated on the left, Exit and the disabled Close on the right', async () => {
    fetchVote.mockReturnValue(of(baseVote({ pseudo_anonymity: true, description: '<p>Resolved: approve it.</p>' })));
    await mount();
    expect(text('vote-presenter-secrecy')).toBe('Ballots are secret. Results show after the vote closes.');
    expect(text('vote-presenter-share')).toContain('Sign in with your LF account. Only eligible voters can cast.');
    expect(text('vote-presenter-question')).toBe('Resolved: approve it.');
    const footer = fixture.nativeElement.querySelector('[data-testid="vote-presenter-footer"]');
    expect(footer.querySelector('[data-testid="vote-presenter-updated"]')).toBeTruthy();
    expect(footer.querySelector('[data-testid="vote-presenter-exit"]')).toBeTruthy();
    expect(footer.querySelector('[data-testid="vote-presenter-close"]')).toBeTruthy();
    expect(footer.querySelector('[data-testid="vote-presenter-copy-slide"]')).toBeNull();
    expect(text('vote-presenter-context')).toBe('LFX');
    expect(text('vote-presenter-status')).toContain('Vote open · closes');
  });

  it('Retry from the error state restarts polling', async () => {
    fetchVote.mockReturnValueOnce(throwError(() => new Error('down'))).mockReturnValue(of(baseVote()));
    await mount();
    expect(has('vote-presenter-error')).toBe(true);
    (fixture.componentInstance as unknown as { retry(): void }).retry();
    fixture.detectChanges();
    await tick(0);
    expect(has('vote-presenter-open')).toBe(true);
  });

  it('polls without the cache so a hidden tab cancels its request', async () => {
    await mount();
    expect(fetchVote).toHaveBeenCalledWith('v1', { uncached: true });
  });

  it('keeps polling after the vote ends and flips back to open on a reopen, with no visibility event', async () => {
    fetchVote.mockReturnValueOnce(of(baseVote({ status: PollStatus.ENDED }))).mockReturnValue(of(baseVote({ status: PollStatus.ACTIVE })));
    await mount();
    expect(has('vote-presenter-result')).toBe(true);

    await tick(5000);
    expect(has('vote-presenter-open')).toBe(true);
    expect(has('vote-presenter-result')).toBe(false);
  });

  it('shows no result-derived numbers while /results is pending, then the turnout once it arrives', async () => {
    const pending = new Subject<VoteResultsResponse>();
    getVoteResults.mockReturnValue(pending);
    fetchVote.mockReturnValue(of(baseVote({ status: PollStatus.ENDED })));
    await mount();
    expect(has('vote-presenter-results-loading')).toBe(true);
    expect(has('vote-presenter-turnout')).toBe(false);
    expect(has('vote-presenter-turnout-loading')).toBe(true);

    pending.next(results());
    await tick(0);
    expect(has('vote-presenter-results-loading')).toBe(false);
    expect(text('vote-presenter-turnout')).toContain('9');
    expect(text('vote-presenter-turnout')).toContain('of 10 cast');
  });

  it('hides the turnout numbers, rather than showing zeros, when /results fails', async () => {
    getVoteResults.mockReturnValue(throwError(() => new Error('boom')));
    fetchVote.mockReturnValue(of(baseVote({ status: PollStatus.ENDED })));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await mount();
    expect(has('vote-presenter-results-error')).toBe(true);
    expect(has('vote-presenter-turnout')).toBe(false);
    expect(has('vote-presenter-turnout-loading')).toBe(false);
    expect(has('vote-presenter-results-link')).toBe(true);
  });

  describe('held results on an ended pseudo-anonymous vote', () => {
    const held = (): VoteResultsResponse =>
      ({ num_recipients: 10, num_votes_cast: 0, poll_results: [], comment_results: [], results_held: true }) as unknown as VoteResultsResponse;

    it('shows the finalizing state, not blank tallies or a zero abstain row, then the released results', async () => {
      getVoteResults.mockReturnValueOnce(of(held())).mockReturnValue(of(results()));
      fetchVote.mockReturnValue(of(baseVote({ status: PollStatus.ENDED, allow_abstain: true })));
      await mount();
      expect(has('vote-presenter-results-held')).toBe(true);
      expect(has('vote-presenter-results')).toBe(false);
      expect(has('vote-presenter-abstain')).toBe(false);
      expect(has('vote-presenter-turnout')).toBe(false);

      await tick(VOTE_PRESENTER_RESULTS_HOLD_RETRY_MS);
      expect(getVoteResults).toHaveBeenCalledTimes(2);
      expect(has('vote-presenter-results-held')).toBe(false);
      expect(has('vote-presenter-results')).toBe(true);
      expect(text('vote-presenter-turnout')).toContain('of 10 cast');
    });

    it('stops re-requesting after the bounded number of attempts and keeps the finalizing state', async () => {
      getVoteResults.mockReturnValue(of(held()));
      fetchVote.mockReturnValue(of(baseVote({ status: PollStatus.ENDED })));
      await mount();
      await tick(VOTE_PRESENTER_RESULTS_HOLD_RETRY_MS * (VOTE_PRESENTER_RESULTS_HOLD_MAX_ATTEMPTS + 3));
      expect(getVoteResults).toHaveBeenCalledTimes(VOTE_PRESENTER_RESULTS_HOLD_MAX_ATTEMPTS);
      expect(has('vote-presenter-results-held')).toBe(true);
      expect(has('vote-presenter-results')).toBe(false);
    });

    it('keeps finalizing through a failed held-result retry and displays the later release', async () => {
      getVoteResults
        .mockReturnValueOnce(of(held()))
        .mockReturnValueOnce(throwError(() => new Error('temporarily unavailable')))
        .mockReturnValue(of(results()));
      fetchVote.mockReturnValue(of(baseVote({ status: PollStatus.ENDED, allow_abstain: true })));
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      await mount();

      await tick(VOTE_PRESENTER_RESULTS_HOLD_RETRY_MS);
      expect(getVoteResults).toHaveBeenCalledTimes(2);
      expect(has('vote-presenter-results-held')).toBe(true);
      expect(has('vote-presenter-results-error')).toBe(false);
      expect(has('vote-presenter-results')).toBe(false);
      expect(has('vote-presenter-turnout')).toBe(false);
      expect(has('vote-presenter-abstain')).toBe(false);

      await tick(VOTE_PRESENTER_RESULTS_HOLD_RETRY_MS);
      expect(getVoteResults).toHaveBeenCalledTimes(3);
      expect(has('vote-presenter-results-held')).toBe(false);
      expect(has('vote-presenter-results-error')).toBe(false);
      expect(has('vote-presenter-results')).toBe(true);
      expect(has('vote-presenter-abstain')).toBe(true);
      expect(text('vote-presenter-turnout')).toContain('of 10 cast');
    });

    it('counts failed retries toward the attempt limit without dropping the held state', async () => {
      getVoteResults.mockReturnValueOnce(of(held())).mockReturnValue(throwError(() => new Error('temporarily unavailable')));
      fetchVote.mockReturnValue(of(baseVote({ status: PollStatus.ENDED, allow_abstain: true })));
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      await mount();

      await tick(VOTE_PRESENTER_RESULTS_HOLD_RETRY_MS * (VOTE_PRESENTER_RESULTS_HOLD_MAX_ATTEMPTS + 3));
      expect(getVoteResults).toHaveBeenCalledTimes(VOTE_PRESENTER_RESULTS_HOLD_MAX_ATTEMPTS);
      expect(has('vote-presenter-results-held')).toBe(true);
      expect(has('vote-presenter-results-error')).toBe(false);
      expect(has('vote-presenter-results')).toBe(false);
      expect(has('vote-presenter-turnout')).toBe(false);
      expect(has('vote-presenter-abstain')).toBe(false);
    });
  });

  it('formats the closed time as a clock time, never the raw timestamp', async () => {
    fetchVote.mockReturnValue(of(baseVote({ status: PollStatus.ENDED, early_end_time: '2026-12-01T10:42:00Z' })));
    await mount();
    expect(text('vote-presenter-turnout')).toMatch(/Closed\s*\d{1,2}:\d{2}\s?[AP]M/);
    expect(text('vote-presenter-turnout')).not.toContain('2026-12-01T');
  });

  it('labels each question when a vote has more than one', async () => {
    getVoteResults.mockReturnValue(
      of({
        num_recipients: 10,
        num_votes_cast: 8,
        num_abstained: 0,
        poll_results: [
          {
            question: { question_id: 'q1', prompt: 'Approve the budget?', choices: [{ choice_id: 'a', choice_text: 'Yes' }] },
            generic_choice_votes: [{ choice_id: 'a', vote_count: 8, percentage: 100 }],
          },
          {
            question: { question_id: 'q2', prompt: 'Approve the bylaws?', choices: [{ choice_id: 'b', choice_text: 'Yes' }] },
            generic_choice_votes: [{ choice_id: 'b', vote_count: 8, percentage: 100 }],
          },
        ],
      } as unknown as VoteResultsResponse)
    );
    fetchVote.mockReturnValue(of(baseVote({ status: PollStatus.ENDED })));
    await mount();
    expect(text('vote-presenter-results')).toContain('Approve the budget?');
    expect(text('vote-presenter-results')).toContain('Approve the bylaws?');
  });

  it('shows abstentions on an ended ranked vote that allows them', async () => {
    fetchVote.mockReturnValue(of(baseVote({ status: PollStatus.ENDED, poll_type: PollType.MEEK_STV, allow_abstain: true })));
    await mount();
    expect(has('vote-presenter-abstain')).toBe(true);
  });

  it('drops the previous vote when :id changes instead of showing it under the new link', async () => {
    const paramMap = new BehaviorSubject(convertToParamMap({ id: 'v1' }));
    TestBed.resetTestingModule();
    fetchVote = vi.fn((id: string) => (id === 'v1' ? of(baseVote()) : NEVER));
    TestBed.configureTestingModule({
      providers: [
        { provide: VoteService, useValue: { fetchVote, getVoteResults } },
        { provide: ActivatedRoute, useValue: { paramMap } },
        { provide: Router, useValue: { navigateByUrl } },
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    });
    await mount();
    expect(has('vote-presenter-open')).toBe(true);

    paramMap.next(convertToParamMap({ id: 'v2' }));
    await tick(0);
    expect(has('vote-presenter-open')).toBe(false);
    expect(has('vote-presenter-loading')).toBe(true);
  });

  it('exits to the vote permalink', async () => {
    await mount();
    (fixture.componentInstance as unknown as { exit(): void }).exit();
    expect(navigateByUrl).toHaveBeenCalledWith('/votes/v1');
  });
});
