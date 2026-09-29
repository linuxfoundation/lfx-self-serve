// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Unit tests for vote-response.helper.ts (GH #2985) — pins the exact `filters_or` identity
// shape My Votes proved out (email clause first, raw `user_email`, auth-prefix stripped from
// the username), the no-identity short-circuit, and the options passthrough. The REAL
// `fetchAllQueryResources` paginator runs against a mocked proxy so multi-page aggregation and
// `failOnPartial` forwarding are exercised end to end. All fixtures use synthetic placeholder
// identities — never real user data.

// The helper's `@lfx-one/shared/utils` barrel import transitively pulls in @angular/common
// (partially compiled); load the JIT compiler so those injectables resolve under vitest
// (mirrors user.service.spec.ts / auth.middleware.spec.ts).
import '@angular/compiler';

import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IndexedVoteResponse } from '@lfx-one/shared/interfaces';

const { getEffectiveEmail, getRawEffectiveEmail, getUsernameFromAuth } = vi.hoisted(() => ({
  getEffectiveEmail: vi.fn(),
  getRawEffectiveEmail: vi.fn(),
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
  // resolveUserIdentity composed from the mocked getters (the real one closes over the module's
  // unmocked bindings); the real stripAuthPrefix stays exercised through it.
  return {
    ...actual,
    getEffectiveEmail,
    getRawEffectiveEmail,
    getUsernameFromAuth,
    resolveUserIdentity: async (req: Request) => {
      const raw: string | null = await getUsernameFromAuth(req);
      return { email: getEffectiveEmail(req), username: raw ? actual.stripAuthPrefix(raw) : raw };
    },
  };
});

import type { MicroserviceProxyService } from '../services/microservice-proxy.service';
import { fetchCurrentUserVoteResponses, getParentVoteId } from './vote-response.helper';

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
    getRawEffectiveEmail.mockReturnValue(null);
    proxyRequest.mockResolvedValue(page([{ uid: 'vr-1', vote_uid: 'v-1', user_email: 'spec-user@example.org' }]));
  });

  it('matches on both identity clauses, email first (getMyVotes parity)', async () => {
    const rows = await fetchCurrentUserVoteResponses(req, proxy);

    expect(rows).toEqual([{ uid: 'vr-1', vote_uid: 'v-1', user_email: 'spec-user@example.org' }]);
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

  it('aggregates multiple pages, re-sending identity and scoping clauses with the page_token', async () => {
    const row1 = { uid: 'vr-1', user_email: 'spec-user@example.org' };
    const row2 = { uid: 'vr-2', username: 'spec-user' };
    proxyRequest.mockResolvedValueOnce(page([row1], 'cursor-2')).mockResolvedValueOnce(page([row2]));

    const rows = await fetchCurrentUserVoteResponses(req, proxy, { filters: ['project_uid:p1'] });

    expect(rows).toEqual([row1, row2]);
    // Page 2 must re-send the identity/scoping clauses alongside the cursor — dropping them
    // would return other users' or out-of-scope rows (the helper's key invariant).
    expect(proxyRequest).toHaveBeenNthCalledWith(
      2,
      req,
      'LFX_V2_SERVICE',
      '/query/resources',
      'GET',
      expect.objectContaining({ filters: ['project_uid:p1'], filters_or: ['user_email:spec-user@example.org', 'username:spec-user'], page_token: 'cursor-2' })
    );
  });

  it('sends the raw email casing as a second user_email clause when it differs from the lowercased one', async () => {
    // The query service matches filters_or with case-sensitive exact `term` clauses and the
    // index stores the invitee email as entered, so the lowercased value alone can miss a
    // mixed-case stored row (GH #2985) — the raw casing goes out as its own clause.
    getEffectiveEmail.mockReturnValue('spec.user@example.org');
    getRawEffectiveEmail.mockReturnValue('Spec.User@Example.org');

    await fetchCurrentUserVoteResponses(req, proxy);

    expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
      type: 'vote_response',
      filters_or: ['user_email:spec.user@example.org', 'user_email:Spec.User@Example.org', 'username:spec-user'],
    });
  });

  it('keeps a mixed-case stored row fetched via the raw-casing clause through the identity re-check', async () => {
    getEffectiveEmail.mockReturnValue('spec.user@example.org');
    getRawEffectiveEmail.mockReturnValue('Spec.User@Example.org');
    proxyRequest.mockResolvedValue(page([{ uid: 'vr-1', user_email: 'Spec.User@Example.org' }]));

    const rows = await fetchCurrentUserVoteResponses(req, proxy);

    expect(rows).toEqual([{ uid: 'vr-1', user_email: 'Spec.User@Example.org' }]);
  });

  it('omits the duplicate email clause when the raw casing already matches the lowercased one', async () => {
    getRawEffectiveEmail.mockReturnValue('spec-user@example.org');

    await fetchCurrentUserVoteResponses(req, proxy);

    expect(proxyRequest).toHaveBeenCalledWith(
      req,
      'LFX_V2_SERVICE',
      '/query/resources',
      'GET',
      expect.objectContaining({ filters_or: ['user_email:spec-user@example.org', 'username:spec-user'] })
    );
  });

  it('drops rows that fail the server-side identity re-check', async () => {
    // Defense in depth: the index's filters_or match semantics are upstream's contract, so every
    // row is re-checked against the resolved identity (email case-insensitively, username
    // case-sensitively).
    proxyRequest.mockResolvedValue(
      page([
        { uid: 'vr-1', user_email: 'SPEC-USER@example.org' },
        { uid: 'vr-2', username: 'spec-user' },
        { uid: 'vr-3', user_email: 'other-user@example.org' },
        { uid: 'vr-4' },
      ])
    );

    const rows = await fetchCurrentUserVoteResponses(req, proxy);

    expect(rows).toEqual([
      { uid: 'vr-1', user_email: 'SPEC-USER@example.org' },
      { uid: 'vr-2', username: 'spec-user' },
    ]);
  });

  it('drops a row whose stored username casing differs from the resolved one', async () => {
    // The re-check compares usernames case-sensitively: if upstream ever drifts to analyzed
    // (case-insensitive) matching, the exact compare fails closed — a case-differing username
    // row is dropped rather than risk merging distinct identities.
    proxyRequest.mockResolvedValue(page([{ uid: 'vr-1', username: 'Spec-User' }]));

    const rows = await fetchCurrentUserVoteResponses(req, proxy);

    expect(rows).toEqual([]);
  });

  it('fails closed on a later-page failure when failOnPartial is set', async () => {
    // Non-5xx error: fetchWithRetry only retries 5xx, so this surfaces on the first attempt.
    proxyRequest.mockResolvedValueOnce(page([{ uid: 'vr-1' }], 'cursor-2')).mockRejectedValueOnce(new Error('boom'));

    await expect(fetchCurrentUserVoteResponses(req, proxy, { failOnPartial: true })).rejects.toThrow('boom');
  });

  it('returns partial results on a later-page failure by default', async () => {
    proxyRequest.mockResolvedValueOnce(page([{ uid: 'vr-1', user_email: 'spec-user@example.org' }], 'cursor-2')).mockRejectedValueOnce(new Error('boom'));

    await expect(fetchCurrentUserVoteResponses(req, proxy)).resolves.toEqual([{ uid: 'vr-1', user_email: 'spec-user@example.org' }]);
  });
});

describe('getParentVoteId', () => {
  // The single parent-key rule shared by My Votes, Pending Actions, and the drawer read (GH
  // #2985): `vote_uid` wins when present (an empty string counts as absent), `poll_id` is the
  // v1 alias, `vote_id` is never a parent.
  it('prefers vote_uid when both parent keys are present', () => {
    expect(getParentVoteId({ vote_uid: 'v2-uid', poll_id: 'v1-poll', vote_id: 'v1-row' } as IndexedVoteResponse)).toBe('v2-uid');
  });

  it('falls back to poll_id for legacy rows carrying no vote_uid', () => {
    expect(getParentVoteId({ poll_id: 'v1-poll', vote_id: 'v1-row' } as IndexedVoteResponse)).toBe('v1-poll');
  });

  it('treats an empty-string vote_uid as absent, falling back to poll_id', () => {
    expect(getParentVoteId({ vote_uid: '', poll_id: 'v1-poll' } as IndexedVoteResponse)).toBe('v1-poll');
  });

  it('returns undefined when neither parent key is present — vote_id alone is not a parent key', () => {
    expect(getParentVoteId({ vote_id: 'v1-row' } as IndexedVoteResponse)).toBeUndefined();
  });
});
