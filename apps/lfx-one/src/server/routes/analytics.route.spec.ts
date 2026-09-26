// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Same reason as orgs.route.spec.ts: the import graph transitively reaches Angular's
// partially-compiled @angular/common, which needs the JIT compiler under vitest.
import '@angular/compiler';

import express from 'express';
import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ServerFeatureFlag } from '../helpers/server-feature-flag.helper';

import type * as AuthHelper from '../utils/auth-helper';

/**
 * Router-level coverage for the authorization gates on the analytics rows: `requireDashboardAccess`
 * on the Health Metrics rows (LFXV2-3365), `requireNorthStarAccess` on the North Star rows
 * (linuxfoundation/lfx-self-serve-ops#43), and `requireOrgAnalyticsAccess` / `filterReadableAccountIds`
 * on the org-scoped rows (linuxfoundation/lfx-self-serve-ops#44). `requireNorthStarAccess` is stricter
 * than the sibling `requireMarketingAuditorOrLfStaff`: it refuses a project-scoped grant on the `tlf` umbrella.
 *
 * Middleware unit tests (where a gate has them) call it directly — they would keep passing if
 * `router.get('/foundation-profile-summary', requireDashboardAccess, ...)` had the middleware
 * dropped or reordered. Since that registration *is* the fix, these tests drive real HTTP requests
 * through the assembled router.
 *
 * Only the gate is asserted, but the admitted path still runs the real controller/service code,
 * so Snowflake is mocked to return empty rows (the documented missing-object/no-data default
 * path) rather than left as a real client that could attempt a network connection.
 */

const getPersonas = vi.fn();
const checkAccessStrict = vi.fn();
const checkRootMarketingAuditor = vi.fn();
const execute = vi.fn();
const getAccessAwareOrgs = vi.fn();
const checkSingleAccessStrict = vi.fn();

vi.mock('../utils/persona-helper', () => ({
  personaDetectionService: { getPersonas, checkRootMarketingAuditor },
}));
// The org gate delegates to the real `assertOrgLensRead`; these mock what that helper consumes (the
// caller's grant roster and the `b2b_org#auditor` authorizer), so the real decision logic runs.
vi.mock('../services/org-role-grants.service', () => ({
  OrgRoleGrantsService: class {
    public getAccessAwareOrgs = getAccessAwareOrgs;
  },
}));
vi.mock('../services/access-check.service', () => ({
  AccessCheckService: class {
    public checkSingleAccessStrict = checkSingleAccessStrict;
    public checkAccessStrict = checkAccessStrict;

    // The marketing gates' per-project check. A prototype method (not a field) so a test can
    // `vi.spyOn(AccessCheckService.prototype, 'checkSingleAccess')` to stub a project grant.
    public async checkSingleAccess(): Promise<boolean> {
      return false;
    }
  },
}));
vi.mock('../utils/auth-helper', async (importOriginal) => ({
  ...(await importOriginal<typeof AuthHelper>()),
  getEffectiveUsername: () => 'caller',
}));
vi.mock('../services/snowflake.service', () => ({
  SnowflakeService: {
    getInstance: () => ({ execute }),
    isMissingObjectError: () => false,
  },
}));
// Upstream lookups some handlers make before Snowflake (e.g. project slug resolution) fail fast
// instead of attempting a real broker connection that would stall the route sweep.
vi.mock('../services/nats.service', () => ({
  NatsService: class {
    public request = vi.fn().mockRejectedValue(new Error('NATS is not available in route tests'));
    public shutdown = vi.fn();
    public getCodec = () => ({ encode: () => new Uint8Array(), decode: () => ({}) });
  },
}));
vi.mock('../services/logger.service', () => ({
  logger: {
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    startOperation: vi.fn(() => Date.now()),
    success: vi.fn(),
    // Read by the production `apiErrorHandler` mounted below.
    getLastOperation: vi.fn(),
  },
}));

