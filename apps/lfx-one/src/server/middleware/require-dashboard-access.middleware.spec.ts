// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The middleware's import graph transitively reaches Angular's partially-compiled @angular/common;
// under vitest that needs the JIT compiler, so load it before importing the module under test.
import '@angular/compiler';

import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getPersonas = vi.fn();
const checkProjectWriter = vi.fn();

vi.mock('../utils/persona-helper', () => ({
  personaDetectionService: {
    getPersonas: () => getPersonas(),
    checkProjectWriter: (...args: unknown[]) => checkProjectWriter(...args),
  },
}));

const getProjectBySlug = vi.fn();
const getProjectById = vi.fn();
vi.mock('../services/project.service', () => ({
  ProjectService: class {
    public getProjectBySlug = (...args: unknown[]) => getProjectBySlug(...args);
    public getProjectById = (...args: unknown[]) => getProjectById(...args);
  },
}));

const { requireDashboardAccess, requireExecutiveOrLFStaff } = await import('./require-dashboard-access.middleware');

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
  return { method: 'GET', path: '/api/social-listening/mentions-feed', query } as unknown as Request;
}

/** The middleware either calls next() with nothing (allow) or next(error) (deny). */
function verdict(next: ReturnType<typeof vi.fn>): 'allow' | 'deny' {
  expect(next).toHaveBeenCalledTimes(1);
  return next.mock.calls[0][0] === undefined ? 'allow' : 'deny';
}

