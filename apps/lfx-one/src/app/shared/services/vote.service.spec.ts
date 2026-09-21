// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpParams } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { RECENTLY_OPENED_VOTE_TTL_MS } from '@lfx-one/shared/constants';
import { PollStatus } from '@lfx-one/shared/enums';
import { of } from 'rxjs';
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

describe('VoteService', () => {
  let service: VoteService;
  let http: { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    http = { get: vi.fn(), post: vi.fn() };

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

  // GH-2731: the open flag rides the create POST as `?open=true` — pin the param wiring so the
  // fused create+open contract can't silently revert to the two-request flow.
  describe('createVote open flag', () => {
    it('sends open=true as a query param when the option is set', () => {
      http.post.mockReturnValue(of(buildVote()));

      const data = { name: 'New ballot' } as unknown as CreateVoteRequest;
      service.createVote(data, { open: true }).subscribe();

      expect(http.post).toHaveBeenCalledWith('/api/votes', data, { params: expect.any(HttpParams) });
      const params = http.post.mock.calls[0][2].params as HttpParams;
      expect(params.get('open')).toBe('true');
    });

    it('sends no params when the option is absent', () => {
      http.post.mockReturnValue(of(buildVote()));

      const data = { name: 'New ballot' } as unknown as CreateVoteRequest;
      service.createVote(data).subscribe();

      expect(http.post).toHaveBeenCalledWith('/api/votes', data, { params: undefined });
    });
  });
});