const analyticsRouter = (await import('./analytics.route')).default;
const { ProjectService } = await import('../services/project.service');
const { AccessCheckService } = await import('../services/access-check.service');
const { apiErrorHandler } = await import('../middleware/error-handler.middleware');

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use('/api/analytics', analyticsRouter);
  // The production error handler, so tests observe the error body a real client receives.
  app.use(apiErrorHandler);
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
  execute.mockResolvedValue({ rows: [] });
  // Default: a caller with no grant roster entries whom the authorizer does not admit.
  getAccessAwareOrgs.mockResolvedValue({ resolved: new Map(), upstreamFailed: false, degraded: false });
  checkSingleAccessStrict.mockResolvedValue(false);
  checkAccessStrict.mockImplementation(
    async (_req: unknown, resources: { id: string; access: string }[]) => new Map(resources.map((r) => [`${r.id}#${r.access}`, false]))
  );
});

describe.each([
  ['/foundation-profile-summary', 'foundationSlug'],
  ['/health-overview-revenue', 'foundationSlug'],
  ['/health-overview-kpis', 'foundationSlug'],
  ['/engagement-group-attendance', 'foundationSlug'],
  ['/engagement-meeting-participation', 'foundationSlug'],
  ['/engagement-non-member-participation', 'foundationSlug'],
  ['/engagement-org-participation', 'foundationSlug'],
  ['/engagement-representatives', 'foundationSlug'],
  ['/events-registration-forecast', 'foundationSlug'],
  // The event id rides ahead of the slug so the gate still reads the foundation it is testing.
  ['/events-registration-forecast-curve', 'eventId=evt-1&foundationSlug'],
  ['/events-past', 'foundationSlug'],
  ['/events-at-a-glance', 'foundationSlug'],
])('analytics router — dashboard access gate on %s', (path, slugParam) => {
  it('refuses a caller without ED or LF Staff access', async () => {
    getPersonas.mockResolvedValue({ personas: [], isLFStaff: false, isRootWriter: false, personaProjects: {} });

    const res = await fetch(`${baseUrl}/api/analytics${path}?${slugParam}=cncf`);

    expect(res.status).toBe(403);
  });

  it('admits LF Staff past the gate', async () => {
    getPersonas.mockResolvedValue({ personas: [], isLFStaff: true, isRootWriter: false, personaProjects: {} });

    const res = await fetch(`${baseUrl}/api/analytics${path}?${slugParam}=cncf`);

    expect(res.status).toBe(200);
    expect(getPersonas).toHaveBeenCalled();
  });

  it('refuses an ED scoped to a different foundation', async () => {
    getPersonas.mockResolvedValue({
      personas: ['executive-director'],
      isLFStaff: false,
      isRootWriter: false,
      personaProjects: { 'executive-director': [{ projectSlug: 'kubernetes' }] },
    });

    const res = await fetch(`${baseUrl}/api/analytics${path}?${slugParam}=cncf`);

    expect(res.status).toBe(403);
  });

  it('admits an ED scoped to the requested foundation', async () => {
    getPersonas.mockResolvedValue({
      personas: ['executive-director'],
      isLFStaff: false,
      isRootWriter: false,
      personaProjects: { 'executive-director': [{ projectSlug: 'cncf' }] },
    });

    const res = await fetch(`${baseUrl}/api/analytics${path}?${slugParam}=cncf`);

    expect(res.status).toBe(200);
    expect(getPersonas).toHaveBeenCalled();
  });
});

