// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Unit tests for vote.service.ts — upstream path encoding (GH-1568), X-Sync removal, poll budgets,
// the enableVote FGA-gap retry (GH-1637), the enable grace hint (GH-2826), and the GH-1558
// drain-sort-paginate canonical vote list ordering. All fixtures use synthetic placeholder
// identities — never real user data.

// `@angular/compiler` before everything: the GH-1558 ordering specs wire the REAL
// compareVotesByRecency through the mocked utils barrel via importActual of vote.utils, which
// statically imports @angular/forms — the JIT compiler shim lets that graph load in plain Node.
import '@angular/compiler';

import type { Request } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  VOTE_REMINDER_INACTIVE,
  VOTE_REMINDER_PRECHECK_FAILED,
  VOTE_REMINDER_SELECTION_STALE,
  VOTE_SUMMARY_NOT_ENDED,
  VOTE_SUMMARY_SEND_FAILED,
  VOTE_VOTERS_DRAFT,
} from '@lfx-one/shared/constants';
import { IndexedVoteResponseStatus, VoteResponseStatus, VoteVoterStatus } from '@lfx-one/shared/enums';
import type {
  CreateVoteResponseRequest,
  IndexedVote,
  IndexedVoteResponse,
  QueryServiceResponse,
  VoteResultsResponse,
  VoteVoter,
} from '@lfx-one/shared/interfaces';

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
  getRawEffectiveEmail,
  getUsernameFromAuth,
  stripAuthPrefix,
  computeIsFoundation,
  addAccessToResources,
  assertVoteWrite,
  sendEmail,
} = vi.hoisted(() => ({
  proxyRequest: vi.fn(),
  proxyRequestWithResponse: vi.fn(),
  // Most suites bypass the callback; submission regressions install the real poll implementation.
  pollEndpoint: vi.fn<(options: PollEndpointOptions) => Promise<boolean>>(() => Promise.resolve(true)),
  fetchEntityProject: vi.fn<(...args: unknown[]) => Promise<Record<string, unknown> | null>>(() => Promise.resolve(null)),
  toEntityProjectFields: vi.fn(),
  getProjectsByIds: vi.fn(),
  fetchAllQueryResources: vi.fn(),
  getEffectiveEmail: vi.fn(),
  getRawEffectiveEmail: vi.fn(),
  getUsernameFromAuth: vi.fn(),
  stripAuthPrefix: vi.fn((username: string) => username),
  computeIsFoundation: vi.fn(() => false),
  addAccessToResources: vi.fn(async (_req: unknown, resources: unknown[]) => resources),
  assertVoteWrite: vi.fn(),
  sendEmail: vi.fn(),
}));

vi.mock('@lfx-one/shared/utils', async () => {
  // The real GH-1558 comparator — the ordering specs must exercise the service's actual sort, not
  // a stub. Deep importActual avoids the barrel's @angular/common/http graph (compiler shim above).
  const { compareVotesByRecency, isVoteClosingSoon, computeResultPercentage } =
    await vi.importActual<typeof import('@lfx-one/shared/utils/vote.utils')>('@lfx-one/shared/utils/vote.utils');
  const { countVotesByStatus, normalizePollStatus, sortCommentResponsesByText } =
    await vi.importActual<typeof import('@lfx-one/shared/utils/poll.utils')>('@lfx-one/shared/utils/poll.utils');
  const { maskIdentifierForLogs } = await vi.importActual<typeof import('@lfx-one/shared/utils/email.utils')>('@lfx-one/shared/utils/email.utils');
  const { escapeHtml } = await vi.importActual<typeof import('@lfx-one/shared/utils/html-utils')>('@lfx-one/shared/utils/html-utils');
  return {
    computeIsFoundation,
    compareVotesByRecency,
    computeResultPercentage,
    countVotesByStatus,
    isVoteClosingSoon,
    normalizePollStatus,
    maskIdentifierForLogs,
    escapeHtml,
    sortCommentResponsesByRecency: vi.fn((responses: unknown[]) => responses),
    sortCommentResponsesByText,
  };
});
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
vi.mock('./access-check.service', () => ({
  AccessCheckService: class {
    public addAccessToResources = addAccessToResources;
  },
}));
vi.mock('./email.service', () => ({
  EmailService: class {
    public sendEmail = sendEmail;
  },
}));
vi.mock('../helpers/vote-write-access.helper', () => ({ assertVoteWrite }));
vi.mock('../helpers/entity-project-enrichment.helper', () => ({
  fetchEntityProject,
  toEntityProjectFields,
}));
vi.mock('../helpers/poll-endpoint.helper', () => ({ pollEndpoint }));
vi.mock('../helpers/query-service.helper', () => ({ fetchAllQueryResources }));
vi.mock('../utils/auth-helper', () => ({
  getEffectiveEmail,
  getRawEffectiveEmail,
  getUsernameFromAuth,
  stripAuthPrefix,
  // Composed from the mocks above, as in vote-response.helper.spec.ts, so per-test identity control is unchanged.
  resolveUserIdentity: async (req: Request) => {
    const raw: string | null = await getUsernameFromAuth(req);
    return { email: getEffectiveEmail(req), username: raw ? stripAuthPrefix(raw) : raw };
  },
}));

