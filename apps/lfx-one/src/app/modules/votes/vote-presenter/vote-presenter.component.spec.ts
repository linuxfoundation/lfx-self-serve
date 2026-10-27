// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { PollStatus, PollType } from '@lfx-one/shared/enums';
import { Vote, VoteResultsResponse } from '@lfx-one/shared/interfaces';
import { VoteService } from '@services/vote.service';
import { of, throwError } from 'rxjs';
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

  it('requests results exactly once after the vote ends and stops polling', async () => {
    fetchVote.mockReturnValueOnce(of(baseVote())).mockReturnValue(of(baseVote({ status: PollStatus.ENDED, early_end_time: '2026-11-01T10:00:00Z' })));
    await mount();
    await tick(5000);
    await tick(30_000);
    expect(getVoteResults).toHaveBeenCalledTimes(1);
    expect(getVoteResults).toHaveBeenCalledWith('v1');
    expect(has('vote-presenter-result')).toBe(true);
    expect(text('vote-presenter-closed-at')).toContain('Closed automatically at');
    expect(fetchVote).toHaveBeenCalledTimes(2);
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

  it('exits to the vote permalink', async () => {
    await mount();
    (fixture.componentInstance as unknown as { exit(): void }).exit();
    expect(navigateByUrl).toHaveBeenCalledWith('/votes/v1');
  });
});
