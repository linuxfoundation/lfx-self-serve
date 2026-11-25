// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getProjects, getWorkspaces, getEmployeeViewWorkspaces, getOrgLensViewMode, redactWorkspacesForEmployeeView, logger } = vi.hoisted(() => ({
  getProjects: vi.fn(),
  getWorkspaces: vi.fn(),
  getEmployeeViewWorkspaces: vi.fn(),
  getOrgLensViewMode: vi.fn(() => 'full'),
  redactWorkspacesForEmployeeView: vi.fn((_req: unknown, _org: string, response: unknown) => response),
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
    public getWorkspaces = getWorkspaces;
    public getEmployeeViewWorkspaces = getEmployeeViewWorkspaces;
  },
}));
vi.mock('../services/org-role-grants.service', () => ({ OrgRoleGrantsService: class {} }));
vi.mock('../helpers/org-lens-read-access.helper', () => ({ getOrgLensViewMode }));
vi.mock('../helpers/org-lens-projects-employee-view.helper', () => ({
  redactProjectsForEmployeeView: (_req: unknown, _org: string, response: unknown) => response,
  redactWorkspacesForEmployeeView,
}));
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
    expect(getProjects).toHaveBeenCalledWith(ORG_UID, 'Acme', ['k8s'], expected, 'exclude');
  });

  it('rejects an unknown scope with a 400 before the service', async () => {
    const next = vi.fn();

    await controller.getProjects(buildReq({ orgScope: 'every' }), buildRes(), next);

    expect(getProjects).not.toHaveBeenCalled();
    expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 400 });
  });
});

describe('OrgLensProjectsController team members (lfx-self-serve-ops#1246)', () => {
  const controller = new OrgLensProjectsController();

  beforeEach(() => {
    vi.clearAllMocks();
    getProjects.mockResolvedValue({ orgSlug: 'acme', orgName: 'Acme', dataUpdatedAt: '2026-10-30T00:00:00Z', projects: [] });
  });

  it.each([
    [{}, 'exclude'],
    [{ teamMembers: 'exclude' }, 'exclude'],
    [{ teamMembers: 'include' }, 'include'],
  ])('passes the team members pick of %o to the service as %s', async (query, expected) => {
    const next = vi.fn();

    await controller.getProjects(buildReq({ orgName: 'Acme', slugs: 'k8s', ...query }), buildRes(), next);

    expect(next).not.toHaveBeenCalled();
    expect(getProjects).toHaveBeenCalledWith(ORG_UID, 'Acme', ['k8s'], 'insights', expected);
  });

  it('rejects an unknown team members pick with a 400 naming the field before the service', async () => {
    const next = vi.fn();

    await controller.getProjects(buildReq({ teamMembers: 'only' }), buildRes(), next);

    expect(getProjects).not.toHaveBeenCalled();
    expect(next.mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 400 });
    expect((next.mock.calls[0][0] as Error).message).toContain('teamMembers');
  });
});

describe('OrgLensProjectsController workspaces in the all employee view (epic #5845)', () => {
  const controller = new OrgLensProjectsController();
  const defaultWorkspace = { workspaces: [{ id: 'all-activities', name: 'All Activities', projectSlugs: ['k8s', 'envoy'] }] };

  beforeEach(() => {
    vi.clearAllMocks();
    getOrgLensViewMode.mockReturnValue('full');
  });

  it('serves a grantless employee the company-derived default workspace and never reads or seeds the workspace store', async () => {
    getOrgLensViewMode.mockReturnValue('employee');
    getEmployeeViewWorkspaces.mockResolvedValue(defaultWorkspace);
    const res = buildRes();
    const next = vi.fn();

    await controller.getWorkspaces(buildReq({}), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(getEmployeeViewWorkspaces).toHaveBeenCalledWith(ORG_UID);
    expect(getWorkspaces).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(defaultWorkspace);
  });

  it('leaves the full view on the workspace store', async () => {
    getWorkspaces.mockResolvedValue({ workspaces: [] });

    await controller.getWorkspaces(buildReq({}), buildRes(), vi.fn());

    expect(getWorkspaces).toHaveBeenCalled();
    expect(getEmployeeViewWorkspaces).not.toHaveBeenCalled();
  });
});
