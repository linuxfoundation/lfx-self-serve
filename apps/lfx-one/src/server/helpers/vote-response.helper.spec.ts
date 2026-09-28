// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Unit tests for vote-response.helper.ts (GH #2985) — pins the exact `filters_or` identity
// shape My Votes proved out (email clause first, raw `user_email`, auth-prefix stripped from
// the username), the no-identity short-circuit, and the options passthrough. The REAL
// `fetchAllQueryResources` paginator runs against a mocked proxy so multi-page aggregation and
// `failOnPartial` forwarding are exercised end to end. All fixtures use synthetic placeholder
// identities — never real user data.

import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getEffectiveEmail, getUsernameFromAuth } = vi.hoisted(() => ({
  getEffectiveEmail: vi.fn(),
  getUsernameFromAuth: vi.fn(),
}));

vi.mock('../services/logger.service', () => ({
  logger: {
    debug: vi.fn(),
    warning: vi.fn(),
  },
}));
vi.mock('../utils/auth-helper', async () => {
  // Keep the real stripAuthPrefix — the auth0|-prefix stripping is part of the pinned contract.
  const actual = await vi.importActual<typeof import('../utils/auth-helper')>('../utils/auth-helper');
  return { ...actual, getEffectiveEmail, getUsernameFromAuth };
});

import type { MicroserviceProxyService } from '../services/microservice-proxy.service';
import { fetchCurrentUserVoteResponses } from './vote-response.helper';

describe('fetchCurrentUserVoteResponses', () => {
  const req = {} as Request;
  const proxyRequest = vi.fn();
  const proxy = { proxyRequest } as unknown as MicroserviceProxyService;

  const page = (rows: object[], pageToken?: string) => ({
    resources: rows.map((data) => ({ data })),
    ...(pageToken && { page_token: pageToken }),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    getUsernameFromAuth.mockResolvedValue('spec-user');
    getEffectiveEmail.mockReturnValue('spec-user@example.org');
    proxyRequest.mockResolvedValue(page([{ uid: 'vr-1', vote_uid: 'v-1' }]));
  });

  it('matches on both identity clauses, email first (getMyVotes parity)', async () => {
    const rows = await fetchCurrentUserVoteResponses(req, proxy);

    expect(rows).toEqual([{ uid: 'vr-1', vote_uid: 'v-1' }]);
    expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
      type: 'vote_response',
      filters_or: ['user_email:spec-user@example.org', 'username:spec-user'],
    });
  });

  it('strips the auth provider prefix from the username clause', async () => {
    getUsernameFromAuth.mockResolvedValue('auth0|spec-user');

    await fetchCurrentUserVoteResponses(req, proxy);

    expect(proxyRequest).toHaveBeenCalledWith(
      req,
      'LFX_V2_SERVICE',
      '/query/resources',
      'GET',
      expect.objectContaining({ filters_or: ['user_email:spec-user@example.org', 'username:spec-user'] })
    );
  });

  it('matches email-only when the request carries no username', async () => {
    getUsernameFromAuth.mockResolvedValue(null);

    await fetchCurrentUserVoteResponses(req, proxy);

    expect(proxyRequest).toHaveBeenCalledWith(
      req,
      'LFX_V2_SERVICE',
      '/query/resources',
      'GET',
      expect.objectContaining({ filters_or: ['user_email:spec-user@example.org'] })
    );
  });

  it('matches username-only when the request carries no email', async () => {
    getEffectiveEmail.mockReturnValue(null);

    await fetchCurrentUserVoteResponses(req, proxy);

    expect(proxyRequest).toHaveBeenCalledWith(
      req,
      'LFX_V2_SERVICE',
      '/query/resources',
      'GET',
      expect.objectContaining({ filters_or: ['username:spec-user'] })
    );
  });

  it('returns [] without touching the proxy when neither identity exists', async () => {
    getUsernameFromAuth.mockResolvedValue(null);
    getEffectiveEmail.mockReturnValue(null);

    await expect(fetchCurrentUserVoteResponses(req, proxy)).resolves.toEqual([]);
    expect(proxyRequest).not.toHaveBeenCalled();
  });

  it('merges extra filters into the query (ANDed against the identity disjunction)', async () => {
    await fetchCurrentUserVoteResponses(req, proxy, { filters: ['vote_uid:v-1'] });

    expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
      type: 'vote_response',
      filters: ['vote_uid:v-1'],
      filters_or: ['user_email:spec-user@example.org', 'username:spec-user'],
    });
  });

  it('omits the filters param entirely when none are supplied', async () => {
    await fetchCurrentUserVoteResponses(req, proxy);

    expect(proxyRequest.mock.calls[0]?.[4]).not.toHaveProperty('filters');
  });

  it('aggregates multiple pages, forwarding the upstream page_token', async () => {
    proxyRequest.mockResolvedValueOnce(page([{ uid: 'vr-1' }], 'cursor-2')).mockResolvedValueOnce(page([{ uid: 'vr-2' }]));

    const rows = await fetchCurrentUserVoteResponses(req, proxy);

    expect(rows).toEqual([{ uid: 'vr-1' }, { uid: 'vr-2' }]);
    expect(proxyRequest).toHaveBeenNthCalledWith(2, req, 'LFX_V2_SERVICE', '/query/resources', 'GET', expect.objectContaining({ page_token: 'cursor-2' }));
  });

  it('fails closed on a later-page failure when failOnPartial is set', async () => {
    // Non-5xx error: fetchWithRetry only retries 5xx, so this surfaces on the first attempt.
    proxyRequest.mockResolvedValueOnce(page([{ uid: 'vr-1' }], 'cursor-2')).mockRejectedValueOnce(new Error('boom'));

    await expect(fetchCurrentUserVoteResponses(req, proxy, { failOnPartial: true })).rejects.toThrow('boom');
  });

  it('returns partial results on a later-page failure by default', async () => {
    proxyRequest.mockResolvedValueOnce(page([{ uid: 'vr-1' }], 'cursor-2')).mockRejectedValueOnce(new Error('boom'));

    await expect(fetchCurrentUserVoteResponses(req, proxy)).resolves.toEqual([{ uid: 'vr-1' }]);
  });
});
