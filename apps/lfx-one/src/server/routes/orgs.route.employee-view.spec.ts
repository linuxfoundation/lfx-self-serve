// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Same reason as orgs.route.spec.ts: the import graph transitively reaches Angular's
// partially-compiled @angular/common, which needs the JIT compiler under vitest.
import '@angular/compiler';

import { ORG_LENS_EMPLOYEE_VIEW_HIDDEN_PAGES } from '@lfx-one/shared/constants';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ReadAccessHelper from '../helpers/org-lens-read-access.helper';

/**
 * Epic #5845 (S15, #5860): router-level API checks for the all employee view.
 *
 * The data-driven half of "every endpoint behind a hidden page or blocked panel answers 403 for an employee-view user and
 * not 403 for a full-view user". The route table is read off the assembled router, so a route added under a hidden
 * page's prefix later is covered without touching this file, and a hidden page with no mapping here fails the suite.
 *
 * Only the gate decision is stubbed: `assertOrgLensRead` answers `employee-view` (or `org-grant` for the full view) and the
 * real `requireOrgLensAccess`, `blockEmployeeView` and `blockEmployeeViewOnOrgRecord` run. Fixture identifiers are
 * synthetic (reserved example domains, no real people).
 */

const ORG_UID = '0016100000ACMEAAA1';
let mode: 'employee' | 'full' = 'employee';

vi.mock('../helpers/org-lens-read-access.helper', async (importOriginal) => ({
  ...(await importOriginal<typeof ReadAccessHelper>()),
  assertOrgLensRead: async () => (mode === 'employee' ? 'employee-view' : 'org-grant'),
  getOrgLensViewMode: () => mode,
  resolveOrgLensViewMode: async () => mode,
}));
vi.mock('../helpers/server-feature-flag.helper', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isServerFeatureEnabled: () => true,
}));
vi.mock('../services/access-check.service', () => ({ AccessCheckService: class {} }));
vi.mock('../services/org-role-grants.service', () => ({ OrgRoleGrantsService: class {} }));
vi.mock('../services/microservice-proxy.service', () => ({
  MicroserviceProxyService: class {
    public proxyRequest = vi.fn().mockResolvedValue({ resources: [] });
    public proxyRequestWithResponse = vi.fn().mockResolvedValue({ data: { resources: [] }, headers: {} });
  },
}));
vi.mock('../utils/auth-helper', () => ({ getEffectiveUsername: () => 'employee', isImpersonating: () => false }));
vi.mock('../utils/persona-helper', () => ({ personaDetectionService: { checkLFStaff: async () => false } }));
vi.mock('../services/logger.service', () => ({
  logger: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn(), startOperation: vi.fn(() => Date.now()), success: vi.fn() },
}));

const orgsRouter = (await import('./orgs.route')).default;

interface RouteEntry {
  method: string;
  path: string;
  url: string;
}

/** Every concrete route on the orgs router, with each `:param` filled by the synthetic company id (or a placeholder). */
const routeTable = (): RouteEntry[] => {
  const entries: RouteEntry[] = [];
  for (const layer of (orgsRouter as unknown as { stack: { route?: { path: string; methods: Record<string, boolean> } }[] }).stack) {
    if (!layer.route) {
      continue;
    }
    for (const method of Object.keys(layer.route.methods)) {
      const url = layer.route.path.replace(/:(orgUid|accountId|uid|id)\b/g, ORG_UID).replace(/:[A-Za-z]+/g, 'x');
      entries.push({ method: method.toUpperCase(), path: layer.route.path, url });
    }
  }
  return entries;
};

/**
 * Hidden page segment -> the API routes behind it. A page hidden in `ORG_LENS_EMPLOYEE_VIEW_HIDDEN_PAGES` must appear here;
 * the matcher says which router paths belong to it. EasyCLA is not on this router: it is refused by
 * `assertOrgLensClaRead` (covered in org-lens-employee-view-gates.spec.ts).
 */
const HIDDEN_PAGE_ROUTES: Record<string, (path: string) => boolean> = {
  memberships: (p) => /\/lens\/(memberships|key-contacts|employees)(\/|$)/.test(p),
  people: (p) => /\/lens\/(people|access)(\/|$)/.test(p),
  groups: (p) => /\/lens\/groups(\/|$)/.test(p),
  // The Profile page's API lives outside `/lens`: the canonical record, its addresses, the logo upload.
  profile: (p) => /^\/uid\/:uid(\/|$)/.test(p) || p === '/:id',
};
const COVERED_ELSEWHERE = new Set(['easycla']);

