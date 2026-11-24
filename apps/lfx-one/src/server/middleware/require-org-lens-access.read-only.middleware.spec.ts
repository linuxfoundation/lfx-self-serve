// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ assertOrgLensRead: vi.fn(), getOrgLensViewMode: vi.fn(), resolveOrgLensRollUp: vi.fn() }));

vi.mock('../helpers/org-lens-read-access.helper', () => ({ assertOrgLensRead: mocks.assertOrgLensRead, getOrgLensViewMode: mocks.getOrgLensViewMode }));
vi.mock('../helpers/org-lens-roll-up.helper', () => ({ resolveOrgLensRollUp: mocks.resolveOrgLensRollUp }));

const { requireOrgLensAccess } = await import('./require-org-lens-access.middleware');

const ORG_UID = '0016100000ACMEAAA1';

const run = async (method: string, orgUid = ORG_UID, path = '/read-check') => {
  const next = vi.fn();
  await requireOrgLensAccess({ params: { orgUid }, method, path } as unknown as Request, {} as Response, next);
  return next;
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.assertOrgLensRead.mockResolvedValue('org-grant');
  mocks.getOrgLensViewMode.mockReturnValue('full');
});

describe('requireOrgLensAccess: the all employee view is read-only', () => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('answers 403 EMPLOYEE_VIEW_FORBIDDEN to %s in the employee view', async (method) => {
    mocks.assertOrgLensRead.mockResolvedValue('employee-view');
    mocks.getOrgLensViewMode.mockReturnValue('employee');

    const next = await run(method);

    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 403, code: 'EMPLOYEE_VIEW_FORBIDDEN' });
  });

  it.each(['GET', 'HEAD'])('lets %s through in the employee view', async (method) => {
    mocks.assertOrgLensRead.mockResolvedValue('employee-view');
    mocks.getOrgLensViewMode.mockReturnValue('employee');

    expect(await run(method)).toHaveBeenCalledWith();
  });

  it.each(['/people/all', '/memberships/active', '/events/abc/attendees'])('refuses %s to the employee view unless the path is approved', async (path) => {
    mocks.assertOrgLensRead.mockResolvedValue('employee-view');
    mocks.getOrgLensViewMode.mockReturnValue('employee');

    const next = await run('GET', ORG_UID, path);

    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 403, code: 'EMPLOYEE_VIEW_FORBIDDEN' });
  });

  it.each(['/READ-CHECK', '/Org-Scope/'])('matches the approved path %s the way Express routes it, ignoring case', async (path) => {
    mocks.assertOrgLensRead.mockResolvedValue('employee-view');
    mocks.getOrgLensViewMode.mockReturnValue('employee');

    expect(await run('GET', ORG_UID, path)).toHaveBeenCalledWith();
  });

  it('does not restrict paths for a grant holder', async () => {
    expect(await run('GET', ORG_UID, '/people/all')).toHaveBeenCalledWith();
  });

  it('lets a grant holder write', async () => {
    expect(await run('POST')).toHaveBeenCalledWith();
  });

  it('passes the gate refusal through unchanged', async () => {
    const refusal = Object.assign(new Error('nope'), { statusCode: 403 });
    mocks.assertOrgLensRead.mockRejectedValue(refusal);

    expect((await run('GET')).mock.calls[0][0]).toBe(refusal);
  });
});
