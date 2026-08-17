// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The middleware's import graph transitively reaches Angular's partially-compiled @angular/common
// (via the shared logging/service chain). Under vitest that needs the JIT compiler as a fallback,
// so load it before importing the module under test.
import '@angular/compiler';

import type { NextFunction, Request, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ServerFeatureFlag } from '../helpers/server-feature-flag.helper';

const getPersonas = vi.fn();
const checkRootMarketingAuditor = vi.fn();
const checkRootCampaignManager = vi.fn();
const checkSingleAccess = vi.fn();
const getProjectIdBySlug = vi.fn();

vi.mock('../utils/persona-helper', () => ({
  personaDetectionService: {
    getPersonas: (...args: unknown[]) => getPersonas(...args),
    checkRootMarketingAuditor: (...args: unknown[]) => checkRootMarketingAuditor(...args),
    checkRootCampaignManager: (...args: unknown[]) => checkRootCampaignManager(...args),
  },
}));

vi.mock('../services/access-check.service', () => ({
  AccessCheckService: vi.fn().mockImplementation(() => ({
    checkSingleAccess: (...args: unknown[]) => checkSingleAccess(...args),
  })),
}));

vi.mock('../services/project.service', () => ({
  ProjectService: vi.fn().mockImplementation(() => ({
    getProjectIdBySlug: (...args: unknown[]) => getProjectIdBySlug(...args),
  })),
}));

const { requireMarketingAuditor, requireCampaignManager } = await import('./require-marketing-access.middleware');

interface PersonaResult {
  personas: string[];
  isRootWriter?: boolean;
  isLFStaff?: boolean;
}

function nonEd(overrides: Partial<PersonaResult> = {}): PersonaResult {
  return { personas: ['contributor'], isRootWriter: false, isLFStaff: false, ...overrides };
}

function buildReq(query: Record<string, string> = {}): Request {
  return { path: '/api/analytics/event-roster', query } as unknown as Request;
}

/** The middleware either calls next() with nothing (allow) or next(error) (deny). */
function verdict(next: ReturnType<typeof vi.fn>): 'allow' | 'deny' {
  expect(next).toHaveBeenCalledTimes(1);
  return next.mock.calls[0][0] === undefined ? 'allow' : 'deny';
}

function setFlag(enabled: boolean): void {
  if (enabled) {
    process.env[ServerFeatureFlag.MarketingOpsFga] = 'true';
  } else {
    delete process.env[ServerFeatureFlag.MarketingOpsFga];
  }
}

