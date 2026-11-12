// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Same reason as clas.controller.spec.ts: validation.helper's import graph transitively reaches
// Angular's partially-compiled @angular/common, which needs the JIT compiler under vitest.
import '@angular/compiler';

import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted so the vi.mock factories below can reference them.
const service = vi.hoisted(() => ({
  getFoundationProjects: vi.fn(),
  getActiveMemberships: vi.fn(),
  getExpiredMemberships: vi.fn(),
  getDiscoverOpportunities: vi.fn(),
  getFamilyActiveMemberships: vi.fn(),
  getFamilyExpiredMemberships: vi.fn(),
  getFamilyDiscoverOpportunities: vi.fn(),
}));
const { getFoundationProjects } = service;
const { resolveOrgLensRollUp } = vi.hoisted(() => ({ resolveOrgLensRollUp: vi.fn() }));

vi.mock('../services/org-lens-memberships.service', () => ({
  OrgLensMembershipsService: class {
    public getFoundationProjects = service.getFoundationProjects;
    public getActiveMemberships = service.getActiveMemberships;
    public getExpiredMemberships = service.getExpiredMemberships;
    public getDiscoverOpportunities = service.getDiscoverOpportunities;
    public getFamilyActiveMemberships = service.getFamilyActiveMemberships;
    public getFamilyExpiredMemberships = service.getFamilyExpiredMemberships;
    public getFamilyDiscoverOpportunities = service.getFamilyDiscoverOpportunities;
  },
}));
vi.mock('../helpers/org-lens-roll-up.helper', () => ({ resolveOrgLensRollUp }));
vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { OrgLensMembershipsController } = await import('./org-lens-memberships.controller');
const { ServiceValidationError } = await import('../errors');

const VALID_ORG_UID = '001ABCDEFGHIJKLMNO';

function makeRes(): Response {
  return { setHeader: vi.fn(), json: vi.fn() } as unknown as Response;
}

function makeReq(params: Record<string, string>): Request {
  return { params } as unknown as Request;
}

