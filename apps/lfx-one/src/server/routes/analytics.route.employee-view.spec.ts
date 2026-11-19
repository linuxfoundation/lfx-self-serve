// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Same reason as analytics.route.spec.ts: the import graph reaches Angular's partially-compiled @angular/common.
import '@angular/compiler';

import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type * as ReadAccessHelper from '../helpers/org-lens-read-access.helper';

/**
 * Epic #5845 (S15, #5860): the org-scoped `/api/analytics/*` rows refuse the all employee view unless a reviewed route opts in.
 *
 * These rows are keyed by an `accountId` query param, so neither `blockEmployeeView` (needs `:orgUid`) nor the lens
 * prefix gate applies; `requireOrgAnalyticsAccess` -> `assertOrgAnalyticsRead` is the only guard. Every route carrying that
 * middleware is read off the assembled router, so a route added later is covered. `ALLOWED_FOR_EMPLOYEE_VIEW` lists the
 * paths a story has reviewed and opted in; it is empty today, and adding to it is a deliberate, reviewed act.
 */

const ORG_UID = '0016100000ACMEAAA1';
const ALLOWED_FOR_EMPLOYEE_VIEW = new Set<string>([
  '/org-foundation-coverage',
  '/org-involvement-contributors-monthly',
  '/org-involvement-maintainers-monthly',
  '/org-involvement-event-attendance-monthly',
]);
const OPT_IN_MIDDLEWARE = 'requireOrgAnalyticsAccessAllowingEmployeeView';

vi.mock('../helpers/org-lens-read-access.helper', async (importOriginal) => ({
  ...(await importOriginal<typeof ReadAccessHelper>()),
  assertOrgLensRead: async () => 'employee-view',
}));
vi.mock('../services/access-check.service', () => ({ AccessCheckService: class {} }));
vi.mock('../services/org-role-grants.service', () => ({ OrgRoleGrantsService: class {} }));
vi.mock('../services/snowflake.service', () => ({
  SnowflakeService: { getInstance: () => ({ execute: vi.fn().mockResolvedValue({ rows: [] }) }), isMissingObjectError: () => false },
}));
vi.mock('../utils/auth-helper', () => ({ getEffectiveUsername: () => 'employee', isImpersonating: () => false }));
vi.mock('../services/logger.service', () => ({
  logger: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn(), startOperation: vi.fn(() => Date.now()), success: vi.fn() },
}));

const analyticsRouter = (await import('./analytics.route')).default;

interface Layer {
  route?: { path: string; methods: Record<string, boolean>; stack: { name: string; handle: { name?: string } }[] };
}

const GATES = ['requireOrgAnalyticsAccess', OPT_IN_MIDDLEWARE];

const gatedLayers = (): NonNullable<Layer['route']>[] =>
  (analyticsRouter as unknown as { stack: Layer[] }).stack
    .filter((layer) => layer.route?.stack.some((s) => GATES.includes(s.handle?.name ?? '')) && layer.route.methods['get'])
    .map((layer) => layer.route as NonNullable<Layer['route']>);

const gatedPaths = (): string[] => gatedLayers().map((route) => route.path);

/** The paths whose route actually carries the opt-in gate (not merely listed). */
const optedInPaths = (): string[] =>
  gatedLayers()
    .filter((route) => route.stack.some((s) => s.handle?.name === OPT_IN_MIDDLEWARE))
    .map((route) => route.path);

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use('/api/analytics', analyticsRouter);
  app.use((err: { statusCode?: number; code?: string }, _req: Request, res: Response, _next: NextFunction) => {
    res.status(err.statusCode ?? 500).json({ code: err.code });
  });
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('analytics router, all employee view', () => {
  it('finds the org-scoped rows behind requireOrgAnalyticsAccess', () => {
    expect(gatedPaths().length).toBeGreaterThan(10);
  });

  it('answers 403 EMPLOYEE_VIEW_FORBIDDEN on every org-scoped row unless the route is reviewed and allow-listed', async () => {
    for (const path of gatedPaths().filter((p) => !ALLOWED_FOR_EMPLOYEE_VIEW.has(p))) {
      const res = await fetch(`${baseUrl}/api/analytics${path}?accountId=${ORG_UID}`);
      const body = (await res.json().catch(() => ({}))) as { code?: string };

      expect({ path, status: res.status, code: body.code }, `GET ${path}`).toEqual({ path, status: 403, code: 'EMPLOYEE_VIEW_FORBIDDEN' });
    }
  });

  // Skipped only while the Overview story (#5847), which introduces the opt-in gate, is not yet in this branch's base.
  it.skipIf(optedInPaths().length === 0)('opts in exactly the allow-listed rows, so an opt-in cannot be added without this list (and its review)', () => {
    expect([...optedInPaths()].sort()).toEqual([...ALLOWED_FOR_EMPLOYEE_VIEW].sort());
  });

  it.skipIf(optedInPaths().length === 0)('admits the all employee view on the allow-listed rows (no 403 EMPLOYEE_VIEW_FORBIDDEN)', async () => {
    for (const path of ALLOWED_FOR_EMPLOYEE_VIEW) {
      const res = await fetch(`${baseUrl}/api/analytics${path}?accountId=${ORG_UID}`);
      const body = (await res.json().catch(() => ({}))) as { code?: string };

      expect({ path, code: body.code }, `GET ${path}`).not.toEqual({ path, code: 'EMPLOYEE_VIEW_FORBIDDEN' });
    }
  });
});