describe.each(['/member-retention', '/member-acquisition', '/engaged-community', '/flywheel-conversion'])(
  'analytics router — North Star gate on %s',
  (path) => {
    // Vitest auto-loads apps/lfx-one/.env, so an ambient LFX_MARKETING_OPS_FGA_ENABLED=true would send
    // the denial tests down the flag-on path; clearAllMocks also keeps mockResolvedValue implementations.
    beforeEach(() => {
      delete process.env[ServerFeatureFlag.MarketingOpsFga];
      checkRootMarketingAuditor.mockReset();
    });

    afterEach(() => {
      delete process.env[ServerFeatureFlag.MarketingOpsFga];
    });

    it('refuses a caller without ED, LF Staff or marketing access', async () => {
      getPersonas.mockResolvedValue({ personas: [], isLFStaff: false, isRootWriter: false, personaProjects: {} });

      const res = await fetch(`${baseUrl}/api/analytics${path}?foundationSlug=cncf`);

      expect(res.status).toBe(403);
      expect(execute).not.toHaveBeenCalled();
    });

    it('refuses an ED scoped to a different foundation', async () => {
      getPersonas.mockResolvedValue({
        personas: ['executive-director'],
        isLFStaff: false,
        isRootWriter: false,
        personaProjects: { 'executive-director': [{ projectSlug: 'kubernetes' }] },
      });

      const res = await fetch(`${baseUrl}/api/analytics${path}?foundationSlug=cncf`);

      expect(res.status).toBe(403);
      expect(execute).not.toHaveBeenCalled();
    });

    it('admits an ED scoped to the requested foundation', async () => {
      getPersonas.mockResolvedValue({
        personas: ['executive-director'],
        isLFStaff: false,
        isRootWriter: false,
        personaProjects: { 'executive-director': [{ projectSlug: 'cncf' }] },
      });

      const res = await fetch(`${baseUrl}/api/analytics${path}?foundationSlug=cncf`);

      expect(res.status).toBe(200);
    });

    it('admits LF Staff past the gate', async () => {
      getPersonas.mockResolvedValue({ personas: [], isLFStaff: true, isRootWriter: false, personaProjects: {} });

      const res = await fetch(`${baseUrl}/api/analytics${path}?foundationSlug=cncf`);

      expect(res.status).toBe(200);
    });

    it('admits a root marketing_auditor grantee when marketing-ops FGA is on', async () => {
      process.env[ServerFeatureFlag.MarketingOpsFga] = 'true';
      getPersonas.mockResolvedValue({ personas: [], isLFStaff: false, isRootWriter: false, personaProjects: {} });
      checkRootMarketingAuditor.mockResolvedValue(true);

      const res = await fetch(`${baseUrl}/api/analytics${path}?foundationSlug=cncf`);

      expect(res.status).toBe(200);
      expect(checkRootMarketingAuditor).toHaveBeenCalled();
    });

    it('refuses a project-scoped grant on the tlf umbrella aggregate when marketing-ops FGA is on', async () => {
      process.env[ServerFeatureFlag.MarketingOpsFga] = 'true';
      getPersonas.mockResolvedValue({ personas: [], isLFStaff: false, isRootWriter: false, personaProjects: {} });
      checkRootMarketingAuditor.mockResolvedValue(false);
      const projectLookup = vi.spyOn(ProjectService.prototype, 'getProjectIdBySlug').mockResolvedValue({ uid: 'uid-tlf', slug: 'tlf', exists: true });
      const projectGrant = vi.spyOn(AccessCheckService.prototype, 'checkSingleAccess').mockResolvedValue(true);

      try {
        const res = await fetch(`${baseUrl}/api/analytics${path}?foundationSlug=tlf`);

        expect(res.status).toBe(403);
        expect(execute).not.toHaveBeenCalled();
      } finally {
        projectLookup.mockRestore();
        projectGrant.mockRestore();
      }
    });
  }
);

// Synthetic 18-char account ids — fixtures never carry a real customer's id (lfx-self-serve-ops#35).
const OWN = '001EXAMPLEOWN00AAA';
const VICTIM = '001EXAMPLEOTHER0AA';

/**
 * A caller who is a board member of `boardMemberOf` (a persona, never an access grant) and holds an
 * org permission on `grants` — seen by both the grant roster and the batched `b2b_org#auditor` check.
 */
function caller({ boardMemberOf = [], grants = [] }: { boardMemberOf?: string[]; grants?: string[] }): void {
  const organizations = boardMemberOf.map((accountId) => ({ accountId, accountName: 'Org', uid: accountId }));
  getPersonas.mockResolvedValue({
    personas: boardMemberOf.length > 0 ? ['board-member'] : ['contributor'],
    isLFStaff: false,
    isRootWriter: false,
    personaProjects: {},
    organizations,
    error: null,
  });
  getAccessAwareOrgs.mockResolvedValue({
    resolved: new Map(grants.map((uid) => [uid, { roleSource: 'direct-writer' }])),
    upstreamFailed: false,
    degraded: false,
  });
  checkAccessStrict.mockImplementation(
    async (_req: unknown, resources: { id: string; access: string }[]) => new Map(resources.map((r) => [`${r.id}#${r.access}`, grants.includes(r.id)]))
  );
}

/** Whether any Snowflake query ran with this account id among its binds. */
function queried(accountId: string): boolean {
  return JSON.stringify(execute.mock.calls).includes(accountId);
}

// Discovered from the assembled router, so a row added later is swept without editing a list — the
// gap the org rows fell into when the Org Lens prefix was gated but these were not.
const routePaths = analyticsRouter.stack.flatMap((layer) => (typeof layer.route?.path === 'string' ? [layer.route.path] : []));

