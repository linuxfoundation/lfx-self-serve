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

const { requireExecutiveDashboardAccess } = await import('./require-executive-dashboard-access.middleware');

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
  return { path: '/api/analytics/brand-reach', query } as unknown as Request;
}

/** The middleware either calls next() with nothing (allow) or next(error) (deny). */
function verdict(next: ReturnType<typeof vi.fn>): 'allow' | 'deny' {
  expect(next).toHaveBeenCalledTimes(1);
  return next.mock.calls[0][0] === undefined ? 'allow' : 'deny';
}

describe('requireExecutiveDashboardAccess', () => {
  beforeEach(() => {
    getPersonas.mockReset();
  });

  it('denies a caller with neither the ED persona nor LF Staff', async () => {
    getPersonas.mockResolvedValue({ personas: ['contributor'], personaProjects: {}, isRootWriter: false, isLFStaff: false });
    const next = vi.fn();

    await requireExecutiveDashboardAccess(buildReq({ foundationSlug: 'tlf' }), {} as Response, next as unknown as NextFunction);

    expect(verdict(next)).toBe('deny');
  });

  it('allows an ED to read their own foundation', async () => {
    getPersonas.mockResolvedValue(edFor(['tlf']));
    const next = vi.fn();

    await requireExecutiveDashboardAccess(buildReq({ foundationSlug: 'tlf' }), {} as Response, next as unknown as NextFunction);

    expect(verdict(next)).toBe('allow');
  });

  it('denies an ED requesting a foundation they do not hold the persona for', async () => {
    getPersonas.mockResolvedValue(edFor(['tlf']));
    const next = vi.fn();

    await requireExecutiveDashboardAccess(buildReq({ foundationSlug: 'cncf' }), {} as Response, next as unknown as NextFunction);

    expect(verdict(next)).toBe('deny');
  });

  // The point of this middleware over requireExecutiveDirector: LF Staff pass without holding
  // the ED persona at all, and bypass foundation scoping entirely.
  it('allows LF Staff without the ED persona, for any foundation', async () => {
    getPersonas.mockResolvedValue({ personas: [], personaProjects: {}, isRootWriter: false, isLFStaff: true });
    const next = vi.fn();

    await requireExecutiveDashboardAccess(buildReq({ foundationSlug: 'cncf' }), {} as Response, next as unknown as NextFunction);

    expect(verdict(next)).toBe('allow');
  });

  it('allows a root writer any foundation', async () => {
    getPersonas.mockResolvedValue(edFor(['tlf'], { isRootWriter: true }));
    const next = vi.fn();

    await requireExecutiveDashboardAccess(buildReq({ foundationSlug: 'cncf' }), {} as Response, next as unknown as NextFunction);

    expect(verdict(next)).toBe('allow');
  });

  it('allows an ED when the request names no foundation', async () => {
    getPersonas.mockResolvedValue(edFor(['tlf']));
    const next = vi.fn();

    await requireExecutiveDashboardAccess(buildReq(), {} as Response, next as unknown as NextFunction);

    expect(verdict(next)).toBe('allow');
  });

  it('denies an ED whose scoped project list is missing entirely', async () => {
    getPersonas.mockResolvedValue({ personas: ['executive-director'], personaProjects: {}, isRootWriter: false, isLFStaff: false });
    const next = vi.fn();

    await requireExecutiveDashboardAccess(buildReq({ foundationSlug: 'tlf' }), {} as Response, next as unknown as NextFunction);

    expect(verdict(next)).toBe('deny');
  });
});
