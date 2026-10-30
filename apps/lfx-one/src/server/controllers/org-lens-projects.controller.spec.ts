// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getProjects, logger } = vi.hoisted(() => ({
  getProjects: vi.fn(),
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

// validation.helper imports `@lfx-one/shared/utils`, whose barrel pulls Angular; see validation.helper.spec.ts.
// The real parsers stand in for the barrel (vi.mock factories are hoisted, so the modules load dynamically).
vi.mock('@lfx-one/shared/utils', async () => ({
  ...(await import('../../../../../packages/shared/src/utils/org-commit-filters.utils')),
  ...(await import('../../../../../packages/shared/src/utils/org-lens-time-range.utils')),
  ...(await import('../../../../../packages/shared/src/utils/org-team-members.utils')),
  ...(await import('../../../../../packages/shared/src/utils/org-scope.utils')),
}));
vi.mock('../services/org-lens-projects.service', () => ({
  OrgLensProjectsService: class {
    public getProjects = getProjects;
  },
}));
vi.mock('../services/org-role-grants.service', () => ({ OrgRoleGrantsService: class {} }));
vi.mock('../services/logger.service', () => ({ logger }));

import { ServiceValidationError } from '../errors';
import { OrgLensProjectsController } from './org-lens-projects.controller';

const ORG_UID = '001410000000000AAA';

function buildReq(query: Record<string, unknown>): Request {
  return { params: { orgUid: ORG_UID }, query, path: '/test' } as unknown as Request;
}

function buildRes(): Response {
  return { setHeader: vi.fn(), json: vi.fn() } as unknown as Response;
}

describe('OrgLensProjectsController organization scope (lfx-self-serve-ops#1219)', () => {
  const controller = new OrgLensProjectsController();

  beforeEach(() => {
    vi.clearAllMocks();
    getProjects.mockResolvedValue({ orgSlug: 'acme', orgName: 'Acme', dataUpdatedAt: '2026-10-30T00:00:00Z', projects: [] });
  });

  it.each([
    [{}, 'insights'],
    [{ orgScope: 'all' }, 'all'],
    [{ orgScope: 'insights' }, 'insights'],
  ])('passes the scope of %o to the service as %s', async (query, expected) => {
    const next = vi.fn();

    await controller.getProjects(buildReq({ orgName: 'Acme', slugs: 'k8s', ...query }), buildRes(), next);

    expect(next).not.toHaveBeenCalled();
    expect(getProjects).toHaveBeenCalledWith(ORG_UID, 'Acme', ['k8s'], expected);
  });

  it('rejects an unknown scope with a 400 before the service', async () => {
    const next = vi.fn();

    await controller.getProjects(buildReq({ orgScope: 'every' }), buildRes(), next);

    expect(getProjects).not.toHaveBeenCalled();
    expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 400 });
  });
});
