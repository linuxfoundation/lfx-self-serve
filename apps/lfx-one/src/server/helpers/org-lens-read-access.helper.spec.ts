// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAccessAwareOrgs: vi.fn(),
  checkSingleAccessStrict: vi.fn(),
  resolveEmployeeView: vi.fn(),
  getEffectiveUsername: vi.fn(() => 'employee'),
  isImpersonating: vi.fn(() => false),
}));

vi.mock('../services/org-role-grants.service', () => ({
  OrgRoleGrantsService: class {
    public getAccessAwareOrgs = mocks.getAccessAwareOrgs;
  },
}));
vi.mock('../services/access-check.service', () => ({
  AccessCheckService: class {
    public checkSingleAccessStrict = mocks.checkSingleAccessStrict;
  },
}));
vi.mock('../services/org-employee-view.service', () => ({
  OrgEmployeeViewService: class {
    public resolve = mocks.resolveEmployeeView;
  },
}));
vi.mock('../services/logger.service', () => ({ logger: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../utils/auth-helper', () => ({ getEffectiveUsername: () => mocks.getEffectiveUsername(), isImpersonating: () => mocks.isImpersonating() }));

const { assertOrgLensRead, getOrgLensViewMode, resolveOrgLensViewMode } = await import('./org-lens-read-access.helper');

const ORG_UID = '0016100000ACMEAAA1';
const FLAG = 'LFX_ORG_LENS_EMPLOYEE_VIEW_ENABLED';
const IMPERSONATION_ONLY_FLAG = 'LFX_ORG_LENS_EMPLOYEE_VIEW_IMPERSONATION_ONLY';

const req = (): Request => ({ path: '/api/orgs/x/lens/overview' }) as unknown as Request;
const roster = (over: Record<string, unknown> = {}) => ({ resolved: new Map(), upstreamFailed: false, degraded: false, ...over });
const eligible = { eligible: true, org: { orgUid: ORG_UID, orgName: 'Acme Motors' } };

beforeEach(() => {
  vi.clearAllMocks();
  process.env[FLAG] = 'true';
  delete process.env[IMPERSONATION_ONLY_FLAG];
  mocks.isImpersonating.mockReturnValue(false);
  mocks.getEffectiveUsername.mockReturnValue('employee');
  mocks.getAccessAwareOrgs.mockResolvedValue(roster());
  mocks.checkSingleAccessStrict.mockResolvedValue(false);
  mocks.resolveEmployeeView.mockResolvedValue({ eligible: false, reason: 'no-verified-company-email' });
});

describe('assertOrgLensRead: employee-view qualification', () => {
  it('admits a caller who holds nothing but qualifies as an employee, in the employee mode', async () => {
    mocks.resolveEmployeeView.mockResolvedValue(eligible);
    const r = req();

    await expect(assertOrgLensRead(r, ORG_UID, 'op')).resolves.toBe('employee-view');
    expect(getOrgLensViewMode(r, ORG_UID)).toBe('employee');
    expect(mocks.resolveEmployeeView).toHaveBeenCalledWith(r, ORG_UID);
  });

  it.each([
    ['no verified company email', { eligible: false, reason: 'no-verified-company-email' }],
    ['an email on a non-member or other company domain', { eligible: false, reason: 'no-verified-company-email' }],
    ['a different company than the one their email names', { eligible: false, reason: 'other-company' }],
  ])('refuses with 403 for %s', async (_label, verdict) => {
    mocks.resolveEmployeeView.mockResolvedValue(verdict);

    await expect(assertOrgLensRead(req(), ORG_UID, 'op')).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
  });

  it('answers 503, not 403, when the lookup cannot be completed', async () => {
    mocks.resolveEmployeeView.mockRejectedValue(new Error('cdp down'));

    await expect(assertOrgLensRead(req(), ORG_UID, 'op')).rejects.toMatchObject({ statusCode: 503, code: 'ROLE_GRANTS_UNAVAILABLE' });
  });

  it('leaves an existing grant holder on the full view and never asks about employment', async () => {
    mocks.getAccessAwareOrgs.mockResolvedValue(roster({ resolved: new Map([[ORG_UID, 'direct-auditor']]) }));
    const r = req();

    await expect(assertOrgLensRead(r, ORG_UID, 'op')).resolves.toBe('org-grant');
    expect(getOrgLensViewMode(r, ORG_UID)).toBe('full');
    expect(mocks.resolveEmployeeView).not.toHaveBeenCalled();
  });

  it('leaves LF staff (authorizer entitlement) on the full view and never asks about employment', async () => {
    mocks.checkSingleAccessStrict.mockResolvedValue(true);
    const r = req();

    await expect(assertOrgLensRead(r, ORG_UID, 'op')).resolves.toBe('auditor-entitlement');
    expect(getOrgLensViewMode(r, ORG_UID)).toBe('full');
    expect(mocks.resolveEmployeeView).not.toHaveBeenCalled();
  });

  it.each([
    ['a caller who holds a grant on another company', { resolved: new Map([['0016100000OTHERAAA1', { roleSource: 'direct-writer' }]]) }],
    ['LF staff', { isStaff: true }],
  ])('does not try the employee view for %s', async (_label, over) => {
    mocks.getAccessAwareOrgs.mockResolvedValue(roster(over));
    mocks.resolveEmployeeView.mockResolvedValue(eligible);

    await expect(assertOrgLensRead(req(), ORG_UID, 'op')).rejects.toMatchObject({ statusCode: 403 });
    expect(mocks.resolveEmployeeView).not.toHaveBeenCalled();
  });

  it('answers a retriable 503, not a 403, when the staff check failed and the employee view is on', async () => {
    mocks.getAccessAwareOrgs.mockResolvedValue(roster({ staffCheck: 'failed' }));
    mocks.resolveEmployeeView.mockResolvedValue(eligible);

    await expect(assertOrgLensRead(req(), ORG_UID, 'op')).rejects.toMatchObject({ statusCode: 503, code: 'ROLE_GRANTS_UNAVAILABLE' });
    expect(mocks.resolveEmployeeView).not.toHaveBeenCalled();
  });

  it('does not try the employee view when the roster could not be verified: still a 503', async () => {
    mocks.getAccessAwareOrgs.mockResolvedValue(roster({ upstreamFailed: true }));
    mocks.resolveEmployeeView.mockResolvedValue(eligible);

    await expect(assertOrgLensRead(req(), ORG_UID, 'op')).rejects.toMatchObject({ statusCode: 503 });
    expect(mocks.resolveEmployeeView).not.toHaveBeenCalled();
  });

  it('does not try the employee view for a roll-up check, which shares a roster', async () => {
    mocks.resolveEmployeeView.mockResolvedValue(eligible);

    await expect(assertOrgLensRead(req(), ORG_UID, 'op', Promise.resolve(roster() as never))).rejects.toMatchObject({ statusCode: 403 });
    expect(mocks.resolveEmployeeView).not.toHaveBeenCalled();
  });

  it('is off by default: a caller with no grant is refused without any extra lookup', async () => {
    process.env[FLAG] = '';
    mocks.resolveEmployeeView.mockResolvedValue(eligible);

    await expect(assertOrgLensRead(req(), ORG_UID, 'op')).rejects.toMatchObject({ statusCode: 403 });
    expect(mocks.resolveEmployeeView).not.toHaveBeenCalled();
  });

  describe('staff preview (impersonation-only)', () => {
    beforeEach(() => {
      process.env[FLAG] = '';
      process.env[IMPERSONATION_ONLY_FLAG] = 'true';
      mocks.resolveEmployeeView.mockResolvedValue(eligible);
    });

    it('admits an employee only while staff impersonate them, in the employee mode', async () => {
      mocks.isImpersonating.mockReturnValue(true);
      const r = req();

      await expect(assertOrgLensRead(r, ORG_UID, 'op')).resolves.toBe('employee-view');
      expect(getOrgLensViewMode(r, ORG_UID)).toBe('employee');
    });

    it('refuses a real employee who is not being impersonated, with no employment lookup', async () => {
      await expect(assertOrgLensRead(req(), ORG_UID, 'op')).rejects.toMatchObject({ statusCode: 403 });
      expect(mocks.resolveEmployeeView).not.toHaveBeenCalled();
    });

    it('still refuses an impersonated target who is not eligible', async () => {
      mocks.isImpersonating.mockReturnValue(true);
      mocks.resolveEmployeeView.mockResolvedValue({ eligible: false, reason: 'no-verified-company-email' });

      await expect(assertOrgLensRead(req(), ORG_UID, 'op')).rejects.toMatchObject({ statusCode: 403 });
    });
  });

  it('resolves for the effective user: an impersonated session is judged as the target, and a missing identity is refused', async () => {
    mocks.getEffectiveUsername.mockReturnValue(null as never);

    await expect(assertOrgLensRead(req(), ORG_UID, 'op')).rejects.toMatchObject({ statusCode: 403 });
    expect(mocks.getAccessAwareOrgs).not.toHaveBeenCalled();
  });

  it('memoizes per request, so one request makes one employment lookup', async () => {
    mocks.resolveEmployeeView.mockResolvedValue(eligible);
    const r = req();

    await Promise.all([assertOrgLensRead(r, ORG_UID, 'op'), assertOrgLensRead(r, ORG_UID, 'op'), resolveOrgLensViewMode(r, ORG_UID, 'op')]);

    expect(mocks.resolveEmployeeView).toHaveBeenCalledTimes(1);
  });
});

describe('getOrgLensViewMode', () => {
  it('fails closed to the employee mode before the gate has resolved', () => {
    expect(getOrgLensViewMode(req(), ORG_UID)).toBe('employee');
  });

  it('answers the full view for a roll-up segment, which only grant holders reach', () => {
    expect(getOrgLensViewMode(req(), 'family-0016100000ACMEAAA1')).toBe('full');
  });

  it('resolveOrgLensViewMode runs the gate and rethrows its refusal', async () => {
    await expect(resolveOrgLensViewMode(req(), ORG_UID, 'op')).rejects.toMatchObject({ statusCode: 403 });
  });
});
