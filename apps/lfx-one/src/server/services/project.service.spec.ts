// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { ProjectFunding } from '@lfx-one/shared/enums';
import type { Project, QueryServiceResponse, ResolvedPeriodRange } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mirrors meeting.service.spec.ts: the `@lfx-one/shared/*` alias isn't wired into this app's
// vitest config, so every runtime (non-type-only) import needs a stub. `ProjectService`'s
// constructor also builds `NatsService`/`SnowflakeService`/`ETagService`; the Snowflake-backed
// suites below use only the `execute` mock, while the others stay trivial.
const { proxyRequest, addAccessToResources, checkAccess, execute } = vi.hoisted(() => ({
  proxyRequest: vi.fn(),
  addAccessToResources: vi.fn(),
  checkAccess: vi.fn(),
  execute: vi.fn(),
}));

vi.mock('@lfx-one/shared/constants', () => ({
  EVENT_GROWTH_TOP_EVENTS_LIMIT: 0,
  getYearForRange: vi.fn(),
  HEALTH_METRICS_RANGES: {},
  isHealthMetricsRange: vi.fn(),
  NATS_CONFIG: {},
  PENDING_ACTION_SEVERITY: {},
  PENDING_ACTION_SURVEYS_ROW_LIMIT: 0,
  PROJECT_HEALTH_SCORE_CATEGORIES: [],
  ROOT_PROJECT_SLUG: 'root',
}));
vi.mock('@lfx-one/shared/enums', () => ({}));
// computeIsFoundation and summarizeWriterGrants are pulled in from the REAL implementation
// (not hand-copied) so foundation-classification drift — e.g. a change to computeIsFoundation's
// Membership/stage rules — fails these tests too. summarizeWriterGrants's own `writer === true`
// filter can't be exercised from here (getDirectGrantProjects has already applied it before
// getWriterSummary ever calls summarizeWriterGrants); that's covered by
// packages/shared/src/utils/project.utils.spec.ts. Other `@lfx-one/shared/utils` exports this
// file doesn't touch stay stubbed.
//
// Deep-imports the single pure file rather than `vi.importActual('@lfx-one/shared/utils')`:
// the barrel re-exports Angular-dependent utils that pull in `@angular/common`'s `PlatformLocation`,
// which needs the Angular JIT compiler — unavailable under this plain-Node Vitest environment, so
// importing the barrel here throws at module-load time. `project.utils.ts` itself has no such
// dependency.
vi.mock('@lfx-one/shared/utils', async () => {
  const actual = await vi.importActual<typeof import('../../../../../packages/shared/src/utils/project.utils')>(
    '../../../../../packages/shared/src/utils/project.utils'
  );
  return {
    computeIsFoundation: actual.computeIsFoundation,
    summarizeWriterGrants: actual.summarizeWriterGrants,
    getDefaultMarketingImpactMonth: vi.fn(),
    nullifyEmptyStrings: vi.fn(),
    resolvePeriodRange: vi.fn(),
  };
});
vi.mock('./microservice-proxy.service', () => ({
  MicroserviceProxyService: class {
    public proxyRequest = proxyRequest;
  },
}));
vi.mock('./access-check.service', () => ({
  AccessCheckService: class {
    public addAccessToResources = addAccessToResources;
    public checkAccess = checkAccess;
  },
}));
vi.mock('./nats.service', () => ({ NatsService: class {} }));
vi.mock('./etag.service', () => ({ ETagService: class {} }));
vi.mock('./snowflake.service', () => ({ SnowflakeService: { getInstance: () => ({ execute }) } }));
vi.mock('./logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn(), sanitize: (v: unknown) => v },
}));

import type { Request } from 'express';

import { ProjectService } from './project.service';

const req = {} as unknown as Request;

function pageOf(projects: Partial<Project>[], pageToken?: string): QueryServiceResponse<Project> {
  return { resources: projects.map((p) => ({ id: `project:${p.uid}`, data: p as Project })), page_token: pageToken } as QueryServiceResponse<Project>;
}

/** Every param object any of the three create-picker project methods sent to the query service. */
function paramsSentTo(type: 'project'): Record<string, any>[] {
  return proxyRequest.mock.calls.filter((call) => call[3] === 'GET' && call[2] === '/query/resources' && call[4]?.type === type).map((call) => call[4]);
}