describe('requireMarketingAuditor / requireCampaignManager', () => {
  beforeEach(() => {
    getPersonas.mockReset();
    checkRootMarketingAuditor.mockReset();
    checkRootCampaignManager.mockReset();
    checkSingleAccess.mockReset();
    getProjectIdBySlug.mockReset();
    setFlag(true);
  });

  afterEach(() => {
    delete process.env[ServerFeatureFlag.MarketingOpsFga];
  });

  describe('flag off', () => {
    it('falls back to ED-only behavior, denying a non-ED caller', async () => {
      setFlag(false);
      getPersonas.mockResolvedValue({ personas: ['contributor'], personaProjects: {} });
      const next = vi.fn();

      await requireMarketingAuditor(buildReq({ foundationSlug: 'tlf' }), {} as Response, next as unknown as NextFunction);

      expect(verdict(next)).toBe('deny');
      expect(checkRootMarketingAuditor).not.toHaveBeenCalled();
    });

    it('falls back to ED-only behavior, allowing a scoped ED', async () => {
      setFlag(false);
      getPersonas.mockResolvedValue({
        personas: ['executive-director'],
        personaProjects: { 'executive-director': [{ projectUid: 'uid-tlf', projectSlug: 'tlf', projectName: 'tlf' }] },
        isRootWriter: false,
        isLFStaff: false,
      });
      const next = vi.fn();

      await requireMarketingAuditor(buildReq({ foundationSlug: 'tlf' }), {} as Response, next as unknown as NextFunction);

      expect(verdict(next)).toBe('allow');
    });
  });

  describe('flag on — persona bypass', () => {
    it('allows an ED scoped to the requested foundation without needing an FGA check', async () => {
      getPersonas.mockResolvedValue({
        personas: ['executive-director'],
        personaProjects: { 'executive-director': [{ projectUid: 'uid-tlf', projectSlug: 'tlf', projectName: 'tlf' }] },
        isRootWriter: false,
        isLFStaff: false,
      });
      const next = vi.fn();

      await requireMarketingAuditor(buildReq({ foundationSlug: 'tlf' }), {} as Response, next as unknown as NextFunction);

      expect(verdict(next)).toBe('allow');
      expect(checkRootMarketingAuditor).not.toHaveBeenCalled();
    });

    it('allows an ED without needing an FGA check when the request names no foundation', async () => {
      getPersonas.mockResolvedValue({ personas: ['executive-director'], personaProjects: {}, isRootWriter: false, isLFStaff: false });
      const next = vi.fn();

      await requireMarketingAuditor(buildReq(), {} as Response, next as unknown as NextFunction);

      expect(verdict(next)).toBe('allow');
      expect(checkRootMarketingAuditor).not.toHaveBeenCalled();
    });

    it('does not hard-deny an ED out of scope for the requested foundation — falls through to a root FGA grant', async () => {
      getPersonas.mockResolvedValue({
        personas: ['executive-director'],
        personaProjects: { 'executive-director': [{ projectUid: 'uid-other', projectSlug: 'other-foundation', projectName: 'other' }] },
        isRootWriter: false,
        isLFStaff: false,
      });
      checkRootMarketingAuditor.mockResolvedValue(true);
      const next = vi.fn();

      await requireMarketingAuditor(buildReq({ foundationSlug: 'tlf' }), {} as Response, next as unknown as NextFunction);

      expect(verdict(next)).toBe('allow');
      expect(checkRootMarketingAuditor).toHaveBeenCalled();
    });

    it('denies an ED out of scope for the requested foundation when no FGA grant exists either', async () => {
      getPersonas.mockResolvedValue({
        personas: ['executive-director'],
        personaProjects: { 'executive-director': [{ projectUid: 'uid-other', projectSlug: 'other-foundation', projectName: 'other' }] },
        isRootWriter: false,
        isLFStaff: false,
      });
      checkRootMarketingAuditor.mockResolvedValue(false);
      getProjectIdBySlug.mockResolvedValue({ uid: 'uid-tlf', slug: 'tlf', exists: true });
      checkSingleAccess.mockResolvedValue(false);
      const next = vi.fn();

      await requireMarketingAuditor(buildReq({ foundationSlug: 'tlf' }), {} as Response, next as unknown as NextFunction);

      expect(verdict(next)).toBe('deny');
    });

    it('allows a root writer', async () => {
      getPersonas.mockResolvedValue(nonEd({ isRootWriter: true }));
      const next = vi.fn();

      await requireCampaignManager(buildReq({ project: 'tlf' }), {} as Response, next as unknown as NextFunction);

      expect(verdict(next)).toBe('allow');
    });

    it('allows LF staff', async () => {
      getPersonas.mockResolvedValue(nonEd({ isLFStaff: true }));
      const next = vi.fn();

      await requireCampaignManager(buildReq({ project: 'tlf' }), {} as Response, next as unknown as NextFunction);

      expect(verdict(next)).toBe('allow');
    });
  });

  describe('flag on — root FGA cascade', () => {
    it('allows via a root marketing_auditor grant', async () => {
      getPersonas.mockResolvedValue(nonEd());
      checkRootMarketingAuditor.mockResolvedValue(true);
      const next = vi.fn();

      await requireMarketingAuditor(buildReq({ foundationSlug: 'tlf' }), {} as Response, next as unknown as NextFunction);

      expect(verdict(next)).toBe('allow');
      expect(getProjectIdBySlug).not.toHaveBeenCalled();
    });

    it('allows via a root campaign_manager grant', async () => {
      getPersonas.mockResolvedValue(nonEd());
      checkRootCampaignManager.mockResolvedValue(true);
      const next = vi.fn();

      await requireCampaignManager(buildReq({ project: 'tlf' }), {} as Response, next as unknown as NextFunction);

      expect(verdict(next)).toBe('allow');
      // The two relations must not be conflated — a root marketing_auditor grant must not also
      // satisfy campaign_manager.
      expect(checkRootMarketingAuditor).not.toHaveBeenCalled();
    });
  });

  describe('flag on — per-project FGA grant', () => {
    it('allows a caller with a project-scoped grant', async () => {
      getPersonas.mockResolvedValue(nonEd());
      checkRootMarketingAuditor.mockResolvedValue(false);
      getProjectIdBySlug.mockResolvedValue({ uid: 'uid-tlf', slug: 'tlf', exists: true });
      checkSingleAccess.mockResolvedValue(true);
      const next = vi.fn();

      await requireMarketingAuditor(buildReq({ foundationSlug: 'tlf' }), {} as Response, next as unknown as NextFunction);

      expect(verdict(next)).toBe('allow');
      expect(checkSingleAccess).toHaveBeenCalledWith(expect.anything(), { resource: 'project', id: 'uid-tlf', access: 'marketing_auditor' });
    });

    it('denies when the project exists but the caller has no grant', async () => {
      getPersonas.mockResolvedValue(nonEd());
      checkRootMarketingAuditor.mockResolvedValue(false);
      getProjectIdBySlug.mockResolvedValue({ uid: 'uid-tlf', slug: 'tlf', exists: true });
      checkSingleAccess.mockResolvedValue(false);
      const next = vi.fn();

      await requireMarketingAuditor(buildReq({ foundationSlug: 'tlf' }), {} as Response, next as unknown as NextFunction);

      expect(verdict(next)).toBe('deny');
    });
  });

  describe('flag on — missing slug / missing project', () => {
    it('denies when the request names no foundation and the caller has no root grant', async () => {
      getPersonas.mockResolvedValue(nonEd());
      checkRootMarketingAuditor.mockResolvedValue(false);
      const next = vi.fn();

      await requireMarketingAuditor(buildReq(), {} as Response, next as unknown as NextFunction);

      expect(verdict(next)).toBe('deny');
      expect(getProjectIdBySlug).not.toHaveBeenCalled();
    });

    it('denies with the same error shape when the slug does not resolve to a project', async () => {
      getPersonas.mockResolvedValue(nonEd());
      checkRootMarketingAuditor.mockResolvedValue(false);
      getProjectIdBySlug.mockResolvedValue({ uid: '', slug: 'ghost', exists: false });
      const notFound = vi.fn();
      await requireMarketingAuditor(buildReq({ foundationSlug: 'ghost' }), {} as Response, notFound as unknown as NextFunction);

      getPersonas.mockResolvedValue(nonEd());
      checkRootMarketingAuditor.mockResolvedValue(false);
      getProjectIdBySlug.mockResolvedValue({ uid: 'uid-tlf', slug: 'tlf', exists: true });
      checkSingleAccess.mockResolvedValue(false);
      const noGrant = vi.fn();
      await requireMarketingAuditor(buildReq({ foundationSlug: 'tlf' }), {} as Response, noGrant as unknown as NextFunction);

      expect(verdict(notFound)).toBe('deny');
      expect(verdict(noGrant)).toBe('deny');
      const a = notFound.mock.calls[0][0];
      const b = noGrant.mock.calls[0][0];
      expect(a.message).toBe(b.message);
      expect(a.context?.code ?? a.code).toBe(b.context?.code ?? b.code);
    });
  });

  describe('flag on — fail closed', () => {
    it('denies (via next(error)) when an upstream call throws', async () => {
      getPersonas.mockResolvedValue(nonEd());
      checkRootMarketingAuditor.mockRejectedValue(new Error('access-check unavailable'));
      const next = vi.fn();

      await requireMarketingAuditor(buildReq({ foundationSlug: 'tlf' }), {} as Response, next as unknown as NextFunction);

      expect(next).toHaveBeenCalledTimes(1);
      expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
    });
  });
});
