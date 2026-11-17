// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_UID = '0016100000ACMEAAA1';

const mocks = vi.hoisted(() => ({
  flagEnabled: vi.fn(),
  resolveOrgLensViewMode: vi.fn(),
  getOrgLensViewMode: vi.fn(),
  getOrgDonations: vi.fn(),
  getMyInitiatives: vi.fn(),
  getInitiativesStats: vi.fn(),
}));

vi.mock('../helpers/server-feature-flag.helper', () => ({
  isServerFeatureEnabled: mocks.flagEnabled,
  ServerFeatureFlag: { OrgLensEmployeeView: 'org-lens-employee-view' },
}));
vi.mock('../helpers/org-lens-read-access.helper', () => ({
  resolveOrgLensViewMode: mocks.resolveOrgLensViewMode,
  getOrgLensViewMode: mocks.getOrgLensViewMode,
}));
vi.mock('../utils/auth-helper', () => ({ getUsernameFromAuth: vi.fn().mockResolvedValue('synthetic-user') }));
vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => Date.now()), success: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../services/crowdfunding.service', () => ({
  CrowdfundingService: class {
    public getOrgDonations = mocks.getOrgDonations;
    public getMyInitiatives = mocks.getMyInitiatives;
    public getInitiativesStats = mocks.getInitiativesStats;
  },
}));

const { CrowdfundingController } = await import('./crowdfunding.controller');

const donations = () => ({
  data: [
    {
      id: 'd1',
      recurring: false,
      initiativeName: 'Synthetic Fund',
      initiativeSlug: 'synthetic-fund',
      donorName: 'Synthetic Donor',
      donorEmail: 'donor@example.com',
      anonymous: false,
      amountCents: 2500,
      date: 1,
    },
  ],
  total: 1,
  pageSize: 20,
  offset: 0,
});

const initiatives = () => ({
  data: [
    { id: 'i1', slug: 'a', name: 'Company Fund', creator: 'Synthetic Owner', attribution: { type: 'organization', entityUid: ORG_UID, name: 'Acme' } },
    { id: 'i2', slug: 'b', name: 'Personal Fund', creator: 'Synthetic Owner', attribution: { type: 'personal', name: 'Synthetic Owner' } },
  ],
  total: 2,
  pageSize: 20,
  offset: 0,
});

const call = async (method: 'getOrgDonations' | 'getMyInitiatives' | 'getInitiativesStats', query: Record<string, string>) => {
  const res = { json: vi.fn() };
  const next = vi.fn();
  await new CrowdfundingController()[method]({ query } as unknown as Request, res as unknown as Response, next);
  return { res, next };
};

describe('CrowdfundingController all employee view (epic #5845)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getOrgDonations.mockResolvedValue(donations());
    mocks.getMyInitiatives.mockResolvedValue(initiatives());
    mocks.getInitiativesStats.mockResolvedValue({ activeCount: 1, totalRaised: 25, monthlyGain: 0, totalSponsors: 3 });
  });

  describe('org-donations', () => {
    it('removes donor names, emails and the anonymous flag in the employee view, keeping initiative, date and amount', async () => {
      mocks.flagEnabled.mockReturnValue(true);
      mocks.resolveOrgLensViewMode.mockResolvedValue('employee');
      mocks.getOrgLensViewMode.mockReturnValue('employee');

      const { res } = await call('getOrgDonations', { orgUid: ORG_UID });

      const body = res.json.mock.calls[0][0];
      expect(body.data[0]).toEqual({
        id: 'd1',
        recurring: false,
        initiativeName: 'Synthetic Fund',
        initiativeSlug: 'synthetic-fund',
        amountCents: 2500,
        date: 1,
      });
      expect(JSON.stringify(body)).not.toMatch(/Synthetic Donor|donor@example\.com/);
      expect(body.total).toBe(1);
    });

    it('is untouched in the full view', async () => {
      mocks.flagEnabled.mockReturnValue(true);
      mocks.resolveOrgLensViewMode.mockResolvedValue('full');
      mocks.getOrgLensViewMode.mockReturnValue('full');

      const { res } = await call('getOrgDonations', { orgUid: ORG_UID });

      expect(res.json).toHaveBeenCalledWith(donations());
    });

    it('does not run the lens gate, and is untouched, while the flag is off', async () => {
      mocks.flagEnabled.mockReturnValue(false);

      const { res } = await call('getOrgDonations', { orgUid: ORG_UID });

      expect(mocks.resolveOrgLensViewMode).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(donations());
    });

    it('refuses before the upstream call when the gate refuses', async () => {
      mocks.flagEnabled.mockReturnValue(true);
      const refusal = Object.assign(new Error('no'), { statusCode: 403 });
      mocks.resolveOrgLensViewMode.mockRejectedValue(refusal);

      const { next } = await call('getOrgDonations', { orgUid: ORG_UID });

      expect(next).toHaveBeenCalledWith(refusal);
      expect(mocks.getOrgDonations).not.toHaveBeenCalled();
    });
  });

  describe('company initiatives list', () => {
    it('removes the creator and a personal attribution name in the employee view', async () => {
      mocks.flagEnabled.mockReturnValue(true);
      mocks.resolveOrgLensViewMode.mockResolvedValue('employee');

      const { res } = await call('getMyInitiatives', { orgUid: ORG_UID });

      const body = res.json.mock.calls[0][0];
      expect(body.data[0]).not.toHaveProperty('creator');
      expect(body.data[0].attribution.name).toBe('Acme');
      expect(body.data[1].attribution).toEqual({ type: 'personal' });
      expect(JSON.stringify(body)).not.toContain('Synthetic Owner');
    });

    it('is untouched in the full view', async () => {
      mocks.flagEnabled.mockReturnValue(true);
      mocks.resolveOrgLensViewMode.mockResolvedValue('full');

      const { res } = await call('getMyInitiatives', { orgUid: ORG_UID });

      expect(res.json).toHaveBeenCalledWith(initiatives());
    });

    it("never gates or redacts the caller's own list or a project scope", async () => {
      mocks.flagEnabled.mockReturnValue(true);

      const own = await call('getMyInitiatives', {});
      const project = await call('getMyInitiatives', { projectUid: '123e4567-e89b-12d3-a456-426614174000' });

      expect(mocks.resolveOrgLensViewMode).not.toHaveBeenCalled();
      expect(own.res.json).toHaveBeenCalledWith(initiatives());
      expect(project.res.json).toHaveBeenCalledWith(initiatives());
    });
  });

  describe('company initiatives stats', () => {
    it('returns totals through the gate, and refuses when the gate does', async () => {
      mocks.flagEnabled.mockReturnValue(true);
      mocks.resolveOrgLensViewMode.mockResolvedValue('employee');

      const ok = await call('getInitiativesStats', { orgUid: ORG_UID });
      expect(ok.res.json).toHaveBeenCalledWith({ activeCount: 1, totalRaised: 25, monthlyGain: 0, totalSponsors: 3 });

      const refusal = Object.assign(new Error('no'), { statusCode: 403 });
      mocks.resolveOrgLensViewMode.mockRejectedValue(refusal);
      mocks.getInitiativesStats.mockClear();
      const denied = await call('getInitiativesStats', { orgUid: ORG_UID });
      expect(denied.next).toHaveBeenCalledWith(refusal);
      expect(mocks.getInitiativesStats).not.toHaveBeenCalled();
    });
  });
});