describe('ProjectService — create picker methods', () => {
  let service: ProjectService;

  beforeEach(() => {
    proxyRequest.mockReset();
    addAccessToResources.mockReset();
    checkAccess.mockReset();
    service = new ProjectService();
  });

  describe('getDirectGrantProjects', () => {
    it('queries filter_grants=direct and returns only writer-permitted projects', async () => {
      proxyRequest.mockResolvedValueOnce(
        pageOf([
          { uid: 'a', slug: 'a' },
          { uid: 'b', slug: 'b' },
        ])
      );
      addAccessToResources.mockImplementationOnce((_req: Request, projects: Project[]) =>
        Promise.resolve(projects.map((p) => ({ ...p, writer: p.uid === 'a' })))
      );

      const result = await service.getDirectGrantProjects(req);

      expect(result.map((p) => p.uid)).toEqual(['a']);
      expect(proxyRequest).toHaveBeenCalledTimes(1);
      expect(proxyRequest.mock.calls[0][4]).toMatchObject({ type: 'project', filter_grants: 'direct' });
    });

    it('excludes the ROOT pseudo-project', async () => {
      proxyRequest.mockResolvedValueOnce(pageOf([{ uid: 'root', slug: 'root' }]));
      addAccessToResources.mockImplementationOnce((_req: Request, projects: Project[]) => Promise.resolve(projects.map((p) => ({ ...p, writer: true }))));

      const result = await service.getDirectGrantProjects(req);

      expect(result).toEqual([]);
      expect(addAccessToResources).not.toHaveBeenCalled();
    });

    it('OR-includes meeting_coordinator when requested, without re-checking existing writers', async () => {
      proxyRequest.mockResolvedValueOnce(
        pageOf([
          { uid: 'a', slug: 'a' },
          { uid: 'b', slug: 'b' },
        ])
      );
      addAccessToResources.mockImplementationOnce((_req: Request, projects: Project[]) =>
        Promise.resolve(projects.map((p) => ({ ...p, writer: p.uid === 'a' })))
      );
      checkAccess.mockResolvedValueOnce(new Map([['b#meeting_coordinator', true]]));

      const result = await service.getDirectGrantProjects(req, true);

      expect(result.map((p) => p.uid).sort()).toEqual(['a', 'b']);
      // Only the non-writer ('b') needed the extra round trip.
      expect(checkAccess).toHaveBeenCalledTimes(1);
      expect(checkAccess.mock.calls[0][1]).toEqual([{ resource: 'project', id: 'b', access: 'meeting_coordinator' }]);
    });
  });

  // Membership-funded + Active + not an Internal Allocation, per the real computeIsFoundation.
  function foundation(uid: string): Partial<Project> {
    return { uid, slug: uid, stage: 'Active', legal_entity_type: '', funding: 'Funded' as ProjectFunding, funding_model: ['Membership'] };
  }
  // Missing the Membership funding model — the real computeIsFoundation returns false.
  function nonFoundation(uid: string): Partial<Project> {
    return { uid, slug: uid, stage: 'Active', legal_entity_type: '', funding: 'Funded' as ProjectFunding, funding_model: [] };
  }

  describe('getWriterSummary', () => {
    it('returns {true, false} when the only direct-writer project is a foundation', async () => {
      proxyRequest.mockResolvedValueOnce(pageOf([foundation('fdn')]));
      addAccessToResources.mockImplementationOnce((_req: Request, projects: Project[]) => Promise.resolve(projects.map((p) => ({ ...p, writer: true }))));

      const result = await service.getWriterSummary(req);

      expect(result).toEqual({ hasWriterFoundation: true, hasWriterProject: false });
    });

    it('returns {false, true} when the only direct-writer project is non-foundation', async () => {
      proxyRequest.mockResolvedValueOnce(pageOf([nonFoundation('proj')]));
      addAccessToResources.mockImplementationOnce((_req: Request, projects: Project[]) => Promise.resolve(projects.map((p) => ({ ...p, writer: true }))));

      const result = await service.getWriterSummary(req);

      expect(result).toEqual({ hasWriterFoundation: false, hasWriterProject: true });
    });

    it('returns {true, true} when direct-writer grants span both a foundation and a non-foundation project', async () => {
      proxyRequest.mockResolvedValueOnce(pageOf([foundation('fdn'), nonFoundation('proj')]));
      addAccessToResources.mockImplementationOnce((_req: Request, projects: Project[]) => Promise.resolve(projects.map((p) => ({ ...p, writer: true }))));

      const result = await service.getWriterSummary(req);

      expect(result).toEqual({ hasWriterFoundation: true, hasWriterProject: true });
    });

    it('returns {false, false} when the caller holds no direct writer grants', async () => {
      proxyRequest.mockResolvedValueOnce(pageOf([foundation('visible-only')]));
      addAccessToResources.mockImplementationOnce((_req: Request, projects: Project[]) => Promise.resolve(projects.map((p) => ({ ...p, writer: false }))));

      const result = await service.getWriterSummary(req);

      expect(result).toEqual({ hasWriterFoundation: false, hasWriterProject: false });
    });

    it('propagates upstream errors rather than resolving a fail-closed summary', async () => {
      proxyRequest.mockRejectedValueOnce(new Error('upstream unavailable'));

      await expect(service.getWriterSummary(req)).rejects.toThrow('upstream unavailable');
    });
  });

  describe('getChildProjects', () => {
    it('queries parent=project:<uid> and filters to writer-permitted children', async () => {
      proxyRequest.mockResolvedValueOnce(pageOf([{ uid: 'child-1', slug: 'child-1' }]));
      addAccessToResources.mockImplementationOnce((_req: Request, projects: Project[]) => Promise.resolve(projects.map((p) => ({ ...p, writer: true }))));

      const result = await service.getChildProjects(req, 'parent-uid');

      expect(result.map((p) => p.uid)).toEqual(['child-1']);
      expect(proxyRequest.mock.calls[0][4]).toMatchObject({ type: 'project', parent: 'project:parent-uid' });
    });
  });

  describe('searchCreatableProjects', () => {
    it('queries name=<term> with a small page size and filters to writer-permitted matches', async () => {
      proxyRequest.mockResolvedValueOnce(pageOf([{ uid: 'match-1', slug: 'match-1' }]));
      addAccessToResources.mockImplementationOnce((_req: Request, projects: Project[]) => Promise.resolve(projects.map((p) => ({ ...p, writer: true }))));

      const result = await service.searchCreatableProjects(req, 'kubernetes');

      expect(result.map((p) => p.uid)).toEqual(['match-1']);
      expect(proxyRequest.mock.calls[0][4]).toMatchObject({ type: 'project', name: 'kubernetes', page_size: 20 });
    });

    it('continues to the next page when the first page has no writer-permitted matches', async () => {
      // Page 1: visible-but-non-writable matches only. Page 2: the actual inherited-writer match.
      // A single-page search would return [] here even though a real target exists.
      proxyRequest.mockResolvedValueOnce(pageOf([{ uid: 'visible-only', slug: 'visible-only' }], 'token-2'));
      proxyRequest.mockResolvedValueOnce(pageOf([{ uid: 'inherited-writer', slug: 'inherited-writer' }]));
      addAccessToResources.mockImplementation((_req: Request, projects: Project[]) =>
        Promise.resolve(projects.map((p) => ({ ...p, writer: p.uid === 'inherited-writer' })))
      );

      const result = await service.searchCreatableProjects(req, 'kubernetes');

      expect(result.map((p) => p.uid)).toEqual(['inherited-writer']);
      expect(proxyRequest).toHaveBeenCalledTimes(2);
      expect(proxyRequest.mock.calls[1][4]).toMatchObject({ page_token: 'token-2' });
    });

    it('stops paging once the page cap is reached, even if pages remain', async () => {
      proxyRequest.mockResolvedValue(pageOf([{ uid: 'no-match', slug: 'no-match' }], 'more'));
      addAccessToResources.mockImplementation((_req: Request, projects: Project[]) => Promise.resolve(projects.map((p) => ({ ...p, writer: false }))));

      const result = await service.searchCreatableProjects(req, 'kubernetes');

      expect(result).toEqual([]);
      expect(proxyRequest).toHaveBeenCalledTimes(5);
    });
  });

  it('never issues a type=project query-service call without filter_grants, parent, or name', async () => {
    proxyRequest.mockResolvedValue(pageOf([]));
    addAccessToResources.mockImplementation((_req: Request, projects: Project[]) => Promise.resolve(projects));

    await service.getDirectGrantProjects(req);
    await service.getChildProjects(req, 'uid-1');
    await service.searchCreatableProjects(req, 'term');

    const calls = paramsSentTo('project');
    expect(calls.length).toBeGreaterThan(0);
    for (const params of calls) {
      expect(params['filter_grants'] === 'direct' || typeof params['parent'] === 'string' || typeof params['name'] === 'string').toBe(true);
    }
  });
});

