// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Unit tests for vote.service.ts — upstream path encoding (GH-1568), X-Sync removal, poll budgets,
// the enableVote FGA-gap retry (GH-1637), and the enable grace hint (GH-2826). All fixtures use
// synthetic placeholder identities — never real user data.

import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IndexedVoteResponseStatus } from '@lfx-one/shared/enums';

// Only `@lfx-one/shared/utils` is stubbed: its barrel pulls `@angular/common/http` (HttpParams via
// meeting.utils), which can't JIT-compile in this plain-Node env. Enums/constants resolve for real via the alias.
const {
  proxyRequest,
  proxyRequestWithResponse,
  pollEndpoint,
  fetchEntityProject,
  toEntityProjectFields,
  getProjectsByIds,
  fetchAllQueryResources,
  getEffectiveEmail,
  getUsernameFromAuth,
  stripAuthPrefix,
  computeIsFoundation,
} = vi.hoisted(() => ({
  proxyRequest: vi.fn(),
  proxyRequestWithResponse: vi.fn(),
  // Resolve immediately without invoking pollFn — the index-polling loop is pollEndpoint's own
  // tested helper; these suites pin the upstream paths plus the captured poll budgets/retry grids.
  pollEndpoint: vi.fn(() => Promise.resolve(true)),
  fetchEntityProject: vi.fn<(...args: unknown[]) => Promise<Record<string, unknown> | null>>(() => Promise.resolve(null)),
  toEntityProjectFields: vi.fn(),
  getProjectsByIds: vi.fn(),
  fetchAllQueryResources: vi.fn(),
  getEffectiveEmail: vi.fn(),
  getUsernameFromAuth: vi.fn(),
  stripAuthPrefix: vi.fn((username: string) => username),
  computeIsFoundation: vi.fn(() => false),
}));

vi.mock('@lfx-one/shared/utils', () => ({
  computeIsFoundation,
  sortCommentResponsesByRecency: vi.fn((responses: unknown[]) => responses),
}));
vi.mock('./logger.service', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    startOperation: vi.fn(),
    success: vi.fn(),
    sanitize: vi.fn((value: unknown) => value),
  },
}));
vi.mock('./microservice-proxy.service', () => ({
  MicroserviceProxyService: class {
    public proxyRequest = proxyRequest;
    public proxyRequestWithResponse = proxyRequestWithResponse;
  },
}));
vi.mock('./project.service', () => ({
  ProjectService: class {
    public getProjectsByIds = getProjectsByIds;
  },
}));
vi.mock('../helpers/entity-project-enrichment.helper', () => ({
  fetchEntityProject,
  toEntityProjectFields,
}));
vi.mock('../helpers/poll-endpoint.helper', () => ({ pollEndpoint }));
vi.mock('../helpers/query-service.helper', () => ({ fetchAllQueryResources }));
vi.mock('../utils/auth-helper', () => ({
  getEffectiveEmail,
  getUsernameFromAuth,
  stripAuthPrefix,
}));

import { MicroserviceError, ServiceValidationError } from '../errors';
import type { PollEndpointOptions } from '../helpers/poll-endpoint.helper';
import { logger } from './logger.service';
import { VoteService } from './vote.service';

