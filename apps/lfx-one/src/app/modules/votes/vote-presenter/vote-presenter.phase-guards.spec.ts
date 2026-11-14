// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { PollStatus, PollType } from '@lfx-one/shared/enums';
import { Vote } from '@lfx-one/shared/interfaces';
import { VoteService } from '@services/vote.service';
import { MessageService } from 'primeng/api';
import { NEVER, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VotePresenterComponent } from './vote-presenter.component';

/*
 * The shell projects the presenter's phase content, and Angular instantiates projected content whether or not the
 * shell's <ng-content> renders it. The presenter's own @if guards are therefore the only thing keeping the live content
 * (Send ballots, which reads the voter list when created, and Close) from being created in another phase. These cases
 * assert on instantiation, not just on the DOM, so removing a guard fails here.
 */
describe('VotePresenterComponent phase guards', () => {
  let fixture: ComponentFixture<VotePresenterComponent>;
  let fetchVote: ReturnType<typeof vi.fn>;
  let getReminderRecipients: ReturnType<typeof vi.fn>;

  const vote = (overrides: Partial<Vote> = {}): Vote =>
    ({
      uid: 'v1',
      name: 'Approve the 2027 budget',
      status: PollStatus.ACTIVE,
      poll_type: PollType.GENERIC,
      committee_name: 'Governing Board',
      end_time: '2026-12-01T17:00:00Z',
      num_response_received: 3,
      total_voting_request_invitations: 10,
      ...overrides,
    }) as Vote;

  const sendBallots = (): unknown => (fixture.componentInstance as unknown as { sendBallots: () => unknown }).sendBallots();
  const has = (testId: string): boolean => !!fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const mount = async (): Promise<void> => {
    fixture = TestBed.createComponent(VotePresenterComponent);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fetchVote = vi.fn(() => of(vote()));
    getReminderRecipients = vi.fn(() => of([]));
    TestBed.configureTestingModule({
      providers: [
        {
          provide: VoteService,
          useValue: {
            fetchVote,
            getVoteResults: () => of({ num_recipients: 10, num_votes_cast: 9, num_abstained: 0, generic_choice_votes: [] }),
            endVote: vi.fn(),
            getReminderRecipients,
          },
        },
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ id: 'v1' })) } },
        { provide: Router, useValue: { navigateByUrl: vi.fn() } },
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    });
  });

  afterEach(() => vi.useRealTimers());

  it('creates Send ballots and Close while the vote is open', async () => {
    await mount();
    expect(sendBallots()).toBeTruthy();
    expect(getReminderRecipients).toHaveBeenCalledTimes(1);
    expect(has('vote-presenter-close')).toBe(true);
  });

  it.each([
    ['ended', () => fetchVote.mockReturnValue(of(vote({ status: PollStatus.ENDED })))],
    ['disabled (empty)', () => fetchVote.mockReturnValue(of(vote({ status: PollStatus.DISABLED })))],
    ['no electorate (empty)', () => fetchVote.mockReturnValue(of(vote({ total_voting_request_invitations: 0, num_response_received: 0 })))],
    ['loading', () => fetchVote.mockReturnValue(NEVER)],
    ['error', () => fetchVote.mockReturnValue(throwError(() => new Error('down')))],
  ])('never creates Send ballots or Close in the %s phase', async (_phase, arrange) => {
    arrange();
    await mount();
    expect(sendBallots()).toBeUndefined();
    expect(getReminderRecipients).not.toHaveBeenCalled();
    expect(has('vote-presenter-close')).toBe(false);
    expect(has('vote-qr')).toBe(false);
  });
});
