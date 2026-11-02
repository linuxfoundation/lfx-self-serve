// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The controller imports the shared `utils` barrel, which statically pulls in `@angular/forms`; under
// vitest's plain Node runtime that needs the JIT compiler loaded first.
import '@angular/compiler';

import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { searchUsers, resolveImpersonatorToken, decodeJwtPayload } = vi.hoisted(() => ({
  searchUsers: vi.fn(),
  resolveImpersonatorToken: vi.fn(),
  decodeJwtPayload: vi.fn(),
}));

vi.mock('../utils/impersonator-token', () => ({ resolveImpersonatorToken }));
vi.mock('../utils/auth-helper', () => ({ decodeJwtPayload }));

vi.mock('../services/search.service', () => ({
  SearchService: class {
    public searchUsers = searchUsers;
  },
}));
vi.mock('../services/cdp.service', () => ({ CdpService: class {} }));
vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import { ServiceValidationError } from '../errors';
import { SearchController } from './search.controller';

function buildReq(query: Record<string, unknown>): Request {
  return { query, path: '/search/users' } as unknown as Request;
}

function buildRes(): Response {
  return { json: vi.fn() } as unknown as Response;
}

describe('SearchController.searchUsers — tags', () => {
  let controller: SearchController;

  beforeEach(() => {
    vi.clearAllMocks();
    searchUsers.mockResolvedValue({ results: [], total: 0 });
    controller = new SearchController();
  });

  it('forwards an exact email tag lookup for committee members', async () => {
    const res = buildRes();
    const next = vi.fn() as NextFunction;

    await controller.searchUsers(buildReq({ type: 'committee_member', tags: 'email:kim.park@partner-corp.example' }), res, next);

    expect(searchUsers).toHaveBeenCalledWith(expect.anything(), { tags: 'email:kim.park@partner-corp.example', type: 'committee_member' }, undefined);
    expect(res.json).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it.each([
    ['a committee_uid tag', 'committee_uid:committee-1'],
    ['a project tag', 'project_uid:project-1'],
    ['an email tag smuggling a second value', 'email:a@partner-corp.example,committee_uid:committee-1'],
  ])('rejects %s on a committee-member search without querying upstream', async (_label, tags) => {
    const res = buildRes();
    const next = vi.fn();

    await controller.searchUsers(buildReq({ type: 'committee_member', tags }), res, next);

    expect(searchUsers).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
  });

  it('rejects a repeated tags param alongside a name', async () => {
    const res = buildRes();
    const next = vi.fn();

    await controller.searchUsers(
      buildReq({ type: 'committee_member', name: 'kim', tags: ['email:a@partner-corp.example', 'committee_uid:committee-1'] }),
      res,
      next
    );

    expect(searchUsers).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
  });

  it('rejects a repeated name param alongside a valid email tag', async () => {
    const res = buildRes();
    const next = vi.fn();

    await controller.searchUsers(buildReq({ type: 'committee_member', name: ['kim', 'park'], tags: 'email:kim.park@partner-corp.example' }), res, next);

    expect(searchUsers).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.any(ServiceValidationError));
  });

  it('still forwards a name-only committee-member search', async () => {
    const res = buildRes();
    const next = vi.fn();

    await controller.searchUsers(buildReq({ type: 'committee_member', name: 'kim' }), res, next);

    expect(searchUsers).toHaveBeenCalledWith(expect.anything(), { name: 'kim', sort: 'best_match', type: 'committee_member' }, undefined);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('SearchController.searchUsersAsImpersonator', () => {
  let controller: SearchController;

  beforeEach(() => {
    vi.clearAllMocks();
    searchUsers.mockResolvedValue({ results: [], total: 0 });
    resolveImpersonatorToken.mockResolvedValue('real-admin-token');
    controller = new SearchController();
  });

  it("runs the search with the admin's own token, not the request's bearer token", async () => {
    const res = buildRes();
    const next = vi.fn();
    const req = { ...buildReq({ type: 'committee_member', name: 'kim' }), bearerToken: 'current-target-token' } as unknown as Request;

    await controller.searchUsersAsImpersonator(req, res, next);

    expect(resolveImpersonatorToken).toHaveBeenCalledWith(req, 'search_users');
    expect(searchUsers).toHaveBeenCalledWith(req, { name: 'kim', sort: 'best_match', type: 'committee_member' }, { bearerToken: 'real-admin-token' });
    expect(next).not.toHaveBeenCalled();
  });

  describe('self exclusion', () => {
    const row = (username: string, email: string) => ({
      uid: username,
      username,
      email,
      first_name: username,
      last_name: '',
      job_title: null,
      organization: null,
      type: 'committee_member',
    });

    beforeEach(() => {
      decodeJwtPayload.mockReturnValue({ 'http://lfx.dev/claims/username': 'admin', 'http://lfx.dev/claims/email': 'admin@example.com' });
      searchUsers.mockResolvedValue({ results: [row('admin', 'admin@example.com'), row('kim', 'kim@example.com')], total: 2 });
    });

    it('drops the signed-in admin from the results and the total', async () => {
      const res = buildRes();

      await controller.searchUsersAsImpersonator(buildReq({ type: 'committee_member', name: 'a' }), res, vi.fn());

      expect(res.json).toHaveBeenCalledWith({ results: [row('kim', 'kim@example.com')], total: 1 });
    });

    it('matches the admin by email when the row carries no username', async () => {
      searchUsers.mockResolvedValue({ results: [{ ...row('', 'ADMIN@example.com'), username: null }, row('kim', 'kim@example.com')], total: 2 });
      const res = buildRes();

      await controller.searchUsersAsImpersonator(buildReq({ type: 'committee_member', name: 'a' }), res, vi.fn());

      expect(res.json).toHaveBeenCalledWith({ results: [row('kim', 'kim@example.com')], total: 1 });
    });

    it('also drops the user currently being impersonated', async () => {
      const res = buildRes();
      const req = {
        ...buildReq({ type: 'committee_member', name: 'a' }),
        appSession: { impersonationUser: { username: 'kim', email: 'kim@example.com' } },
      } as unknown as Request;

      await controller.searchUsersAsImpersonator(req, res, vi.fn());

      expect(res.json).toHaveBeenCalledWith({ results: [], total: 0 });
    });

    it('leaves the plain route unfiltered', async () => {
      const res = buildRes();

      await controller.searchUsers(buildReq({ type: 'committee_member', name: 'a' }), res, vi.fn());

      expect(res.json).toHaveBeenCalledWith({ results: [row('admin', 'admin@example.com'), row('kim', 'kim@example.com')], total: 2 });
    });
  });

  it('does not search when the caller cannot impersonate', async () => {
    const denied = new Error('Insufficient permissions to impersonate users');
    resolveImpersonatorToken.mockRejectedValue(denied);
    const res = buildRes();
    const next = vi.fn();

    await controller.searchUsersAsImpersonator(buildReq({ type: 'committee_member', name: 'kim' }), res, next);

    expect(searchUsers).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(denied);
  });

  it('leaves the plain route on the request token', async () => {
    await controller.searchUsers(buildReq({ type: 'committee_member', name: 'kim' }), buildRes(), vi.fn());

    expect(resolveImpersonatorToken).not.toHaveBeenCalled();
  });
});