import { ConflictError, MicroserviceError, ServiceValidationError } from '../errors';
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
    assertVoteWrite.mockResolvedValue(undefined);
    addAccessToResources.mockImplementation(async (_req: unknown, resources: unknown[]) => resources);
    sendEmail.mockResolvedValue({ email_id: 'email-sent' });
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

  describe('extendVote', () => {
    it('encodes the uid in the POST /extend path', async () => {
      const data = { end_time: '2026-09-01T23:59:00.000Z', end_time_timezone: 'America/New_York' };

      await service.extendVote(req, HOSTILE_UID, data);

      expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', '/votes/abc%2Fdef/extend', 'POST', undefined, data);
    });

    it('rejects a dot-segment uid without proxying', async () => {
      await expect(service.extendVote(req, '..', { end_time: 'x', end_time_timezone: 'UTC' })).rejects.toThrow(ServiceValidationError);

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
    const RESPONSE_UID = 'vr000000-0000-0000-0000-00000000d201';
    const EMAIL = 'spec-voter@example.org';
    const USERNAME = 'spec-voter';
    const payload: CreateVoteResponseRequest = {
      vote_uid: CANONICAL_UID,
      vote_response_uid: RESPONSE_UID,
      abstain: false,
      user_vote_content: [{ question_id: 'question-1', choice_ids: ['choice-1'] }],
    };
    const responseRow = (overrides: Partial<IndexedVoteResponse> = {}): IndexedVoteResponse => ({
      uid: RESPONSE_UID,
      vote_uid: CANONICAL_UID,
      user_email: EMAIL,
      username: '',
      vote_status: IndexedVoteResponseStatus.RESPONDED,
      ...overrides,
    });
    let indexedRows: IndexedVoteResponse[];
    let secondPageRows: IndexedVoteResponse[] | undefined;
    let queryReads: number;
    let writes: number;
    let accepted: boolean;
    let submitGate: Promise<void> | undefined;
    let submitError: Error | undefined;
    let queryError: Error | undefined;
    let ignoreIndexFilters: boolean;

    beforeEach(async () => {
      vi.useFakeTimers();
      const realPoll = await vi.importActual<typeof import('../helpers/poll-endpoint.helper')>('../helpers/poll-endpoint.helper');
      const realPaginator = await vi.importActual<typeof import('../helpers/query-service.helper')>('../helpers/query-service.helper');
      pollEndpoint.mockImplementation(realPoll.pollEndpoint);
      fetchAllQueryResources.mockImplementation(realPaginator.fetchAllQueryResources);
      getEffectiveEmail.mockReturnValue(EMAIL);
      getRawEffectiveEmail.mockReturnValue(null);
      getUsernameFromAuth.mockResolvedValue(USERNAME);
      indexedRows = [responseRow()];
      secondPageRows = undefined;
      queryReads = 0;
      writes = 0;
      accepted = false;
      submitGate = undefined;
      submitError = undefined;
      queryError = undefined;
      ignoreIndexFilters = false;
      proxyRequest.mockImplementation(async (_req: Request, _service: string, path: string, method: string, params: Record<string, unknown> = {}) => {
        if (path === '/vote_responses' && method === 'POST') {
          writes++;
          if (submitError) throw submitError;
          await submitGate;
          accepted = true;
          return;
        }
        if (path !== '/query/resources' || method !== 'GET') throw new Error(`Unexpected transport call: ${method} ${path}`);
        if (!accepted) throw new Error('Confirmation read before ballot acceptance');
        queryReads++;
        if (queryError) throw queryError;
        const pageRows = params['page_token'] ? (secondPageRows ?? []) : indexedRows;
        const matches = (row: IndexedVoteResponse, clause: string): boolean => {
          const [field, value] = clause.split(':', 2);
          return row[field as keyof IndexedVoteResponse] === value;
        };
        const rows = ignoreIndexFilters
          ? pageRows
          : pageRows.filter((row) => {
              if (params['filter_grants'] === 'direct' && row.username !== USERNAME) return false;
              const filters = (params['filters'] as string[] | undefined) ?? [];
              const identities = (params['filters_or'] as string[] | undefined) ?? [];
              return filters.every((clause) => matches(row, clause)) && (!identities.length || identities.some((clause) => matches(row, clause)));
            });
        return {
          resources: rows.map((data) => ({ data })),
          ...(secondPageRows && !params['page_token'] && { page_token: 'cursor-2' }),
        };
      });
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
      pollEndpoint.mockImplementation(() => Promise.resolve(true));
      fetchAllQueryResources.mockReset();
      getEffectiveEmail.mockReset();
      getRawEffectiveEmail.mockReset();
      getUsernameFromAuth.mockReset();
      proxyRequest.mockReset();
    });

    const expectConfirmed = (): void => {
      expect(writes).toBe(1);
      expect(logger.warning).not.toHaveBeenCalledWith(req, 'create_vote_response', expect.any(String), expect.anything());
    };
    const expectUnconfirmed = (): void => {
      expect(writes).toBe(1);
      expect(logger.warning).toHaveBeenCalledWith(
        req,
        'create_vote_response',
        expect.any(String),
        expect.objectContaining({ vote_response_uid: RESPONSE_UID })
      );
    };
    const settleSubmission = async (): Promise<void> => {
      const submission = service.createVoteResponse(req, payload);
      await vi.runAllTimersAsync();
      await submission;
    };

    it('confirms an email-only invitation even when the caller also has an LFID', async () => {
      // Exercise the real proxy and JSON serialization; assert the HTTP contract, not proxy arity.
      const { MicroserviceProxyService } = await vi.importActual<typeof import('./microservice-proxy.service')>('./microservice-proxy.service');
      const upstream = new MicroserviceProxyService();
      proxyRequest.mockImplementationOnce(upstream.proxyRequest.bind(upstream));
      let ballot!: globalThis.Request;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, options: RequestInit) => {
          ballot = new globalThis.Request(url, options);
          writes++;
          accepted = true;
          return new Response(null, { status: 204 });
        })
      );

      await settleSubmission();

      expect(new URL(ballot.url).pathname).toBe('/vote_responses');
      expect(ballot.method).toBe('POST');
      expect(ballot.headers.has('X-Sync')).toBe(false);
      expect(await ballot.json()).toEqual(payload);
      expect(queryReads).toBe(1);
      expectConfirmed();
    });

    it('keeps username-only confirmation on the first responded read', async () => {
      getEffectiveEmail.mockReturnValue(null);
      indexedRows = [responseRow({ user_email: undefined, username: USERNAME })];

      await settleSubmission();

      expect(queryReads).toBe(1);
      expectConfirmed();
    });

    it('confirms a mixed-case email invitation through the shared raw-email clause', async () => {
      getRawEffectiveEmail.mockReturnValue('Spec-Voter@Example.org');
      indexedRows = [responseRow({ user_email: 'Spec-Voter@Example.org' })];

      await settleSubmission();

      expect(queryReads).toBe(1);
      expectConfirmed();
    });

    it('waits for upstream acceptance before attempting confirmation', async () => {
      let acceptPost!: () => void;
      submitGate = new Promise<void>((resolve) => {
        acceptPost = resolve;
      });
      const submission = service.createVoteResponse(req, payload);
      await vi.advanceTimersByTimeAsync(0);
      expect(queryReads).toBe(0);
      expect(accepted).toBe(false);

      acceptPost();
      await vi.runAllTimersAsync();
      await submission;

      expect(queryReads).toBe(1);
      expectConfirmed();
    });

    it('does not settle an awaiting response until the next 1000 ms read sees responded', async () => {
      indexedRows = [responseRow({ vote_status: IndexedVoteResponseStatus.AWAITING_RESPONSE })];
      let settled = false;
      const submission = service.createVoteResponse(req, payload).then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(queryReads).toBe(1);
      expect(settled).toBe(false);
      indexedRows = [responseRow()];

      await vi.advanceTimersByTimeAsync(999);
      expect(queryReads).toBe(1);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(settled).toBe(true);
      await submission;

      expect(queryReads).toBe(2);
      expectConfirmed();
    });

    it.each([
      { label: 'another response UID on the same vote', overrides: { uid: 'another-response' } },
      { label: 'a foreign identity on the exact response UID', overrides: { user_email: 'foreign@example.org', username: 'foreign-voter' } },
      { label: 'the exact owned row still awaiting', overrides: { vote_status: IndexedVoteResponseStatus.AWAITING_RESPONSE } },
    ])('does not confirm $label even if the index returns it', async ({ overrides }) => {
      // Deliberately loosen the index: the callback and ownership guard must still reject bad rows.
      ignoreIndexFilters = true;
      indexedRows = [responseRow(overrides)];

      await settleSubmission();

      expect(queryReads).toBe(5);
      expectUnconfirmed();
    });

    it('confirms by response UID when only legacy parent fields are indexed', async () => {
      indexedRows = [responseRow({ vote_uid: undefined, poll_id: CANONICAL_UID, vote_id: RESPONSE_UID })];

      await settleSubmission();

      expect(queryReads).toBe(1);
      expectConfirmed();
    });

    it('finds the owned responded target on a later cursor page in the first outer attempt', async () => {
      indexedRows = [];
      secondPageRows = [responseRow()];
      const start = Date.now();

      await settleSubmission();

      expect(queryReads).toBe(2);
      expect(Date.now()).toBe(start);
      expectConfirmed();
    });

    it('warns without recasting an accepted ballot when neither identity is usable', async () => {
      getEffectiveEmail.mockReturnValue(null);
      getUsernameFromAuth.mockResolvedValue(null);

      await settleSubmission();

      expect(queryReads).toBe(0);
      expectUnconfirmed();
    });

    it('keeps an accepted ballot successful after five unconfirmed reads', async () => {
      indexedRows = [];
      const start = Date.now();

      await settleSubmission();

      expect(queryReads).toBe(5);
      expect(Date.now() - start).toBe(4000);
      expectUnconfirmed();
    });

    it('keeps an accepted ballot successful when confirmation queries fail', async () => {
      queryError = new Error('Synthetic query failure');

      await settleSubmission();

      expect(queryReads).toBe(1);
      expectUnconfirmed();
    });

    it('propagates a rejected POST without attempting confirmation or warning of success', async () => {
      submitError = new Error('Synthetic ballot rejection');

      await expect(service.createVoteResponse(req, payload)).rejects.toBe(submitError);

      expect(writes).toBe(1);
      expect(accepted).toBe(false);
      expect(queryReads).toBe(0);
      expect(logger.warning).not.toHaveBeenCalled();
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

  // GH-2826: the tuple-propagation grace is paid on the enable route — the client echoes the create-completion
  // stamp and enableVote sleeps the remainder (clamped) before attempt 1; no hint (edit flow) → no sleep.
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
    const RESULTS_UID = 'v0000000-0000-0000-0000-00000000c001';
    const namedEndedVote = { ...voteFixture, uid: RESULTS_UID, status: 'ended', pseudo_anonymity: false, poll_questions: [{ question_id: 'q-1' }] };
    const pseudoVote = (overrides: Record<string, unknown> = {}) => ({ ...namedEndedVote, status: 'active', pseudo_anonymity: true, ...overrides });
    const upstreamResults = (overrides: Record<string, unknown> = {}) => ({
      poll_results: [{ question_id: 'q-1', total_voting_request_invitations: 5 }],
      comment_results: [
        {
          prompt: { prompt_id: 'p-1', prompt: 'Any concerns?' },
          responses: [
            {
              vote_id: 'b-1',
              user_id: 'u-1',
              user_name: 'Avery Example',
              profile_picture: 'https://avatars.example/avery.png',
              comment_text: 'Zebra crossing',
              vote_creation_time: '2026-10-02T09:30:00Z',
              abstained: false,
            },
            { vote_id: 'b-2', comment_text: 'apple pie', vote_creation_time: '2026-10-03T09:30:00Z', abstained: true },
          ],
        },
      ],
      num_recipients: 5,
      num_votes_cast: 2,
      num_abstained: 1,
      poll_end_time: '2026-10-10T18:00:00Z',
      poll_end_time_timezone: 'UTC',
      ...overrides,
    });
    const heldPayload = {
      poll_results: [],
      comment_results: [],
      num_recipients: 5,
      num_votes_cast: 2,
      poll_end_time: '2026-10-10T18:00:00Z',
      poll_end_time_timezone: 'UTC',
      results_held: true,
    };
    /** Routes the concurrent vote lookup and results fetch by path. */
    const mockVoteAndResults = (vote: unknown, results: unknown) =>
      proxyRequest.mockImplementation(async (_req: unknown, _service: unknown, path: string) => (path.endsWith('/results') ? results : vote));

    it('encodes the uid in the /results path', async () => {
      mockVoteAndResults({ ...namedEndedVote, uid: HOSTILE_UID }, { poll_results: [], comment_results: [], num_votes_cast: 0 });

      await service.getVoteResults(req, HOSTILE_UID);

      expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', '/votes/abc%2Fdef/results', 'GET');
      expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', '/votes/abc%2Fdef', 'GET');
    });

    it('rejects a dot-segment uid without proxying', async () => {
      await expect(service.getVoteResults(req, '..')).rejects.toThrow(ServiceValidationError);

      expect(proxyRequest).not.toHaveBeenCalled();
    });

    it.each([
      ['an open pseudo-anonymous vote', pseudoVote()],
      ['a disabled pseudo-anonymous vote', pseudoVote({ status: 'disabled' })],
      ['an open vote with no pseudo_anonymity flag', pseudoVote({ pseudo_anonymity: undefined })],
      ['an open pseudo-anonymous vote with a legacy mixed-case status', pseudoVote({ status: 'Active' })],
    ])('holds totals, the abstention count and comments on %s (#3916)', async (_label, vote) => {
      mockVoteAndResults(vote, upstreamResults());

      const results = await service.getVoteResults(req, RESULTS_UID);

      expect(results).toEqual(heldPayload);
      expect(results).not.toHaveProperty('num_abstained');
    });

    it.each([
      ['upstream marks the results held', upstreamResults({ results_held: true })],
      ['upstream returns no poll_results for a vote with questions', upstreamResults({ poll_results: [] })],
      ['upstream omits poll_results for a vote with questions', upstreamResults({ poll_results: undefined })],
    ])('holds an ended pseudo-anonymous vote when %s (#3916)', async (_label, upstream) => {
      mockVoteAndResults(pseudoVote({ status: 'ended' }), upstream);

      expect(await service.getVoteResults(req, RESULTS_UID)).toEqual(heldPayload);
      expect(logger.warning).toHaveBeenCalledWith(req, 'get_vote_results', expect.stringContaining('still holding'), expect.any(Object));
    });

    it('passes an ended named vote with empty upstream results through unheld', async () => {
      const upstream = upstreamResults({ poll_results: [], comment_results: [] });
      mockVoteAndResults(namedEndedVote, upstream);

      const results = await service.getVoteResults(req, RESULTS_UID);

      expect(results).toEqual(upstream);
      expect(results.results_held).toBeUndefined();
    });

    it('returns text-only comments in text order on an ended pseudo-anonymous vote (#3916)', async () => {
      mockVoteAndResults(pseudoVote({ status: 'ended' }), upstreamResults());

      const results = await service.getVoteResults(req, RESULTS_UID);

      expect(results.results_held).toBeUndefined();
      expect(results.num_abstained).toBe(1);
      expect(results.poll_results).toHaveLength(1);
      expect(results.comment_results[0].total_responses).toBe(2);
      expect(results.comment_results[0].responses).toEqual([{ comment_text: 'apple pie' }, { comment_text: 'Zebra crossing' }]);
    });

    it('leaves a named vote unchanged, with attributed comments', async () => {
      const upstream = upstreamResults();
      mockVoteAndResults(namedEndedVote, upstreamResults());

      const results = await service.getVoteResults(req, RESULTS_UID);

      expect(results).toEqual({
        ...upstream,
        comment_results: [{ ...upstream.comment_results[0], total_responses: 2 }],
      });
    });

    it('rejects when the vote lookup fails, never falling back to unheld results (#3916)', async () => {
      const upstream = new MicroserviceError('vote lookup failed', 502, 'BAD_GATEWAY', {});
      proxyRequest.mockImplementation(async (_req: unknown, _service: unknown, path: string) => {
        if (path.endsWith('/results')) return upstreamResults();
        throw upstream;
      });

      await expect(service.getVoteResults(req, RESULTS_UID)).rejects.toBe(upstream);
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

    /** Drives the captured fetchPage callback the way the real fetchAllQueryResources loop would. */
    const drainPages = () =>
      fetchAllQueryResources.mockImplementation(
        async (_req: unknown, fetchPage: (pageToken?: string) => Promise<QueryServiceResponse<IndexedVote>>): Promise<IndexedVote[]> => {
          const collected: IndexedVote[] = [];
          let page = await fetchPage();
          collected.push(...page.resources.map((r) => r.data));
          while (page.page_token) {
            page = await fetchPage(page.page_token);
            collected.push(...page.resources.map((r) => r.data));
          }
          return collected;
        }
      );

    it('batch-decorates only the returned page with effective vote writer access', async () => {
      fetchAllQueryResources.mockResolvedValue([indexRow, { ...indexRow, vote_uid: 'second' }]);
      addAccessToResources.mockImplementationOnce(async (_req, resources) => resources.map((row) => ({ ...(row as object), writer: true })));
      const result = await service.getVotes(req, { page_size: '1' }, { includeProject: false });
      expect(addAccessToResources).toHaveBeenCalledWith(req, [expect.objectContaining({ uid: expect.any(String) })], 'vote');
      expect(result.data).toHaveLength(1);
      expect(result.data[0].writer).toBe(true);
      expect(result.page_token).toBe('offset:1');
    });

    it('preserves a denied or failed-check writer result rather than trusting indexed flags', async () => {
      fetchAllQueryResources.mockResolvedValue([{ ...indexRow, writer: true }]);
      addAccessToResources.mockImplementationOnce(async (_req, resources) => resources.map((row) => ({ ...(row as object), writer: false })));
      const result = await service.getVotes(req, {}, { includeProject: false });
      expect(result.data[0].writer).toBe(false);
    });

    it('summarizes every scoped page without enrichment or participation reads', async () => {
      vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-09T12:00:00Z'));
      drainPages();
      proxyRequest
        .mockResolvedValueOnce({
          resources: [
            { data: { ...indexRow, status: 'AcTiVe', end_time: '2026-10-10T12:00:00Z' } },
            { data: { ...indexRow, vote_uid: 'overdue', end_time: '2026-10-01T12:00:00Z' } },
            { data: { ...indexRow, vote_uid: 'draft', status: 'disabled', end_time: '2026-10-10T12:00:00Z' } },
          ],
          page_token: 'next',
        })
        .mockResolvedValueOnce({
          resources: [
            { data: { ...indexRow, vote_uid: 'boundary', end_time: '2026-10-16T12:00:00Z' } },
            { data: { ...indexRow, vote_uid: 'invalid', end_time: 'invalid' } },
            { data: { ...indexRow, vote_uid: 'ended', status: 'ended', end_time: '2026-10-10T12:00:00Z' } },
          ],
        });
      try {
        expect(await service.getVotesSummary(req, `project:${PROJECT_UID}`, 'Synthetic Board')).toEqual({
          active_votes: 4,
          closing_soon: 2,
          as_of: '2026-10-09T12:00:00.000Z',
        });
        expect(proxyRequest).toHaveBeenNthCalledWith(2, req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
          parent: `project:${PROJECT_UID}`,
          filters: ['committee_name:Synthetic Board'],
          type: 'vote',
          page_size: 1000,
          page_token: 'next',
        });
        expect(fetchAllQueryResources).toHaveBeenCalledWith(req, expect.any(Function), { failOnPartial: true });
        expect(getProjectsByIds).not.toHaveBeenCalled();
      } finally {
        vi.restoreAllMocks();
      }
    });

    it('returns successful zero totals, but rejects a failed later summary page', async () => {
      drainPages();
      proxyRequest.mockResolvedValueOnce({ resources: [] });
      expect(await service.getVotesSummary(req, 'project:synthetic')).toMatchObject({ active_votes: 0, closing_soon: 0 });
      proxyRequest.mockResolvedValueOnce({ resources: [{ data: indexRow }], page_token: 'next' }).mockRejectedValueOnce(new Error('later page failed'));
      await expect(service.getVotesSummary(req, 'project:synthetic')).rejects.toThrow('later page failed');
    });

    it('buckets every scoped page into status-tab counts, forwarding name and group upstream', async () => {
      drainPages();
      proxyRequest
        .mockResolvedValueOnce({
          resources: [
            { data: { ...indexRow, status: 'AcTiVe' } },
            { data: { ...indexRow, vote_uid: 'draft', status: 'disabled' } },
            { data: { ...indexRow, vote_uid: 'unknown', status: 'unrecognized' } },
          ],
          page_token: 'next',
        })
        .mockResolvedValueOnce({
          resources: [{ data: { ...indexRow, vote_uid: 'legacy-ended', status: 'ENDED' } }, { data: { ...indexRow, vote_uid: 'ended', status: 'ended' } }],
        });
      expect(await service.getVoteStatusCounts(req, `project:${PROJECT_UID}`, 'Steering', 'Synthetic Board')).toEqual({
        all: 5,
        active: 1,
        disabled: 1,
        ended: 2,
      });
      const upstream = { parent: `project:${PROJECT_UID}`, name: 'Steering', filters: ['committee_name:Synthetic Board'], type: 'vote', page_size: 1000 };
      expect(proxyRequest).toHaveBeenNthCalledWith(1, req, 'LFX_V2_SERVICE', '/query/resources', 'GET', upstream);
      expect(proxyRequest).toHaveBeenNthCalledWith(2, req, 'LFX_V2_SERVICE', '/query/resources', 'GET', { ...upstream, page_token: 'next' });
      expect(fetchAllQueryResources).toHaveBeenCalledWith(req, expect.any(Function), { failOnPartial: true });
      expect(getProjectsByIds).not.toHaveBeenCalled();
    });

    it('omits unset status-count narrowing and rejects a failed later status-counts page', async () => {
      drainPages();
      proxyRequest.mockResolvedValueOnce({ resources: [] });
      expect(await service.getVoteStatusCounts(req, 'project:synthetic')).toEqual({ all: 0, active: 0, disabled: 0, ended: 0 });
      expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
        parent: 'project:synthetic',
        type: 'vote',
        page_size: 1000,
      });
      proxyRequest.mockResolvedValueOnce({ resources: [{ data: indexRow }], page_token: 'next' }).mockRejectedValueOnce(new Error('later page failed'));
      await expect(service.getVoteStatusCounts(req, 'project:synthetic')).rejects.toThrow('later page failed');
    });

    it('filters before sorting/slicing and returns a full closing count from the same snapshot', async () => {
      vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-09T12:00:00Z'));
      drainPages();
      proxyRequest.mockResolvedValue({
        resources: [
          { data: { ...indexRow, vote_uid: 'far', end_time: '2027-01-01T00:00:00Z' } },
          { data: { ...indexRow, vote_uid: 'older', creation_time: '2026-10-01T00:00:00Z', end_time: '2026-10-10T00:00:00Z' } },
          { data: { ...indexRow, vote_uid: 'newer', creation_time: '2026-10-02T00:00:00Z', end_time: '2026-10-11T00:00:00Z' } },
        ],
      });
      try {
        const query = { parent: 'project:synthetic', name: 'Board', filters: ['status:active'], closing_soon: 'true', page_size: '1' };
        const first = await service.getVotes(req, query, { includeProject: false });
        expect(first).toMatchObject({ total_records: 2, page_token: 'offset:1' });
        expect(first.data.map((vote) => vote.uid)).toEqual(['newer']);
        const second = await service.getVotes(req, { ...query, page_token: first.page_token }, { includeProject: false });
        expect(second.data.map((vote) => vote.uid)).toEqual(['older']);
        expect(second.total_records).toBe(2);
        expect(second.page_token).toBeUndefined();
        expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
          parent: query.parent,
          name: query.name,
          type: 'vote',
          page_size: 1000,
        });
        const ordinary = await service.getVotes(req, { closing_soon: 'false' }, { includeProject: false });
        expect(ordinary.data).toHaveLength(3);
        expect(ordinary).not.toHaveProperty('total_records');
      } finally {
        vi.restoreAllMocks();
      }
    });

    it.each(['status:active', ['status:active']])('keeps summary, status counts and paginated shortcuts aligned for filter %j', async (filters) => {
      vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-09T12:00:00Z'));
      drainPages();
      const indexed = [
        { ...indexRow, vote_uid: 'canonical', committee_name: 'Synthetic Board', creation_time: '2026-10-02T00:00:00Z', end_time: '2026-10-10T12:00:00Z' },
        {
          ...indexRow,
          vote_uid: 'mixed',
          committee_name: 'Synthetic Board',
          status: 'AcTiVe',
          creation_time: '2026-10-03T00:00:00Z',
          end_time: '2026-10-11T12:00:00Z',
        },
        { ...indexRow, vote_uid: 'overdue', committee_name: 'Synthetic Board', creation_time: '2026-10-01T00:00:00Z', end_time: '2026-10-01T12:00:00Z' },
        { ...indexRow, vote_uid: 'draft', committee_name: 'Synthetic Board', status: 'disabled' },
        { ...indexRow, vote_uid: 'ended', committee_name: 'Synthetic Board', status: 'ended' },
        { ...indexRow, vote_uid: 'legacy-ended', committee_name: 'Synthetic Board', status: 'ENDED' },
        { ...indexRow, vote_uid: 'other-group', committee_name: 'Other Board' },
        { ...indexRow, vote_uid: 'other-project', project_uid: 'synthetic-other-project', committee_name: 'Synthetic Board' },
        { ...indexRow, vote_uid: 'other-name', name: 'Budget', committee_name: 'Synthetic Board', status: 'disabled' },
      ];
      // Enforce the upstream's exact term semantics; returning preselected rows would miss F1.
      proxyRequest.mockImplementation(async (_req: Request, _service: string, path: string, _method: string, params: Record<string, unknown>) => {
        const clauses = [params['filters'], params['filters_all']].flat().filter((clause): clause is string => typeof clause === 'string');
        const matches = indexed.filter((row) => {
          if (params['parent'] !== `project:${row.project_uid}`) return false;
          if (typeof params['name'] === 'string' && !row.name.includes(params['name'])) return false;
          return clauses.every((clause) => {
            const separator = clause.indexOf(':');
            const field = clause.slice(0, separator);
            return row[field as keyof typeof row] === clause.slice(separator + 1);
          });
        });
        if (path === '/query/resources/count') return { count: matches.length };
        const offset = Number(params['page_token'] ?? 0);
        const nextOffset = offset + 2;
        return {
          resources: matches.slice(offset, nextOffset).map((data) => ({ data })),
          page_token: nextOffset < matches.length ? String(nextOffset) : undefined,
        };
      });
      try {
        const query = { parent: `project:${PROJECT_UID}`, name: 'Steering', filters, filters_all: ['committee_name:Synthetic Board'] };
        const originalQuery = structuredClone(query);
        expect(await service.getVotesSummary(req, query.parent, 'Synthetic Board')).toMatchObject({ active_votes: 3, closing_soon: 2 });
        expect(await service.getVotesCount(req, { ...query, page_token: '2', page_size: '1' })).toBe(3);
        const active = await service.getVotes(req, { ...query, page_size: '2' }, { includeProject: false });
        expect(active.data.map((vote) => vote.uid)).toEqual(['mixed', 'canonical']);
        expect(active.data.map((vote) => vote.status)).toEqual(['active', 'active']);
        expect(active).not.toHaveProperty('total_records');
        const activeTail = await service.getVotes(req, { ...query, page_size: '2', page_token: active.page_token }, { includeProject: false });
        expect(activeTail.data.map((vote) => vote.uid)).toEqual(['overdue']);
        const closing = await service.getVotes(req, { ...query, closing_soon: 'true', page_size: '1' }, { includeProject: false });
        expect(closing.data.map((vote) => vote.uid)).toEqual(['mixed']);
        expect(closing.data[0].status).toBe('active');
        expect(closing.total_records).toBe(2);
        const closingTail = await service.getVotes(
          req,
          { ...query, closing_soon: 'true', page_size: '1', page_token: closing.page_token },
          { includeProject: false }
        );
        expect(closingTail.data.map((vote) => vote.uid)).toEqual(['canonical']);
        expect(closingTail.total_records).toBe(2);
        expect(closingTail.page_token).toBeUndefined();
        // Every status tab's count matches that tab's normalized list total (#3687), including the
        // mixed-case `ENDED` row an exact upstream `status:ended` match would drop.
        const statusCounts = await service.getVoteStatusCounts(req, query.parent, query.name, 'Synthetic Board');
        expect(statusCounts).toEqual({ all: 6, active: 3, disabled: 1, ended: 2 });
        for (const [status, expectedUids] of [
          ['ended', ['ended', 'legacy-ended']],
          ['disabled', ['draft']],
        ] as const) {
          const scoped = { ...query, filters: [`status:${status}`] };
          expect(await service.getVotesCount(req, scoped)).toBe(statusCounts[status]);
          const page = await service.getVotes(req, { ...scoped, page_size: '10' }, { includeProject: false });
          expect(page.data.map((vote) => vote.uid).sort()).toEqual([...expectedUids]);
          expect(page.data.every((vote) => vote.status === status)).toBe(true);
        }
        expect(query).toEqual(originalQuery);
        expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
          parent: query.parent,
          name: query.name,
          filters_all: query.filters_all,
          type: 'vote',
          page_size: 1000,
        });
        expect(proxyRequest.mock.calls.every((call) => call[2] === '/query/resources')).toBe(true);
        expect(getProjectsByIds).not.toHaveBeenCalled();
      } finally {
        vi.restoreAllMocks();
        proxyRequest.mockReset();
        fetchAllQueryResources.mockReset();
      }
    });

    it.each([
      ['AcTiVe', 'active'],
      ['ENDED', 'ended'],
      ['DiSaBlEd', 'disabled'],
      ['unrecognized', 'unrecognized'],
    ])('normalizes recognized indexed status %s to %s without inventing unknown statuses', async (status, expected) => {
      fetchAllQueryResources.mockResolvedValueOnce([{ ...indexRow, status }]);
      const result = await service.getVotes(req, { parent: `project:${PROJECT_UID}` }, { includeProject: false });
      expect(result.data[0]).toMatchObject({ uid: INDEX_VOTE_UID, status: expected });
    });

    it.each([undefined, ['committee_name:Synthetic Board'], 'status:archived'])('retains the ordinary upstream count path for filters %j', async (filters) => {
      proxyRequest.mockResolvedValueOnce({ count: 7 });
      const query = { parent: `project:${PROJECT_UID}`, ...(filters && { filters }) };
      expect(await service.getVotesCount(req, query)).toBe(7);
      expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', '/query/resources/count', 'GET', { ...query, type: 'vote' });
      expect(fetchAllQueryResources).not.toHaveBeenCalled();
    });

    it.each([
      ['status:ended', 'ended'],
      [['status:disabled', 'committee_name:Synthetic Board'], 'disabled'],
      ['status:ENDED', 'ended'],
    ] as const)('drains and normalizes locally for recognized status filter %j', async (filters, status) => {
      drainPages();
      proxyRequest.mockResolvedValueOnce({
        resources: [
          { data: { ...indexRow, vote_uid: 'legacy', status: status.toUpperCase() } },
          { data: { ...indexRow, vote_uid: 'canonical', status } },
          { data: { ...indexRow, vote_uid: 'other', status: 'active' } },
        ],
      });
      try {
        const query = { parent: `project:${PROJECT_UID}`, filters, page_size: '1', page_token: 'offset:1' };
        expect(await service.getVotesCount(req, query)).toBe(2);
        // The status clause is stripped upstream (exact match would drop `legacy`); other clauses stay.
        expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
          parent: query.parent,
          ...(Array.isArray(filters) && { filters: ['committee_name:Synthetic Board'] }),
          type: 'vote',
          page_size: 1000,
        });
        expect(proxyRequest.mock.calls.some((call) => call[2] === '/query/resources/count')).toBe(false);
      } finally {
        proxyRequest.mockReset();
        fetchAllQueryResources.mockReset();
      }
    });

    it('rejects an incomplete Active count instead of returning a partial normalized total', async () => {
      drainPages();
      proxyRequest.mockResolvedValueOnce({ resources: [{ data: indexRow }], page_token: 'next' }).mockRejectedValueOnce(new Error('later page failed'));
      try {
        await expect(service.getVotesCount(req, { parent: `project:${PROJECT_UID}`, filters: ['status:active'] })).rejects.toThrow('later page failed');
        expect(fetchAllQueryResources).toHaveBeenCalledWith(req, expect.any(Function), { failOnPartial: true });
      } finally {
        proxyRequest.mockReset();
        fetchAllQueryResources.mockReset();
      }
    });

    it.each(['yes', '', ['true'], ['true', 'false'], true, {}])('rejects malformed closing flags before any upstream work: %j', async (closingSoon) => {
      await expect(service.getVotes(req, { closing_soon: closingSoon })).rejects.toThrow(ServiceValidationError);
      expect(fetchAllQueryResources).not.toHaveBeenCalled();
      expect(proxyRequest).not.toHaveBeenCalled();
    });

    it('enriches an index row carrying only project_uid with the canonical project fields', async () => {
      fetchAllQueryResources.mockResolvedValue([indexRow]);
      getProjectsByIds.mockResolvedValue(new Map([[PROJECT_UID, project]]));
      computeIsFoundation.mockReturnValue(true);

      const result = await service.getVotes(req);

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
      fetchAllQueryResources.mockResolvedValue([indexRow]);
      getProjectsByIds.mockResolvedValue(new Map());

      const result = await service.getVotes(req);

      expect(result.data[0]).not.toHaveProperty('project_slug');
      expect(result.data[0]).not.toHaveProperty('is_foundation');
    });

    it('skips project enrichment entirely when includeProject is false', async () => {
      fetchAllQueryResources.mockResolvedValue([indexRow]);

      const result = await service.getVotes(req, {}, { includeProject: false });

      expect(getProjectsByIds).not.toHaveBeenCalled();
      expect(computeIsFoundation).not.toHaveBeenCalled();
      expect(result.data[0]).not.toHaveProperty('project_slug');
      expect(result.data[0]).not.toHaveProperty('is_foundation');
      expect(result.data[0]).not.toHaveProperty('parent_project_uid');
    });

    it('assembles the canonical active-first, creation_time-desc order across multiple upstream pages', async () => {
      // Upstream returns its default name_asc order (Alpha, Middling, Zebra) split across two pages.
      drainPages();
      proxyRequest
        .mockResolvedValueOnce({
          resources: [
            {
              data: {
                vote_uid: 'alpha-active',
                name: 'Alpha Active',
                status: 'active',
                creation_time: '2025-06-01T00:00:00Z',
                project_uid: PROJECT_UID,
                end_time: '2099-01-01T00:00:00Z',
              },
            },
            {
              data: {
                vote_uid: 'middling-ended',
                name: 'Middling Ended',
                status: 'ended',
                creation_time: '2025-06-10T00:00:00Z',
                project_uid: PROJECT_UID,
                end_time: '2025-07-01T00:00:00Z',
              },
            },
          ],
          page_token: 'upstream-cursor-2',
        })
        .mockResolvedValueOnce({
          resources: [
            {
              data: {
                vote_uid: 'zebra-active',
                name: 'Zebra Active',
                status: 'active',
                creation_time: '2025-05-01T00:00:00Z',
                project_uid: PROJECT_UID,
                end_time: '2099-01-01T00:00:00Z',
              },
            },
          ],
          page_token: undefined,
        });
      getProjectsByIds.mockResolvedValue(new Map());

      const result = await service.getVotes(req, { parent: `project:${PROJECT_UID}` });

      // Active tier first (newest creation_time first within it), then ended — the drained
      // name_asc order (alpha, middling, zebra) must not leak through.
      expect(result.data.map((v) => v.uid)).toEqual(['alpha-active', 'zebra-active', 'middling-ended']);
      // The drain loop threads the upstream cursor and pins the GH-1558 fixed upstream page size.
      expect(proxyRequest).toHaveBeenNthCalledWith(1, req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
        parent: `project:${PROJECT_UID}`,
        type: 'vote',
        page_size: 1000,
      });
      expect(proxyRequest).toHaveBeenNthCalledWith(2, req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
        parent: `project:${PROJECT_UID}`,
        type: 'vote',
        page_size: 1000,
        page_token: 'upstream-cursor-2',
      });
    });

    it('forwards filters/name/parent/tags upstream while stripping client page_size, page_token, and order', async () => {
      drainPages();
      proxyRequest.mockResolvedValue({ resources: [], page_token: undefined });

      await service.getVotes(req, {
        parent: 'project:abc',
        tags: 'committee_uid:c1',
        name: 'steering',
        filters: ['status:active', 'committee_name:Synthetic Board'],
        filters_or: ['user_email:a@example.org'],
        page_size: '10',
        page_token: 'offset:20',
        order: 'updated_at.desc',
      });

      expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
        parent: 'project:abc',
        tags: 'committee_uid:c1',
        name: 'steering',
        filters: ['committee_name:Synthetic Board'],
        filters_or: ['user_email:a@example.org'],
        type: 'vote',
        page_size: 1000,
      });
    });

    it('slices the sorted set by the client page_size and round-trips the opaque offset token', async () => {
      const rows = ['2025-06-04', '2025-06-03', '2025-06-02', '2025-06-01'].map((day, i) => ({
        vote_uid: `v-${i}`,
        name: `Vote ${i}`,
        status: 'ended',
        creation_time: `${day}T00:00:00Z`,
        project_uid: PROJECT_UID,
        end_time: '2025-07-01T00:00:00Z',
      }));
      fetchAllQueryResources.mockResolvedValue(rows);
      getProjectsByIds.mockResolvedValue(new Map());

      const first = await service.getVotes(req, { page_size: '2' });
      expect(first.data.map((v) => v.uid)).toEqual(['v-0', 'v-1']);
      expect(first.page_token).toBe('offset:2');

      const second = await service.getVotes(req, { page_size: '2', page_token: first.page_token });
      expect(second.data.map((v) => v.uid)).toEqual(['v-2', 'v-3']);
      expect(second.page_token).toBeUndefined();
    });

    it('defaults to a 50-row page when the client omits page_size', async () => {
      const rows = Array.from({ length: 51 }, (_, i) => ({
        vote_uid: `v-${String(i).padStart(2, '0')}`,
        name: `Vote ${i}`,
        status: 'ended',
        creation_time: `2025-06-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z`,
        project_uid: PROJECT_UID,
        end_time: '2025-07-01T00:00:00Z',
      }));
      fetchAllQueryResources.mockResolvedValue(rows);
      getProjectsByIds.mockResolvedValue(new Map());

      const result = await service.getVotes(req);

      expect(result.data).toHaveLength(50);
      expect(result.page_token).toBe('offset:50');
    });

    it('rejects an explicit-but-malformed page_token with a 400 instead of silently restarting at page 1', async () => {
      const rows = [
        { vote_uid: 'v-0', name: 'A', status: 'ended', creation_time: '2025-06-02T00:00:00Z', project_uid: PROJECT_UID, end_time: '2025-07-01T00:00:00Z' },
        { vote_uid: 'v-1', name: 'B', status: 'ended', creation_time: '2025-06-01T00:00:00Z', project_uid: PROJECT_UID, end_time: '2025-07-01T00:00:00Z' },
      ];
      fetchAllQueryResources.mockResolvedValue(rows);
      getProjectsByIds.mockResolvedValue(new Map());

      await expect(service.getVotes(req, { page_size: '1', page_token: 'not-an-offset' })).rejects.toThrow(ServiceValidationError);
    });

    it('rejects an offset page_token whose digits overflow a safe integer instead of answering an empty terminal page', async () => {
      const rows = [
        { vote_uid: 'v-0', name: 'A', status: 'ended', creation_time: '2025-06-02T00:00:00Z', project_uid: PROJECT_UID, end_time: '2025-07-01T00:00:00Z' },
      ];
      fetchAllQueryResources.mockResolvedValue(rows);
      getProjectsByIds.mockResolvedValue(new Map());

      // 400 nines: parseInt overflows float64 to Infinity — slice() would return [] with no continuation.
      await expect(service.getVotes(req, { page_token: `offset:${'9'.repeat(400)}` })).rejects.toThrow(ServiceValidationError);
    });

    it('caps a client page_size at the upstream max so one response cannot pull an unbounded slice', async () => {
      const rows = Array.from({ length: 1001 }, (_, i) => ({
        vote_uid: `v-${String(i).padStart(4, '0')}`,
        name: `Vote ${i}`,
        status: 'ended',
        creation_time: `2025-06-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z`,
        project_uid: PROJECT_UID,
        end_time: '2025-07-01T00:00:00Z',
      }));
      fetchAllQueryResources.mockResolvedValue(rows);
      getProjectsByIds.mockResolvedValue(new Map());

      const result = await service.getVotes(req, { page_size: '5000' });

      expect(result.data).toHaveLength(1000);
      expect(result.page_token).toBe('offset:1000');
    });

    it('drains with failOnPartial so a failed later page surfaces as an error instead of a silently truncated list', async () => {
      drainPages();
      proxyRequest.mockRejectedValueOnce(new Error('upstream 500'));

      await expect(service.getVotes(req)).rejects.toThrow('upstream 500');
      // The behavioral contract is the helper's own (tested there); here we pin the wiring.
      expect(fetchAllQueryResources).toHaveBeenCalledWith(req, expect.any(Function), { failOnPartial: true });
    });

    it('enriches only the returned slice, not the full drained set', async () => {
      const rows = [
        { vote_uid: 'v-0', name: 'A', status: 'ended', creation_time: '2025-06-03T00:00:00Z', project_uid: 'p-0', end_time: '2025-07-01T00:00:00Z' },
        { vote_uid: 'v-1', name: 'B', status: 'ended', creation_time: '2025-06-02T00:00:00Z', project_uid: 'p-1', end_time: '2025-07-01T00:00:00Z' },
        { vote_uid: 'v-2', name: 'C', status: 'ended', creation_time: '2025-06-01T00:00:00Z', project_uid: 'p-2', end_time: '2025-07-01T00:00:00Z' },
      ];
      fetchAllQueryResources.mockResolvedValue(rows);
      getProjectsByIds.mockResolvedValue(new Map());

      await service.getVotes(req, { page_size: '2' });

      expect(getProjectsByIds).toHaveBeenCalledWith(req, ['p-0', 'p-1']);
    });
  });

  describe('getVotesUpstreamPage', () => {
    it('forwards caller params verbatim and returns the raw upstream cursor (committee-activity contract)', async () => {
      const row = { vote_uid: 'v-0', name: 'A', status: 'ended', project_uid: 'p-0', end_time: '2025-07-01T00:00:00Z' };
      proxyRequest.mockResolvedValue({ resources: [{ data: row }], page_token: 'upstream-cursor' });

      const result = await service.getVotesUpstreamPage(
        req,
        { tags: 'committee_uid:c1', page_size: 40, sort: 'updated_desc', date_field: 'last_modified_time', date_to: '2025-06-01T00:00:00Z' },
        { includeProject: false }
      );

      expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
        tags: 'committee_uid:c1',
        page_size: 40,
        sort: 'updated_desc',
        date_field: 'last_modified_time',
        date_to: '2025-06-01T00:00:00Z',
        type: 'vote',
      });
      expect(result.page_token).toBe('upstream-cursor');
      expect(result.data[0].uid).toBe('v-0');
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
      fetchAllQueryResources.mockResolvedValue([
        { vote_uid: MY_VOTE_UID, vote_status: IndexedVoteResponseStatus.RESPONDED, user_email: 'spec-user@example.org' },
      ]);
      proxyRequest.mockResolvedValue(detailVote);
      getProjectsByIds.mockResolvedValue(new Map([[PROJECT_UID, project]]));
      computeIsFoundation.mockReturnValue(true);

      const { votes, complete } = await service.getMyVotes(req);
      expect(complete).toBe(true);

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

    it('orders by the canonical recency comparator — active tier first, creation_time desc within it (GH-1558)', async () => {
      // end_time desc (the pre-GH-1558 inline sort) would put UID_B before UID_A; creation_time desc must win.
      const UID_A = 'v0000000-0000-0000-0000-00000000d201';
      const UID_B = 'v0000000-0000-0000-0000-00000000d202';
      const UID_C = 'v0000000-0000-0000-0000-00000000d203';
      const details: Record<string, object> = {
        [UID_A]: {
          uid: UID_A,
          name: 'Active Newer',
          status: 'active',
          creation_time: '2025-06-01T00:00:00Z',
          end_time: '2099-01-01T00:00:00Z',
          project_uid: PROJECT_UID,
        },
        [UID_B]: {
          uid: UID_B,
          name: 'Active Older',
          status: 'active',
          creation_time: '2025-01-01T00:00:00Z',
          end_time: '2099-12-01T00:00:00Z',
          project_uid: PROJECT_UID,
        },
        [UID_C]: {
          uid: UID_C,
          name: 'Ended Newest',
          status: 'ended',
          creation_time: '2025-12-01T00:00:00Z',
          end_time: '2025-12-31T00:00:00Z',
          project_uid: PROJECT_UID,
        },
      };
      fetchAllQueryResources.mockResolvedValue([
        { vote_uid: UID_A, username: 'spec-user' },
        { vote_uid: UID_B, username: 'spec-user' },
        { vote_uid: UID_C, username: 'spec-user' },
      ]);
      proxyRequest.mockImplementation((_req: unknown, _service: string, path: string) => Promise.resolve(details[path.replace('/votes/', '')]));
      getProjectsByIds.mockResolvedValue(new Map());

      const { votes, complete } = await service.getMyVotes(req);
      expect(complete).toBe(true);

      expect(votes.map((v) => v.uid)).toEqual([UID_A, UID_B, UID_C]);
    });

    it('keys legacy poll_id-only rows by the v1 parent alias, matching Pending Actions (GH #2985)', async () => {
      // vote_uid absent on a legacy row: poll_id (parent v1 alias) must key both the detail list
      // and the responded set, or My Votes and Pending Actions diverge on the same row.
      fetchAllQueryResources.mockResolvedValue([
        { poll_id: 'poll-v1-9', vote_status: IndexedVoteResponseStatus.RESPONDED, user_email: 'spec-user@example.org' },
      ]);
      proxyRequest.mockResolvedValue(detailVote);
      getProjectsByIds.mockResolvedValue(new Map());

      const { votes, complete } = await service.getMyVotes(req);
      expect(complete).toBe(true);

      expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', '/votes/poll-v1-9', 'GET');
      expect(votes[0]).toMatchObject({ response_status: VoteResponseStatus.RESPONDED });
    });

    it('returns [] without any upstream call when the request carries neither username nor email', async () => {
      getUsernameFromAuth.mockResolvedValue(null);
      getEffectiveEmail.mockReturnValue(null);

      const { votes, complete } = await service.getMyVotes(req);
      expect(complete).toBe(true);

      expect(votes).toEqual([]);
      // The helper short-circuits before the paginator, so neither the vote_response query nor
      // any per-vote detail fetch may fire.
      expect(fetchAllQueryResources).not.toHaveBeenCalled();
      expect(proxyRequest).not.toHaveBeenCalled();
    });

    it.each([false, true])('preserves available rows and marks an exhausted later-page scan incomplete (empty first page: %s)', async (empty) => {
      const actual = await vi.importActual<typeof import('../helpers/query-service.helper')>('../helpers/query-service.helper');
      fetchAllQueryResources.mockImplementationOnce(actual.fetchAllQueryResources);
      const failure = Object.assign(new Error('Temporary query failure'), { statusCode: 503 });
      proxyRequest.mockImplementation((_req: Request, _service: string, path: string, _method: string, params?: Record<string, unknown>) => {
        if (path !== '/query/resources') return Promise.resolve(detailVote);
        if (params?.['page_token']) return Promise.reject(failure);
        return Promise.resolve({
          resources: empty ? [] : [{ data: { vote_uid: MY_VOTE_UID, username: 'spec-user' } }],
          page_token: 'cursor-2',
        });
      });
      getProjectsByIds.mockResolvedValue(new Map());

      const result = await service.getMyVotes(req);

      expect(result.complete).toBe(false);
      expect(result.votes.map((vote) => vote.uid)).toEqual(empty ? [] : [MY_VOTE_UID]);
      expect(proxyRequest.mock.calls.filter((call) => call[2] === '/query/resources')).toHaveLength(4);

      fetchAllQueryResources.mockImplementationOnce(actual.fetchAllQueryResources);
      proxyRequest.mockResolvedValue({ resources: [] });
      await expect(service.getMyVotes(req)).resolves.toEqual({ votes: [], complete: true });
    });

    it.each([401, 429, 500, 503, null])('keeps successful details but marks skipped detail reads incomplete: %s', async (statusCode) => {
      fetchAllQueryResources.mockResolvedValue([
        { vote_uid: MY_VOTE_UID, username: 'spec-user' },
        { vote_uid: 'unavailable-vote', username: 'spec-user' },
      ]);
      proxyRequest.mockImplementation((_req: Request, _service: string, path: string) => {
        if (path === `/votes/${MY_VOTE_UID}`) return Promise.resolve(detailVote);
        if (statusCode === null) return Promise.resolve(null);
        return Promise.reject(new MicroserviceError('Detail unavailable', statusCode, 'UPSTREAM_ERROR'));
      });
      getProjectsByIds.mockResolvedValue(new Map());

      const result = await service.getMyVotes(req);

      expect(result.complete).toBe(false);
      expect(result.votes).toEqual([expect.objectContaining({ uid: MY_VOTE_UID })]);
    });

    it.each([
      { statusCode: 403, includeReadable: true },
      { statusCode: 404, includeReadable: true },
      { statusCode: 403, includeReadable: false },
      { statusCode: 404, includeReadable: false },
    ])('counts only visible votes after a $statusCode detail response (readable vote: $includeReadable)', async ({ statusCode, includeReadable }) => {
      const responses = [{ vote_uid: 'invisible-vote', username: 'spec-user' }];
      if (includeReadable) responses.push({ vote_uid: MY_VOTE_UID, username: 'spec-user' });
      fetchAllQueryResources.mockResolvedValue(responses);
      proxyRequest.mockImplementation((_req: Request, _service: string, path: string) => {
        if (path === `/votes/${MY_VOTE_UID}`) return Promise.resolve(detailVote);
        return Promise.reject(new MicroserviceError('Vote not visible', statusCode, 'UPSTREAM_ERROR'));
      });
      getProjectsByIds.mockResolvedValue(new Map());

      for (let refresh = 0; refresh < 2; refresh++) {
        const result = await service.getMyVotes(req);

        expect(result.complete).toBe(true);
        expect(result.votes.map((vote) => vote.uid)).toEqual(includeReadable ? [MY_VOTE_UID] : []);
      }
    });

    it.each([
      new Error('Network unavailable'),
      Object.assign(new Error('Unexpected forbidden error'), { statusCode: 403 }),
      Object.assign(new Error('Unexpected not-found error'), { statusCode: 404 }),
    ])('keeps counts unavailable for unexpected detail errors even alongside an invisible vote: %s', async (error) => {
      fetchAllQueryResources.mockResolvedValue([
        { vote_uid: MY_VOTE_UID, username: 'spec-user' },
        { vote_uid: 'unavailable-vote', username: 'spec-user' },
        { vote_uid: 'invisible-vote', username: 'spec-user' },
      ]);
      proxyRequest.mockImplementation((_req: Request, _service: string, path: string) => {
        if (path === `/votes/${MY_VOTE_UID}`) return Promise.resolve(detailVote);
        if (path === '/votes/invisible-vote') return Promise.reject(new MicroserviceError('Vote not found', 404, 'NOT_FOUND'));
        return Promise.reject(error);
      });
      getProjectsByIds.mockResolvedValue(new Map());

      const result = await service.getMyVotes(req);

      expect(result.complete).toBe(false);
      expect(result.votes).toEqual([expect.objectContaining({ uid: MY_VOTE_UID })]);
    });

    it('does not report complete empty success when every detail read fails', async () => {
      fetchAllQueryResources.mockResolvedValue([{ vote_uid: MY_VOTE_UID, username: 'spec-user' }]);
      proxyRequest.mockRejectedValue(Object.assign(new Error('Detail unavailable'), { statusCode: 503 }));
      getProjectsByIds.mockResolvedValue(new Map());

      await expect(service.getMyVotes(req)).resolves.toEqual({ votes: [], complete: false });
    });
  });

  describe('getMyVoteResponse', () => {
    const VOTE_UID = 'v0000000-0000-0000-0000-00000000d301';

    beforeEach(() => {
      getUsernameFromAuth.mockResolvedValue('spec-user');
      getEffectiveEmail.mockReturnValue('spec-user@example.org');
      // Drive the helper's fetchPage callback through the mocked paginator (mirrors getVotes'
      // drainPages) so the outgoing query params stay observable on proxyRequest.
      fetchAllQueryResources.mockImplementation(
        async (_req: unknown, fetchPage: (pageToken?: string) => Promise<QueryServiceResponse<unknown>>): Promise<unknown[]> => {
          const page = await fetchPage();
          return page.resources.map((r) => r.data);
        }
      );
    });

    it('narrows on vote_uid via filters, ANDed with the identity filters_or disjunction', async () => {
      proxyRequest.mockResolvedValue({
        resources: [
          { data: { uid: 'vr-1', vote_uid: VOTE_UID, vote_status: IndexedVoteResponseStatus.AWAITING_RESPONSE, user_email: 'spec-user@example.org' } },
        ],
      });

      const result = await service.getMyVoteResponse(req, VOTE_UID);

      expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
        type: 'vote_response',
        filters: [`vote_uid:${VOTE_UID}`],
        filters_or: ['user_email:spec-user@example.org', 'username:spec-user'],
      });
      expect(result).toMatchObject({ uid: 'vr-1', vote_uid: VOTE_UID });
    });

    it('returns null when the only indexed row belongs to a different vote', async () => {
      // Row carries the mocked identity so the helper's ownership re-check keeps it — the null
      // must come from the vote_uid mismatch, not from the row being filtered out.
      proxyRequest.mockResolvedValue({ resources: [{ data: { uid: 'vr-1', vote_uid: 'v0000000-0000-0000-0000-00000000d999', username: 'spec-user' } }] });

      await expect(service.getMyVoteResponse(req, VOTE_UID)).resolves.toBeNull();
    });

    it('falls back to a poll_id-scoped query for legacy rows carrying no vote_uid (GH #2985)', async () => {
      // The vote_uid-scoped query finds nothing; the poll_id-scoped retry returns the legacy
      // row — the same parent-key fallback getMyVotes applies, one list/drawer level down.
      proxyRequest.mockResolvedValueOnce({ resources: [] }).mockResolvedValueOnce({
        resources: [
          { data: { uid: 'vr-legacy-1', poll_id: VOTE_UID, vote_status: IndexedVoteResponseStatus.AWAITING_RESPONSE, user_email: 'spec-user@example.org' } },
        ],
      });

      const result = await service.getMyVoteResponse(req, VOTE_UID);

      expect(proxyRequest).toHaveBeenNthCalledWith(
        1,
        req,
        'LFX_V2_SERVICE',
        '/query/resources',
        'GET',
        expect.objectContaining({ filters: [`vote_uid:${VOTE_UID}`] })
      );
      expect(proxyRequest).toHaveBeenNthCalledWith(
        2,
        req,
        'LFX_V2_SERVICE',
        '/query/resources',
        'GET',
        expect.objectContaining({ filters: [`poll_id:${VOTE_UID}`] })
      );
      expect(result).toMatchObject({ uid: 'vr-legacy-1', poll_id: VOTE_UID, vote_uid: VOTE_UID });
    });

    it('returns null after exactly two scoped queries when neither vote_uid nor poll_id matches', async () => {
      // The double-empty outcome (genuinely nonexistent/foreign vote) is the most common real
      // path — pin the bounded two-call contract so the fallback can never silently loop or
      // widen (companion to the poll_id fallback spec above).
      proxyRequest.mockResolvedValue({ resources: [] });

      await expect(service.getMyVoteResponse(req, VOTE_UID)).resolves.toBeNull();

      expect(proxyRequest).toHaveBeenCalledTimes(2);
      expect(proxyRequest).toHaveBeenNthCalledWith(
        1,
        req,
        'LFX_V2_SERVICE',
        '/query/resources',
        'GET',
        expect.objectContaining({ filters: [`vote_uid:${VOTE_UID}`] })
      );
      expect(proxyRequest).toHaveBeenNthCalledWith(
        2,
        req,
        'LFX_V2_SERVICE',
        '/query/resources',
        'GET',
        expect.objectContaining({ filters: [`poll_id:${VOTE_UID}`] })
      );
    });

    it('falls back to poll_id when the vote_uid query returns only non-matching rows', async () => {
      // Owned but foreign-vote rows (loosely-analyzed vote_uid filter) must not suppress the
      // legacy fallback — the trigger is "no match", not "no rows".
      proxyRequest
        .mockResolvedValueOnce({ resources: [{ data: { uid: 'vr-other', vote_uid: 'v0000000-0000-0000-0000-00000000d999', username: 'spec-user' } }] })
        .mockResolvedValueOnce({ resources: [{ data: { uid: 'vr-legacy-1', poll_id: VOTE_UID, user_email: 'spec-user@example.org' } }] });

      const result = await service.getMyVoteResponse(req, VOTE_UID);

      expect(proxyRequest).toHaveBeenCalledTimes(2);
      expect(result).toMatchObject({ uid: 'vr-legacy-1', poll_id: VOTE_UID, vote_uid: VOTE_UID });
    });

    it('falls back to vote_id when the indexer left uid empty, logging the drift', async () => {
      proxyRequest.mockResolvedValue({ resources: [{ data: { vote_id: 'v1-row-9', vote_uid: VOTE_UID, username: 'spec-user' } }] });

      const result = await service.getMyVoteResponse(req, VOTE_UID);

      expect(result).toMatchObject({ uid: 'v1-row-9', vote_uid: VOTE_UID });
      expect(logger.warning).toHaveBeenCalledWith(
        req,
        'get_my_vote_response',
        'vote_response row missing uid; falling back to vote_id',
        expect.objectContaining({ vote_uid: VOTE_UID, vote_id: 'v1-row-9' })
      );
    });

    it('returns null without any upstream call when the request carries neither username nor email', async () => {
      getUsernameFromAuth.mockResolvedValue(null);
      getEffectiveEmail.mockReturnValue(null);

      await expect(service.getMyVoteResponse(req, VOTE_UID)).resolves.toBeNull();
      expect(fetchAllQueryResources).not.toHaveBeenCalled();
      expect(proxyRequest).not.toHaveBeenCalled();
    });
  });

  describe('getVoteReminderRecipients (#3769)', () => {
    const VOTE_UID = 'v0000000-0000-0000-0000-00000000r001';
    const row = (overrides: Partial<IndexedVoteResponse> = {}) => ({
      uid: 'r-1',
      vote_uid: VOTE_UID,
      user_name: 'Avery Example',
      user_email: 'avery@acme-motors.example',
      user_org_name: 'Acme Motors',
      user_role: 'Member',
      user_voting_status: 'Voting Rep',
      vote_status: IndexedVoteResponseStatus.AWAITING_RESPONSE,
      voter_removed: false,
      vote_creation_time: '',
      ...overrides,
    });
    const activeVote = { ...voteFixture, uid: VOTE_UID, status: 'active', end_time: '2099-06-01T18:00:00Z' };
    beforeEach(() => {
      proxyRequest.mockResolvedValue(activeVote);
      fetchAllQueryResources.mockResolvedValue([]);
    });

    it.each([
      { status: 'ended', end_time: '2099-06-01T18:00:00Z' },
      { status: 'disabled', end_time: '2099-06-01T18:00:00Z' },
      { status: 'active', end_time: '2000-01-01T00:00:00Z' },
      { status: 'active', end_time: new Date(Date.now()).toISOString() },
      { status: 'active', end_time: 'invalid' },
    ])('rejects inactive or expired polls before reading recipients: %j', async (state) => {
      proxyRequest.mockResolvedValue({ ...activeVote, ...state });
      await expect(service.getVoteReminderRecipients(req, VOTE_UID)).rejects.toMatchObject({ statusCode: 409, code: VOTE_REMINDER_INACTIVE });
      expect(fetchAllQueryResources).not.toHaveBeenCalled();
    });

    it('includes legacy invitations once, rejecting rows whose canonical parent is different', async () => {
      fetchAllQueryResources.mockResolvedValue([
        row({ uid: 'legacy', vote_uid: undefined, poll_id: VOTE_UID }),
        row({ uid: 'legacy', vote_uid: undefined, poll_id: VOTE_UID }),
        row({ uid: 'current', poll_id: VOTE_UID }),
        row({ uid: 'foreign', vote_uid: 'another-vote', poll_id: VOTE_UID }),
        row({ uid: 'unparented', vote_uid: undefined }),
      ]);
      const recipients = await service.getVoteReminderRecipients(req, VOTE_UID);
      expect(recipients.map((recipient) => recipient.uid).sort()).toEqual(['current', 'legacy']);
    });

    it('drains the vote-scoped vote_response rows with failOnPartial, through the user-token proxy', async () => {
      fetchAllQueryResources.mockImplementation(async (_req: Request, fetchPage: (pageToken?: string) => Promise<unknown>) => {
        await fetchPage();
        await fetchPage('next-token');
        return [];
      });
      proxyRequest.mockResolvedValueOnce(activeVote).mockResolvedValue({ resources: [] });

      await service.getVoteReminderRecipients(req, VOTE_UID);

      expect(fetchAllQueryResources).toHaveBeenCalledWith(req, expect.any(Function), { failOnPartial: true });
      expect(proxyRequest).toHaveBeenNthCalledWith(1, req, 'LFX_V2_SERVICE', `/votes/${VOTE_UID}`, 'GET');
      expect(proxyRequest).toHaveBeenNthCalledWith(2, req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
        type: 'vote_response',
        filters_or: [`vote_uid:${VOTE_UID}`, `poll_id:${VOTE_UID}`],
      });
      expect(proxyRequest).toHaveBeenNthCalledWith(3, req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
        type: 'vote_response',
        filters_or: [`vote_uid:${VOTE_UID}`, `poll_id:${VOTE_UID}`],
        page_token: 'next-token',
      });
    });

    it('keeps only awaiting, uncast, non-removed rows with a uid, sorted by name', async () => {
      fetchAllQueryResources.mockResolvedValue([
        row({ uid: 'r-zed', user_name: 'Zed Example' }),
        row({ uid: 'r-responded', vote_status: IndexedVoteResponseStatus.RESPONDED }),
        row({ uid: 'r-cast', vote_creation_time: '2026-10-01T00:00:00Z' }),
        row({ uid: 'r-removed', voter_removed: true }),
        row({ uid: undefined }),
        row({ uid: 'r-ended', vote_status: 'awaiting_response_but_poll_ended' }),
        row({ uid: 'r-avery' }),
      ]);

      const recipients = await service.getVoteReminderRecipients(req, VOTE_UID);

      expect(recipients.map((r) => r.uid)).toEqual(['r-avery', 'r-zed']);
    });

    it('returns an identity-only projection — ballot content is never forwarded', async () => {
      fetchAllQueryResources.mockResolvedValue([
        row({
          poll_answers: [{ question_id: 'q-1', prompt: 'Approve?', type: 'generic', user_choice: [], ranked_user_choice: [] }],
          comment_responses: [{ prompt_id: 'c-1', comment_text: 'secret' }],
        }),
      ]);

      const [recipient] = await service.getVoteReminderRecipients(req, VOTE_UID);

      expect(recipient).toEqual({
        uid: 'r-1',
        user_name: 'Avery Example',
        user_email: 'avery@acme-motors.example',
        user_org_name: 'Acme Motors',
        user_role: 'Member',
        user_voting_status: 'Voting Rep',
      });
    });
  });

  describe('getVoteVoters (#3911)', () => {
    const VOTE_UID = 'v0000000-0000-0000-0000-00000000b001';
    const genericAnswer = {
      question_id: 'q-1',
      prompt: 'Approve the charter?',
      type: 'generic',
      user_choice: [{ choice_id: 'c-yes', choice_text: 'Yes' }],
    };
    const rankedAnswer = {
      question_id: 'q-2',
      prompt: 'Rank the candidates',
      type: 'ranked_choice',
      ranked_user_choice: [
        { choice_id: 'c-b', choice_text: 'Candidate B', choice_rank: 1 },
        { choice_id: 'c-a', choice_text: 'Candidate A', choice_rank: 2 },
      ],
    };
    const comment = { prompt_id: 'p-1', comment_text: 'Synthetic comment' };
    const row = (overrides: Partial<IndexedVoteResponse> = {}): IndexedVoteResponse => ({
      uid: 'b-1',
      vote_uid: VOTE_UID,
      user_name: 'Avery Example',
      user_email: 'avery@acme-motors.example',
      username: 'avery-example',
      user_org_name: 'Acme Motors',
      user_role: 'Member',
      user_voting_status: 'Voting Rep',
      profile_picture: 'https://avatars.example/avery.png',
      vote_status: IndexedVoteResponseStatus.AWAITING_RESPONSE,
      voter_removed: false,
      vote_creation_time: '',
      ...overrides,
    });
    const namedVote = { ...voteFixture, uid: VOTE_UID, status: 'active', pseudo_anonymity: false, end_time: '2099-06-01T18:00:00Z' };
    const queryResourceCalls = () => proxyRequest.mock.calls.filter(([, , path]) => path === '/query/resources');
    /** Named votes return full `VoteVoter` rows; narrows the union return for field assertions. */
    const getNamedVoters = async () => (await service.getVoteVoters(req, VOTE_UID)) as VoteVoter[];

    beforeEach(() => {
      proxyRequest.mockResolvedValue(namedVote);
      fetchAllQueryResources.mockResolvedValue([]);
    });

    it.each(['disabled', 'DISABLED', 'archived', '', undefined])(
      'refuses a draft or unrecognized status (%j) with 409 before reading any ballot (AC-2)',
      async (status) => {
        proxyRequest.mockResolvedValue({ ...namedVote, status });

        await expect(service.getVoteVoters(req, VOTE_UID)).rejects.toMatchObject({ statusCode: 409, code: VOTE_VOTERS_DRAFT });

        expect(fetchAllQueryResources).not.toHaveBeenCalled();
        expect(queryResourceCalls()).toHaveLength(0);
      }
    );

    it('checks the draft state before the privacy flag, so a pseudo-anonymous draft still reports 409', async () => {
      proxyRequest.mockResolvedValue({ ...namedVote, status: 'disabled', pseudo_anonymity: true });

      await expect(service.getVoteVoters(req, VOTE_UID)).rejects.toMatchObject({ statusCode: 409, code: VOTE_VOTERS_DRAFT });
    });

    it.each([
      { status: 'active', pseudo_anonymity: true },
      { status: 'ended', pseudo_anonymity: true },
      { status: 'active', pseudo_anonymity: undefined },
      { status: 'ended', pseudo_anonymity: undefined },
      { status: 'active', pseudo_anonymity: null },
    ])('returns name-sorted participation-only rows on a vote that is not explicitly named (%j) (#3916)', async (state) => {
      proxyRequest.mockResolvedValue({ ...namedVote, ...state });
      fetchAllQueryResources.mockResolvedValue([
        row({
          uid: 'b-voted',
          user_name: 'Casey Example',
          vote_status: IndexedVoteResponseStatus.RESPONDED,
          vote_creation_time: '2026-10-02T09:30:00Z',
          abstained: false,
          poll_answers: [genericAnswer],
          comment_responses: [comment],
        }),
        row({
          uid: 'b-abstained',
          user_name: 'Blake Example',
          vote_status: IndexedVoteResponseStatus.RESPONDED,
          vote_creation_time: '2026-10-03T11:00:00Z',
          abstained: true,
          poll_answers: [],
          comment_responses: [comment],
        }),
        row({ uid: 'b-pending', user_name: 'Avery Example' }),
      ]);

      const voters = await service.getVoteVoters(req, VOTE_UID);

      const identity = { user_org_name: 'Acme Motors', user_role: 'Member', user_voting_status: 'Voting Rep' };
      expect(voters).toEqual([
        { user_name: 'Avery Example', ...identity, status: 'pending' },
        { user_name: 'Blake Example', ...identity, status: 'responded' },
        { user_name: 'Casey Example', ...identity, status: 'responded' },
      ]);
      for (const voter of voters) {
        for (const field of [
          'uid',
          'poll_answers',
          'comment_responses',
          'abstained',
          'submitted_at',
          'vote_creation_time',
          'user_email',
          'username',
          'profile_picture',
        ]) {
          expect(voter).not.toHaveProperty(field);
        }
      }
    });

    it('propagates a vote lookup failure without reading any ballot', async () => {
      const upstream = new MicroserviceError('vote lookup failed', 502, 'BAD_GATEWAY', {});
      proxyRequest.mockRejectedValue(upstream);

      await expect(service.getVoteVoters(req, VOTE_UID)).rejects.toBe(upstream);

      expect(fetchAllQueryResources).not.toHaveBeenCalled();
    });

    it.each(['active', 'ended', 'ACTIVE', 'Ended'])('returns every invitee with status and current ballot on a named %s vote (AC-1)', async (status) => {
      proxyRequest.mockResolvedValue({ ...namedVote, status });
      fetchAllQueryResources.mockResolvedValue([
        row({
          uid: 'b-voted',
          user_name: 'Blake Example',
          vote_status: IndexedVoteResponseStatus.RESPONDED,
          vote_creation_time: '2026-10-02T09:30:00Z',
          abstained: false,
          poll_answers: [genericAnswer, rankedAnswer],
          comment_responses: [comment],
        }),
        row({
          uid: 'b-abstained',
          user_name: 'Casey Example',
          vote_status: IndexedVoteResponseStatus.RESPONDED,
          vote_creation_time: '2026-10-03T11:00:00Z',
          abstained: true,
          poll_answers: [],
          comment_responses: [comment],
        }),
        row({ uid: 'b-pending', user_name: 'Avery Example' }),
      ]);

      const voters = await service.getVoteVoters(req, VOTE_UID);

      expect(voters).toEqual([
        {
          uid: 'b-pending',
          user_name: 'Avery Example',
          user_email: 'avery@acme-motors.example',
          username: 'avery-example',
          user_org_name: 'Acme Motors',
          user_role: 'Member',
          user_voting_status: 'Voting Rep',
          profile_picture: 'https://avatars.example/avery.png',
          status: VoteVoterStatus.NOT_VOTED,
          submitted_at: undefined,
          poll_answers: undefined,
          comment_responses: undefined,
        },
        expect.objectContaining({
          uid: 'b-voted',
          status: VoteVoterStatus.VOTED,
          submitted_at: '2026-10-02T09:30:00Z',
          poll_answers: [
            { ...genericAnswer, ranked_user_choice: [] },
            { ...rankedAnswer, user_choice: [] },
          ],
          comment_responses: [comment],
        }),
        expect.objectContaining({
          uid: 'b-abstained',
          status: VoteVoterStatus.ABSTAINED,
          submitted_at: '2026-10-03T11:00:00Z',
          poll_answers: [],
          comment_responses: [comment],
        }),
      ]);
    });

    it('normalizes omitted choice arrays without mutating the indexed answers', async () => {
      const unanswered = { question_id: 'q-3', prompt: 'Optional question', type: 'generic' };
      fetchAllQueryResources.mockResolvedValue([
        row({ vote_status: IndexedVoteResponseStatus.RESPONDED, poll_answers: [genericAnswer, rankedAnswer, unanswered] }),
      ]);

      const [voter] = await getNamedVoters();

      expect(voter.poll_answers).toEqual([
        { ...genericAnswer, ranked_user_choice: [] },
        { ...rankedAnswer, user_choice: [] },
        { ...unanswered, user_choice: [], ranked_user_choice: [] },
      ]);
      expect(genericAnswer).not.toHaveProperty('ranked_user_choice');
      expect(rankedAnswer).not.toHaveProperty('user_choice');
      expect(unanswered).not.toHaveProperty('user_choice');
      expect(unanswered).not.toHaveProperty('ranked_user_choice');
    });

    it('never forwards fields outside the voter projection, such as SES tracking or the org id', async () => {
      fetchAllQueryResources.mockResolvedValue([
        { ...row({ user_org_id: 'org-1', vote_creation_time: '2026-10-02T09:30:00Z' }), ses_message_id: 'ses-1', user_id: 'auth0|synthetic' },
      ]);

      const [voter] = await service.getVoteVoters(req, VOTE_UID);

      expect(Object.keys(voter).sort()).toEqual(
        [
          'comment_responses',
          'poll_answers',
          'profile_picture',
          'status',
          'submitted_at',
          'uid',
          'user_email',
          'user_name',
          'user_org_name',
          'user_role',
          'user_voting_status',
          'username',
        ].sort()
      );
    });

    it.each([
      { label: 'responded without a submission time', overrides: { vote_status: IndexedVoteResponseStatus.RESPONDED }, expected: VoteVoterStatus.VOTED },
      {
        label: 'a submission time with an ended status',
        overrides: { vote_status: IndexedVoteResponseStatus.ENDED, vote_creation_time: '2026-10-02T09:30:00Z' },
        expected: VoteVoterStatus.VOTED,
      },
      {
        label: 'an abstention marked responded without a submission time',
        overrides: { vote_status: IndexedVoteResponseStatus.RESPONDED, abstained: true },
        expected: VoteVoterStatus.ABSTAINED,
      },
      {
        label: 'awaiting response after the poll ended',
        overrides: { vote_status: IndexedVoteResponseStatus.AWAITING_RESPONSE_BUT_POLL_ENDED },
        expected: VoteVoterStatus.NOT_VOTED,
      },
      { label: 'an abstained flag on an unsubmitted row', overrides: { abstained: true }, expected: VoteVoterStatus.NOT_VOTED },
    ])('derives the status from $label', async ({ overrides, expected }) => {
      fetchAllQueryResources.mockResolvedValue([row(overrides)]);

      const [voter] = await service.getVoteVoters(req, VOTE_UID);

      expect(voter.status).toBe(expected);
    });

    it('drops removed voters, rows with another parent, rows without a uid and duplicates, keeping legacy poll_id-only rows', async () => {
      fetchAllQueryResources.mockResolvedValue([
        row({ uid: 'legacy', vote_uid: undefined, poll_id: VOTE_UID }),
        row({ uid: 'legacy', vote_uid: undefined, poll_id: VOTE_UID }),
        row({ uid: 'current', poll_id: VOTE_UID }),
        row({ uid: 'removed', voter_removed: true }),
        row({ uid: 'foreign', vote_uid: 'another-vote', poll_id: VOTE_UID }),
        row({ uid: 'unparented', vote_uid: undefined }),
        row({ uid: undefined }),
      ]);

      const voters = await getNamedVoters();

      expect(voters.map((voter) => voter.uid).sort()).toEqual(['current', 'legacy']);
    });

    it('sorts voters by name, placing unnamed voters first', async () => {
      fetchAllQueryResources.mockResolvedValue([
        row({ uid: 'b-zed', user_name: 'Zed Example' }),
        row({ uid: 'b-unnamed', user_name: undefined }),
        row({ uid: 'b-avery', user_name: 'Avery Example' }),
      ]);

      const voters = await getNamedVoters();

      expect(voters.map((voter) => voter.uid)).toEqual(['b-unnamed', 'b-avery', 'b-zed']);
    });

    it('drains the vote-scoped vote_response rows with failOnPartial, through the user-token proxy, after the vote lookup', async () => {
      fetchAllQueryResources.mockImplementation(async (_req: Request, fetchPage: (pageToken?: string) => Promise<unknown>) => {
        await fetchPage();
        await fetchPage('next-token');
        return [];
      });
      proxyRequest.mockResolvedValueOnce(namedVote).mockResolvedValue({ resources: [] });

      await service.getVoteVoters(req, VOTE_UID);

      expect(fetchAllQueryResources).toHaveBeenCalledWith(req, expect.any(Function), { failOnPartial: true });
      expect(proxyRequest).toHaveBeenNthCalledWith(1, req, 'LFX_V2_SERVICE', `/votes/${VOTE_UID}`, 'GET');
      expect(proxyRequest).toHaveBeenNthCalledWith(2, req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
        type: 'vote_response',
        filters_or: [`vote_uid:${VOTE_UID}`, `poll_id:${VOTE_UID}`],
      });
      expect(proxyRequest).toHaveBeenNthCalledWith(3, req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
        type: 'vote_response',
        filters_or: [`vote_uid:${VOTE_UID}`, `poll_id:${VOTE_UID}`],
        page_token: 'next-token',
      });
    });

    it('rejects instead of returning a partial voter list when the page set is incomplete', async () => {
      const partial = new MicroserviceError('Incomplete query-service page set', 502, 'BAD_GATEWAY', {});
      fetchAllQueryResources.mockRejectedValue(partial);

      await expect(service.getVoteVoters(req, VOTE_UID)).rejects.toBe(partial);

      expect(fetchAllQueryResources).toHaveBeenCalledWith(req, expect.any(Function), { failOnPartial: true });
    });

    it('logs counts only — never voter names or emails', async () => {
      fetchAllQueryResources.mockResolvedValue([row({ uid: 'b-1' }), row({ uid: 'b-2', voter_removed: true })]);

      await service.getVoteVoters(req, VOTE_UID);

      expect(logger.debug).toHaveBeenCalledWith(req, 'get_vote_voters', 'Mapped vote voters', {
        vote_uid: VOTE_UID,
        row_count: 2,
        voter_count: 1,
        participation_only: false,
      });
      const loggedMetadata = JSON.stringify(vi.mocked(logger.debug).mock.calls);
      expect(loggedMetadata).not.toContain('avery@acme-motors.example');
      expect(loggedMetadata).not.toContain('Avery Example');
    });
  });

  describe('sendVoteReminders (#3769)', () => {
    beforeEach(() => {
      vi.spyOn(service, 'getVoteReminderRecipients').mockResolvedValue([{ uid: 'r-1' }, { uid: 'r-2' }]);
    });
    afterEach(() => vi.restoreAllMocks());

    it('checks writer access before reading recipients or sending', async () => {
      const forbidden = new MicroserviceError('Forbidden', 403, 'FORBIDDEN', {});
      assertVoteWrite.mockRejectedValueOnce(forbidden);
      await expect(service.sendVoteReminders(req, CANONICAL_UID, ['r-1'])).rejects.toBe(forbidden);
      expect(service.getVoteReminderRecipients).not.toHaveBeenCalled();
      expect(proxyRequest).not.toHaveBeenCalled();
    });

    it('marks an unavailable writer check as a confirmed pre-send failure', async () => {
      const unavailable = new MicroserviceError('Access unavailable', 503, 'ACCESS_CHECK_UNAVAILABLE');
      assertVoteWrite.mockRejectedValueOnce(unavailable);
      const failure = await service.sendVoteReminders(req, CANONICAL_UID, ['r-1']).catch((error: unknown) => error);
      expect(failure).toMatchObject({ statusCode: 503, code: VOTE_REMINDER_PRECHECK_FAILED, originalError: unavailable });
      expect((failure as MicroserviceError).toResponse()).toMatchObject({ code: VOTE_REMINDER_PRECHECK_FAILED });
      expect(service.getVoteReminderRecipients).not.toHaveBeenCalled();
      expect(proxyRequest).not.toHaveBeenCalled();
    });

    it('preserves the inactive-vote conflict from the eligibility check', async () => {
      const inactive = new ConflictError('Inactive vote', VOTE_REMINDER_INACTIVE);
      vi.mocked(service.getVoteReminderRecipients).mockRejectedValueOnce(inactive);
      await expect(service.sendVoteReminders(req, CANONICAL_UID, ['r-1'])).rejects.toBe(inactive);
      expect(proxyRequest).not.toHaveBeenCalled();
    });

    it.each(['vote lookup', 'query drain'])('marks a failed %s as not sent without attempting bulk_resend', async (phase) => {
      vi.mocked(service.getVoteReminderRecipients).mockRestore();
      const upstream = new MicroserviceError('Read failed', 502, 'BAD_GATEWAY', { transportFailure: true });
      proxyRequest.mockResolvedValue({ uid: CANONICAL_UID, status: 'active', end_time: new Date(Date.now() + 60000).toISOString() });
      if (phase === 'vote lookup') proxyRequest.mockRejectedValueOnce(upstream);
      else fetchAllQueryResources.mockRejectedValueOnce(upstream);
      const failure = await service.sendVoteReminders(req, CANONICAL_UID, ['r-1']).catch((error: unknown) => error);
      expect(failure).toMatchObject({ statusCode: 502, code: VOTE_REMINDER_PRECHECK_FAILED, originalError: upstream });
      expect((failure as MicroserviceError).toResponse()).toMatchObject({ code: VOTE_REMINDER_PRECHECK_FAILED });
      expect((failure as MicroserviceError).toResponse()).not.toHaveProperty('transport');
      expect(proxyRequest.mock.calls.every((call) => call[3] === 'GET')).toBe(true);
      expect(fetchAllQueryResources).toHaveBeenCalledTimes(phase === 'query drain' ? 1 : 0);
    });

    it('rejects the whole stale selection without sending an eligible subset', async () => {
      vi.mocked(service.getVoteReminderRecipients).mockResolvedValue([{ uid: 'r-2' }]);
      await expect(service.sendVoteReminders(req, CANONICAL_UID, ['r-1', 'r-2'])).rejects.toMatchObject({
        statusCode: 409,
        code: VOTE_REMINDER_SELECTION_STALE,
      });
      expect(assertVoteWrite).toHaveBeenCalledWith(req, CANONICAL_UID, 'send_vote_reminders');
      expect(assertVoteWrite.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(service.getVoteReminderRecipients).mock.invocationCallOrder[0]);
      expect(proxyRequest).not.toHaveBeenCalled();
    });

    it('does not send when fresh eligibility cannot be verified', async () => {
      const originalError = new Error('query failed');
      vi.mocked(service.getVoteReminderRecipients).mockRejectedValue(originalError);
      await expect(service.sendVoteReminders(req, CANONICAL_UID, ['r-1'])).rejects.toMatchObject({
        statusCode: 500,
        code: VOTE_REMINDER_PRECHECK_FAILED,
        originalError,
      });
      expect(proxyRequest).not.toHaveBeenCalled();
    });

    it('POSTs the recipient IDs to the vote bulk_resend endpoint with the user token and returns the count', async () => {
      proxyRequest.mockResolvedValue(undefined);

      const result = await service.sendVoteReminders(req, CANONICAL_UID, ['r-1', 'r-2']);

      expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', `/votes/${CANONICAL_UID}/bulk_resend`, 'POST', undefined, {
        recipient_ids: ['r-1', 'r-2'],
      });
      // No ApiRequestOptions argument: the user's own bearer token is used, never an M2M override.
      expect(proxyRequest.mock.calls[0]).toHaveLength(6);
      expect(result).toEqual({ recipient_count: 2 });
    });

    it('encodes the vote uid in the upstream path', async () => {
      proxyRequest.mockResolvedValue(undefined);

      await service.sendVoteReminders(req, HOSTILE_UID, ['r-1']);

      expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', '/votes/abc%2Fdef/bulk_resend', 'POST', undefined, { recipient_ids: ['r-1'] });
    });

    it.each([408, 500, 503, 504])('does not mark an upstream %s send failure as a pre-send failure', async (status) => {
      const upstream = new MicroserviceError('Send outcome unknown', status, 'UPSTREAM_FAILURE', { transportFailure: true });
      proxyRequest.mockRejectedValueOnce(upstream);
      await expect(service.sendVoteReminders(req, CANONICAL_UID, ['r-1'])).rejects.toBe(upstream);
      expect(upstream.toResponse()).not.toMatchObject({ code: VOTE_REMINDER_PRECHECK_FAILED });
    });

    it('propagates an upstream 400 unchanged', async () => {
      const upstream = new MicroserviceError('poll is not active', 400, 'BAD_REQUEST', { service: 'LFX_V2_SERVICE' });
      proxyRequest.mockRejectedValue(upstream);

      await expect(service.sendVoteReminders(req, CANONICAL_UID, ['r-1'])).rejects.toBe(upstream);
    });
  });

  describe('getVoteSummaryRecipients (#3662)', () => {
    const VOTE_UID = 'v0000000-0000-0000-0000-00000000c001';
    const row = (overrides: Partial<IndexedVoteResponse> = {}): IndexedVoteResponse => ({
      uid: 'b-1',
      vote_uid: VOTE_UID,
      user_name: 'Avery Example',
      user_email: 'avery@acme-motors.example',
      username: 'avery-example',
      user_org_name: 'Acme Motors',
      user_role: 'Member',
      user_voting_status: 'Voting Rep',
      profile_picture: 'https://avatars.example/avery.png',
      vote_status: IndexedVoteResponseStatus.AWAITING_RESPONSE,
      voter_removed: false,
      vote_creation_time: '',
      ...overrides,
    });

    it('drops removed voters, rows with another parent, rows without a uid and duplicates', async () => {
      fetchAllQueryResources.mockResolvedValue([
        row({ uid: 'current' }),
        row({ uid: 'current' }),
        row({ uid: 'removed', voter_removed: true }),
        row({ uid: 'foreign', vote_uid: 'another-vote' }),
        row({ uid: 'unparented', vote_uid: undefined }),
        row({ uid: undefined }),
      ]);

      const recipients = await service.getVoteSummaryRecipients(req, VOTE_UID);

      expect(recipients.map((recipient) => recipient.uid)).toEqual(['current']);
    });

    it('sorts recipients by name, placing unnamed recipients first', async () => {
      fetchAllQueryResources.mockResolvedValue([
        row({ uid: 'b-zed', user_name: 'Zed Example' }),
        row({ uid: 'b-unnamed', user_name: undefined }),
        row({ uid: 'b-avery', user_name: 'Avery Example' }),
      ]);

      const recipients = await service.getVoteSummaryRecipients(req, VOTE_UID);

      expect(recipients.map((recipient) => recipient.uid)).toEqual(['b-unnamed', 'b-avery', 'b-zed']);
    });

    it('returns only identity fields — never ballot content', async () => {
      fetchAllQueryResources.mockResolvedValue([row({ poll_answers: [{ question_id: 'q-1', prompt: 'Approve?', type: 'generic', user_choice: [] }] })]);

      const [recipient] = await service.getVoteSummaryRecipients(req, VOTE_UID);

      expect(Object.keys(recipient).sort()).toEqual(['uid', 'user_email', 'user_name'].sort());
    });

    it('reads vote_response rows without checking pseudo_anonymity or vote status', async () => {
      fetchAllQueryResources.mockResolvedValue([row()]);

      await service.getVoteSummaryRecipients(req, VOTE_UID);

      expect(proxyRequest).not.toHaveBeenCalled();
      expect(fetchAllQueryResources).toHaveBeenCalledWith(req, expect.any(Function), { failOnPartial: true });
    });
  });

  describe('sendVoteSummary (#3662)', () => {
    const endedVote = { ...voteFixture, uid: CANONICAL_UID, name: 'Spring Election', status: 'ended' };
    const resultsFixture: VoteResultsResponse = {
      poll_results: [
        {
          question: { question_id: 'q-1', prompt: 'Approve the charter?', type: 'single_choice', choices: [{ choice_id: 'c-yes', choice_text: 'Yes' }] },
          generic_choice_votes: [{ choice_id: 'c-yes', vote_count: 3, percentage: 100 }],
          ranked_choice_votes: [],
        },
      ],
      comment_results: [],
      num_recipients: 5,
      num_votes_cast: 3,
      num_abstained: 0,
      poll_end_time: '2026-01-01T00:00:00Z',
    };
    const recipientsFixture = [
      { uid: 'r-1', user_name: 'Avery Example', user_email: 'avery@acme-motors.example' },
      { uid: 'r-2', user_name: 'Blake Example', user_email: 'blake@acme-motors.example' },
    ];

    beforeEach(() => {
      proxyRequest.mockResolvedValue(endedVote);
      vi.spyOn(service, 'getVoteResults').mockResolvedValue(resultsFixture);
      vi.spyOn(service, 'getVoteSummaryRecipients').mockResolvedValue(recipientsFixture);
    });
    afterEach(() => vi.restoreAllMocks());

    it('checks writer access before reading the vote, results or recipients', async () => {
      const forbidden = new MicroserviceError('Forbidden', 403, 'FORBIDDEN', {});
      assertVoteWrite.mockRejectedValueOnce(forbidden);

      await expect(service.sendVoteSummary(req, CANONICAL_UID)).rejects.toBe(forbidden);

      expect(proxyRequest).not.toHaveBeenCalled();
      expect(service.getVoteResults).not.toHaveBeenCalled();
      expect(service.getVoteSummaryRecipients).not.toHaveBeenCalled();
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it.each(['active', 'draft', 'disabled', undefined])(
      'refuses a vote that has not ended (status %j) before reading results or recipients',
      async (status) => {
        proxyRequest.mockResolvedValue({ ...endedVote, status });

        await expect(service.sendVoteSummary(req, CANONICAL_UID)).rejects.toMatchObject({ statusCode: 409, code: VOTE_SUMMARY_NOT_ENDED });

        expect(service.getVoteResults).not.toHaveBeenCalled();
        expect(service.getVoteSummaryRecipients).not.toHaveBeenCalled();
        expect(sendEmail).not.toHaveBeenCalled();
      }
    );

    it.each([
      ['held results', { ...resultsFixture, results_held: true }],
      ['results without an abstention count', { ...resultsFixture, num_abstained: undefined }],
    ])('refuses to email %s as a final summary', async (_label, results) => {
      vi.mocked(service.getVoteResults).mockResolvedValue(results);

      await expect(service.sendVoteSummary(req, CANONICAL_UID)).rejects.toMatchObject({
        statusCode: 502,
        code: 'VOTE_RESULTS_UNAVAILABLE',
      });
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it('sends one email per recipient and returns the sent count', async () => {
      const result = await service.sendVoteSummary(req, CANONICAL_UID);

      expect(sendEmail).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ recipient_count: 2, failed_count: 0 });
    });

    it('sends the identical rendered email to every recipient — never personalized per voter', async () => {
      await service.sendVoteSummary(req, CANONICAL_UID);

      const [firstCall, secondCall] = sendEmail.mock.calls;
      expect(firstCall[1]).toMatchObject({ to: 'avery@acme-motors.example' });
      expect(secondCall[1]).toMatchObject({ to: 'blake@acme-motors.example' });
      expect(firstCall[1].subject).toBe(secondCall[1].subject);
      expect(firstCall[1].html).toBe(secondCall[1].html);
      expect(firstCall[1].text).toBe(secondCall[1].text);
    });

    it('filters out recipients with no email before sending', async () => {
      vi.mocked(service.getVoteSummaryRecipients).mockResolvedValue([...recipientsFixture, { uid: 'r-3', user_name: 'No Email' }]);

      const result = await service.sendVoteSummary(req, CANONICAL_UID);

      expect(sendEmail).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ recipient_count: 2, failed_count: 0 });
    });

    it('deduplicates recipients sharing the same email before sending', async () => {
      vi.mocked(service.getVoteSummaryRecipients).mockResolvedValue([
        ...recipientsFixture,
        { uid: 'r-dup', user_name: 'Dup', user_email: 'AVERY@acme-motors.example' },
      ]);

      const result = await service.sendVoteSummary(req, CANONICAL_UID);

      expect(sendEmail).toHaveBeenCalledTimes(2);
      expect(result.recipient_count).toBe(2);
    });

    it('counts a partial send failure without throwing, and logs a warning for the failed recipient', async () => {
      sendEmail.mockResolvedValueOnce({ email_id: 'email-sent' }).mockRejectedValueOnce(new Error('smtp down'));

      const result = await service.sendVoteSummary(req, CANONICAL_UID);

      expect(result).toEqual({ recipient_count: 1, failed_count: 1 });
      expect(logger.warning).toHaveBeenCalledWith(
        req,
        'send_vote_summary',
        'Failed to send the summary email to one recipient',
        expect.objectContaining({ vote_uid: CANONICAL_UID, recipient_uid: 'r-2' })
      );
    });

    // #3662: emailService.sendEmail resolves without throwing when sending is disabled or the
    // recipient is filtered — it only omits `email_id`. A recipient whose send was
    // accepted-but-not-sent must count as failed, not sent.
    it('counts a fulfilled-but-unsent reply (no email_id) as a failure, not a send', async () => {
      sendEmail.mockResolvedValueOnce({ email_id: 'email-sent' }).mockResolvedValueOnce({});

      const result = await service.sendVoteSummary(req, CANONICAL_UID);

      expect(result).toEqual({ recipient_count: 1, failed_count: 1 });
      expect(logger.warning).toHaveBeenCalledWith(
        req,
        'send_vote_summary',
        'Failed to send the summary email to one recipient',
        expect.objectContaining({ vote_uid: CANONICAL_UID, recipient_uid: 'r-2' })
      );
    });

    it('throws when every send fails, reporting none sent', async () => {
      sendEmail.mockRejectedValue(new Error('smtp down'));

      await expect(service.sendVoteSummary(req, CANONICAL_UID)).rejects.toMatchObject({
        statusCode: 502,
        code: VOTE_SUMMARY_SEND_FAILED,
      });
    });

    it('does not throw when there are no recipients at all — nothing to send', async () => {
      vi.mocked(service.getVoteSummaryRecipients).mockResolvedValue([]);

      const result = await service.sendVoteSummary(req, CANONICAL_UID);

      expect(sendEmail).not.toHaveBeenCalled();
      expect(result).toEqual({ recipient_count: 0, failed_count: 0 });
    });

    it('renders first-choice vote counts and percentages for a ranked-choice question', async () => {
      vi.mocked(service.getVoteResults).mockResolvedValue({
        ...resultsFixture,
        poll_results: [
          {
            question: { question_id: 'q-2', prompt: 'Rank the candidates', type: 'single_choice', choices: [{ choice_id: 'c-a', choice_text: 'Alex' }] },
            generic_choice_votes: [],
            ranked_choice_votes: [{ choice_id: 'c-a', rank_counts: [{ rank: 1, count: 2 }], condorcet_matrix: [] }],
          },
        ],
      });

      await service.sendVoteSummary(req, CANONICAL_UID);

      const { html, text } = sendEmail.mock.calls[0][1];
      expect(html).toContain('Alex (first-choice votes)');
      expect(html).toContain('2 (100%)');
      expect(text).toContain('Alex (first-choice votes): 2 (100%)');
    });

    it('reports 0% for a ranked-choice question with no first-choice votes at all', async () => {
      vi.mocked(service.getVoteResults).mockResolvedValue({
        ...resultsFixture,
        poll_results: [
          {
            question: { question_id: 'q-2', prompt: 'Rank the candidates', type: 'single_choice', choices: [{ choice_id: 'c-a', choice_text: 'Alex' }] },
            generic_choice_votes: [],
            ranked_choice_votes: [{ choice_id: 'c-a', rank_counts: [], condorcet_matrix: [] }],
          },
        ],
      });

      await service.sendVoteSummary(req, CANONICAL_UID);

      const { html } = sendEmail.mock.calls[0][1];
      expect(html).toContain('0 (0%)');
    });
  });
});
