// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The org-role-grants import graph reaches Angular's partially-compiled @angular/common through the shared logging
// chain, so the JIT compiler must be loaded before the module under test (as the other middleware specs do).
import '@angular/compiler';

import type { AccessCheckRequest } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveCdpAudience } from './cdp-audience.helper';

const checkAccessStrict = vi.fn();
let impersonating = false;

vi.mock('../services/access-check.service', () => ({
  AccessCheckService: class {
    public checkAccessStrict = (...args: unknown[]) => checkAccessStrict(...args);
  },
}));
vi.mock('../utils/auth-helper', () => ({ isImpersonating: () => impersonating }));
vi.mock('../services/logger.service', () => ({ logger: { warning: vi.fn(), debug: vi.fn(), info: vi.fn() } }));

const FLAG = 'LFX_ORG_LENS_CDP_GLOBAL_ORG_ADMINS';
const req = {} as Request;

/** The authorizer answering `team:<id>#member` for a caller who is a member of exactly `teams`. */
function memberOf(...teams: string[]): void {
  checkAccessStrict.mockImplementation(async (_req: Request, requests: AccessCheckRequest[]) => {
    return new Map(requests.map((request): [string, boolean] => [`${request.id}#${request.access}`, teams.includes(request.id)]));
  });
}

/** The team ids the one strict batch asked about. */
function askedTeams(): string[] {
  expect(checkAccessStrict).toHaveBeenCalledTimes(1);
  const requests = checkAccessStrict.mock.calls[0][1] as AccessCheckRequest[];
  expect(requests.every((request) => request.resource === 'team' && request.access === 'member')).toBe(true);
  return requests.map((request) => request.id);
}

describe('resolveCdpAudience (spec 062 FR-010, FR-011, DR-044)', () => {
  beforeEach(() => {
    checkAccessStrict.mockReset();
    impersonating = false;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe.each([
    { flag: 'off', env: 'false', teams: ['lf-staff'] },
    { flag: 'on', env: 'true', teams: ['lf-staff', 'global_org_admin'] },
  ])('global org admins switch $flag', ({ env, teams }) => {
    beforeEach(() => {
      vi.stubEnv(FLAG, env);
    });

    it('asks about exactly the audience teams, in one strict batch', async () => {
      memberOf();
      await resolveCdpAudience(req);
      expect(askedTeams()).toEqual(teams);
    });

    it('admits an lf-staff member with the lf-staff answer kept for Meetings and Groups', async () => {
      memberOf('lf-staff');
      await expect(resolveCdpAudience(req)).resolves.toEqual({ status: 'in', lfStaff: true });
    });

    it('keeps a global-org-auditors member out', async () => {
      memberOf('global-org-auditors');
      await expect(resolveCdpAudience(req)).resolves.toEqual({ status: 'out', lfStaff: false });
    });

    it('keeps a member of no audience team out', async () => {
      memberOf('some-other-team');
      await expect(resolveCdpAudience(req)).resolves.toEqual({ status: 'out', lfStaff: false });
    });

    it('refuses a session acting as another user before any check, even when that user is lf-staff', async () => {
      memberOf('lf-staff');
      impersonating = true;
      await expect(resolveCdpAudience(req)).resolves.toEqual({ status: 'out', lfStaff: false });
      expect(checkAccessStrict).not.toHaveBeenCalled();
    });

    it('answers unverifiable, never out or in, when the authorizer fails', async () => {
      checkAccessStrict.mockRejectedValue(new Error('authorizer unavailable'));
      await expect(resolveCdpAudience(req)).resolves.toEqual({ status: 'unverifiable', lfStaff: false });
    });
  });

  it('keeps a global_org_admin member out while the switch is off', async () => {
    vi.stubEnv(FLAG, 'false');
    memberOf('global_org_admin');
    await expect(resolveCdpAudience(req)).resolves.toEqual({ status: 'out', lfStaff: false });
  });

  it('admits a global_org_admin member while the switch is on, without the lf-staff answer', async () => {
    vi.stubEnv(FLAG, 'true');
    memberOf('global_org_admin');
    await expect(resolveCdpAudience(req)).resolves.toEqual({ status: 'in', lfStaff: false });
  });
});
