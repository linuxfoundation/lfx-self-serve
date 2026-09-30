// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveOrgLensEdit } from './org-lens-edit-access.helper';

const { getRoleGrants, hasEditorAccess, checkSingleAccessStrict, getEffectiveUsername } = vi.hoisted(() => ({
  getRoleGrants: vi.fn(),
  hasEditorAccess: vi.fn(),
  checkSingleAccessStrict: vi.fn(),
  getEffectiveUsername: vi.fn(),
}));

vi.mock('../services/org-role-grants.service', () => ({
  OrgRoleGrantsService: class {
    public static hasEditorAccess = hasEditorAccess;
    public getRoleGrants = getRoleGrants;
  },
}));
vi.mock('../services/access-check.service', () => ({
  AccessCheckService: class {
    public checkSingleAccessStrict = checkSingleAccessStrict;
  },
}));
vi.mock('../services/logger.service', () => ({ logger: { warning: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('../utils/auth-helper', () => ({ getEffectiveUsername }));

const req = {} as Request;
const ORG = '0014100000Te2QjAAJ';

beforeEach(() => {
  vi.clearAllMocks();
  getEffectiveUsername.mockReturnValue('caller');
  getRoleGrants.mockResolvedValue({ writers: [], cascadingWriters: [], degraded: false });
  hasEditorAccess.mockReturnValue(false);
  checkSingleAccessStrict.mockResolvedValue(false);
});

describe('resolveOrgLensEdit (#3136)', () => {
  it('allows a roster editor without asking the authorizer', async () => {
    hasEditorAccess.mockReturnValue(true);

    expect(await resolveOrgLensEdit(req, ORG, 'op')).toEqual({ kind: 'allowed' });
    expect(checkSingleAccessStrict).not.toHaveBeenCalled();
  });

  it('allows a company-wide writer the roster does not list, by asking for writer (not auditor) on the org', async () => {
    checkSingleAccessStrict.mockResolvedValue(true);

    expect(await resolveOrgLensEdit(req, ORG, 'op')).toEqual({ kind: 'allowed' });
    expect(checkSingleAccessStrict).toHaveBeenCalledWith(req, { resource: 'b2b_org', id: ORG, access: 'writer' });
  });

  it('denies a read-only caller: the authorizer answers no and the roster loaded cleanly', async () => {
    expect(await resolveOrgLensEdit(req, ORG, 'op')).toEqual({ kind: 'denied' });
  });

  it('reports an authorizer outage as unverifiable, never as denied', async () => {
    const failure = new Error('access-check down');
    checkSingleAccessStrict.mockRejectedValue(failure);

    expect(await resolveOrgLensEdit(req, ORG, 'op')).toEqual({ kind: 'unverifiable', path: '/access-check', error: failure });
  });

  it('lets the authorizer admit a caller even when the roster lookup fails', async () => {
    getRoleGrants.mockRejectedValue(new Error('query-service down'));
    checkSingleAccessStrict.mockResolvedValue(true);

    expect(await resolveOrgLensEdit(req, ORG, 'op')).toEqual({ kind: 'allowed' });
  });

  it('reports a failed roster as unverifiable when the authorizer answers no (the projection may lag the roster)', async () => {
    const failure = new Error('query-service down');
    getRoleGrants.mockRejectedValue(failure);

    expect(await resolveOrgLensEdit(req, ORG, 'op')).toEqual({ kind: 'unverifiable', path: '/query/resources', error: failure });
  });

  it('reports a degraded roster as unverifiable without naming an upstream', async () => {
    getRoleGrants.mockResolvedValue({ writers: [], cascadingWriters: [], degraded: true });

    expect(await resolveOrgLensEdit(req, ORG, 'op')).toEqual({ kind: 'unverifiable' });
  });

  it('denies a request with no caller identity without consulting anything', async () => {
    getEffectiveUsername.mockReturnValue(undefined);

    expect(await resolveOrgLensEdit(req, ORG, 'op')).toEqual({ kind: 'denied' });
    expect(getRoleGrants).not.toHaveBeenCalled();
    expect(checkSingleAccessStrict).not.toHaveBeenCalled();
  });
});
