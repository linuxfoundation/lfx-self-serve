// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { computed, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { TestBed } from '@angular/core/testing';
import { VOTE_SUMMARY_SEND_TIMEOUT_MS } from '@lfx-one/shared/constants';
import { SendVoteSummaryResponse, VoteSummaryPreviewResponse } from '@lfx-one/shared/interfaces';
import { Subject, TimeoutError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UserService } from './user.service';
import { VoteSummarySendService } from './vote-summary-send.service';
import { VoteService } from './vote.service';

const PREVIEW: VoteSummaryPreviewResponse = {
  ready: [{ uid: 'synthetic-voter', user_email: 'avery@acme-motors.example' }],
  missing_email: [],
  unique_email_count: 1,
  shared_email_voter_count: 0,
};
const RESULT: SendVoteSummaryResponse = {
  recipient_count: 0,
  failed_count: 0,
  skipped_count: 0,
  uncertain_count: 1,
  recipients: [{ ...PREVIEW.ready[0]!, outcome: 'uncertain' }],
};

describe('VoteSummarySendService', () => {
  const user = signal<{ sub: string } | null>({ sub: 'synthetic-manager' });
  let pending: Subject<SendVoteSummaryResponse>;
  let sendVoteSummary: ReturnType<typeof vi.fn>;
  let service: VoteSummarySendService;

  beforeEach(() => {
    TestBed.resetTestingModule();
    user.set({ sub: 'synthetic-manager' });
    pending = new Subject<SendVoteSummaryResponse>();
    sendVoteSummary = vi.fn().mockReturnValue(pending);
    TestBed.configureTestingModule({
      providers: [
        { provide: UserService, useValue: { user } },
        { provide: VoteService, useValue: { sendVoteSummary } },
      ],
    });
    service = TestBed.inject(VoteSummarySendService);
  });

  afterEach(() => vi.useRealTimers());

  it('retains a pending attempt and its eventual outcome until explicitly dismissed', () => {
    expect(service.send('vote-1', PREVIEW)).toBe(true);
    expect(service.getAttempt('vote-1')).toEqual({ preview: PREVIEW, status: 'sending' });
    service.dismiss('vote-1');
    expect(service.send('vote-1', PREVIEW)).toBe(false);
    expect(sendVoteSummary).toHaveBeenCalledTimes(1);

    pending.next(RESULT);
    expect(pending.observed).toBe(false);
    expect(service.getAttempt('vote-1')).toEqual({ preview: PREVIEW, status: 'success', response: RESULT });
    expect(service.send('vote-1', PREVIEW)).toBe(false);
    service.dismiss('vote-1');
    expect(service.getAttempt('vote-1')).toBeUndefined();
    expect(service.send('vote-1', PREVIEW)).toBe(true);
    expect(sendVoteSummary).toHaveBeenCalledTimes(2);
  });

  it('retains an error instead of retrying an ambiguous write', () => {
    const error = new HttpErrorResponse({ status: 504 });
    service.send('vote-1', PREVIEW);
    pending.error(error);
    expect(service.getAttempt('vote-1')).toEqual({ preview: PREVIEW, status: 'error', error });
    expect(service.send('vote-1', PREVIEW)).toBe(false);
    expect(sendVoteSummary).toHaveBeenCalledTimes(1);
  });

  it('settles a stalled request at the deadline without retrying or accepting a late response', () => {
    vi.useFakeTimers();
    service.send('vote-1', PREVIEW);
    vi.advanceTimersByTime(VOTE_SUMMARY_SEND_TIMEOUT_MS - 1);
    expect(service.getAttempt('vote-1')?.status).toBe('sending');

    vi.advanceTimersByTime(1);
    const attempt = service.getAttempt('vote-1');
    expect(attempt).toMatchObject({ preview: PREVIEW, status: 'error' });
    expect(attempt?.error).toBeInstanceOf(TimeoutError);
    expect(pending.observed).toBe(false);
    pending.next(RESULT);
    expect(service.getAttempt('vote-1')).toBe(attempt);
    expect(service.send('vote-1', PREVIEW)).toBe(false);
    expect(sendVoteSummary).toHaveBeenCalledTimes(1);
  });

  it('keeps a response received before the deadline instead of replacing it with a timeout', () => {
    vi.useFakeTimers();
    service.send('vote-1', PREVIEW);
    vi.advanceTimersByTime(VOTE_SUMMARY_SEND_TIMEOUT_MS - 1);
    pending.next(RESULT);
    vi.advanceTimersByTime(VOTE_SUMMARY_SEND_TIMEOUT_MS);
    expect(service.getAttempt('vote-1')).toEqual({ preview: PREVIEW, status: 'success', response: RESULT });
    expect(pending.observed).toBe(false);
    expect(sendVoteSummary).toHaveBeenCalledTimes(1);
  });

  it('keeps different votes separate', () => {
    service.send('vote-1', PREVIEW);
    expect(service.getAttempt('vote-2')).toBeUndefined();
    expect(service.send('vote-2', PREVIEW)).toBe(true);
    expect(sendVoteSummary).toHaveBeenCalledTimes(2);
  });

  it('reactively exposes an attempt created after an initial empty lookup', () => {
    const statuses: (string | undefined)[] = [];
    TestBed.runInInjectionContext(() => {
      toObservable(computed(() => service.getAttempt('vote-1')))
        .pipe(takeUntilDestroyed())
        .subscribe((attempt) => statuses.push(attempt?.status));
    });
    TestBed.tick();
    service.send('vote-1', PREVIEW);
    TestBed.tick();
    pending.next(RESULT);
    TestBed.tick();
    expect(statuses).toEqual([undefined, 'sending', 'success']);
  });

  it.each([null, { sub: 'another-synthetic-manager' }])('isolates identities immediately after an effective-user change to %s', (nextUser) => {
    service.send('vote-1', PREVIEW);
    user.set(nextUser);
    // Do not wait for the cleanup subscription: the read must fail closed synchronously.
    expect(service.getAttempt('vote-1')).toBeUndefined();
    pending.next(RESULT);
    TestBed.tick();
    expect(service.getAttempt('vote-1')).toBeUndefined();
    user.set({ sub: 'synthetic-manager' });
    TestBed.tick();
    expect(service.getAttempt('vote-1')).toBeUndefined();
  });

  it('does not let a previous user response replace a new user attempt for the same vote', () => {
    const previous = pending;
    service.send('vote-1', PREVIEW);
    user.set({ sub: 'another-synthetic-manager' });
    pending = new Subject<SendVoteSummaryResponse>();
    sendVoteSummary.mockReturnValue(pending);
    service.send('vote-1', PREVIEW);
    previous.next(RESULT);
    expect(service.getAttempt('vote-1')?.status).toBe('sending');
    pending.next(RESULT);
    expect(service.getAttempt('vote-1')?.status).toBe('success');
  });

  it('does not start or retain a send without an effective subject', () => {
    user.set(null);
    expect(service.send('vote-1', PREVIEW)).toBe(false);
    expect(sendVoteSummary).not.toHaveBeenCalled();
    expect(service.getAttempt('vote-1')).toBeUndefined();
  });
});