describe('OrgLensMembershipsController.getFoundationProjects', () => {
  beforeEach(() => {
    getFoundationProjects.mockReset();
    getFoundationProjects.mockResolvedValue({ accountId: VALID_ORG_UID, foundationId: 'cncf', projects: [] });
  });

  it('passes validated path params through to the service', async () => {
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    await new OrgLensMembershipsController().getFoundationProjects(makeReq({ orgUid: VALID_ORG_UID, foundationId: 'cncf' }), res, next);

    expect(getFoundationProjects).toHaveBeenCalledWith(VALID_ORG_UID, 'cncf');
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ accountId: VALID_ORG_UID, foundationId: 'cncf', projects: [] });
  });

  // The validator is the only thing between a request path value and the Snowflake bind and the
  // logs, so each rejected shape is pinned: a later refactor that drops the assert, or loosens
  // FOUNDATION_ID_PATTERN, has to fail here.
  it.each([
    ['a path traversal', '../x'],
    ['an encoded separator', 'a%2Fb'],
    ['an empty id', ''],
    ['an over-long id', 'a'.repeat(65)],
  ])('rejects %s as foundationId without calling the service', async (_label, foundationId) => {
    const next = vi.fn() as unknown as NextFunction;

    await new OrgLensMembershipsController().getFoundationProjects(makeReq({ orgUid: VALID_ORG_UID, foundationId }), makeRes(), next);

    expect(getFoundationProjects).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect(vi.mocked(next).mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
  });

  it('rejects a malformed orgUid without calling the service', async () => {
    const next = vi.fn() as unknown as NextFunction;

    await new OrgLensMembershipsController().getFoundationProjects(makeReq({ orgUid: 'not-an-sfid', foundationId: 'cncf' }), makeRes(), next);

    expect(getFoundationProjects).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect(vi.mocked(next).mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
  });

  it('refuses a family roll-up key: the side panel reads one organization, the row’s own', async () => {
    const next = vi.fn() as unknown as NextFunction;

    await new OrgLensMembershipsController().getFoundationProjects(makeReq({ orgUid: `family-${VALID_ORG_UID}`, foundationId: 'cncf' }), makeRes(), next);

    expect(getFoundationProjects).not.toHaveBeenCalled();
    expect(vi.mocked(next).mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
  });
});

describe('OrgLensMembershipsController — family roll-up lists', () => {
  const ROLL_UP = `family-${VALID_ORG_UID}`;
  const SUBSIDIARY = '001ABCDEFGHIJKLMNP';
  const scope = {
    rollUpKey: ROLL_UP,
    rootUid: VALID_ORG_UID,
    members: [
      { uid: VALID_ORG_UID, accountId: VALID_ORG_UID, name: 'Parent Co', logoUrl: null },
      { uid: SUBSIDIARY, accountId: SUBSIDIARY, name: 'Subsidiary Co', logoUrl: null },
    ],
    complete: true,
  };
  const rollUpReq = (query: Record<string, string> = {}): Request => ({ params: { orgUid: ROLL_UP }, query }) as unknown as Request;

  beforeEach(() => {
    Object.values(service).forEach((fn) => fn.mockReset());
    resolveOrgLensRollUp.mockReset();
    resolveOrgLensRollUp.mockResolvedValue(scope);
    service.getFamilyActiveMemberships.mockResolvedValue({ accountId: ROLL_UP, summary: {}, memberships: [] });
    service.getFamilyExpiredMemberships.mockResolvedValue({ accountId: ROLL_UP, memberships: [] });
    service.getFamilyDiscoverOpportunities.mockResolvedValue({ accountId: ROLL_UP, opportunities: [] });
  });

  it('reads the active list for the server-resolved scope, with every filter and the Company filter', async () => {
    const next = vi.fn() as unknown as NextFunction;

    await new OrgLensMembershipsController().getActiveMemberships(
      rollUpReq({ search: 'cn', tier: 'Gold', renewal: '90', company: SUBSIDIARY }),
      makeRes(),
      next
    );

    expect(resolveOrgLensRollUp).toHaveBeenCalledWith(expect.anything(), ROLL_UP, 'get_org_lens_memberships_active');
    expect(service.getFamilyActiveMemberships).toHaveBeenCalledWith(scope, { search: 'cn', tier: 'Gold', renewal: '90', company: SUBSIDIARY });
    expect(service.getActiveMemberships).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('refuses a Company filter naming an organization outside the roll-up', async () => {
    const next = vi.fn() as unknown as NextFunction;

    await new OrgLensMembershipsController().getActiveMemberships(rollUpReq({ company: '001ZZZZZZZZZZZZZZZ' }), makeRes(), next);

    expect(service.getFamilyActiveMemberships).not.toHaveBeenCalled();
    expect(vi.mocked(next).mock.calls[0][0]).toBeInstanceOf(ServiceValidationError);
  });

  it('reads the expired list for the scope, passing the Company filter', async () => {
    const next = vi.fn() as unknown as NextFunction;

    await new OrgLensMembershipsController().getExpiredMemberships(rollUpReq({ search: 'x', company: VALID_ORG_UID }), makeRes(), next);

    expect(service.getFamilyExpiredMemberships).toHaveBeenCalledWith(scope, 'x', VALID_ORG_UID);
    expect(service.getExpiredMemberships).not.toHaveBeenCalled();
  });

  it('reads the discover list for the scope', async () => {
    const next = vi.fn() as unknown as NextFunction;

    await new OrgLensMembershipsController().getDiscoverOpportunities(rollUpReq(), makeRes(), next);

    expect(service.getFamilyDiscoverOpportunities).toHaveBeenCalledWith(scope);
    expect(service.getDiscoverOpportunities).not.toHaveBeenCalled();
  });

  it('passes a refused roll-up to the error handler without reading', async () => {
    const refused = new Error('forbidden');
    resolveOrgLensRollUp.mockRejectedValue(refused);
    const next = vi.fn() as unknown as NextFunction;

    await new OrgLensMembershipsController().getActiveMemberships(rollUpReq(), makeRes(), next);

    expect(next).toHaveBeenCalledWith(refused);
    expect(service.getFamilyActiveMemberships).not.toHaveBeenCalled();
  });

  it('keeps a single organization on its own read, never asking for a roll-up scope', async () => {
    service.getActiveMemberships.mockResolvedValue({ accountId: VALID_ORG_UID, summary: {}, memberships: [] });
    const next = vi.fn() as unknown as NextFunction;

    await new OrgLensMembershipsController().getActiveMemberships(
      { params: { orgUid: VALID_ORG_UID }, query: { company: SUBSIDIARY } } as unknown as Request,
      makeRes(),
      next
    );

    expect(service.getActiveMemberships).toHaveBeenCalledWith(VALID_ORG_UID, undefined, undefined, undefined);
    expect(resolveOrgLensRollUp).not.toHaveBeenCalled();
  });
});
