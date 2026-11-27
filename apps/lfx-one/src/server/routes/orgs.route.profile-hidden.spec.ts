// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Same reason as require-executive-director.middleware.spec.ts: the import graph transitively
// reaches Angular's partially-compiled @angular/common, which needs the JIT compiler under vitest.
import '@angular/compiler';

import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Router-level coverage for hiding the company Profile routes in the all employee view (#5858). Uses the real `blockEmployeeView`.
 *
 * The middleware has its own unit tests, but those call it directly — they would keep passing if the
 * `router.use('/:orgUid/lens', …)` registration were deleted, moved below a route, or scoped so
 * narrowly that it missed the `:accountId` routes. Since that registration *is* the fix for the
 * cross-org exposure, these tests drive real HTTP requests through the assembled router.
 *
 * Only the gate is asserted. A blocked request must be refused with 403; an admitted one only has to
 * get *past* the gate — whatever the downstream handler then does with no upstreams configured is
 * irrelevant here and deliberately not stubbed, which keeps this test from re-encoding every
 * controller's wiring.
 */

const getAccessAwareOrgs = vi.fn();
const getRollUpSet = vi.fn();
const checkSingleAccessStrict = vi.fn();
const proxyRequest = vi.fn();
const proxyRequestWithResponse = vi.fn();
const resolveOrgLensEdit = vi.fn();
let lfStaffStub = false;
const checkLFStaff = vi.fn(async () => lfStaffStub);

// The read gate asks the authorizer for `b2b_org:<uid>#auditor` alongside the roster; unmocked, the
// real service would hit the bare `proxyRequest` stub and turn every ungranted case into a 503.
vi.mock('../services/access-check.service', () => ({
  AccessCheckService: class {
    public checkSingleAccessStrict = checkSingleAccessStrict;
  },
}));
vi.mock('../services/org-role-grants.service', () => ({
  OrgRoleGrantsService: class {
    public getAccessAwareOrgs = getAccessAwareOrgs;
    public getRollUpSet = getRollUpSet;
  },
}));
// Epic #5845: the employee-view verdict is the only thing the profile-hiding tests vary; its own spec covers the proofs.
const resolveEmployeeView = vi.fn();
vi.mock('../services/org-employee-view.service', () => ({
  OrgEmployeeViewService: class {
    public resolve = resolveEmployeeView;
  },
}));
vi.mock('../services/microservice-proxy.service', () => ({
  MicroserviceProxyService: class {
    public proxyRequest = proxyRequest;
    public proxyRequestWithResponse = proxyRequestWithResponse;
  },
}));
// #3136: the edit decision has its own unit spec; here only the route's wiring and mapping are asserted.
vi.mock('../helpers/org-lens-edit-access.helper', () => ({ resolveOrgLensEdit }));

// `isImpersonating` is needed because the LFXV2-3288 logo route now runs `blockDuringImpersonation`
// before its raw body parser (mirrors profile.route.ts's picture-upload gate). A partial mock that
// omitted it would make the middleware call `undefined(req)` and 500 every test in this file.
// Toggled via `impersonatingStub` so the impersonation-blocked scenario can flip it per test.
let impersonatingStub = false;
vi.mock('../utils/auth-helper', () => ({ getEffectiveUsername: () => 'jdoe', isImpersonating: () => impersonatingStub }));
// The ROI LF-staff gate (in every environment) asks `lf-staff#member`; each case sets the answer it needs.
vi.mock('../utils/persona-helper', () => ({ personaDetectionService: { checkLFStaff: () => checkLFStaff() } }));
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

const orgsRouter = (await import('./orgs.route')).default;

const GRANTED = '0014100000Te2ovAAB';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use('/api/orgs', orgsRouter);
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
  vi.clearAllMocks();
  impersonatingStub = false;
  lfStaffStub = false;
  getAccessAwareOrgs.mockResolvedValue({ resolved: new Map([[GRANTED, { roleSource: 'direct-writer' }]]), upstreamFailed: false });
  checkSingleAccessStrict.mockResolvedValue(false);
  resolveEmployeeView.mockResolvedValue({ eligible: false, reason: 'no-employer' });
  delete process.env['LFX_ORG_LENS_EMPLOYEE_VIEW_ENABLED'];
});

/**
 * Epic #5845 (#5858) — the company Profile page is hidden in the all employee view, so every API route behind it
 * (canonical record read and edit, addresses, logo upload, and the bare `/:id` read) answers 403 there. These routes sit
 * outside `/:orgUid/lens`, so the lens gate does not cover them; each is exercised here through the assembled router.
 */
describe('orgs router — Profile routes in the all employee view', () => {
  const UID = '0014100000BetaAAAA';
  const calls: [string, string, RequestInit?][] = [
    ['GET /uid/:uid', `/uid/${UID}`],
    ['PUT /uid/:uid', `/uid/${UID}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'X' }) }],
    ['GET /uid/:uid/addresses', `/uid/${UID}/addresses`],
    ['POST /uid/:uid/logo', `/uid/${UID}/logo`, { method: 'POST', headers: { 'Content-Type': 'image/svg+xml' }, body: Buffer.from('<svg/>') }],
    ['GET /:id', `/${UID}`],
  ];

  beforeEach(() => {
    process.env['LFX_ORG_LENS_EMPLOYEE_VIEW_ENABLED'] = 'true';
    // The employee view is for callers holding no grants (the one entry rule), so this describe's caller holds none.
    getAccessAwareOrgs.mockResolvedValue({ resolved: new Map(), upstreamFailed: false });
    resolveEmployeeView.mockResolvedValue({ eligible: true, org: { orgUid: UID, orgName: 'Beta' } });
  });

  it.each(calls)('refuses %s with 403 and never reaches member-service', async (_label, path, init) => {
    const res = await fetch(`${baseUrl}/api/orgs${path}`, init);

    expect(res.status).toBe(403);
    // The refusal came from the employee-view verdict, not from the read gate's own 403 (the body is Express's default page here).
    expect(resolveEmployeeView).toHaveBeenCalled();
    expect(proxyRequest).not.toHaveBeenCalled();
    expect(proxyRequestWithResponse).not.toHaveBeenCalled();
  });

  it.each(calls)('lets a full-view caller through on %s', async (_label, path, init) => {
    getAccessAwareOrgs.mockResolvedValue({ resolved: new Map([[UID, { roleSource: 'direct-writer' }]]), upstreamFailed: false });

    const res = await fetch(`${baseUrl}/api/orgs${path}`, init);

    // Admitted by the grant: the employee-view verdict is never asked, and the handler (not the gate) answers.
    expect(resolveEmployeeView).not.toHaveBeenCalled();
    expect(res.status).not.toBe(403);
  });

  it('answers a malformed company id with the controller 400, before the read gate or any lookup', async () => {
    const res = await fetch(`${baseUrl}/api/orgs/uid/not-an-account-id`);

    expect(res.status).toBe(400);
    expect(resolveEmployeeView).not.toHaveBeenCalled();
    expect(getAccessAwareOrgs).not.toHaveBeenCalled();
    expect(proxyRequest).not.toHaveBeenCalled();
  });

  it('leaves the routes untouched while the rollout flag is off', async () => {
    delete process.env['LFX_ORG_LENS_EMPLOYEE_VIEW_ENABLED'];
    proxyRequest.mockResolvedValue({ uid: UID, name: 'Beta' });

    const res = await fetch(`${baseUrl}/api/orgs/uid/${UID}`);

    expect(res.status).toBe(200);
    expect(resolveEmployeeView).not.toHaveBeenCalled();
  });
});
