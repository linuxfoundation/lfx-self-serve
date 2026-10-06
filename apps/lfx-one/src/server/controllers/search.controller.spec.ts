// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The controller imports the shared `utils` barrel, which statically pulls in `@angular/forms`; under
// vitest's plain Node runtime that needs the JIT compiler loaded first.
import '@angular/compiler';

import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { searchUsers } = vi.hoisted(() => ({ searchUsers: vi.fn() }));

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

    expect(searchUsers).toHaveBeenCalledWith(expect.anything(), { tags: 'email:kim.park@partner-corp.example', type: 'committee_member' });
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

    expect(searchUsers).toHaveBeenCalledWith(expect.anything(), { name: 'kim', sort: 'best_match', type: 'committee_member' });
    expect(next).not.toHaveBeenCalled();
  });
});