// Every row that reads an organization's Snowflake data by the caller-supplied account id. The sweep
// pins this set from both sides: each listed row must actually reach Snowflake for an admitted
// account (so its "never for an ungranted one" assertion is not vacuous), and any other row that
// starts querying by account id fails until it is added here — and therefore gated.
const ORG_SCOPED_ROWS = new Set([
  '/certified-employees',
  '/membership-tier',
  '/organization-maintainers',
  '/organization-contributors',
  '/training-enrollments',
  '/event-attendance-monthly',
  '/org-contributors-monthly',
  '/org-contributors-project-distribution',
  '/org-maintainers-monthly',
  '/org-maintainers-distribution',
  '/org-maintainers-key-members',
  '/org-event-attendees-monthly',
  '/org-event-speakers-monthly',
  '/org-training-enrollments-monthly',
  '/org-training-enrollments-distribution',
  '/org-certified-employees-monthly',
  '/org-certified-employees-distribution',
  '/org-foundation-coverage',
  '/org-involvement-contributors-monthly',
  '/org-involvement-maintainers-monthly',
  '/org-involvement-event-attendance-monthly',
  '/org-involvement-certified-employees-monthly',
  '/org-involvement-training-enrollments',
  '/org-lens-account-context',
]);

describe('analytics router — no row reads an organization the caller holds no access to', () => {
  const request = (path: string, accountId: string): Promise<Response> =>
    fetch(`${baseUrl}/api/analytics${path}?accountId=${accountId}&accountIds=${accountId}&foundationSlug=cncf&projectSlug=cncf&slugs=cncf`);

  it('lists only rows the router actually serves', () => {
    expect(routePaths).toEqual(expect.arrayContaining([...ORG_SCOPED_ROWS]));
  });

  it.each(routePaths)('%s never queries Snowflake with an ungranted account id', async (path) => {
    caller({ grants: [OWN] });

    await (await request(path, OWN)).arrayBuffer();
    expect(queried(OWN)).toBe(ORG_SCOPED_ROWS.has(path));

    execute.mockClear();
    await (await request(path, VICTIM)).arrayBuffer();
    expect(queried(VICTIM)).toBe(false);
  });
});

describe.each([
  ['/membership-tier', 'projectSlug'],
  ['/org-maintainers-key-members', 'foundationSlug'],
])('analytics router — org analytics gate on %s', (path, slugParam) => {
  // Admission is proven by the handler querying Snowflake for the account; with the mocked empty
  // rows the handler then answers its own no-data status, which is not what these tests pin.
  const request = (accountId: string): Promise<Response> => fetch(`${baseUrl}/api/analytics${path}?accountId=${accountId}&${slugParam}=cncf`);

  it('refuses an organization the caller holds no access to (the reported exposure)', async () => {
    caller({ grants: [OWN] });

    const res = await request(VICTIM);

    expect(res.status).toBe(403);
    expect(execute).not.toHaveBeenCalled();
  });

  // Personas shape presentation only; access comes from a permission on the organization.
  it('refuses a board member of the organization who holds no permission on it', async () => {
    caller({ boardMemberOf: [OWN] });

    const res = await request(OWN);

    expect(res.status).toBe(403);
    expect(execute).not.toHaveBeenCalled();
  });

  it('admits an org-grant holder who is not a board member', async () => {
    caller({ grants: [OWN] });

    await request(OWN);

    expect(queried(OWN)).toBe(true);
  });

  it('admits an ungranted caller the authorizer confirms as b2b_org auditor (LF team, cascade)', async () => {
    caller({});
    checkSingleAccessStrict.mockResolvedValue(true);

    await request(OWN);

    expect(queried(OWN)).toBe(true);
    expect(checkSingleAccessStrict).toHaveBeenCalledWith(expect.anything(), { resource: 'b2b_org', id: OWN, access: 'auditor' });
  });

  it('answers 503, not 403, when the grant lookup failed and the authorizer does not admit the caller', async () => {
    caller({});
    getAccessAwareOrgs.mockResolvedValue({ resolved: new Map(), upstreamFailed: true, degraded: false });

    const res = await request(OWN);

    expect(res.status).toBe(503);
    expect(execute).not.toHaveBeenCalled();
  });

  // The id authorized must be the id queried: the non-canonical 15-char form is refused outright.
  it('rejects the 15-char form of an organization the caller can read', async () => {
    caller({ grants: [OWN] });

    const res = await request(OWN.slice(0, 15));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ errors: [expect.objectContaining({ field: 'accountId' })] });
    expect(execute).not.toHaveBeenCalled();
  });
});