describe('ProjectService — Snowflake-backed marketing reads', () => {
  let service: ProjectService;

  beforeEach(() => {
    execute.mockReset();
    service = new ProjectService();
  });

  describe('getSocialReach', () => {
    // Regression guard for the zero-fill bug: this method used to swallow Snowflake failures and
    // resolve a defaults object, which reached the dashboard as a 200 and rendered "zero spend,
    // 0.0x ROAS" — indistinguishable from a genuine measurement of zero. The rethrow is the whole
    // contract the callers' unavailable states depend on, so it needs coverage of its own;
    // otherwise a later refactor could reinstate the fallback with every test still green.
    it('propagates Snowflake failures rather than resolving zero-filled defaults', async () => {
      const failure = new Error('snowflake timeout');
      execute.mockRejectedValue(failure);

      await expect(service.getSocialReach('tlf', undefined, { start: '2026-01-01', end: '2026-07-01', label: 'test' } as any)).rejects.toBe(failure);
    });
  });

  describe('getEventsOverviewSummary', () => {
    const overviewRow = {
      PROJECT_ID: 'proj-1',
      REGISTRATIONS_COUNT: 1200,
      REGISTRATIONS_CHANGE: 0.52,
      ATTENDEES_COUNT: 800,
      ATTENDEES_CHANGE: -0.1,
      SPEAKERS_COUNT: 60,
      SPEAKERS_CHANGE: 0,
      COUNTRIES_COUNT: 30,
      COUNTRIES_CHANGE: null,
      COMPANIES_COUNT: 45,
      COMPANIES_CHANGE: 0.2,
      EVENT_COUNT: 12,
    };

    // The two reads resolve independently, so the mock is ordered: overview first, sponsorship second.
    function mockReads(overview: unknown[], sponsorship: unknown[]): void {
      execute.mockResolvedValueOnce({ rows: overview }).mockResolvedValueOnce({ rows: sponsorship });
    }

    it('maps both reads, passing through change fractions and preserving null', async () => {
      mockReads([overviewRow], [{ SPONSORSHIP_REVENUE: 1500000 }]);

      const result = await service.getEventsOverviewSummary('tlf');

      expect(result.projectId).toBe('proj-1');
      expect(result.registrations).toEqual({ value: 1200, changeFraction: 0.52 });
      expect(result.attendees).toEqual({ value: 800, changeFraction: -0.1 });
      // Zero is a real measured delta, not "no baseline" — it must survive as 0, not become null.
      expect(result.speakers).toEqual({ value: 60, changeFraction: 0 });
      expect(result.countries).toEqual({ value: 30, changeFraction: null });
      expect(result.organizations).toEqual({ value: 45, changeFraction: 0.2 });
      expect(result.sponsorship).toEqual({ value: 1500000, changeFraction: null });
    });

    // Events and Sponsorship have no modeled YoY column; the contract is a value with a null
    // delta, so the UI renders no change indicator rather than a fabricated 0%.
    it('reports no YoY delta for events and sponsorship', async () => {
      mockReads([overviewRow], [{ SPONSORSHIP_REVENUE: 42 }]);

      const result = await service.getEventsOverviewSummary('tlf');

      expect(result.events).toEqual({ value: 12, changeFraction: null });
      expect(result.sponsorship.changeFraction).toBeNull();
    });

    it('falls back to zeroed metrics when the foundation has no overview row', async () => {
      mockReads([], []);

      const result = await service.getEventsOverviewSummary('unknown-slug');

      expect(result.projectId).toBe('');
      expect(result.registrations).toEqual({ value: 0, changeFraction: null });
      expect(result.sponsorship).toEqual({ value: 0, changeFraction: null });
    });

    // Same contract the getSocialReach guard above protects: a Snowflake failure must not be
    // laundered into a zero-filled 200, which the dashboard would render as measured zeros.
    it('propagates Snowflake failures rather than resolving zero-filled defaults', async () => {
      const failure = new Error('snowflake timeout');
      execute.mockRejectedValue(failure);

      await expect(service.getEventsOverviewSummary('tlf')).rejects.toBe(failure);
    });
  });

  describe('getEventDetail', () => {
    const eventRow = {
      EVENT_ID: 'evt-1',
      EVENT_NAME: 'KubeCon NA',
      START_DATE: '2026-11-10',
      EVENT_COUNTRY: 'United States',
      EVENT_URL: 'https://events.example.org/kubecon',
      REG_ACTUAL: 900,
      REG_GOAL: 1000,
      SPON_GOAL: 1000000,
      VS_LY: 1.1,
      COMP_SCORE: 'high',
      CFP_STATUS: 'Review Complete',
    };

    // Ordered mock: the event query resolves first, the tier query second.
    function mockReads(event: unknown[], tiers: unknown[]): void {
      execute.mockResolvedValueOnce({ rows: event }).mockResolvedValueOnce({ rows: tiers });
    }

    it('maps the event and its tier breakdown', async () => {
      mockReads(
        [eventRow],
        [
          { SPONSORSHIP_TIER: 'Diamond', REVENUE: 300000, SPONSOR_COUNT: 2 },
          { SPONSORSHIP_TIER: 'Gold', REVENUE: 200000, SPONSOR_COUNT: 4 },
        ]
      );

      const result = await service.getEventDetail('evt-1', 'tlf');

      expect(result?.eventName).toBe('KubeCon NA');
      // Sponsorship actual is summed from the tier rows, not read from the event row.
      expect(result?.sponsorshipRevenue).toEqual({ actual: 500000, goal: 1000000 });
      expect(result?.sponsorshipTiers).toHaveLength(2);
    });

    // Both queries are scoped by foundation: the event id alone carries no ownership, so an ED
    // could otherwise read another foundation's sponsorship revenue by guessing an id.
    it('binds the foundation slug ahead of the event id in both reads', async () => {
      mockReads([eventRow], []);

      await service.getEventDetail('evt-1', 'tlf');

      expect(execute).toHaveBeenCalledTimes(2);
      for (const [sql, binds] of execute.mock.calls) {
        expect(sql).toContain('slug_resolve');
        expect(binds).toEqual(['tlf', 'evt-1']);
      }
    });

    // An event outside the caller's foundation is filtered out by the slug_resolve join, so it
    // is indistinguishable from a nonexistent one — no existence oracle for other foundations.
    it('returns null when the event is not in the caller’s foundation', async () => {
      mockReads([], []);

      await expect(service.getEventDetail('evt-1', 'other-foundation')).resolves.toBeNull();
    });

    it('propagates Snowflake failures rather than resolving a partial event', async () => {
      const failure = new Error('snowflake timeout');
      execute.mockRejectedValue(failure);

      await expect(service.getEventDetail('evt-1', 'tlf')).rejects.toBe(failure);
    });
  });
});

