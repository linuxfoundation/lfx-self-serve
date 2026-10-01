// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Same reason as require-executive-director.middleware.spec.ts: the import graph transitively
// reaches Angular's partially-compiled @angular/common, which needs the JIT compiler under vitest.
import '@angular/compiler';

import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAccessAwareOrgs = vi.fn();
const checkSingleAccessStrict = vi.fn();
const getEffectiveUsername = vi.fn();

// The middleware delegates to `assertOrgLensRead`, so these mocks target what that helper consumes —
// the tests therefore exercise the real gate logic, not a reimplementation of it.
vi.mock('../services/org-role-grants.service', () => ({
  OrgRoleGrantsService: class {
    public getAccessAwareOrgs = getAccessAwareOrgs;
  },
}));
// The per-org authorizer question (`b2b_org:<uid>#auditor`) the gate asks alongside the roster.
vi.mock('../services/access-check.service', () => ({
  AccessCheckService: class {
    public checkSingleAccessStrict = checkSingleAccessStrict;
  },
}));
vi.mock('../utils/auth-helper', () => ({ getEffectiveUsername: () => getEffectiveUsername() }));
// Deny paths log before rejecting; the real logger expects a fuller request object than these stubs
// carry, and would otherwise throw into the catch and turn a 403 into a 500.
vi.mock('../services/logger.service', () => ({
  logger: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { requireOrgLensAccess } = await import('./require-org-lens-access.middleware');

const LF = '0014100000Te2ovAAB';
const OTHER_ORG = '0014100000BetaAAAA';

function grants(uids: string[], upstreamFailed = false): { resolved: Map<string, unknown>; upstreamFailed: boolean } {
  return { resolved: new Map(uids.map((uid) => [uid, { roleSource: 'direct-writer' }])), upstreamFailed };
}

function buildReq(orgUid: string): Request {
  return { path: `/api/orgs/${orgUid}/lens/people/all`, params: { orgUid } } as unknown as Request;
}

async function run(orgUid: string): Promise<{ next: ReturnType<typeof vi.fn> }> {
  const next = vi.fn() as unknown as NextFunction & ReturnType<typeof vi.fn>;
  await requireOrgLensAccess(buildReq(orgUid), {} as Response, next);
  return { next };
}

/** Allow = next() with no argument; deny = next(error). */
function statusOf(next: ReturnType<typeof vi.fn>): number | 'allow' {
  expect(next).toHaveBeenCalledTimes(1);
  const arg: unknown = next.mock.calls[0][0];
  if (arg === undefined) return 'allow';
  return arg instanceof Error && 'statusCode' in arg && typeof arg.statusCode === 'number' ? arg.statusCode : 500;
}

/** The error handed to next(); undefined when the request was allowed. */
function errorOf(next: ReturnType<typeof vi.fn>): unknown {
  return next.mock.calls[0][0];
}

beforeEach(() => {
  vi.clearAllMocks();
  getEffectiveUsername.mockReturnValue('lguerra');
  getAccessAwareOrgs.mockResolvedValue(grants([LF]));
  // Default: the authorizer resolves "not an auditor" — the roster alone decides in most cases.
  checkSingleAccessStrict.mockResolvedValue(false);
});

describe('requireOrgLensAccess', () => {
  it('allows a caller holding a relation on the requested organization without asking the authorizer', async () => {
    const { next } = await run(LF);
    expect(statusOf(next)).toBe('allow');
    // The authorizer cannot change an org-grant outcome, so a granted read never pays for it.
    expect(checkSingleAccessStrict).not.toHaveBeenCalled();
  });

  it('refuses an organization the caller holds no relation on (the reported exposure)', async () => {
    // Before this middleware existed, this request returned 3,519 rows of another org's people.
    const { next } = await run(OTHER_ORG);
    expect(statusOf(next)).toBe(403);
    // A verified denial is not an upstream failure, so it names no failed upstream path.
    expect(errorOf(next)).toMatchObject({ service: 'LFX_V2_SERVICE', operation: 'require_org_lens_access', path: undefined });
  });

  it('allows a cascading (inherited) grant, not only a direct one', async () => {
    getAccessAwareOrgs.mockResolvedValue({
      resolved: new Map([[OTHER_ORG, { roleSource: 'inherited-auditor', parentUid: LF, parentName: 'LF' }]]),
      upstreamFailed: false,
    });

    const { next } = await run(OTHER_ORG);

    expect(statusOf(next)).toBe('allow');
  });

  it('allows a direct auditor', async () => {
    getAccessAwareOrgs.mockResolvedValue({ resolved: new Map([[LF, { roleSource: 'direct-auditor' }]]), upstreamFailed: false });

    const { next } = await run(LF);

    expect(statusOf(next)).toBe('allow');
  });

  it('returns a retriable 503 when the grants lookup fails, rather than claiming no permission', async () => {
    getAccessAwareOrgs.mockResolvedValue(grants([], true));

    const { next } = await run(LF);

    expect(statusOf(next)).toBe(503);
  });

  it('does not fall open when the grants lookup fails for an org the caller could otherwise read', async () => {
    getAccessAwareOrgs.mockResolvedValue({ resolved: new Map([[LF, { roleSource: 'direct-writer' }]]), upstreamFailed: true });

    const { next } = await run(LF);

    expect(statusOf(next)).toBe(503);
  });

  it('allows a verified grant on this org even when roll-up expansion degraded', async () => {
    // The regression this locks: folding the roll-up `degraded` flag into the gate's veto made a
    // CONFIRMED direct grant answer 503, locking an administrator out of the org they administer
    // whenever some unrelated part of the hierarchy walk came back incomplete. `degraded` reports
    // which orgs are missing from the map; it never invalidates one that is present.
    getAccessAwareOrgs.mockResolvedValue({ resolved: new Map([[LF, { roleSource: 'direct-writer' }]]), upstreamFailed: false, degraded: true });

    const { next } = await run(LF);

    expect(statusOf(next)).toBe('allow');
  });

  it('still returns 503 for an org absent from a degraded map, since the absence is unverified', async () => {
    // The other half of the contract: a degraded map is a lower bound, so "not in the map" is not
    // yet "denied" — answering 403 here would tell a roll-up editor they lost access they hold.
    getAccessAwareOrgs.mockResolvedValue({ resolved: new Map([[LF, { roleSource: 'direct-writer' }]]), upstreamFailed: false, degraded: true });

    const { next } = await run(OTHER_ORG);

    expect(statusOf(next)).toBe(503);
  });

  it('allows a caller the authorizer confirms as auditor on an org they hold no roster grant on', async () => {
    // LF staff, a cascade the roster did not surface, and key-contact promotion all resolve through
    // the one `b2b_org#auditor` relation — the gate asks the authorizer instead of mirroring a team
    // list (spec 044 / DR-001). Pinning this matters because
    // it is what makes a 200 the correct answer for such a caller on an arbitrary org — behaviour
    // that is easy to mistake for a missing gate.
    getAccessAwareOrgs.mockResolvedValue({ resolved: new Map(), upstreamFailed: false });
    checkSingleAccessStrict.mockResolvedValue(true);

    const { next } = await run(OTHER_ORG);

    expect(statusOf(next)).toBe('allow');
    expect(checkSingleAccessStrict).toHaveBeenCalledWith(expect.anything(), { resource: 'b2b_org', id: OTHER_ORG, access: 'auditor' });
  });

  it('allows an authorizer-confirmed auditor even when the grant lookup degraded, because the two resolutions are independent', async () => {
    // The authorizer answer is deliberately ordered BEFORE the degraded branch: it and the per-org
    // roster are separate upstream calls, so a roster outage must not withhold access the
    // authorizer already confirmed. A refactor that hoisted the degraded guard above it would
    // answer 503 and lock every team member out during any roster blip.
    getAccessAwareOrgs.mockResolvedValue({ resolved: new Map(), upstreamFailed: true });
    checkSingleAccessStrict.mockResolvedValue(true);

    const { next } = await run(OTHER_ORG);

    expect(statusOf(next)).toBe('allow');
  });

  it('returns a retriable 503 when the authorizer check itself fails, never a 403 and never data', async () => {
    // Fail-closed in the accurate direction: an authorizer outage is "couldn't verify", not
    // "denied". The strict check is used precisely so this path cannot degrade to a silent false.
    getAccessAwareOrgs.mockResolvedValue({ resolved: new Map(), upstreamFailed: false });
    checkSingleAccessStrict.mockRejectedValue(new Error('access-check unreachable'));

    const { next } = await run(OTHER_ORG);

    expect(statusOf(next)).toBe(503);
  });

  it('refuses a caller the authorizer resolves as not an auditor when nothing is degraded', async () => {
    getAccessAwareOrgs.mockResolvedValue({ resolved: new Map(), upstreamFailed: false, degraded: false });
    checkSingleAccessStrict.mockResolvedValue(false);

    const { next } = await run(OTHER_ORG);

    expect(statusOf(next)).toBe(403);
  });

  it('does not consult a team list: the roster shape carries no staff flag the gate could read', async () => {
    // The pre-044 gate short-circuited on `isStaff` from the roster. The contract now forbids the
    // gate consulting any team list — only the affordance does — so a roster claiming staff must
    // not by itself open an org the authorizer denies.
    getAccessAwareOrgs.mockResolvedValue({ resolved: new Map(), upstreamFailed: false, isStaff: true });
    checkSingleAccessStrict.mockResolvedValue(false);

    const { next } = await run(OTHER_ORG);

    expect(statusOf(next)).toBe(403);
  });

  it('refuses when no caller identity can be resolved', async () => {
    getEffectiveUsername.mockReturnValue(undefined);

    const { next } = await run(LF);

    expect(statusOf(next)).toBe(403);
    expect(getAccessAwareOrgs).not.toHaveBeenCalled();
  });

  it('refuses when the route carries no organization id', async () => {
    const next = vi.fn() as unknown as NextFunction & ReturnType<typeof vi.fn>;
    await requireOrgLensAccess({ path: '/api/orgs//lens/people/all', params: {} } as unknown as Request, {} as Response, next);

    expect(statusOf(next)).toBe(400);
  });

  it('rejects a malformed organization id before asking any upstream', async () => {
    // `:orgUid` is the 18-char account id; anything else is a client error, not a question for
    // the roster or the authorizer, so neither is reached with a value they could never match.
    const { next } = await run('abc');

    expect(statusOf(next)).toBe(400);
    expect(getAccessAwareOrgs).not.toHaveBeenCalled();
    expect(checkSingleAccessStrict).not.toHaveBeenCalled();
  });

  it('allows an authorizer-confirmed auditor when the roster lookup throws outright', async () => {
    // A thrown roster lookup and a degraded one are the same fact to the gate: the roster has no
    // answer. Both wait for the authorizer, which is independent and may still admit the caller.
    getAccessAwareOrgs.mockRejectedValue(new Error('query-service unreachable'));
    checkSingleAccessStrict.mockResolvedValue(true);

    const { next } = await run(OTHER_ORG);

    expect(statusOf(next)).toBe('allow');
  });

  it('returns a retriable 503 naming the roster upstream when the lookup throws and the authorizer denies', async () => {
    getAccessAwareOrgs.mockRejectedValue(new Error('query-service unreachable'));
    checkSingleAccessStrict.mockResolvedValue(false);

    const { next } = await run(LF);

    expect(statusOf(next)).toBe(503);
    expect(errorOf(next)).toMatchObject({ path: '/query/resources' });
  });

  it('names the authorizer upstream when both the roster and the authorizer throw', async () => {
    // Row 3 precedes row 4: the authorizer is the deciding authority for an unlisted org, so its
    // outage is the one to report even though the roster failed first.
    getAccessAwareOrgs.mockRejectedValue(new Error('query-service unreachable'));
    checkSingleAccessStrict.mockRejectedValue(new Error('access-check unreachable'));

    const { next } = await run(OTHER_ORG);

    expect(statusOf(next)).toBe(503);
    expect(errorOf(next)).toMatchObject({ path: '/access-check' });
  });

  it('admits an authorizer-confirmed auditor over an incomplete roll-up', async () => {
    // Row 2 precedes row 5: `degraded` says other orgs may be missing from the roster, which is
    // no reason to 503 a caller the authorizer has confirmed on this one.
    getAccessAwareOrgs.mockResolvedValue({ resolved: new Map(), upstreamFailed: false, degraded: true });
    checkSingleAccessStrict.mockResolvedValue(true);

    const { next } = await run(OTHER_ORG);

    expect(statusOf(next)).toBe('allow');
  });

  it('resolves each request and org once, replaying the answer to a second caller on the same request', async () => {
    // The middleware and a handler that also asserts share one request; the second call must not
    // cost a second roster lookup or authorizer round-trip.
    const req = buildReq(OTHER_ORG);
    getAccessAwareOrgs.mockResolvedValue({ resolved: new Map(), upstreamFailed: false });
    checkSingleAccessStrict.mockResolvedValue(false);

    const first = vi.fn() as unknown as NextFunction & ReturnType<typeof vi.fn>;
    const second = vi.fn() as unknown as NextFunction & ReturnType<typeof vi.fn>;
    await requireOrgLensAccess(req, {} as Response, first);
    await requireOrgLensAccess(req, {} as Response, second);

    expect(statusOf(first)).toBe(403);
    expect(statusOf(second)).toBe(403);
    expect(getAccessAwareOrgs).toHaveBeenCalledTimes(1);
    expect(checkSingleAccessStrict).toHaveBeenCalledTimes(1);
  });
});
