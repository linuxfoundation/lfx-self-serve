// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Same reason as require-executive-director.middleware.spec.ts: the import graph transitively
// reaches Angular's partially-compiled @angular/common, which needs the JIT compiler under vitest.
import '@angular/compiler';

import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAccessAwareOrgs = vi.fn();
const getEffectiveUsername = vi.fn();

// The middleware delegates to `assertOrgLensRead`, so these mocks target what that helper consumes —
// the tests therefore exercise the real gate logic, not a reimplementation of it.
vi.mock('../services/org-role-grants.service', () => ({
  OrgRoleGrantsService: class {
    public getAccessAwareOrgs = getAccessAwareOrgs;
  },
}));
vi.mock('../utils/auth-helper', () => ({ getEffectiveUsername: () => getEffectiveUsername() }));
// Deny paths log before rejecting; the real logger expects a fuller request object than these stubs
// carry, and would otherwise throw into the catch and turn a 403 into a 500.
vi.mock('../services/logger.service', () => ({
  logger: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { requireOrgLensAccess } = await import('./require-org-lens-access.middleware');

const LF = '0014100000Te2ovAAB';
const RED_HAT = '0014100000Te2QjAAJ';

function grants(uids: string[], upstreamFailed = false): { resolved: Map<string, unknown>; upstreamFailed: boolean } {
  return { resolved: new Map(uids.map((uid) => [uid, { roleSource: 'direct-writer' }])), upstreamFailed };
}

function buildReq(orgUid: string): Request {
  return { path: `/api/orgs/${orgUid}/lens/people/all`, params: { orgUid } } as unknown as Request;
}

async function run(orgUid: string): Promise<{ next: ReturnType<typeof vi.fn> }> {
  const next = vi.fn() as unknown as NextFunction & ReturnType<typeof vi.fn>;
  await requireOrgLensAccess(buildReq(orgUid), {} as Response, next);
  return { next };
}

/** Allow = next() with no argument; deny = next(error). */
function statusOf(next: ReturnType<typeof vi.fn>): number | 'allow' {
  expect(next).toHaveBeenCalledTimes(1);
  const arg = next.mock.calls[0][0];
  if (arg === undefined) return 'allow';
  return (arg as { statusCode?: number }).statusCode ?? 500;
}

beforeEach(() => {
  vi.clearAllMocks();
  getEffectiveUsername.mockReturnValue('lguerra');
  getAccessAwareOrgs.mockResolvedValue(grants([LF]));
});

describe('requireOrgLensAccess', () => {
  it('allows a caller holding a relation on the requested organization', async () => {
    const { next } = await run(LF);
    expect(statusOf(next)).toBe('allow');
  });

  it('refuses an organization the caller holds no relation on (the reported exposure)', async () => {
    // Before this middleware existed, this request returned 3,519 rows of another org's people.
    const { next } = await run(RED_HAT);
    expect(statusOf(next)).toBe(403);
  });

  it('allows a cascading (inherited) grant, not only a direct one', async () => {
    getAccessAwareOrgs.mockResolvedValue({
      resolved: new Map([[RED_HAT, { roleSource: 'inherited-auditor', parentUid: LF, parentName: 'LF' }]]),
      upstreamFailed: false,
    });

    const { next } = await run(RED_HAT);

    expect(statusOf(next)).toBe('allow');
  });

  it('allows a direct auditor', async () => {
    getAccessAwareOrgs.mockResolvedValue({ resolved: new Map([[LF, { roleSource: 'direct-auditor' }]]), upstreamFailed: false });

    const { next } = await run(LF);

    expect(statusOf(next)).toBe('allow');
  });

  it('returns a retriable 503 when the grants lookup fails, rather than claiming no permission', async () => {
    getAccessAwareOrgs.mockResolvedValue(grants([], true));

    const { next } = await run(LF);

    expect(statusOf(next)).toBe(503);
  });

  it('does not fall open when the grants lookup fails for an org the caller could otherwise read', async () => {
    getAccessAwareOrgs.mockResolvedValue({ resolved: new Map([[LF, { roleSource: 'direct-writer' }]]), upstreamFailed: true });

    const { next } = await run(LF);

    expect(statusOf(next)).toBe(503);
  });

  it('refuses when no caller identity can be resolved', async () => {
    getEffectiveUsername.mockReturnValue(undefined);

    const { next } = await run(LF);

    expect(statusOf(next)).toBe(403);
    expect(getAccessAwareOrgs).not.toHaveBeenCalled();
  });

  it('refuses when the route carries no organization id', async () => {
    const next = vi.fn() as unknown as NextFunction & ReturnType<typeof vi.fn>;
    await requireOrgLensAccess({ path: '/api/orgs//lens/people/all', params: {} } as unknown as Request, {} as Response, next);

    expect(statusOf(next)).toBe(403);
  });

  it('propagates an unexpected error rather than silently allowing', async () => {
    getAccessAwareOrgs.mockRejectedValue(new Error('boom'));

    const { next } = await run(LF);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
  });
});
