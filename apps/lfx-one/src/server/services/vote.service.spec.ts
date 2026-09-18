// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Unit tests for vote.service.ts — upstream path encoding (GH-1568), X-Sync removal, poll budgets,
// and the enableVote FGA-gap retry (GH-1637). All fixtures use synthetic placeholder identities —
// never real user data.

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

  // GH-1637: the create/delete/enable polls must keep their explicit fine-grid budgets, the
  // wall-clock cap (maxDurationMs — attempt counts alone can't bound wall-clock time) with the
  // remaining-budget request timeout, and the vote_uid filter predicate — `tags` can never match
  // a vote by uid (vote documents are indexed without a vote-uid tag). A regression there silently
  // turns create/enable into a fixed full-budget wait followed by the fallback, and makes delete
  // resolve instantly without confirming removal (delete's predicate is `resources.length === 0`).
  describe('poll budgets', () => {
    // pollEndpoint is stubbed with an untyped vi.fn, so type the captured options explicitly.
    const capturedPollOptions = (): PollEndpointOptions => {
      const [options] = pollEndpoint.mock.calls[0] as unknown as [PollEndpointOptions];
      return options;
    };

    it('createVote polls with the explicit 27 × 300 ms budget, an 8 s wall-clock cap, and the vote_uid filter predicate', async () => {
      const voteData = { name: 'New ballot' };

      await service.createVote(req, voteData as never);

      // Exactly six args — a seventh would be the removed X-Sync header.
      expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', '/votes', 'POST', undefined, voteData);
      const options = capturedPollOptions();
      expect(options).toMatchObject({ operation: 'create_vote', maxRetries: 27, retryDelayMs: 300, maxDurationMs: 8000 });

      proxyRequest.mockResolvedValue({ resources: [] });
      await expect(options.pollFn({ remainingMs: 5000 })).resolves.toBe(false);

      // Found in the index: resolves true (the boolean pins the found-path — a bare call would
      // let an inverted `resources.length > 0` check pass while every create burns the full budget).
      proxyRequest.mockResolvedValue({ resources: [{ data: { vote_uid: CANONICAL_UID, status: 'disabled' } }] });
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

    it('enableVote polls with the explicit 36 × 300 ms budget, a 10.5 s wall-clock cap, and the vote_uid filter predicate', async () => {
      await service.enableVote(req, CANONICAL_UID);

      const options = capturedPollOptions();
      expect(options).toMatchObject({ operation: 'enable_vote', maxRetries: 36, retryDelayMs: 300, maxDurationMs: 10500 });

      proxyRequest.mockResolvedValue({ resources: [] });
      await expect(options.pollFn({ remainingMs: 5000 })).resolves.toBe(false);

      // Still disabled in the index: keep polling.
      proxyRequest.mockResolvedValue({ resources: [{ data: { vote_uid: CANONICAL_UID, status: 'disabled' } }] });
      await expect(options.pollFn({ remainingMs: 5000 })).resolves.toBe(false);

      // Active: resolves — pins the `status === 'active'` gate against deletion.
      proxyRequest.mockResolvedValue({ resources: [{ data: { vote_uid: CANONICAL_UID, status: 'active' } }] });
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
  });

  // GH-1637: the enable PUT is authorized on `vote:{uid}` (Heimdall openfga_check), and a freshly
  // created vote's FGA tuple lags index visibility — the voting service is observed to publish
  // the indexer message before the fga-sync one (verified in lfx-v2-voting-service). With the
  // create poll resolving at index-visibility, an
  // immediate enable can 403 inside that replication gap; enableVote retries only that signature
  // on a bounded 3-attempt / 600 ms grid. The grid runs under one 11.7 s end-to-end deadline
  // (each PUT gets the remaining budget as its request timeout, sleeps truncate to the deadline,
  // the index poll inherits the leftover) so slow 403s can't stretch the call past the documented
  // cap — three 30 s-default-timeout denials plus a fresh poll window would otherwise take ~100 s.
  describe('enableVote FGA-gap retry', () => {
    it('retries the enable PUT on a 403 and succeeds on a later attempt', async () => {
      vi.useFakeTimers();
      try {
        proxyRequestWithResponse.mockRejectedValueOnce(new MicroserviceError('Forbidden', 403, 'FORBIDDEN'));

        const promise = service.enableVote(req, CANONICAL_UID);
        await vi.advanceTimersByTimeAsync(600);
        const vote = await promise;

        expect(proxyRequestWithResponse).toHaveBeenCalledTimes(2);
        // Every PUT runs under the shared end-to-end deadline: the first gets the full 11.7 s as
        // its request timeout, the retry only the 11.1 s left after the 600 ms backoff.
        expect(proxyRequestWithResponse).toHaveBeenNthCalledWith(
          1,
          req,
          'LFX_V2_SERVICE',
          `/votes/${CANONICAL_UID}/enable`,
          'PUT',
          undefined,
          undefined,
          undefined,
          { timeoutMs: 11700 }
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
          { timeoutMs: 11100 }
        );
        expect(vote.status).toBe('active');
      } finally {
        vi.useRealTimers();
      }
    });

    it('stops after the bounded attempts and rethrows the 403', async () => {
      vi.useFakeTimers();
      try {
        proxyRequestWithResponse.mockRejectedValue(new MicroserviceError('Forbidden', 403, 'FORBIDDEN'));

        const promise = service.enableVote(req, CANONICAL_UID);
        const rejection = expect(promise).rejects.toMatchObject({ statusCode: 403 });
        await vi.advanceTimersByTimeAsync(1200);
        await rejection;

        expect(proxyRequestWithResponse).toHaveBeenCalledTimes(3);
      } finally {
        vi.useRealTimers();
      }
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

    it('passes only the leftover end-to-end budget to the index poll after a slow retry', async () => {
      vi.useFakeTimers();
      try {
        // A 403 that takes 2 s to return, then success at t=2.6 s: the poll must inherit the
        // shared deadline's leftover (9.1 s), not a fresh 10.5 s window.
        proxyRequestWithResponse.mockImplementationOnce(() => {
          vi.advanceTimersByTime(2000);
          return Promise.reject(new MicroserviceError('Forbidden', 403, 'FORBIDDEN'));
        });

        const promise = service.enableVote(req, CANONICAL_UID);
        await vi.advanceTimersByTimeAsync(600);
        await promise;

        const [options] = pollEndpoint.mock.calls[0] as unknown as [PollEndpointOptions];
        expect(options.maxDurationMs).toBe(9100);
      } finally {
        vi.useRealTimers();
      }
    });

    it('rethrows the observed 403 with the exhaustion warning when the backoff would spend the budget', async () => {
      vi.useFakeTimers();
      try {
        // Each 403 takes 11.5 s to return — after the first, only 200 ms of the 11.7 s budget
        // remains: under the minimum viable request budget, so no further PUT is issued. The old
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
