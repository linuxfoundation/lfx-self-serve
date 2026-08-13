// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The middleware's import graph transitively reaches Angular's partially-compiled @angular/common
// (via the shared logging/service chain). Under vitest that needs the JIT compiler as a fallback,
// so load it before importing the module under test.
import '@angular/compiler';

import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getPersonas = vi.fn();

vi.mock('../utils/persona-helper', () => ({
  personaDetectionService: { getPersonas: () => getPersonas() },
}));

const { requireDashboardAccess } = await import('./require-dashboard-access.middleware');

interface PersonaResult {
  personas: string[];
  personaProjects?: Record<string, { projectUid: string; projectSlug: string; projectName: string | null }[]>;
  isRootWriter?: boolean;
  isLFStaff?: boolean;
}

function edFor(slugs: string[], overrides: Partial<PersonaResult> = {}): PersonaResult {
  return {
    personas: ['executive-director'],
    personaProjects: {
      'executive-director': slugs.map((slug) => ({ projectUid: `uid-${slug}`, projectSlug: slug, projectName: slug })),
    },
    isRootWriter: false,
    isLFStaff: false,
    ...overrides,
  };
}

function buildReq(query: Record<string, string> = {}): Request {
  return { path: '/api/social-listening/mentions-feed', query } as unknown as Request;
}

/** The middleware either calls next() with nothing (allow) or next(error) (deny). */
function verdict(next: ReturnType<typeof vi.fn>): 'allow' | 'deny' {
  expect(next).toHaveBeenCalledTimes(1);
  return next.mock.calls[0][0] === undefined ? 'allow' : 'deny';
}

describe('requireDashboardAccess', () => {
  beforeEach(() => {
    getPersonas.mockReset();
  });

  it('denies a caller without the ED persona or LF-staff membership', async () => {
    getPersonas.mockResolvedValue({ personas: ['contributor'], personaProjects: {}, isRootWriter: false, isLFStaff: false });
    const next = vi.fn();

    await requireDashboardAccess(buildReq({ foundationSlug: 'tlf' }), {} as Response, next as unknown as NextFunction);

    expect(verdict(next)).toBe('deny');
  });

  it('allows an ED to read their own foundation', async () => {
    getPersonas.mockResolvedValue(edFor(['tlf', 'cncf']));
    const next = vi.fn();

    await requireDashboardAccess(buildReq({ foundationSlug: 'cncf' }), {} as Response, next as unknown as NextFunction);

    expect(verdict(next)).toBe('allow');
  });

  // Holding the ED persona somewhere is not authorization for every foundation.
  it('denies an ED requesting a foundation they do not hold the persona for', async () => {
    getPersonas.mockResolvedValue(edFor(['tlf']));
    const next = vi.fn();

    await requireDashboardAccess(buildReq({ foundationSlug: 'cncf' }), {} as Response, next as unknown as NextFunction);

    expect(verdict(next)).toBe('deny');
  });

  // Same message and code as the no-access denial: a distinct "not your foundation" error would
  // confirm the foundation exists, turning the endpoint into an existence oracle.
  it('denies out-of-scope with the same error as a no-access denial', async () => {
    getPersonas.mockResolvedValue({ personas: ['contributor'], personaProjects: {}, isLFStaff: false });
    const noAccess = vi.fn();
    await requireDashboardAccess(buildReq({ foundationSlug: 'tlf' }), {} as Response, noAccess as unknown as NextFunction);

    getPersonas.mockResolvedValue(edFor(['tlf']));
    const outOfScope = vi.fn();
    await requireDashboardAccess(buildReq({ foundationSlug: 'cncf' }), {} as Response, outOfScope as unknown as NextFunction);

    const a = noAccess.mock.calls[0][0];
    const b = outOfScope.mock.calls[0][0];
    expect(b.message).toBe(a.message);
    expect(b.context?.code ?? b.code).toBe(a.context?.code ?? a.code);
  });

  // The point of this middleware: LF staff hold no ED persona (they stay contributors) but are
  // an intended audience for executive dashboards, scoped to no single foundation.
  it('allows LF staff without the ED persona, for any foundation', async () => {
    getPersonas.mockResolvedValue({ personas: ['contributor'], personaProjects: {}, isRootWriter: false, isLFStaff: true });
    const next = vi.fn();

    await requireDashboardAccess(buildReq({ foundationSlug: 'cncf' }), {} as Response, next as unknown as NextFunction);

    expect(verdict(next)).toBe('allow');
  });

  it('allows a root writer any foundation', async () => {
    getPersonas.mockResolvedValue(edFor(['tlf'], { isRootWriter: true }));
    const next = vi.fn();

    await requireDashboardAccess(buildReq({ foundationSlug: 'cncf' }), {} as Response, next as unknown as NextFunction);

    expect(verdict(next)).toBe('allow');
  });

  // With no slug there is nothing to scope against; rejecting a missing required parameter is
  // the handler's job, and dashboard endpoints that take no foundation stay reachable.
  it('allows an ED when the request names no foundation', async () => {
    getPersonas.mockResolvedValue(edFor(['tlf']));
    const next = vi.fn();

    await requireDashboardAccess(buildReq(), {} as Response, next as unknown as NextFunction);

    expect(verdict(next)).toBe('allow');
  });

  it('allows LF staff when the request names no foundation', async () => {
    getPersonas.mockResolvedValue({ personas: ['contributor'], personaProjects: {}, isRootWriter: false, isLFStaff: true });
    const next = vi.fn();

    await requireDashboardAccess(buildReq(), {} as Response, next as unknown as NextFunction);

    expect(verdict(next)).toBe('allow');
  });

  it('denies an ED whose scoped project list is missing entirely', async () => {
    getPersonas.mockResolvedValue({ personas: ['executive-director'], personaProjects: {}, isRootWriter: false, isLFStaff: false });
    const next = vi.fn();

    await requireDashboardAccess(buildReq({ foundationSlug: 'tlf' }), {} as Response, next as unknown as NextFunction);

    expect(verdict(next)).toBe('deny');
  });
});