describe('requireDashboardAccess', () => {
  beforeEach(() => {
    getPersonas.mockReset();
    checkProjectWriter.mockReset();
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

  // Upstream slugs are stored verbatim — a mixed-case entry must not 403 a scoped ED.
  it('allows an ED when the upstream slug is mixed-case', async () => {
    getPersonas.mockResolvedValue(edFor(['TLF']));
    const next = vi.fn();

    await requireDashboardAccess(buildReq({ foundationSlug: 'tlf' }), {} as Response, next as unknown as NextFunction);

    expect(verdict(next)).toBe('allow');
  });

  it('allows an ED when the requested slug is mixed-case', async () => {
    getPersonas.mockResolvedValue(edFor(['tlf']));
    const next = vi.fn();

    await requireDashboardAccess(buildReq({ foundationSlug: 'TLF' }), {} as Response, next as unknown as NextFunction);

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

  it('allows a root writer a foundation it also holds writer_guard on', async () => {
    getPersonas.mockResolvedValue(edFor(['tlf'], { isRootWriter: true }));
    checkProjectWriter.mockResolvedValue(true);
    const next = vi.fn();

    await requireDashboardAccess(buildReq({ foundationSlug: 'cncf' }), {} as Response, next as unknown as NextFunction);

    expect(verdict(next)).toBe('allow');
    expect(checkProjectWriter).toHaveBeenCalledWith(expect.anything(), 'cncf');
  });

  // The ROOT check admits `global_writer`, which is withheld on Draft/Confidential projects.
  it('denies a root writer a foundation it does not hold writer_guard on', async () => {
    getPersonas.mockResolvedValue(edFor(['tlf'], { isRootWriter: true }));
    checkProjectWriter.mockResolvedValue(false);
    const next = vi.fn();

    await requireDashboardAccess(buildReq({ foundationSlug: 'cncf' }), {} as Response, next as unknown as NextFunction);

    expect(verdict(next)).toBe('deny');
  });

  it('allows a root writer an unscoped request without a per-project check', async () => {
    getPersonas.mockResolvedValue(edFor([], { isRootWriter: true }));
    const next = vi.fn();

    await requireDashboardAccess(buildReq(), {} as Response, next as unknown as NextFunction);

    expect(verdict(next)).toBe('allow');
    expect(checkProjectWriter).not.toHaveBeenCalled();
  });

  it('allows a root writer its own ED foundation without a per-project check', async () => {
    getPersonas.mockResolvedValue(edFor(['tlf'], { isRootWriter: true }));
    const next = vi.fn();

    await requireDashboardAccess(buildReq({ foundationSlug: 'tlf' }), {} as Response, next as unknown as NextFunction);

    expect(verdict(next)).toBe('allow');
    expect(checkProjectWriter).not.toHaveBeenCalled();
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

  it.each([
    { body: { foundationSlug: 'Synthetic-Owned' }, query: {}, allowed: true },
    { body: { foundationSlug: 'synthetic-foreign' }, query: {}, allowed: false },
    { body: { foundationSlug: 'synthetic-foreign' }, query: { foundationSlug: 'synthetic-owned' }, allowed: false },
    { body: {}, query: { foundationSlug: 'synthetic-foreign' }, allowed: true },
  ])('authorizes POST body scope without query fallback ($allowed)', async ({ body, query, allowed }) => {
    getPersonas.mockResolvedValue(edFor(['synthetic-owned']));
    const next = vi.fn();
    const req = { ...buildReq(), method: 'POST', body, query } as Request;
    await requireDashboardAccess(req, {} as Response, next);
    expect(verdict(next)).toBe(allowed ? 'allow' : 'deny');
  });

  it('allows LF staff to read a foreign body foundation', async () => {
    getPersonas.mockResolvedValue(edFor([], { isLFStaff: true }));
    const next = vi.fn();
    await requireDashboardAccess({ ...buildReq(), method: 'POST', body: { foundationSlug: 'synthetic-foreign' } } as Request, {} as Response, next);
    expect(verdict(next)).toBe('allow');
  });

  it.each([true, false])('checks a POST root writer against the normalized body foundation (%s)', async (allowed) => {
    getPersonas.mockResolvedValue(edFor(['synthetic-owned'], { isRootWriter: true }));
    checkProjectWriter.mockResolvedValue(allowed);
    const next = vi.fn();
    const req = { ...buildReq({ foundationSlug: 'synthetic-owned' }), method: 'POST', body: { foundationSlug: 'Synthetic-Foreign' } } as Request;
    await requireDashboardAccess(req, {} as Response, next);
    expect(verdict(next)).toBe(allowed ? 'allow' : 'deny');
    expect(checkProjectWriter).toHaveBeenCalledWith(req, 'synthetic-foreign');
  });
});

describe('requireExecutiveOrLFStaff', () => {
  const projectReq = (slug = 'child') => ({ method: 'GET', path: '/api/projects/x/participating-orgs', query: {}, params: { slug } }) as unknown as Request;
  const run = async (req: Request) => {
    const next = vi.fn();
    await requireExecutiveOrLFStaff(req, {} as Response, next as unknown as NextFunction);
    return next;
  };

  beforeEach(() => {
    getPersonas.mockReset();
    getProjectBySlug.mockReset();
    getProjectById.mockReset();
    checkProjectWriter.mockReset();
  });

  it('allows LF staff without resolving the project', async () => {
    getPersonas.mockResolvedValue({ personas: ['contributor'], isLFStaff: true });
    expect(verdict(await run(projectReq()))).toBe('allow');
    expect(getProjectBySlug).not.toHaveBeenCalled();
  });

  it.each([
    ['a board member', ['board-member']],
    ['a project writer', ['maintainer']],
    ['a plain viewer', ['contributor']],
  ])('denies %s', async (_label, personas) => {
    getPersonas.mockResolvedValue({ personas, personaProjects: {}, isLFStaff: false });
    expect(verdict(await run(projectReq()))).toBe('deny');
    expect(getProjectBySlug).not.toHaveBeenCalled();
  });

  it('allows an ED for a project directly in their scope', async () => {
    getPersonas.mockResolvedValue(edFor(['child']));
    getProjectBySlug.mockResolvedValue({ uid: 'uid-child', slug: 'child', parent_uid: 'uid-parent' });
    expect(verdict(await run(projectReq()))).toBe('allow');
  });

  it('allows an ED for a project under a foundation they direct', async () => {
    getPersonas.mockResolvedValue(edFor(['foundation-a']));
    getProjectBySlug.mockResolvedValue({ uid: 'uid-child', slug: 'child', parent_uid: 'uid-foundation-a' });
    getProjectById.mockResolvedValue({ uid: 'uid-foundation-a', slug: 'foundation-a', parent_uid: '' });
    expect(verdict(await run(projectReq()))).toBe('allow');
  });

  it('denies an ED for a project under a different foundation', async () => {
    getPersonas.mockResolvedValue(edFor(['foundation-a']));
    getProjectBySlug.mockResolvedValue({ uid: 'uid-child', slug: 'child', parent_uid: 'uid-foundation-b' });
    getProjectById.mockResolvedValue({ uid: 'uid-foundation-b', slug: 'foundation-b', parent_uid: '' });
    expect(verdict(await run(projectReq()))).toBe('deny');
  });

  it('denies (not 5xx) when the ancestry lookup fails, and reads parents metadata-only', async () => {
    getPersonas.mockResolvedValue(edFor(['foundation-a']));
    getProjectBySlug.mockResolvedValue({ uid: 'uid-child', slug: 'child', parent_uid: 'uid-root' });
    getProjectById.mockRejectedValue(new Error('404'));
    expect(verdict(await run(projectReq()))).toBe('deny');
    expect(getProjectById).toHaveBeenCalledWith(expect.anything(), 'uid-root', false);
  });

  it('allows a root writer without ED scopes only with writer access on the topmost foundation', async () => {
    getPersonas.mockResolvedValue({ personas: ['executive-director'], personaProjects: {}, isRootWriter: true, isLFStaff: false });
    getProjectBySlug.mockResolvedValue({ uid: 'uid-child', slug: 'child', parent_uid: 'uid-f' });
    getProjectById.mockResolvedValue({ uid: 'uid-f', slug: 'f', parent_uid: '' });

    checkProjectWriter.mockResolvedValue(true);
    expect(verdict(await run(projectReq()))).toBe('allow');
    expect(checkProjectWriter).toHaveBeenCalledWith(expect.anything(), 'f');
  });

  it('denies a root writer lacking writer access on the foundation', async () => {
    getPersonas.mockResolvedValue({ personas: ['executive-director'], personaProjects: {}, isRootWriter: true, isLFStaff: false });
    getProjectBySlug.mockResolvedValue({ uid: 'uid-child', slug: 'child', parent_uid: '' });
    checkProjectWriter.mockResolvedValue(false);
    expect(verdict(await run(projectReq()))).toBe('deny');
  });

  it('forwards a persona lookup failure instead of allowing', async () => {
    getPersonas.mockRejectedValue(new Error('boom'));
    expect(verdict(await run(projectReq()))).toBe('deny');
  });
});
