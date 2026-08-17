// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Same reason as require-executive-director.middleware.spec.ts: the import graph transitively
// reaches Angular's partially-compiled @angular/common, which needs the JIT compiler under vitest.
import '@angular/compiler';

import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Router-level coverage for LFXV2-3294: the marketing/ED-dashboard endpoints gated by
 * `requireExecutiveDirector` (ED-or-LF-Staff) must enforce authorization. The middleware has its
 * own unit tests, but those call it directly — they would keep passing if a route's
 * `requireExecutiveDirector` argument were dropped. This drives real HTTP requests through the
 * assembled router so a missing gate shows up as a non-403 response instead of silently passing.
 * Also covers multi-foundation-summary (ungated at route level but authorized server-side by
 * filterSlugsToPersonaScope to verify scope validation across all personas).
 *
 * Only the gate/scope validation is asserted. An admitted request only has to get past the gate —
 * whatever the (unstubbed) controller does next with no upstream services configured is irrelevant
 * here, same rationale as orgs.route.spec.ts.
 */

const getPersonas = vi.fn();

vi.mock('../utils/persona-helper', () => ({
  personaDetectionService: { getPersonas: () => getPersonas() },
}));
vi.mock('../services/logger.service', () => ({
  logger: {
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    startOperation: vi.fn(() => Date.now()),
    success: vi.fn(),
  },
}));

const analyticsRouter = (await import('./analytics.route')).default;

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use('/api/analytics', analyticsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  getPersonas.mockReset();
});

const NON_ED = { personas: ['contributor'], personaProjects: {}, isRootWriter: false, isLFStaff: false };

function edFor(slugs: string[], overrides: Record<string, unknown> = {}) {
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

// Every endpoint gated by requireExecutiveDashboardAccess (ED-or-LF-Staff, no service-level
// scope validation for multi-persona users) — the full registration list, so a missing/deleted
// gate on any one of them shows up here rather than only in a sample. Middleware branching
// itself is covered by require-executive-dashboard-access.middleware.spec.ts.
const DASHBOARD_ACCESS_GATED = [
  '/web-activities-summary',
  '/email-ctr',
  '/social-reach',
  '/keyword-performance',
  '/social-media',
  '/social-media/monthly',
  '/event-growth',
  '/events-overview-summary',
  '/event-roster',
  '/event-detail',
  '/brand-reach',
  '/brand-health',
  '/revenue-impact',
  '/marketing-attribution',
];

const GATED_SAMPLE = [...DASHBOARD_ACCESS_GATED];

describe('analytics router — authorization on marketing/dashboard endpoints', () => {
  it.each(GATED_SAMPLE)('refuses %s for a non-ED caller', async (path) => {
    getPersonas.mockResolvedValue(NON_ED);

    const res = await fetch(`${baseUrl}/api/analytics${path}`);

    expect(res.status).toBe(403);
  });

  it('admits an ED reading their own foundation', async () => {
    getPersonas.mockResolvedValue(edFor(['tlf']));

    const res = await fetch(`${baseUrl}/api/analytics/brand-reach?foundationSlug=tlf`);

    expect(res.status).not.toBe(403);
    expect(getPersonas).toHaveBeenCalled();
  });

  it('refuses an ED requesting a foundation outside their scope', async () => {
    getPersonas.mockResolvedValue(edFor(['tlf']));

    const res = await fetch(`${baseUrl}/api/analytics/brand-reach?foundationSlug=cncf`);

    expect(res.status).toBe(403);
  });

  // isRootWriter/isLFStaff only bypass the foundationSlug scope check, not the initial ED-persona
  // gate — so the bypass is only observable in combination with the ED persona.
  it('admits an ED root writer for a foundation outside their scoped project list', async () => {
    getPersonas.mockResolvedValue(edFor(['tlf'], { isRootWriter: true }));

    const res = await fetch(`${baseUrl}/api/analytics/brand-reach?foundationSlug=cncf`);

    expect(res.status).not.toBe(403);
  });

  it('admits ED LF staff for a foundation outside their scoped project list', async () => {
    getPersonas.mockResolvedValue(edFor(['tlf'], { isLFStaff: true }));

    const res = await fetch(`${baseUrl}/api/analytics/brand-reach?foundationSlug=cncf`);

    expect(res.status).not.toBe(403);
  });

  it('refuses a root writer without the ED persona', async () => {
    getPersonas.mockResolvedValue({ personas: [], personaProjects: {}, isRootWriter: true, isLFStaff: false });

    const res = await fetch(`${baseUrl}/api/analytics/brand-reach?foundationSlug=cncf`);

    expect(res.status).toBe(403);
  });

  it('admits LF staff without the ED persona on an ED-or-LF-Staff dashboard endpoint', async () => {
    getPersonas.mockResolvedValue({ personas: [], personaProjects: {}, isRootWriter: false, isLFStaff: true });

    const res = await fetch(`${baseUrl}/api/analytics/brand-reach?foundationSlug=cncf`);

    expect(res.status).not.toBe(403);
  });

  // multi-foundation-summary is ungated at the route level; authorization is enforced server-side
  // by filterSlugsToPersonaScope. Non-ED users are allowed through if they have the requested
  // slugs in their persona projects.
  it('admits a non-ED user with board-member persona for their own foundations', async () => {
    const boardMember = {
      personas: ['board-member'],
      personaProjects: {
        'board-member': [{ projectUid: 'uid-cncf', projectSlug: 'cncf', projectName: 'CNCF' }],
      },
      isRootWriter: false,
      isLFStaff: false,
    };
    getPersonas.mockResolvedValue(boardMember);

    const res = await fetch(`${baseUrl}/api/analytics/multi-foundation-summary?slugs=cncf`);

    expect(res.status).not.toBe(403);
    expect(getPersonas).toHaveBeenCalled();
  });

  it('refuses a non-ED user for foundations outside their persona scope', async () => {
    const boardMember = {
      personas: ['board-member'],
      personaProjects: {
        'board-member': [{ projectUid: 'uid-cncf', projectSlug: 'cncf', projectName: 'CNCF' }],
      },
      isRootWriter: false,
      isLFStaff: false,
    };
    getPersonas.mockResolvedValue(boardMember);

    const res = await fetch(`${baseUrl}/api/analytics/multi-foundation-summary?slugs=tlf`);

    expect(res.status).toBe(400); // ServiceValidationError from filterSlugsToPersonaScope
  });

  // Regression guard: these endpoints were never in scope for ED gating (personal/org analytics,
  // not marketing dashboards) — a future change should not accidentally start gating them.
  it('leaves non-marketing endpoints ungated', async () => {
    getPersonas.mockResolvedValue(NON_ED);

    const res = await fetch(`${baseUrl}/api/analytics/active-weeks-streak`);

    expect(res.status).not.toBe(403);
  });
});
