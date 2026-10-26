// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import type { RoleGrantsResponse } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getEffectiveUsername } = vi.hoisted(() => ({ getEffectiveUsername: vi.fn(() => 'employee') }));

vi.mock('../utils/auth-helper', () => ({ getEffectiveUsername: () => getEffectiveUsername() }));
vi.mock('./logger.service', () => ({ logger: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const { OrgAffiliationService } = await import('./org-affiliation.service');
const { ORG_AFFILIATION_LOOKUP_TIMEOUT_MS } = await import('@lfx-one/shared/constants');

const CDEV_ORG = '0b7d6b1e-6a2f-4a1f-9c66-9d9a0f0d1234';

const req = (): Request => ({ path: '/api/orgs/me/role-grants' }) as unknown as Request;

/** A caller who holds nothing on a clean roster — the only shape that reaches the lookup. */
function grants(overrides: Partial<RoleGrantsResponse> = {}): RoleGrantsResponse {
  return {
    writers: [],
    auditors: [],
    cascadingWriters: [],
    cascadingAuditors: [],
    username: 'employee',
    loaded_at: '2026-10-26T00:00:00.000Z',
    isStaff: false,
    degraded: false,
    lookupOutcome: 'ok',
    staffCheck: 'ok',
    ...overrides,
  };
}

function experience(organizationId: string | undefined, endDate?: string) {
  return [{ id: 'we-1', organization: 'Acme Motors', organizationId, jobTitle: 'Engineer', startDate: 'Jan 2024', endDate, source: 'cdp-enriched' as const }];
}

function service(opts: { experiences?: unknown; account?: unknown } = {}) {
  const cdp = {
    // The read-only reader: it must never be the member-creating `getWorkExperiencesForUser`.
    getWorkExperiencesForKnownUser: vi.fn().mockImplementation(() => {
      if (opts.experiences instanceof Error) return Promise.reject(opts.experiences);
      // A promise passed through as-is lets a test supply one that never settles.
      if (opts.experiences instanceof Promise) return opts.experiences;
      return Promise.resolve(opts.experiences ?? []);
    }),
    getWorkExperiencesForUser: vi.fn(),
  };
  const organizations = {
    getOrgLensAccountContextByCdevOrgId: vi
      .fn()
      .mockImplementation(() => (opts.account instanceof Error ? Promise.reject(opts.account) : Promise.resolve(opts.account ?? null))),
  };
  return { svc: new OrgAffiliationService(cdp as never, organizations as never), cdp, organizations };
}

beforeEach(() => {
  vi.clearAllMocks();
  getEffectiveUsername.mockReturnValue('employee');
});

describe('OrgAffiliationService.getRoleGrantAffiliation', () => {
  it('reports a member employer, which is what distinguishes "never granted" from "no organization"', async () => {
    const { svc, organizations } = service({ experiences: experience(CDEV_ORG), account: { isMember: true } });

    await expect(svc.getRoleGrantAffiliation(req(), grants())).resolves.toEqual({
      affiliation: { hasEmployer: true, employerIsMember: true, lookup: 'ok' },
    });
    expect(organizations.getOrgLensAccountContextByCdevOrgId).toHaveBeenCalledWith(CDEV_ORG);
  });

  it('reports a non-member employer as an answer, not an outage', async () => {
    const { svc } = service({ experiences: experience(CDEV_ORG), account: { isMember: false } });

    await expect(svc.getRoleGrantAffiliation(req(), grants())).resolves.toEqual({
      affiliation: { hasEmployer: true, employerIsMember: false, lookup: 'ok' },
    });
  });

  it('treats an employer unknown to LFX as not a member rather than unresolved', async () => {
    const { svc } = service({ experiences: experience(CDEV_ORG), account: null });

    await expect(svc.getRoleGrantAffiliation(req(), grants())).resolves.toEqual({
      affiliation: { hasEmployer: true, employerIsMember: false, lookup: 'ok' },
    });
  });

  it('reports no employer for an empty work history', async () => {
    const { svc, organizations } = service({ experiences: [] });

    await expect(svc.getRoleGrantAffiliation(req(), grants())).resolves.toEqual({
      affiliation: { hasEmployer: false, employerIsMember: false, lookup: 'ok' },
    });
    expect(organizations.getOrgLensAccountContextByCdevOrgId).not.toHaveBeenCalled();
  });

  it('reports an employer with no crowd.dev id as unresolved, since it may well be a member', async () => {
    const { svc } = service({ experiences: experience(undefined) });

    await expect(svc.getRoleGrantAffiliation(req(), grants())).resolves.toEqual({
      affiliation: { hasEmployer: true, employerIsMember: false, lookup: 'failed' },
    });
  });

  it("never throws: a CDP outage is reported as unresolved so the caller keeps today's copy", async () => {
    const { svc } = service({ experiences: new Error('cdp down') });

    await expect(svc.getRoleGrantAffiliation(req(), grants())).resolves.toEqual({
      affiliation: { hasEmployer: false, employerIsMember: false, lookup: 'failed' },
    });
  });

  // The employer was already in hand, so the outage must not log as "no affiliation" (PR #4318 review).
  it('never throws: a warehouse outage keeps the known employer and reports membership unresolved', async () => {
    const { svc } = service({ experiences: experience(CDEV_ORG), account: new Error('snowflake down') });

    await expect(svc.getRoleGrantAffiliation(req(), grants())).resolves.toEqual({
      affiliation: { hasEmployer: true, employerIsMember: false, lookup: 'failed' },
    });
  });

  // A job the caller has left is not an affiliation: the copy tells them to ask an administrator at
  // the company, which is no help to someone who no longer works there.
  it('ignores a former employer, even at a member company', async () => {
    const { svc, organizations } = service({ experiences: experience(CDEV_ORG, 'Mar 2025'), account: { isMember: true } });

    await expect(svc.getRoleGrantAffiliation(req(), grants())).resolves.toEqual({
      affiliation: { hasEmployer: false, employerIsMember: false, lookup: 'ok' },
    });
    expect(organizations.getOrgLensAccountContextByCdevOrgId).not.toHaveBeenCalled();
  });

  // `GET /api/orgs/me/role-grants` is a read: resolving through the member-creating reader would
  // write to CDP for exactly the no-grant callers this runs for (PR #4318 review).
  it('reads work history without creating a CDP member', async () => {
    const { svc, cdp } = service({ experiences: experience(CDEV_ORG), account: { isMember: true } });

    await svc.getRoleGrantAffiliation(req(), grants());

    expect(cdp.getWorkExperiencesForKnownUser).toHaveBeenCalledWith(expect.anything(), 'employee');
    expect(cdp.getWorkExperiencesForUser).not.toHaveBeenCalled();
  });
});

// Copilot (PR #4318): the enrichment rides a page-blocking request, so a stalled dependency must not
// hold the Org Lens page on its skeleton — it degrades to the unknown verdict and today's copy.
describe('OrgAffiliationService deadline', () => {
  it('gives up on a stalled lookup instead of holding the role-grants response', async () => {
    vi.useFakeTimers();
    try {
      // A dependency that never settles — the whole point of the budget.
      const { svc } = service({ experiences: new Promise(() => {}) });
      const pending = svc.getRoleGrantAffiliation(req(), grants());

      await vi.advanceTimersByTimeAsync(ORG_AFFILIATION_LOOKUP_TIMEOUT_MS + 1);

      await expect(pending).resolves.toEqual({
        affiliation: { hasEmployer: false, employerIsMember: false, lookup: 'failed' },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not fire the deadline for a lookup that answers in time', async () => {
    vi.useFakeTimers();
    try {
      const { svc } = service({ experiences: experience(CDEV_ORG), account: { isMember: true } });

      const verdict = await svc.getRoleGrantAffiliation(req(), grants());

      expect(verdict).toEqual({ affiliation: { hasEmployer: true, employerIsMember: true, lookup: 'ok' } });
      // The timer must be cleared, not left pending, or the process keeps a handle per request.
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('OrgAffiliationService gating — the question only arises for a caller who holds nothing', () => {
  it.each([
    ['a direct grant', grants({ writers: ['0014100000Te2ovAAB'] })],
    ['an inherited grant', grants({ cascadingAuditors: [{ uid: '0014100000Te2ovAAB', parentUid: 'p', parentName: 'P' }] })],
    ['company-wide team membership', grants({ isStaff: true })],
    ['a contractor, whose own state outranks this one', grants({ isContractor: true })],
    ['a partial roster, where zero grants proves nothing', grants({ lookupOutcome: 'partial' })],
    ['a failed staff check', grants({ staffCheck: 'failed' })],
  ])('asks nothing upstream for %s', async (_label, value) => {
    const { svc, cdp, organizations } = service({ experiences: experience(CDEV_ORG), account: { isMember: true } });

    await expect(svc.getRoleGrantAffiliation(req(), value)).resolves.toEqual({});
    expect(cdp.getWorkExperiencesForKnownUser).not.toHaveBeenCalled();
    expect(organizations.getOrgLensAccountContextByCdevOrgId).not.toHaveBeenCalled();
  });

  it('reports unresolved when no username is asserted', async () => {
    getEffectiveUsername.mockReturnValue('');
    const { svc, cdp } = service({ experiences: experience(CDEV_ORG), account: { isMember: true } });

    await expect(svc.getRoleGrantAffiliation(req(), grants())).resolves.toEqual({
      affiliation: { hasEmployer: false, employerIsMember: false, lookup: 'failed' },
    });
    expect(cdp.getWorkExperiencesForKnownUser).not.toHaveBeenCalled();
  });
});