describe('analytics router — org-lens-account-context resolves only accounts the caller may read', () => {
  it('resolves only the accounts the caller holds a permission on', async () => {
    caller({ grants: [OWN] });

    const res = await fetch(`${baseUrl}/api/analytics/org-lens-account-context?accountIds=${OWN},${VICTIM}`);

    expect(res.status).toBe(200);
    expect(queried(OWN)).toBe(true);
    expect(queried(VICTIM)).toBe(false);
  });

  it('returns an empty list without querying when no requested account is readable', async () => {
    caller({ boardMemberOf: [VICTIM] });

    const res = await fetch(`${baseUrl}/api/analytics/org-lens-account-context?accountIds=${VICTIM}`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });

  // A batch of made-up ids must not become one authorizer round-trip per id.
  it('checks the whole batch with one authorizer call', async () => {
    caller({ grants: [OWN] });
    const madeUp = Array.from({ length: 49 }, (_, index) => `001EXAMPLEZZ${String(index).padStart(3, '0')}AAA`);

    const res = await fetch(`${baseUrl}/api/analytics/org-lens-account-context?accountIds=${[OWN, ...madeUp].join(',')}`);

    expect(res.status).toBe(200);
    expect(queried(OWN)).toBe(true);
    expect(madeUp.some(queried)).toBe(false);
    expect(checkAccessStrict).toHaveBeenCalledTimes(1);
    expect(checkSingleAccessStrict).not.toHaveBeenCalled();
  });

  // Same two independent sources as the single-org gate (assertOrgLensRead): either one admits.
  it('includes an org the caller holds only a roster grant on, without asking the authorizer for it', async () => {
    caller({ grants: [OWN] });
    checkAccessStrict.mockImplementation(
      async (_req: unknown, resources: { id: string; access: string }[]) => new Map(resources.map((r) => [`${r.id}#${r.access}`, false]))
    );

    const res = await fetch(`${baseUrl}/api/analytics/org-lens-account-context?accountIds=${OWN},${VICTIM}`);

    expect(res.status).toBe(200);
    expect(queried(OWN)).toBe(true);
    expect(queried(VICTIM)).toBe(false);
    expect(checkAccessStrict).toHaveBeenCalledWith(expect.anything(), [{ resource: 'b2b_org', id: VICTIM, access: 'auditor' }]);
  });

  it('includes an org only the authorizer admits (LF team, cascade, key contact)', async () => {
    caller({});
    checkAccessStrict.mockImplementation(
      async (_req: unknown, resources: { id: string; access: string }[]) => new Map(resources.map((r) => [`${r.id}#${r.access}`, r.id === OWN]))
    );

    const res = await fetch(`${baseUrl}/api/analytics/org-lens-account-context?accountIds=${OWN},${VICTIM}`);

    expect(res.status).toBe(200);
    expect(queried(OWN)).toBe(true);
    expect(queried(VICTIM)).toBe(false);
  });

  it('fails closed with 503 when the authorizer cannot answer for an id the roster did not resolve', async () => {
    caller({ grants: [OWN] });
    checkAccessStrict.mockRejectedValue(new Error('authorizer down'));

    const res = await fetch(`${baseUrl}/api/analytics/org-lens-account-context?accountIds=${OWN},${VICTIM}`);

    expect(res.status).toBe(503);
    expect(execute).not.toHaveBeenCalled();
  });

  // A denial is only verified once the roster loaded: with it down, "no" could be a missed grant.
  it('fails closed with 503 when the roster failed and the authorizer does not admit an id', async () => {
    caller({});
    getAccessAwareOrgs.mockResolvedValue({ resolved: new Map(), upstreamFailed: true, degraded: false });

    const res = await fetch(`${baseUrl}/api/analytics/org-lens-account-context?accountIds=${OWN}`);

    expect(res.status).toBe(503);
    expect(execute).not.toHaveBeenCalled();
  });
});