/** Panels blocked on a page that is otherwise shown. `(method, router path)`. */
const BLOCKED_PANEL_ROUTES: [string, string][] = [
  ['GET', '/:orgUid/lens/events/:eventId/attendees'],
  ['GET', '/:orgUid/lens/events/:eventId/speakers'],
  ['GET', '/:orgUid/lens/training/groups/employees'],
  ['GET', '/:orgUid/lens/projects/:projectSlug/leaderboard/ecosystem/organizations/:organizationId'],
];

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use('/api/orgs', orgsRouter);
  // Express recognises an error handler by its four parameters, so `_next` must stay.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: { statusCode?: number; code?: string; message?: string }, _req: Request, res: Response, _next: NextFunction) => {
    res.status(err.statusCode ?? 500).json({ code: err.code, message: err.message });
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

beforeEach(() => {
  mode = 'employee';
});

const call = async (method: string, url: string) => {
  const res = await fetch(`${baseUrl}/api/orgs${url}`, { method, headers: { 'content-type': 'application/json' }, body: method === 'GET' ? undefined : '{}' });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, code: (body as { code?: string }).code };
};

describe('orgs router, all employee view: hidden pages', () => {
  it('has a route mapping for every page the view hides', () => {
    for (const page of ORG_LENS_EMPLOYEE_VIEW_HIDDEN_PAGES) {
      expect(HIDDEN_PAGE_ROUTES[page] ?? (COVERED_ELSEWHERE.has(page) ? true : undefined), `no API route mapping for hidden page "${page}"`).toBeTruthy();
    }
  });

  for (const page of ORG_LENS_EMPLOYEE_VIEW_HIDDEN_PAGES) {
    const matcher = HIDDEN_PAGE_ROUTES[page];
    if (!matcher) {
      continue;
    }

    it(`answers 403 EMPLOYEE_VIEW_FORBIDDEN on every "${page}" route in the employee view, whatever the method`, async () => {
      const routes = routeTable().filter((r) => matcher(r.path));
      expect(routes.length, `no routes found for hidden page "${page}"`).toBeGreaterThan(0);

      for (const route of routes) {
        expect(await call(route.method, route.url), `${route.method} ${route.path}`).toEqual({ status: 403, code: 'EMPLOYEE_VIEW_FORBIDDEN' });
      }
    });

    it(`does not answer EMPLOYEE_VIEW_FORBIDDEN on any "${page}" route in the full view`, async () => {
      mode = 'full';
      for (const route of routeTable().filter((r) => matcher(r.path))) {
        expect((await call(route.method, route.url)).code, `${route.method} ${route.path}`).not.toBe('EMPLOYEE_VIEW_FORBIDDEN');
      }
    });
  }
});

// The panel stories land on sibling branches; until the hide-page stories are in the tree (the hidden-page list is the
// marker, it is empty on the bare gate) the panel routes are legitimately open, so the strict assertion waits for them.
const PAGE_STORIES_APPLIED = ORG_LENS_EMPLOYEE_VIEW_HIDDEN_PAGES.length > 0;

describe.skipIf(!PAGE_STORIES_APPLIED)('orgs router, all employee view: blocked panels on shown pages', () => {
  it.each(BLOCKED_PANEL_ROUTES)('%s %s answers 403 EMPLOYEE_VIEW_FORBIDDEN, and 200-class handling in the full view', async (method, path) => {
    const entry = routeTable().find((r) => r.method === method && r.path === path);
    expect(entry, `panel route ${method} ${path} is no longer registered; update BLOCKED_PANEL_ROUTES`).toBeDefined();
    if (!entry) {
      return;
    }
    expect(await call(method, entry.url)).toEqual({ status: 403, code: 'EMPLOYEE_VIEW_FORBIDDEN' });

    mode = 'full';
    expect((await call(method, entry.url)).code).not.toBe('EMPLOYEE_VIEW_FORBIDDEN');
  });
});

describe('orgs router, all employee view: read-only', () => {
  it('answers 403 EMPLOYEE_VIEW_FORBIDDEN to every non-GET route under /:orgUid/lens', async () => {
    const writes = routeTable().filter((r) => /^\/:(orgUid|accountId)\/lens\//.test(r.path) && r.method !== 'GET' && r.method !== 'HEAD');
    expect(writes.length).toBeGreaterThan(0);

    for (const route of writes) {
      expect(await call(route.method, route.url), `${route.method} ${route.path}`).toEqual({ status: 403, code: 'EMPLOYEE_VIEW_FORBIDDEN' });
    }
  });

  it('answers 403 to non-GET org record routes (profile edit, logo upload) in the employee view', async () => {
    const writes = routeTable().filter((r) => /^\/uid\/:uid/.test(r.path) && r.method !== 'GET');
    for (const route of writes) {
      // Only asserted once the Profile story is applied; before then these routes are not behind the view gate.
      if (!ORG_LENS_EMPLOYEE_VIEW_HIDDEN_PAGES.includes('profile')) {
        continue;
      }
      expect((await call(route.method, route.url)).code, `${route.method} ${route.path}`).toBe('EMPLOYEE_VIEW_FORBIDDEN');
    }
  });
});
