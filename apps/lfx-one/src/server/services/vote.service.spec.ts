// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Unit tests for vote.service.ts upstream path encoding (GH-1568 follow-up). All fixtures use
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
  // tested helper; these tests only pin the upstream path the vote methods build.
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

import { ServiceValidationError } from '../errors';
import { VoteService } from './vote.service';

describe('VoteService upstream path encoding', () => {
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

      expect(proxyRequestWithResponse).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', '/votes/abc%2Fdef/enable', 'PUT');
    });

    it('rejects a dot-segment uid without proxying', async () => {
      await expect(service.enableVote(req, '..')).rejects.toThrow(ServiceValidationError);

      expect(proxyRequestWithResponse).not.toHaveBeenCalled();
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