describe('ProjectService — paid ads compatibility', () => {
  const period: ResolvedPeriodRange = {
    type: 'trailing',
    startDate: '2026-01-01',
    endDate: '2026-07-01',
    label: 'Last 6 months',
  };

  beforeEach(() => {
    execute.mockReset();
  });

  it('translates keyword attribution failures without exposing Snowflake details', async () => {
    const attributionError = new Error('keyword attribution unavailable');
    execute.mockImplementation((sql: string) => {
      if (sql.includes('PAID_ADS_KEYWORD_ATTRIBUTION')) {
        return Promise.reject(attributionError);
      }
      return Promise.resolve({ rows: [], metadata: [] });
    });

    await expect(new ProjectService().getKeywordPerformance('cncf', period)).rejects.toMatchObject({
      message: 'Keyword attribution data is temporarily unavailable',
      code: 'KEYWORD_ATTRIBUTION_UNAVAILABLE',
      statusCode: 503,
      originalError: attributionError,
    });
  });

  it('retries only the missing last-touch conversion column with the legacy query', async () => {
    execute.mockImplementation((sql: string) => {
      if (sql.includes('PROJECT_NAME, CAMPAIGN_NAME') && sql.includes('LAST_TOUCH_CONVERSIONS')) {
        return Promise.reject(new Error("SQL compilation error: invalid identifier 'LAST_TOUCH_CONVERSIONS'"));
      }
      if (sql.includes('PROJECT_NAME, CAMPAIGN_NAME') && sql.includes('SUM(CONV)')) {
        return Promise.resolve({
          rows: [
            {
              PROJECT_NAME: 'Project',
              CAMPAIGN_NAME: 'Campaign',
              FUNNEL_STAGE: 'ToFU',
              SPEND: 100,
              REVENUE: 200,
              ROAS: 2,
              CONVERSIONS: 3,
              CONV_RATE: 1.5,
              CPC: 0.5,
              SESSIONS: 10,
              IMPRESSIONS: 1_000,
              CLICKS: 200,
            },
          ],
          metadata: [],
        });
      }
      return Promise.resolve({ rows: [], metadata: [] });
    });

    const result = await new ProjectService().getSocialReach('cncf', undefined, period);

    expect(result.projectBreakdown?.[0]).toMatchObject({ conversions: 3, convRate: 1.5 });
    expect(
      execute.mock.calls.some(
        ([sql, , options]) => String(sql).includes('LAST_TOUCH_CONVERSIONS') && options?.expectInvalidIdentifier === 'LAST_TOUCH_CONVERSIONS'
      )
    ).toBe(true);
    expect(execute.mock.calls.some(([sql]) => String(sql).includes('SUM(CONV)'))).toBe(true);
  });
});
