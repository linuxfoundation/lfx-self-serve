// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpHeaders, HttpResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import {
  RECENTLY_OPENED_VOTE_TTL_MS,
  VOTE_CREATE_COMPLETED_AT_HEADER,
  VOTE_FGA_TUPLE_PROPAGATION_GRACE_MS,
  VOTE_SPECULATIVE_DELETE_RETRY_DELAY_MS,
} from '@lfx-one/shared/constants';
import { PollStatus } from '@lfx-one/shared/enums';
import { defer, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { VoteService } from './vote.service';

import type { CreateVoteRequest, Vote } from '@lfx-one/shared/interfaces';

function buildVote(overrides: Partial<Vote> = {}): Vote {
  return {
    uid: 'vote-1',
    name: 'Board ballot',
    end_time: '2026-04-01T00:00:00Z',
    status: PollStatus.DISABLED,
    project_uid: 'project-1',
    ...overrides,
  };
}

const CREATE_STAMP = 1_750_000_000_000;

/** The BFF create response as beginSpeculativeCreate observes it: body plus the grace-hint stamp header. */
function createResponse(vote: Vote, stamp: number | null = CREATE_STAMP): HttpResponse<Vote> {
  const headers = stamp === null ? new HttpHeaders() : new HttpHeaders({ [VOTE_CREATE_COMPLETED_AT_HEADER]: String(stamp) });
  return new HttpResponse<Vote>({ body: vote, headers });
}

describe('VoteService', () => {
  let service: VoteService;
  let http: { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    http = { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() };

    TestBed.configureTestingModule({
      providers: [VoteService, { provide: HttpClient, useValue: http }],
    });

    service = TestBed.inject(VoteService);
  });

  // GH-2730: the carrier overlays a just-opened vote's known-active status over stale index rows
  // while the search index catches up. It must self-heal — evict on convergence, prune at the
  // TTL — or it would pin a stale 'active' over the fetched server value indefinitely.
  describe('recently-opened vote carrier', () => {
    it('passes rows through untouched (same array) when nothing was marked', () => {
      const votes = [buildVote({ uid: 'v1' }), buildVote({ uid: 'v2' })];

      expect(service.mergeRecentlyOpenedVotes(votes)).toBe(votes);
    });

    it('substitutes the known-active status for a marked vote whose index row is still stale', () => {
      service.markVoteOpened('v1');

      const votes = [buildVote({ uid: 'v1', status: PollStatus.DISABLED }), buildVote({ uid: 'v2' })];
      const merged = service.mergeRecentlyOpenedVotes(votes);

      expect(merged[0]).toMatchObject({ uid: 'v1', status: PollStatus.ACTIVE });
      // Rows the carrier does not cover keep their reference — the merge must not rebuild them.
      expect(merged[1]).toBe(votes[1]);
    });

    it('evicts the carried uid once a fetched row comes back active — the server value has converged', () => {
      service.markVoteOpened('v1');

      service.mergeRecentlyOpenedVotes([buildVote({ uid: 'v1', status: PollStatus.ACTIVE })]);

      // After eviction the carrier no longer overlays — a stale row would flow through unchanged.
      const merged = service.mergeRecentlyOpenedVotes([buildVote({ uid: 'v1', status: PollStatus.DISABLED })]);
      expect(merged[0].status).toBe(PollStatus.DISABLED);
    });

    it('lets a converged non-disabled row flow through and evicts the carry', () => {
      service.markVoteOpened('v1');

      // A just-opened vote can end early inside the TTL (ITX's EndPollIfAllResponded), so any
      // converged non-disabled status — not just `active` — is the server's truth and must not be
      // overlaid back to active.
      const converged = service.mergeRecentlyOpenedVotes([buildVote({ uid: 'v1', status: PollStatus.ENDED })]);
      expect(converged[0].status).toBe(PollStatus.ENDED);

      // The carry was evicted on convergence — a subsequent stale row flows through unchanged.
      const after = service.mergeRecentlyOpenedVotes([buildVote({ uid: 'v1', status: PollStatus.DISABLED })]);
      expect(after[0].status).toBe(PollStatus.DISABLED);
    });

    it('keeps overlaying inside the TTL window', () => {
      vi.useFakeTimers();
      try {
        service.markVoteOpened('v1');
        vi.advanceTimersByTime(RECENTLY_OPENED_VOTE_TTL_MS - 1);

        const merged = service.mergeRecentlyOpenedVotes([buildVote({ uid: 'v1', status: PollStatus.DISABLED })]);
        expect(merged[0].status).toBe(PollStatus.ACTIVE);
      } finally {
        vi.useRealTimers();
      }
    });

    it('prunes entries older than the TTL so an unconverged carrier cannot pin status indefinitely', () => {
      vi.useFakeTimers();
      try {
        service.markVoteOpened('v1');
        vi.advanceTimersByTime(RECENTLY_OPENED_VOTE_TTL_MS + 1);

        const merged = service.mergeRecentlyOpenedVotes([buildVote({ uid: 'v1', status: PollStatus.DISABLED })]);
        expect(merged[0].status).toBe(PollStatus.DISABLED);
      } finally {
        vi.useRealTimers();
      }
    });

    it('getLiveRecentlyOpenedVotes returns only live entries and persists the prune', () => {
      vi.useFakeTimers();
      try {
        service.markVoteOpened('expired');
        vi.advanceTimersByTime(RECENTLY_OPENED_VOTE_TTL_MS + 1);
        service.markVoteOpened('live');

        const live = service.getLiveRecentlyOpenedVotes();

        expect([...live.keys()]).toEqual(['live']);
        // The prune was written back — a second read does not resurrect the expired entry.
        expect(service.getLiveRecentlyOpenedVotes().size).toBe(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('evictRecentlyOpenedVote is a no-op for uids that are not carried', () => {
      expect(() => service.evictRecentlyOpenedVote('never-marked')).not.toThrow();
    });
  });

  it('createVote posts a plain create — no params, no options (GH-2826 removed the fused open flag)', () => {
    http.post.mockReturnValue(of(buildVote()));

    const data = { name: 'New ballot' } as unknown as CreateVoteRequest;
    service.createVote(data).subscribe();

    expect(http.post).toHaveBeenCalledWith('/api/votes', data);
  });

  it('enableVote sends an empty body without the grace hint — the edit-flow shape (GH-2826)', () => {
    http.put.mockReturnValue(of({ uid: 'vote-1', status: PollStatus.ACTIVE }));

    service.enableVote('vote-1').subscribe();

    expect(http.put).toHaveBeenCalledWith('/api/votes/vote-1/enable', {});
  });

  // GH-2826 Design A: dialog-open fires the speculative create; accept chains the enable onto it. The
  // lifecycle lives on this root service so cancel/navigation cleanup and a confirmed open outlive the component.
  describe('speculative create lifecycle', () => {
    const request = { name: 'New ballot' } as unknown as CreateVoteRequest;

    it('begin fires the plain create immediately (observe: response, no open param) and parks a pending record', () => {
      http.post.mockReturnValue(of(createResponse(buildVote())));

      service.beginSpeculativeCreate(request);

      expect(http.post).toHaveBeenCalledTimes(1);
      const [url, body, options] = http.post.mock.calls[0];
      expect(url).toBe('/api/votes');
      expect(body).toBe(request);
      expect(options).toMatchObject({ observe: 'response' });
      expect(options?.params).toBeUndefined();
      expect(service.hasPendingSpeculativeCreate()).toBe(true);
    });

    it('confirm after the create resolves enables immediately with the echoed create-completion stamp', () => {
      http.post.mockReturnValue(of(createResponse(buildVote())));
      http.put.mockReturnValue(of({ uid: 'vote-1', status: PollStatus.ACTIVE }));

      service.beginSpeculativeCreate(request);
      const outcomes: { vote: Vote; opened: boolean }[] = [];
      service.confirmSpeculativeVote(request).subscribe((outcome) => outcomes.push(outcome));

      expect(http.put).toHaveBeenCalledWith('/api/votes/vote-1/enable', { create_completed_at: CREATE_STAMP });
      expect(outcomes).toEqual([{ vote: buildVote(), opened: true }]);
      // The service (not the component) marks the vote opened so the carrier survives navigation.
      expect(service.getLiveRecentlyOpenedVotes().has('vote-1')).toBe(true);
      expect(service.hasPendingSpeculativeCreate()).toBe(false);
    });

    it('confirm before the create resolves waits for the uid, then enables — one PUT, no duplicate POST', () => {
      const pending = new Subject<HttpResponse<Vote>>();
      http.post.mockReturnValue(pending.asObservable());
      http.put.mockReturnValue(of({ uid: 'vote-1', status: PollStatus.ACTIVE }));

      service.beginSpeculativeCreate(request);
      const outcomes: { vote: Vote; opened: boolean }[] = [];
      service.confirmSpeculativeVote(request).subscribe((outcome) => outcomes.push(outcome));

      // Fast clicker: the create is still in flight — no enable PUT may fire yet.
      expect(http.put).not.toHaveBeenCalled();
      expect(http.post).toHaveBeenCalledTimes(1);

      pending.next(createResponse(buildVote()));
      pending.complete();

      expect(http.put).toHaveBeenCalledWith('/api/votes/vote-1/enable', { create_completed_at: CREATE_STAMP });
      expect(outcomes).toEqual([{ vote: buildVote(), opened: true }]);
    });

    it('confirm with no pending record begins fresh from the fallback request', () => {
      http.post.mockReturnValue(of(createResponse(buildVote())));
      http.put.mockReturnValue(of({ uid: 'vote-1', status: PollStatus.ACTIVE }));

      const outcomes: { vote: Vote; opened: boolean }[] = [];
      service.confirmSpeculativeVote(request).subscribe((outcome) => outcomes.push(outcome));

      expect(http.post).toHaveBeenCalledTimes(1);
      expect(http.put).toHaveBeenCalledWith('/api/votes/vote-1/enable', { create_completed_at: CREATE_STAMP });
      expect(outcomes).toEqual([{ vote: buildVote(), opened: true }]);
    });

    it('confirm after the speculative create failed rethrows the stored error — no second POST, no PUT', () => {
      const failure = new Error('create exploded');
      http.post.mockReturnValue(throwError(() => failure));

      service.beginSpeculativeCreate(request);
      const errors: unknown[] = [];
      service.confirmSpeculativeVote(request).subscribe({ error: (error) => errors.push(error) });

      expect(errors).toEqual([failure]);
      expect(http.post).toHaveBeenCalledTimes(1);
      expect(http.put).not.toHaveBeenCalled();
    });

    it('sends no grace hint when the create response carried no stamp header (deploy-skew guard)', () => {
      http.post.mockReturnValue(of(createResponse(buildVote(), null)));
      http.put.mockReturnValue(of({ uid: 'vote-1', status: PollStatus.ACTIVE }));

      service.beginSpeculativeCreate(request);
      service.confirmSpeculativeVote(request).subscribe();

      expect(http.put).toHaveBeenCalledWith('/api/votes/vote-1/enable', {});
    });

    it('discard after the grace has elapsed issues the compensating delete immediately (slow reader)', () => {
      http.post.mockReturnValue(of(createResponse(buildVote())));
      http.delete.mockReturnValue(of(undefined));

      service.beginSpeculativeCreate(request);
      service.discardSpeculativeVote();

      expect(http.delete).toHaveBeenCalledWith('/api/votes/vote-1');
      expect(http.put).not.toHaveBeenCalled();
      expect(service.hasPendingSpeculativeCreate()).toBe(false);
    });

    it('discard while the create is in flight deletes once the uid lands — the server write is not aborted', () => {
      const pending = new Subject<HttpResponse<Vote>>();
      http.post.mockReturnValue(pending.asObservable());
      http.delete.mockReturnValue(of(undefined));

      service.beginSpeculativeCreate(request);
      service.discardSpeculativeVote();

      // Cancel felt instant: no delete could fire before the uid exists.
      expect(http.delete).not.toHaveBeenCalled();

      pending.next(createResponse(buildVote()));
      pending.complete();

      expect(http.delete).toHaveBeenCalledWith('/api/votes/vote-1');
      expect(service.hasPendingSpeculativeCreate()).toBe(false);
    });

    it('discard after the create errored clears the record without deleting (nothing was created)', () => {
      http.post.mockReturnValue(throwError(() => new Error('create exploded')));

      service.beginSpeculativeCreate(request);
      service.discardSpeculativeVote();

      expect(http.delete).not.toHaveBeenCalled();
      expect(service.hasPendingSpeculativeCreate()).toBe(false);
    });

    it('a fast cancel waits out the grace remainder so the compensating DELETE does not fire pre-tuple', async () => {
      vi.useFakeTimers();
      try {
        http.post.mockReturnValue(of(createResponse(buildVote(), Date.now())));
        http.delete.mockReturnValue(of(undefined));

        service.beginSpeculativeCreate(request);
        service.discardSpeculativeVote();

        // The DELETE route is writer-gated on vote:{uid} at the gateway — pre-tuple would cache a denial.
        expect(http.delete).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(VOTE_FGA_TUPLE_PROPAGATION_GRACE_MS - 1);
        expect(http.delete).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(http.delete).toHaveBeenCalledWith('/api/votes/vote-1');
        expect(service.hasPendingSpeculativeCreate()).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it('a discard without the create-completion stamp pays the full grace (deploy-skew guard)', async () => {
      vi.useFakeTimers();
      try {
        http.post.mockReturnValue(of(createResponse(buildVote(), null)));
        http.delete.mockReturnValue(of(undefined));

        service.beginSpeculativeCreate(request);
        service.discardSpeculativeVote();

        expect(http.delete).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(VOTE_FGA_TUPLE_PROPAGATION_GRACE_MS);
        expect(http.delete).toHaveBeenCalledWith('/api/votes/vote-1');
      } finally {
        vi.useRealTimers();
      }
    });

    it('retries the compensating delete once past the check-cache TTL, then warns (orphan draft is accepted residue)', async () => {
      vi.useFakeTimers();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        http.post.mockReturnValue(of(createResponse(buildVote())));
        // Count subscriptions, not mock calls: retry resubscribes to the ONE observable the mock
        // returned, so only a defer factory sees each attempt (the real HttpClient is cold — each
        // resubscription refires the request).
        let attempts = 0;
        http.delete.mockReturnValue(
          defer(() => {
            attempts++;
            return throwError(() => new Error('delete exploded'));
          })
        );

        service.beginSpeculativeCreate(request);
        service.discardSpeculativeVote();

        expect(attempts).toBe(1);
        await vi.advanceTimersByTimeAsync(VOTE_SPECULATIVE_DELETE_RETRY_DELAY_MS - 1);
        expect(attempts).toBe(1); // still waiting — the retry delay spans the check-cache TTL
        await vi.advanceTimersByTimeAsync(1);
        expect(attempts).toBe(2);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(attempts).toBe(2); // count: 1 exhausted — no third attempt
        expect(warn).toHaveBeenCalledOnce();
        expect(service.hasPendingSpeculativeCreate()).toBe(false);
      } finally {
        warn.mockRestore();
        vi.useRealTimers();
      }
    });

    it('discard is a no-op after confirm — an accepted vote is never compensated', () => {
      http.post.mockReturnValue(of(createResponse(buildVote())));
      http.put.mockReturnValue(of({ uid: 'vote-1', status: PollStatus.ACTIVE }));

      service.beginSpeculativeCreate(request);
      service.confirmSpeculativeVote(request).subscribe();
      service.discardSpeculativeVote();

      expect(http.delete).not.toHaveBeenCalled();
    });

    it('a new begin discards the still-pending prior record and cleans it up independently', () => {
      const first = new Subject<HttpResponse<Vote>>();
      http.post.mockReturnValueOnce(first.asObservable()).mockReturnValue(of(createResponse(buildVote({ uid: 'vote-2' }))));
      http.delete.mockReturnValue(of(undefined));

      service.beginSpeculativeCreate(request); // first record, in flight
      service.beginSpeculativeCreate(request); // supersedes it — the slot now tracks the second
      expect(http.post).toHaveBeenCalledTimes(2);

      first.next(createResponse(buildVote({ uid: 'vote-1' })));
      first.complete();

      expect(http.delete).toHaveBeenCalledWith('/api/votes/vote-1');
      expect(service.hasPendingSpeculativeCreate()).toBe(true); // the second record is unaffected
    });

    it('an enable failure resolves opened: false and keeps the draft — no compensating delete on the accept path', () => {
      http.post.mockReturnValue(of(createResponse(buildVote())));
      http.put.mockReturnValue(throwError(() => new Error('enable exploded')));

      service.beginSpeculativeCreate(request);
      const outcomes: { vote: Vote; opened: boolean }[] = [];
      service.confirmSpeculativeVote(request).subscribe((outcome) => outcomes.push(outcome));

      expect(outcomes).toEqual([{ vote: buildVote(), opened: false }]);
      expect(http.delete).not.toHaveBeenCalled();
      expect(service.getLiveRecentlyOpenedVotes().has('vote-1')).toBe(false);
      expect(service.hasPendingSpeculativeCreate()).toBe(false);
    });

    it('the service-owned confirm chain completes after the component unsubscribes (post-Yes navigation)', () => {
      const pendingPut = new Subject<{ uid: string; status: PollStatus }>();
      http.post.mockReturnValue(of(createResponse(buildVote())));
      http.put.mockReturnValue(pendingPut.asObservable());

      service.beginSpeculativeCreate(request);
      const subscription = service.confirmSpeculativeVote(request).subscribe();
      subscription.unsubscribe(); // the component is destroyed mid-enable…
      expect(service.getLiveRecentlyOpenedVotes().has('vote-1')).toBe(false); // nothing completed yet

      pendingPut.next({ uid: 'vote-1', status: PollStatus.ACTIVE });
      pendingPut.complete();

      // …and the service-side subscription still ran the enable to completion and marked the vote.
      expect(service.getLiveRecentlyOpenedVotes().has('vote-1')).toBe(true);
      expect(service.hasPendingSpeculativeCreate()).toBe(false);
    });
  });
});