describe('VoteService', () => {
  const req = {} as Request;
  // Synthetic uids: a canonical UUID, one carrying a raw path separator, and one pre-encoded —
  // Express hands the controller percent-decoded params, so both hostile shapes arrive decoded.
  const CANONICAL_UID = 'v0000000-0000-0000-0000-00000000d001';
  const HOSTILE_UID = 'abc/def';
  const PREENCODED_UID = '..%2F';
  const voteFixture = { uid: CANONICAL_UID, project_uid: 'p0000000-0000-0000-0000-00000000d001' };

  let service: VoteService;

  beforeEach(() => {
    vi.clearAllMocks();
    proxyRequest.mockResolvedValue(voteFixture);
    proxyRequestWithResponse.mockResolvedValue({ data: voteFixture, headers: {} });
    service = new VoteService();
  });

  describe('getVoteById', () => {
    it('passes a canonical UUID through unchanged (wire-neutral for real uids)', async () => {
      await service.getVoteById(req, CANONICAL_UID);

      expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', `/votes/${CANONICAL_UID}`, 'GET');
    });

    it('encodes a uid containing a path separator so it cannot reshape the upstream path', async () => {
      await service.getVoteById(req, HOSTILE_UID);

      expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', '/votes/abc%2Fdef', 'GET');
    });

    it('double-encodes a pre-encoded uid so a smuggled %2F cannot decode into a separator upstream', async () => {
      await service.getVoteById(req, PREENCODED_UID);

      expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', '/votes/..%252F', 'GET');
    });

    it.each(['.', '..'])(
      'rejects the dot-segment uid "%s" without proxying — fetch URL parsing would normalize it to a different upstream path',
      async (uid) => {
        await expect(service.getVoteById(req, uid)).rejects.toThrow(ServiceValidationError);

        expect(proxyRequest).not.toHaveBeenCalled();
      }
    );

    it('passes a dotted-but-safe uid through unchanged — only exact dot segments URL-normalize', async () => {
      await service.getVoteById(req, 'v1.2');

      expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', '/votes/v1.2', 'GET');
    });

    it('skips project enrichment entirely when includeProject is not set', async () => {
      await service.getVoteById(req, CANONICAL_UID);

      expect(fetchEntityProject).not.toHaveBeenCalled();
      expect(toEntityProjectFields).not.toHaveBeenCalled();
    });

    it('merges the mapped project fields onto the vote when includeProject is set', async () => {
      // Fresh object per test — getVoteById enriches via Object.assign on the proxied payload.
      proxyRequest.mockResolvedValue({ ...voteFixture });
      const project = { uid: voteFixture.project_uid, slug: 'acme-project', name: 'Acme Project' };
      const mappedFields = { project_slug: 'acme-project', project_name: 'Acme Project', is_foundation: false };
      fetchEntityProject.mockResolvedValue(project);
      toEntityProjectFields.mockReturnValue(mappedFields);

      const vote = await service.getVoteById(req, CANONICAL_UID, { includeProject: true });

      expect(fetchEntityProject).toHaveBeenCalledWith(
        req,
        expect.anything(),
        voteFixture.project_uid,
        expect.objectContaining({ operation: 'get_vote_by_id', vote_uid: CANONICAL_UID })
      );
      expect(toEntityProjectFields).toHaveBeenCalledWith(project);
      expect(vote).toMatchObject(mappedFields);
    });

    it('leaves the vote unenriched when the project lookup finds nothing', async () => {
      proxyRequest.mockResolvedValue({ ...voteFixture });
      fetchEntityProject.mockResolvedValue(null);

      const vote = await service.getVoteById(req, CANONICAL_UID, { includeProject: true });

      expect(vote).toEqual(voteFixture);
      expect(toEntityProjectFields).not.toHaveBeenCalled();
    });
  });

  describe('updateVote', () => {
    it('encodes the uid in the PUT path', async () => {
      const voteData = { name: 'Updated ballot' };

      await service.updateVote(req, HOSTILE_UID, voteData as never);

      expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', '/votes/abc%2Fdef', 'PUT', undefined, voteData);
    });

    it('rejects a dot-segment uid without proxying', async () => {
      await expect(service.updateVote(req, '..', { name: 'x' } as never)).rejects.toThrow(ServiceValidationError);

      expect(proxyRequest).not.toHaveBeenCalled();
    });
  });

  describe('deleteVote', () => {
    it('encodes the uid in the DELETE path', async () => {
      proxyRequest.mockResolvedValue(undefined);

      await service.deleteVote(req, HOSTILE_UID);

      expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', '/votes/abc%2Fdef', 'DELETE');
    });

    it('rejects a dot-segment uid without proxying', async () => {
      await expect(service.deleteVote(req, '..')).rejects.toThrow(ServiceValidationError);

      expect(proxyRequest).not.toHaveBeenCalled();
    });
  });

  describe('enableVote', () => {
    it('encodes the uid in the /enable path', async () => {
      await service.enableVote(req, HOSTILE_UID);

      // Trailing args carry no payload/headers; the last is the deadline-derived request timeout
      // (exact values are pinned by the FGA-gap retry suite under fake timers).
      expect(proxyRequestWithResponse).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', '/votes/abc%2Fdef/enable', 'PUT', undefined, undefined, undefined, {
        timeoutMs: expect.any(Number),
      });
    });

    it('rejects a dot-segment uid without proxying', async () => {
      await expect(service.enableVote(req, '..')).rejects.toThrow(ServiceValidationError);

      expect(proxyRequestWithResponse).not.toHaveBeenCalled();
    });
  });

  describe('createVoteResponse', () => {
    it('posts the ballot without an X-Sync header — exactly six proxy arguments', async () => {
      const payload = { vote_uid: CANONICAL_UID, vote_response_uid: 'vr000000-0000-0000-0000-00000000d201' };

      await service.createVoteResponse(req, payload as never);

      // Exactly six args — a seventh would be the removed X-Sync header (GH-1637).
      expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', '/vote_responses', 'POST', undefined, payload);
    });
  });

  // GH-1637: the delete poll must keep its explicit fine-grid budget and wall-clock cap
  // (maxDurationMs — attempt counts alone can't bound wall-clock time) with the
  // remaining-budget request timeout, and keeps the vote_uid filter predicate — `tags` can
  // never match a vote by uid (vote documents are indexed without a vote-uid tag). A regression
  // there makes delete resolve instantly without confirming removal (delete's predicate is
  // `resources.length === 0`). Create no longer polls at all — the GH-2729 FGA-readiness GET
  // probe was removed after live verification showed a pre-tuple check poisons OpenFGA's 10 s
  // check-query cache with a `false` every retry inside the TTL reads back (the probe
  // manufactured the denial that defeated it); the enable 403-retry grid is the readiness
  // mechanism instead. enableVote no longer polls the index either (GH-2730) — its immediate
  // return is pinned below.
  describe('poll budgets', () => {
    // pollEndpoint is stubbed with an untyped vi.fn, so type the captured options explicitly.
    const capturedPollOptions = (): PollEndpointOptions => {
      const [options] = pollEndpoint.mock.calls[0] as unknown as [PollEndpointOptions];
      return options;
    };

    it('createVote issues the POST with the explicit 16 s timeout and returns the POST response without any readiness poll', async () => {
      const voteData = { name: 'New ballot' };

      const vote = await service.createVote(req, voteData as never);

      // Eight args: the seventh stays undefined (that slot was the removed X-Sync header) and the
      // eighth pins the explicit create timeout — 16 s is the v2 voting-api's hardcoded
      // WriteTimeout ceiling plus a 1 s transport margin (the BFF timer starts before gateway
      // transit; an exact 15 s could abort a response completing just under the upstream limit).
      // Create and enable are separate client requests (GH-2826 split): each holds ≤ ~18 s worst
      // case on its own, comfortably under the 60 s ingress ceiling.
      expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', '/votes', 'POST', undefined, voteData, undefined, { timeoutMs: 16000 });
      // The caller consumes only `uid` from the response, so the POST echo is returned as-is and
      // nothing polls: the GH-2729 probe was removed because a pre-tuple check caches `false` for
      // OpenFGA's 10 s check-query TTL and every retry inside the TTL reads that cached denial —
      // the probe manufactured the denial that defeated it. List freshness is the list's own
      // refetch (the pre-GH-1637 index poll never delivered it anyway — a broken `tags:`
      // predicate exhausted 100% of the time and always fell back to this same POST response).
      expect(vote).toEqual(voteFixture);
      expect(pollEndpoint).not.toHaveBeenCalled();
      expect(proxyRequest).toHaveBeenCalledTimes(1);
    });

    it('deleteVote polls with the explicit 27 × 300 ms budget, an 8 s wall-clock cap, and the vote_uid filter predicate', async () => {
      proxyRequest.mockResolvedValue(undefined);

      await service.deleteVote(req, CANONICAL_UID);

      const options = capturedPollOptions();
      expect(options).toMatchObject({ operation: 'delete_vote', maxRetries: 27, retryDelayMs: 300, maxDurationMs: 8000 });

      // The fixed predicate must keep returning false while the record still exists and true
      // once it is gone — drive both cases directly.
      proxyRequest.mockResolvedValue({ resources: [voteFixture] });
      await expect(options.pollFn({ remainingMs: 5000 })).resolves.toBe(false);

      proxyRequest.mockResolvedValue({ resources: [] });
      await expect(options.pollFn({ remainingMs: 5000 })).resolves.toBe(true);
      expect(proxyRequest).toHaveBeenCalledWith(
        req,
        'LFX_V2_SERVICE',
        '/query/resources',
        'GET',
        { type: 'vote', filters: [`vote_uid:${CANONICAL_UID}`] },
        undefined,
        undefined,
        { timeoutMs: 5000 }
      );
    });

    it('deleteVote awaits the de-index poll before returning', async () => {
      // A dropped `await` here returns before the vote leaves the index — the client's refetch
      // still shows the deleted vote (the GH-1637 symptom). create/enable's awaits are pinned by
      // their typed return paths; delete's void return needs this settlement-ordering check.
      proxyRequest.mockResolvedValue(undefined);
      let resolvePoll!: (value: boolean) => void;
      pollEndpoint.mockReturnValueOnce(
        new Promise<boolean>((resolve) => {
          resolvePoll = resolve;
        })
      );

      let settled = false;
      const pending = service.deleteVote(req, CANONICAL_UID).then(() => {
        settled = true;
      });
      await new Promise((resolve) => setImmediate(resolve));
      expect(settled).toBe(false);

      resolvePoll(true);
      await pending;
      expect(settled).toBe(true);
    });

    it('enableVote returns the minimal active shape right after the PUT, without polling the index (GH-2730)', async () => {
      const vote = await service.enableVote(req, CANONICAL_UID);

      // The enable PUT is synchronous upstream (ITX writes the status before responding), so the
      // method responds immediately — the votes list merges the known-open status over stale index
      // rows client-side while the index catches up.
      expect(vote).toEqual({ uid: CANONICAL_UID, status: 'active' });
      const enablePolls = (pollEndpoint.mock.calls as unknown as [PollEndpointOptions][]).filter(([options]) => options.operation === 'enable_vote');
      expect(enablePolls).toHaveLength(0);
      expect(proxyRequest.mock.calls.filter((call) => call[2] === '/query/resources')).toHaveLength(0);
    });
  });

  // GH-2826: the speculative create+open flow pays the FGA tuple-propagation grace on the
  // enable route — the client echoes the BFF-stamped create-completion time (`createCompletedAt`)
  // and enableVote sleeps the remaining grace (max(0, grace − elapsed), clamped to the grace)
  // before attempt 1, so a just-created vote's first PUT never fires before fga-sync's tuple
  // write (a pre-tuple check caches `false` for OpenFGA's 10 s check-query TTL — the GH-2729
  // pivot removed the probe that did exactly that). Without the hint there is no sleep: the
  // edit flow's tuples were written at create time, long past.
  describe('enableVote grace hint (GH-2826)', () => {
    it('sleeps the remaining grace when the hint is fresh, then fires attempt 1 with the fixed 16 s budget', async () => {
      vi.useFakeTimers();
      try {
        // The create resolved 1.2 s ago (a slow reader's dialog time) — 800 ms of the 2 s grace remain.
        const promise = service.enableVote(req, CANONICAL_UID, { createCompletedAt: Date.now() - 1200 });
        // No PUT while the grace remainder runs — a pre-tuple check would cache `false` for the
        // cluster's 10 s OpenFGA check-query TTL and poison the very grid that follows.
        await vi.advanceTimersByTimeAsync(799);
        expect(proxyRequestWithResponse).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        const vote = await promise;

        expect(proxyRequestWithResponse).toHaveBeenCalledTimes(1);
        expect(proxyRequestWithResponse).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', `/votes/${CANONICAL_UID}/enable`, 'PUT', undefined, undefined, undefined, {
          timeoutMs: 16000,
        });
        expect(vote).toEqual({ uid: CANONICAL_UID, status: 'active' });
        // The slept remainder is observable for dev-cluster verification.
        expect(logger.debug).toHaveBeenCalledWith(req, 'enable_vote', 'Sleeping the remaining FGA-propagation grace before the first enable PUT', {
          vote_uid: CANONICAL_UID,
          grace_remaining_ms: 800,
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it('skips the sleep when the hinted elapsed time already exceeds the grace (slow reader)', async () => {
      vi.useFakeTimers();
      try {
        // Create resolved 5 s ago — the grace has fully elapsed naturally, so attempt 1 fires
        // immediately (this is the slow-reader fast path: post-Yes wait is the enable only).
        const promise = service.enableVote(req, CANONICAL_UID, { createCompletedAt: Date.now() - 5000 });
        const vote = await promise;

        expect(proxyRequestWithResponse).toHaveBeenCalledTimes(1);
        expect(vote).toEqual({ uid: CANONICAL_UID, status: 'active' });
      } finally {
        vi.useRealTimers();
      }
    });

    it('clamps a future-dated hint to the full grace rather than sleeping past it', async () => {
      vi.useFakeTimers();
      try {
        // A timestamp 60 s in the "future" (tampered or clock-skewed) yields a negative elapsed —
        // the clamp treats it as just-created: exactly the 2 s grace, never more.
        const promise = service.enableVote(req, CANONICAL_UID, { createCompletedAt: Date.now() + 60_000 });
        await vi.advanceTimersByTimeAsync(1999);
        expect(proxyRequestWithResponse).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        const vote = await promise;

        expect(proxyRequestWithResponse).toHaveBeenCalledTimes(1);
        expect(vote.status).toBe('active');
      } finally {
        vi.useRealTimers();
      }
    });

    it('skips the sleep for a non-finite hint', async () => {
      const vote = await service.enableVote(req, CANONICAL_UID, { createCompletedAt: Number.NaN });

      expect(proxyRequestWithResponse).toHaveBeenCalledTimes(1);
      expect(vote.status).toBe('active');
    });

    it('skips the sleep entirely without the hint — the standalone (edit-flow) path', async () => {
      vi.useFakeTimers();
      try {
        // No fake-timer advance: the promise resolves on microtasks alone, which pins the
        // absence of the grace setTimeout.
        const promise = service.enableVote(req, CANONICAL_UID);
        const vote = await promise;

        expect(proxyRequestWithResponse).toHaveBeenCalledTimes(1);
        expect(vote).toEqual({ uid: CANONICAL_UID, status: 'active' });
        expect(logger.debug).not.toHaveBeenCalledWith(
          req,
          'enable_vote',
          'Sleeping the remaining FGA-propagation grace before the first enable PUT',
          expect.anything()
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it('createVote creates only — no enable PUT and no readiness poll (GH-2826 split the fused path)', async () => {
      await service.createVote(req, { name: 'New ballot' } as never);

      expect(proxyRequest).toHaveBeenCalledTimes(1);
      expect(proxyRequestWithResponse).not.toHaveBeenCalled();
      expect(pollEndpoint).not.toHaveBeenCalled();
    });
  });

  // GH-1637: the enable PUT is authorized on `vote:{uid}` (Heimdall openfga_check), and a freshly
  // created vote's FGA tuple lags the create POST — the voting service is observed to publish
  // the indexer message before the fga-sync one (verified in lfx-v2-voting-service). On the
  // create+open path this grid is the readiness mechanism itself (GH-2729 pivot — the
  // FGA-readiness GET probe was removed after it proved self-defeating against OpenFGA's 10 s
  // check-query cache); it is also the bounded safety net for callers enabling a vote they did
  // not just create. enableVote retries only the 403 signature on a 600 ms grid with no attempt
  // cap — the wall-clock deadline is the only bound. Attempt 1 is exempt from the deadline: it
  // gets the fixed 16 s slow-success budget (the voting-api's hardcoded WriteTimeout plus a 1 s
  // transport margin — a slower enable can never succeed end-to-end anyway). Retries run under
  // the 13 s end-to-end deadline (each retry PUT gets the remaining budget as its request
  // timeout, sleeps truncate to the deadline) so slow 403s can't stretch retries past the
  // documented cap, and the deadline spans the 10 s check-cache TTL so a first attempt that
  // landed before fga-sync's tuple write (its denial cached) still recovers on a post-expiry
  // retry. Post-GH-2730 there is no index poll after the loop — the method returns
  // `{ uid, status: 'active' }` immediately.
  describe('enableVote FGA-gap retry', () => {
    it('retries the enable PUT on a 403 and succeeds on a later attempt', async () => {
      vi.useFakeTimers();
      try {
        proxyRequestWithResponse.mockRejectedValueOnce(new MicroserviceError('Forbidden', 403, 'FORBIDDEN'));

        const promise = service.enableVote(req, CANONICAL_UID);
        await vi.advanceTimersByTimeAsync(600);
        const vote = await promise;

        expect(proxyRequestWithResponse).toHaveBeenCalledTimes(2);
        // The first PUT gets the fixed slow-success budget (16 s — the voting-api's hardcoded
        // WriteTimeout ceiling plus a 1 s transport margin, so a slower enable can never succeed
        // end-to-end anyway); retries get the 13 s deadline's remainder — 12.4 s left after the
        // 600 ms backoff.
        expect(proxyRequestWithResponse).toHaveBeenNthCalledWith(
          1,
          req,
          'LFX_V2_SERVICE',
          `/votes/${CANONICAL_UID}/enable`,
          'PUT',
          undefined,
          undefined,
          undefined,
          { timeoutMs: 16000 }
        );
        expect(proxyRequestWithResponse).toHaveBeenNthCalledWith(
          2,
          req,
          'LFX_V2_SERVICE',
          `/votes/${CANONICAL_UID}/enable`,
          'PUT',
          undefined,
          undefined,
          undefined,
          { timeoutMs: 12400 }
        );
        expect(vote.status).toBe('active');
      } finally {
        vi.useRealTimers();
      }
    });

    it('retries on the 600 ms grid until the 13 s deadline, then rethrows the 403 with the exhaustion warning', async () => {
      vi.useFakeTimers();
      try {
        proxyRequestWithResponse.mockRejectedValue(new MicroserviceError('Forbidden', 403, 'FORBIDDEN'));

        const promise = service.enableVote(req, CANONICAL_UID);
        const rejection = expect(promise).rejects.toMatchObject({ statusCode: 403 });
        await vi.advanceTimersByTimeAsync(12500);
        await rejection;

        // No attempt cap — the deadline is the bound: 21 instant-403 attempts at 0.6 s intervals,
        // stopped by the minimum-viable-budget floor at t = 12 s.
        expect(proxyRequestWithResponse).toHaveBeenCalledTimes(21);
        expect(logger.warning).toHaveBeenCalledWith(
          req,
          'enable_vote',
          'Enable PUT still 403 after bounded retries, surfacing — genuine denial and FGA replication lag are indistinguishable',
          { vote_uid: CANONICAL_UID, attempts: 21 }
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it('treats a 400 "poll is already enabled" answer as success — enable is idempotent', async () => {
      // ITX returns 400 "poll is already enabled" for any non-disabled poll — a double-open or a
      // 408-after-PutPoll (response lost after the write landed) must not report failure.
      proxyRequestWithResponse.mockRejectedValue(new MicroserviceError('poll is already enabled', 400, 'BAD_REQUEST'));

      await expect(service.enableVote(req, CANONICAL_UID)).resolves.toEqual({ uid: CANONICAL_UID, status: 'active' });
      expect(proxyRequestWithResponse).toHaveBeenCalledTimes(1);
    });

    it('still surfaces a 400 that is not the already-enabled signature', async () => {
      proxyRequestWithResponse.mockRejectedValue(new MicroserviceError('end_time must be in the future', 400, 'BAD_REQUEST'));

      await expect(service.enableVote(req, CANONICAL_UID)).rejects.toMatchObject({ statusCode: 400 });
      expect(proxyRequestWithResponse).toHaveBeenCalledTimes(1);
    });

    it('does not retry non-403 microservice failures', async () => {
      proxyRequestWithResponse.mockRejectedValue(new MicroserviceError('Internal', 500, 'INTERNAL_ERROR'));

      await expect(service.enableVote(req, CANONICAL_UID)).rejects.toMatchObject({ statusCode: 500 });
      expect(proxyRequestWithResponse).toHaveBeenCalledTimes(1);
    });

    it('does not retry non-microservice errors, even one carrying a 403 statusCode', async () => {
      // A 403-bearing non-MicroserviceError discriminates the instanceof half of the retry gate —
      // a plain Error carries no statusCode, so dropping `instanceof MicroserviceError` would pass.
      proxyRequestWithResponse.mockRejectedValue(Object.assign(new Error('socket hangup'), { statusCode: 403 }));

      await expect(service.enableVote(req, CANONICAL_UID)).rejects.toThrow('socket hangup');
      expect(proxyRequestWithResponse).toHaveBeenCalledTimes(1);
    });

    it('returns right after a retried PUT succeeds — no index poll even with budget left over (GH-2730)', async () => {
      vi.useFakeTimers();
      try {
        // A 403 that takes 2 s to return, then success at t=2.6 s: pre-GH-2730 the index poll
        // inherited the 9.1 s leftover; now the method responds immediately after the PUT.
        proxyRequestWithResponse.mockImplementationOnce(() => {
          vi.advanceTimersByTime(2000);
          return Promise.reject(new MicroserviceError('Forbidden', 403, 'FORBIDDEN'));
        });

        const promise = service.enableVote(req, CANONICAL_UID);
        await vi.advanceTimersByTimeAsync(600);
        const vote = await promise;

        expect(vote).toEqual({ uid: CANONICAL_UID, status: 'active' });
        const enablePolls = (pollEndpoint.mock.calls as unknown as [PollEndpointOptions][]).filter(([options]) => options.operation === 'enable_vote');
        expect(enablePolls).toHaveLength(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it('rethrows the observed 403 with the exhaustion warning when the backoff would spend the budget', async () => {
      vi.useFakeTimers();
      try {
        // Each 403 takes 11.5 s to return — after the first, 1.5 s of the 13 s budget remains
        // and the 600 ms backoff would leave 900 ms: under the minimum viable request budget, so
        // no further PUT is issued. The old
        // path issued a second PUT with a 1 ms timeout whose 408 masked the observed 403 (and,
        // not being `retryableForbidden`, skipped the exhaustion warning) — a denial surfacing as
        // a client-visible timeout.
        proxyRequestWithResponse.mockImplementation(() => {
          vi.advanceTimersByTime(11500);
          return Promise.reject(new MicroserviceError('Forbidden', 403, 'FORBIDDEN'));
        });

        await expect(service.enableVote(req, CANONICAL_UID)).rejects.toMatchObject({ statusCode: 403 });

        expect(proxyRequestWithResponse).toHaveBeenCalledTimes(1);
        expect(logger.warning).toHaveBeenCalledWith(
          req,
          'enable_vote',
          'Enable PUT still 403 after bounded retries, surfacing — genuine denial and FGA replication lag are indistinguishable',
          { vote_uid: CANONICAL_UID, attempts: 1 }
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it('rethrows the observed 403 with the exhaustion warning when the backoff sleep resumes past the budget floor', async () => {
      vi.useFakeTimers();
      try {
        // The first 403 returns instantly with the budget intact, so the pre-sleep floor check
        // passes (13000 - 600 >= 1000) and the 600 ms backoff is taken. A timer scheduled at the
        // same instant but first then jumps the clock 11.9 s mid-sleep — an event-loop stall
        // resuming the backoff timer late — leaving 500 ms, under the minimum viable request
        // budget: the post-sleep re-check must rethrow the observed 403 with the exhaustion
        // warning rather than issue a PUT whose sub-round-trip 408 would mask it.
        setTimeout(() => vi.advanceTimersByTime(11900), 600);
        proxyRequestWithResponse.mockRejectedValueOnce(new MicroserviceError('Forbidden', 403, 'FORBIDDEN'));

        const promise = service.enableVote(req, CANONICAL_UID);
        const rejection = expect(promise).rejects.toMatchObject({ statusCode: 403 });
        await vi.advanceTimersByTimeAsync(600);
        await rejection;

        expect(proxyRequestWithResponse).toHaveBeenCalledTimes(1);
        expect(logger.warning).toHaveBeenCalledWith(
          req,
          'enable_vote',
          'Enable PUT still 403 after bounded retries, surfacing — genuine denial and FGA replication lag are indistinguishable',
          { vote_uid: CANONICAL_UID, attempts: 1 }
        );
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('getVoteResults', () => {
    it('encodes the uid in the /results path', async () => {
      proxyRequest.mockResolvedValue({ poll_results: [], comment_results: [], num_votes_cast: 0 });

      await service.getVoteResults(req, HOSTILE_UID);

      expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', '/votes/abc%2Fdef/results', 'GET');
    });

    it('rejects a dot-segment uid without proxying', async () => {
      await expect(service.getVoteResults(req, '..')).rejects.toThrow(ServiceValidationError);

      expect(proxyRequest).not.toHaveBeenCalled();
    });
  });

  // The votes table's canonical edit links depend on this enrichment — pin the getProjectsByIds
  // wiring so a mapping regression cannot pass while rows silently fall back to flat URLs.
  describe('getVotes', () => {
    const INDEX_VOTE_UID = 'v0000000-0000-0000-0000-00000000d101';
    const PROJECT_UID = voteFixture.project_uid;
    // Query-service index row (VoteData) carries only project_uid — no slug, name, or tier.
    const indexRow = {
      vote_uid: INDEX_VOTE_UID,
      name: 'Steering Election',
      status: 'active',
      project_uid: PROJECT_UID,
      end_time: '2099-06-01T18:00:00Z',
    };
    const project = { uid: PROJECT_UID, slug: 'acme-project', name: 'Acme Project', parent_uid: 'p0000000-0000-0000-0000-00000000d000' };

    it('enriches an index row carrying only project_uid with the canonical project fields', async () => {
      proxyRequest.mockResolvedValue({ resources: [{ data: indexRow }], page_token: undefined });
      getProjectsByIds.mockResolvedValue(new Map([[PROJECT_UID, project]]));
      computeIsFoundation.mockReturnValue(true);

      const result = await service.getVotes(req);

      expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', { type: 'vote' });
      expect(getProjectsByIds).toHaveBeenCalledWith(req, [PROJECT_UID]);
      expect(computeIsFoundation).toHaveBeenCalledWith(project);
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({
        uid: INDEX_VOTE_UID,
        project_uid: PROJECT_UID,
        project_slug: 'acme-project',
        project_name: 'Acme Project',
        is_foundation: true,
        parent_project_uid: project.parent_uid,
      });
      // normalizeIndexedVote maps the indexer's vote_uid onto uid and strips the alias.
      expect(result.data[0]).not.toHaveProperty('vote_uid');
    });

    it('leaves the row unenriched when the project lookup misses, preserving the flat-URL fallback', async () => {
      proxyRequest.mockResolvedValue({ resources: [{ data: indexRow }], page_token: undefined });
      getProjectsByIds.mockResolvedValue(new Map());

      const result = await service.getVotes(req);

      expect(result.data[0]).not.toHaveProperty('project_slug');
      expect(result.data[0]).not.toHaveProperty('is_foundation');
    });

    it('skips project enrichment entirely when includeProject is false', async () => {
      proxyRequest.mockResolvedValue({ resources: [{ data: indexRow }], page_token: undefined });

      const result = await service.getVotes(req, {}, { includeProject: false });

      expect(getProjectsByIds).not.toHaveBeenCalled();
      expect(computeIsFoundation).not.toHaveBeenCalled();
      expect(result.data[0]).not.toHaveProperty('project_slug');
      expect(result.data[0]).not.toHaveProperty('is_foundation');
      expect(result.data[0]).not.toHaveProperty('parent_project_uid');
    });
  });

  describe('getMyVotes', () => {
    const MY_VOTE_UID = 'v0000000-0000-0000-0000-00000000d102';
    const PROJECT_UID = voteFixture.project_uid;
    const detailVote = {
      uid: MY_VOTE_UID,
      name: 'Board Ratification',
      status: 'active',
      project_uid: PROJECT_UID,
      end_time: '2099-06-01T18:00:00Z',
    };
    const project = { uid: PROJECT_UID, slug: 'acme-project', name: 'Acme Project', parent_uid: 'p0000000-0000-0000-0000-00000000d000' };

    beforeEach(() => {
      getUsernameFromAuth.mockResolvedValue('spec-user');
      getEffectiveEmail.mockReturnValue('spec-user@example.org');
    });

    it('enriches the per-uid vote details with the same canonical project fields', async () => {
      fetchAllQueryResources.mockResolvedValue([{ vote_uid: MY_VOTE_UID, vote_status: IndexedVoteResponseStatus.RESPONDED }]);
      proxyRequest.mockResolvedValue(detailVote);
      getProjectsByIds.mockResolvedValue(new Map([[PROJECT_UID, project]]));
      computeIsFoundation.mockReturnValue(true);

      const votes = await service.getMyVotes(req);

      expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', `/votes/${MY_VOTE_UID}`, 'GET');
      expect(getProjectsByIds).toHaveBeenCalledWith(req, [PROJECT_UID]);
      expect(votes).toHaveLength(1);
      expect(votes[0]).toMatchObject({
        uid: MY_VOTE_UID,
        project_slug: 'acme-project',
        project_name: 'Acme Project',
        is_foundation: true,
        parent_project_uid: project.parent_uid,
      });
    });
  });
});
