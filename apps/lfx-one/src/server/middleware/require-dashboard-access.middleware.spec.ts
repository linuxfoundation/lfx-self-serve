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

const getProjectIdBySlug = vi.fn();
const getProjectById = vi.fn();
vi.mock('../services/project.service', () => ({
  ProjectService: class {
    public getProjectIdBySlug = (...args: unknown[]) => getProjectIdBySlug(...args);
    public getProjectById = (...args: unknown[]) => getProjectById(...args);
  },
}));

vi.mock('../services/logger.service', () => ({ logger: { warning: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() } }));

const { AuthorizationError, MicroserviceError, ServiceValidationError } = await import('../errors');
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
  const error = next.mock.calls[0][0];
  // A denial must be a deliberate error, never an incidental crash inside the middleware.
  expect(error instanceof TypeError).toBe(false);
  return error === undefined ? 'allow' : 'deny';
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
  const run = async (req: Request = projectReq()) => {
    const next = vi.fn();
    await requireExecutiveOrLFStaff(req, {} as Response, next as unknown as NextFunction);
    return next;
  };
  const rootWriter = (): PersonaResult => ({ personas: ['executive-director'], personaProjects: {}, isRootWriter: true, isLFStaff: false });
  const proj = (uid: string, slug: string, parentUid = '') => ({ uid, slug, parent_uid: parentUid });
  const errorOf = (next: ReturnType<typeof vi.fn>) => next.mock.calls[0][0];

  /** Wires the slug lookup plus a uid -> project map for getProjectById. */
  const projects = (...list: ReturnType<typeof proj>[]) => {
    getProjectIdBySlug.mockResolvedValue({ exists: true, uid: list[0].uid });
    getProjectById.mockImplementation(async (_req: unknown, uid: string) => {
      const found = list.find((p) => p.uid === uid);
      if (!found) throw new Error('404');
      return found;
    });
  };

  beforeEach(() => {
    getPersonas.mockReset();
    getProjectIdBySlug.mockReset();
    getProjectById.mockReset();
    checkProjectWriter.mockReset();
  });

  it('allows LF staff without resolving the project', async () => {
    getPersonas.mockResolvedValue({ personas: ['contributor'], isLFStaff: true });
    expect(verdict(await run())).toBe('allow');
    expect(getProjectIdBySlug).not.toHaveBeenCalled();
  });

  it('rejects a malformed slug with a 400 validation error before any persona or project lookup', async () => {
    const next = await run(projectReq('Bad Slug!'));
    expect(errorOf(next)).toBeInstanceOf(ServiceValidationError);
    expect(getPersonas).not.toHaveBeenCalled();
  });

  it.each([
    ['a board member', ['board-member']],
    ['a project writer', ['maintainer']],
    ['a plain viewer', ['contributor']],
  ])('denies %s with an AuthorizationError', async (_label, personas) => {
    getPersonas.mockResolvedValue({ personas, personaProjects: {}, isLFStaff: false });
    const next = await run();
    expect(errorOf(next)).toBeInstanceOf(AuthorizationError);
    expect(getProjectIdBySlug).not.toHaveBeenCalled();
  });

  it('allows an ED for a project directly in their scope', async () => {
    getPersonas.mockResolvedValue(edFor(['child']));
    projects(proj('uid-child', 'child', 'uid-parent'));
    expect(verdict(await run())).toBe('allow');
  });

  it('allows an ED for a project under a foundation they direct without reading past it', async () => {
    getPersonas.mockResolvedValue(edFor(['foundation-a']));
    projects(proj('uid-child', 'child', 'uid-foundation-a'));
    expect(verdict(await run())).toBe('allow');
    expect(getProjectById).toHaveBeenCalledTimes(1);
    expect(getProjectById).toHaveBeenCalledWith(expect.anything(), 'uid-child', false);
  });

  it('denies an ED for a project under a different foundation', async () => {
    getPersonas.mockResolvedValue(edFor(['foundation-a']));
    projects(proj('uid-child', 'child', 'uid-b'), proj('uid-b', 'foundation-b', 'uid-root'), proj('uid-root', 'ROOT'));
    expect(errorOf(await run())).toBeInstanceOf(AuthorizationError);
  });

  it('denies an ED for a top-level project with no parent', async () => {
    getPersonas.mockResolvedValue(edFor(['foundation-a']));
    projects(proj('uid-top', 'top'));
    expect(errorOf(await run())).toBeInstanceOf(AuthorizationError);
  });

  it('stops at the depth cap and denies a deeper chain', async () => {
    getPersonas.mockResolvedValue(edFor(['p8']));
    projects(...['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'].map((slug, i, all) => proj(`uid-${slug}`, slug, all[i + 1] ? `uid-${all[i + 1]}` : '')));
    expect(errorOf(await run())).toBeInstanceOf(AuthorizationError);
  });

  it('answers 404 for an unknown project instead of falling through', async () => {
    getPersonas.mockResolvedValue(edFor(['foundation-a']));
    getProjectIdBySlug.mockResolvedValue({ exists: false });
    expect(errorOf(await run())).toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
  });

  it('denies (403, not 5xx) when an ancestor lookup fails', async () => {
    getPersonas.mockResolvedValue(edFor(['foundation-a']));
    projects(proj('uid-child', 'child', 'uid-missing'));
    expect(errorOf(await run())).toBeInstanceOf(AuthorizationError);
  });

  it('maps a slug lookup outage to 503 ACCESS_CHECK_UNAVAILABLE', async () => {
    getPersonas.mockResolvedValue(edFor(['foundation-a']));
    getProjectIdBySlug.mockRejectedValue(new Error('nats timeout'));
    const error = errorOf(await run());
    expect(error).toBeInstanceOf(MicroserviceError);
    expect(error).toMatchObject({ statusCode: 503, code: 'ACCESS_CHECK_UNAVAILABLE' });
  });

  it('allows a root writer only with verified writer access on the requested project', async () => {
    getPersonas.mockResolvedValue(rootWriter());
    projects(proj('uid-child', 'child', 'uid-f'), proj('uid-f', 'f', 'uid-tlf'), proj('uid-tlf', 'tlf', 'uid-root'), proj('uid-root', 'ROOT'));
    checkProjectWriter.mockResolvedValue(true);
    expect(verdict(await run())).toBe('allow');
    expect(checkProjectWriter).toHaveBeenCalledTimes(1);
    expect(checkProjectWriter).toHaveBeenCalledWith(expect.anything(), 'child');
  });

  it('denies a root writer without writer access on the requested project, whatever its umbrella grants', async () => {
    getPersonas.mockResolvedValue(rootWriter());
    projects(proj('uid-child', 'child', 'uid-f'), proj('uid-f', 'f', 'uid-tlf'), proj('uid-tlf', 'tlf', 'uid-root'), proj('uid-root', 'ROOT'));
    checkProjectWriter.mockImplementation(async (_req: unknown, slug: string) => slug === 'tlf');
    expect(errorOf(await run())).toBeInstanceOf(AuthorizationError);
    expect(checkProjectWriter).not.toHaveBeenCalledWith(expect.anything(), 'tlf');
  });

  it('forwards a persona lookup failure instead of allowing', async () => {
    getPersonas.mockRejectedValue(new Error('boom'));
    expect(verdict(await run())).toBe('deny');
  });
});
