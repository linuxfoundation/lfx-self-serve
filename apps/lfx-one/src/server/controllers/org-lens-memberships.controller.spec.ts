// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Same reason as clas.controller.spec.ts: validation.helper's import graph transitively reaches
// Angular's partially-compiled @angular/common, which needs the JIT compiler under vitest.
import '@angular/compiler';

import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted so the vi.mock factories below can reference them.
const { getFoundationProjects } = vi.hoisted(() => ({ getFoundationProjects: vi.fn() }));

vi.mock('../services/org-lens-memberships.service', () => ({
  OrgLensMembershipsService: class {
    public getFoundationProjects = getFoundationProjects;
  },
}));
vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { OrgLensMembershipsController } = await import('./org-lens-memberships.controller');
const { ServiceValidationError } = await import('../errors');

const VALID_ORG_UID = '001ABCDEFGHIJKLMNO';

function makeRes(): Response {
  return { setHeader: vi.fn(), json: vi.fn() } as unknown as Response;
}

function makeReq(params: Record<string, string>): Request {
  return { params } as unknown as Request;
}

describe('OrgLensMembershipsController.getFoundationProjects', () => {
  beforeEach(() => {
    getFoundationProjects.mockReset();
    getFoundationProjects.mockResolvedValue({ accountId: VALID_ORG_UID, foundationId: 'cncf', projects: [] });
  });

  it('passes validated path params through to the service', async () => {
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    await new OrgLensMembershipsController().getFoundationProjects(makeReq({ orgUid: VALID_ORG_UID, foundationId: 'cncf' }), res, next);

    expect(getFoundationProjects).toHaveBeenCalledWith(VALID_ORG_UID, 'cncf');
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ accountId: VALID_ORG_UID, foundationId: 'cncf', projects: [] });
  });

  // The validator is the only thing between a request path value and the Snowflake bind and the
  // logs, so each rejected shape is pinned: a later refactor that drops the assert, or loosens
  // FOUNDATION_ID_PATTERN, has to fail here.
  it.each([
    ['a path traversal', '../x'],
    ['an encoded separator', 'a%2Fb'],
    ['an empty id', ''],
    ['an over-long id', 'a'.repeat(65)],
  ])('rejects %s as foundationId without calling the service', async (_label, foundationId) => {
    const next = vi.fn() as unknown as NextFunction;

    await new OrgLensMembershipsController().getFoundationProjects(makeReq({ orgUid: VALID_ORG_UID, foundationId }), makeRes(), next);

    expect(getFoundationProjects).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect(vi.mocked(next).mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
  });

  it('rejects a malformed orgUid without calling the service', async () => {
    const next = vi.fn() as unknown as NextFunction;

    await new OrgLensMembershipsController().getFoundationProjects(makeReq({ orgUid: 'not-an-sfid', foundationId: 'cncf' }), makeRes(), next);

    expect(getFoundationProjects).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect(vi.mocked(next).mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
  });
});
