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
  // Real mapping rather than an empty stub, so a future getEmailCtr test exercises the actual
  // filter. No test calls getEmailCtr today — see the note on the focus filter in project.service.
  CLASSIFICATION_TO_EMAIL_TYPES: { 'LF Events': ['EVENT'] },
  // Real values, not 0: these are interpolated into the LIMIT clause, and a 0 would make the
  // asserted SQL diverge from what production actually sends.
  EMAIL_CAMPAIGN_LIMIT: 12,
  EVENT_GROWTH_TOP_EVENTS_LIMIT: 0,
  PAID_CAMPAIGN_LIMIT: 25,
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
  // The real normalizeToUrl, not a stub: the roster and detail reads both depend on it to reject
  // scheme-less/unsafe warehouse URLs, so a stub would let that regress with tests still green.
  const urlUtils = await vi.importActual<typeof import('../../../../../packages/shared/src/utils/url.utils')>(
    '../../../../../packages/shared/src/utils/url.utils'
  );
  return {
    computeIsFoundation: actual.computeIsFoundation,
    summarizeWriterGrants: actual.summarizeWriterGrants,
    normalizeToUrl: urlUtils.normalizeToUrl,
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

    // A month period takes a different code path entirely: it re-aggregates from the event-grained
    // MARKETING_EVENT_REGISTRATIONS rather than reading the YTD rollups, so none of the coverage
    // above touches it.
    describe('month period', () => {
      const month = { type: 'month', startDate: '2026-03-01', endDate: '2026-04-01', label: 'March 2026' } as any;

      it('re-aggregates the three event-grained metrics and reports the month scope', async () => {
        execute.mockResolvedValueOnce({ rows: [{ PROJECT_ID: 'proj-1', EVENT_COUNT: 3, REGISTRATIONS_COUNT: 410, SPEAKERS_COUNT: 12 }] });

        const result = await service.getEventsOverviewSummary('tlf', month);

        expect(result.scope).toBe('month');
        expect(result.events).toEqual({ value: 3, changeFraction: null });
        expect(result.registrations).toEqual({ value: 410, changeFraction: null });
        expect(result.speakers).toEqual({ value: 12, changeFraction: null });
      });

      // These four exist only as pre-aggregated YTD rollups with no monthly grain anywhere in the
      // Platinum layer. They must come back null — a 0 would read as "measured none this month".
      it('returns null, not zero, for the metrics with no monthly grain', async () => {
        execute.mockResolvedValueOnce({ rows: [{ PROJECT_ID: 'proj-1', EVENT_COUNT: 3, REGISTRATIONS_COUNT: 410, SPEAKERS_COUNT: 12 }] });

        const result = await service.getEventsOverviewSummary('tlf', month);

        expect(result.attendees).toEqual({ value: null, changeFraction: null });
        expect(result.countries).toEqual({ value: null, changeFraction: null });
        expect(result.organizations).toEqual({ value: null, changeFraction: null });
        expect(result.sponsorship).toEqual({ value: null, changeFraction: null });
      });

      it('binds the slug and the month boundaries, in that order', async () => {
        execute.mockResolvedValueOnce({ rows: [{ PROJECT_ID: 'proj-1', EVENT_COUNT: 0, REGISTRATIONS_COUNT: 0, SPEAKERS_COUNT: 0 }] });

        await service.getEventsOverviewSummary('tlf', month);

        expect(execute).toHaveBeenCalledWith(expect.any(String), ['tlf', '2026-03-01', '2026-04-01']);
      });

      // Regression guard: the aggregate used to read MAX(r.PROJECT_ID) off the joined event rows,
      // so a month with no events produced MAX() over an empty set — NULL — and emitted
      // projectId: ''. That is the same sentinel the client reads as "the request failed", so a
      // genuinely quiet month rendered as an outage. The id now comes from slug_resolve via a
      // LEFT JOIN and must survive with zero events.
      it('keeps the resolved project id when the month has no events', async () => {
        execute.mockResolvedValueOnce({ rows: [{ PROJECT_ID: 'proj-1', EVENT_COUNT: 0, REGISTRATIONS_COUNT: 0, SPEAKERS_COUNT: 0 }] });

        const result = await service.getEventsOverviewSummary('tlf', month);

        expect(result.projectId).toBe('proj-1');
        expect(result.events).toEqual({ value: 0, changeFraction: null });
      });
    });
  });

  // Same contract the getSocialReach guard above pins: a Snowflake failure must not be laundered
  // into a zero-filled 200. It reached the email tab as a success, so an outage rendered
  // "Total Sends 0 · CTR 0.00%" as measurements and no client guard could see the difference.
  describe('getEmailCtr', () => {
    // Typed rather than cast: a change to ResolvedPeriodRange should break this at compile time.
    const EMAIL_CTR_PERIOD: ResolvedPeriodRange = { type: 'month', startDate: '2026-03-01', endDate: '2026-04-01', label: 'March 2026' };

    it('propagates Snowflake failures rather than resolving zero-filled defaults', async () => {
      const failure = new Error('snowflake timeout');
      execute.mockRejectedValue(failure);

      await expect(service.getEmailCtr('tlf', undefined, EMAIL_CTR_PERIOD)).rejects.toBe(failure);
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

    // Ordered mock for the first three reads (event, tier, channel attribution). getEventDetail
    // also awaits getEventPacing, which issues two more — defaulted to empty rather than counted,
    // so adding a query to that path doesn't break these cases.
    function mockReads(event: unknown[], tiers: unknown[], channels: unknown[] = []): void {
      execute
        .mockResolvedValueOnce({ rows: event })
        .mockResolvedValueOnce({ rows: tiers })
        .mockResolvedValueOnce({ rows: channels })
        .mockResolvedValue({ rows: [] });
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

      // Identified by content, not call order: getEventDetail also drives the channel and pacing
      // reads, and a positional assertion would silently pass if a scoped query were reordered.
      const scoped = execute.mock.calls.filter(
        ([sql]) => String(sql).includes('MARKETING_EVENT_REGISTRATIONS r') || String(sql).includes('SPONSORSHIPS_BY_TIER t')
      );
      expect(scoped).toHaveLength(2);
      for (const [sql, binds] of scoped) {
        expect(sql).toContain('slug_resolve');
        expect(binds).toEqual(['tlf', 'evt-1']);
      }
    });

    // The campaign enrichment matches on an event-NAME substring, which is not a scope: another
    // foundation can run a campaign whose name contains the same words, and this feeds an ED-only
    // response. A non-umbrella caller must therefore carry FOUNDATION_SLUG into both reads.
    it('scopes the paid and email campaign lookups to a non-umbrella foundation', async () => {
      mockReads([eventRow], []);

      await service.getEventDetail('evt-1', 'cncf');

      const campaignReads = execute.mock.calls.filter(
        ([sql]) => String(sql).includes('PAID_SOCIAL_REACH_BY_PROJECT_CHANNEL_MONTH') || String(sql).includes('EMAIL_CAMPAIGN_PERFORMANCE')
      );
      expect(campaignReads.length).toBeGreaterThan(0);
      for (const [sql, binds] of campaignReads) {
        expect(sql).toContain('FOUNDATION_SLUG = ?');
        expect(binds).toContain('cncf');
      }
    });

    // The headline aggregate has no outer GROUP BY, so it returns exactly one row even when the
    // event has no prediction records — every column NULL. A truthiness check on that row reports
    // available: true and renders "Current 0 / Predicted 0", which reads as a measured zero rather
    // than an absent model.
    it('reports pacing unavailable when the prediction aggregate comes back all-NULL', async () => {
      execute.mockImplementation((sql: string) => {
        const text = String(sql);
        if (text.includes('FINAL_CURRENT_CUMULATIVE_REGISTRATIONS')) {
          return Promise.resolve({ rows: [{ DAYS_LEFT: null, CUR_REGS: null, PRIOR: null, PRED_AVG: null, PRED_LOW: null, PRED_HIGH: null }] });
        }
        if (text.includes('MARKETING_EVENT_REGISTRATIONS r') || text.includes('SPONSORSHIPS_BY_TIER t')) {
          return Promise.resolve({ rows: text.includes('SPONSORSHIPS_BY_TIER t') ? [] : [eventRow] });
        }
        return Promise.resolve({ rows: [] });
      });

      const result = await service.getEventDetail('evt-1', 'tlf');

      expect(result?.pacing.available).toBe(false);
      expect(result?.pacing.current).toBeNull();
    });

    // Both pacing reads hit the same day-grained predictions table. This previously asserted the
    // opposite — that the curve came from a MARKETING_EVENT_REGISTRATION_PREDICTIONS_DRILLDOWN —
    // a table that exists in no schema; the name was inferred from PCC's
    // `eventRegistrationPredictionDrilldown` component, which is a UI concept, not a table. The
    // curve query therefore failed with a compile error on every request, the degrade path
    // swallowed it, and the chart never rendered while the test stayed green. Asserting the
    // absence of that name is the point: it is what keeps the invented table from returning.
    it('reads both the headline and the curve from the predictions table', async () => {
      mockReads([eventRow], []);

      await service.getEventDetail('evt-1', 'tlf');

      const pacingReads = execute.mock.calls.filter(([sql]) => String(sql).includes('MARKETING_EVENT_REGISTRATION_PREDICTIONS'));
      const head = pacingReads.find(([sql]) => String(sql).includes('FINAL_CURRENT_CUMULATIVE_REGISTRATIONS'));
      const curve = pacingReads.find(([sql]) => String(sql).includes('DAYS_TO_EVENT'));

      expect(head).toBeDefined();
      expect(curve).toBeDefined();
      expect(String(head![0])).not.toContain('_DRILLDOWN');
      expect(String(curve![0])).not.toContain('_DRILLDOWN');
    });

    // The current-year series is the predicted curve cut at today, so the cutoff column decides
    // where the solid line stops. DAYS_TO_EVENT counts up to 0 on the event day, which makes
    // DAYS_LEFT_FROM_YESTERDAY — not 0 — the position of "today": splitting at 0 would mark the
    // entire curve, future days included, as current-year and draw one unbroken solid line.
    it('cuts the current-year series at today, not at the event date', async () => {
      mockReads([eventRow], []);

      await service.getEventDetail('evt-1', 'tlf');

      const curve = execute.mock.calls
        .map(([sql]) => String(sql))
        .find((sql) => sql.includes('MARKETING_EVENT_REGISTRATION_PREDICTIONS') && sql.includes('DAYS_TO_EVENT'));

      expect(curve).toBeDefined();
      expect(curve!).toContain('DAYS_TO_EVENT <= DAYS_LEFT_FROM_YESTERDAY');
    });

    // The client maps the points array straight onto the x-axis without sorting, so the SQL order
    // is the plot order. DAYS_TO_EVENT runs from the earliest day (most negative) up to 0 on the
    // event day; a DESC order would put the event day leftmost and draw every series in reverse —
    // a chart that still renders, with no error, showing registrations falling to zero.
    it('returns the curve oldest-day-first so the chart plots left to right', async () => {
      mockReads([eventRow], []);

      await service.getEventDetail('evt-1', 'tlf');

      const curve = execute.mock.calls
        .map(([sql]) => String(sql))
        .find((sql) => sql.includes('MARKETING_EVENT_REGISTRATION_PREDICTIONS') && sql.includes('DAYS_TO_EVENT'));

      expect(curve).toBeDefined();
      expect(curve!).not.toMatch(/ORDER BY DAYS_TO_EVENT\s+DESC/i);
    });

    // hasPriorYear comes from the measured prior-year total, not EVENT_CREATED_LAST_YEAR, because
    // that flag contradicts the rest of its own row: Linux Security Summit Europe 2026 carries
    // CREATED_LAST_YEAR = false beside a 1.09 comparison ratio and COMP_SCORE 'high', with five
    // prior editions on record. Reading the flag rendered "no prior year" beneath an "Ahead of
    // last year" badge — one row, two cards, opposite claims.
    // Routed on the SQL rather than call order: getEventDetail fans its campaign and pacing reads
    // out through Promise.all, so a positional mock silently feeds the pacing head row to whichever
    // query happens to resolve in that slot.
    function mockWithPacingHead(event: unknown, priorYear: number): void {
      execute.mockImplementation((sql: string) => {
        const text = String(sql);
        if (text.includes('FINAL_CURRENT_CUMULATIVE_REGISTRATIONS')) {
          return Promise.resolve({
            rows: [{ DAYS_LEFT: 30, CUR_REGS: 48, PRIOR: priorYear, PRED_AVG: 200, PRED_LOW: 190, PRED_HIGH: 210 }],
          });
        }
        if (text.includes('MARKETING_EVENT_REGISTRATIONS r')) return Promise.resolve({ rows: [event] });
        return Promise.resolve({ rows: [] });
      });
    }

    it('reports a prior year from the measured total, not the CREATED_LAST_YEAR flag', async () => {
      mockWithPacingHead({ ...eventRow, CREATED_LAST_YEAR: false }, 46);

      const result = await service.getEventDetail('evt-1', 'tlf');

      expect(result).not.toBeNull();
      expect(result!.hasPriorYear).toBe(true);
    });

    // The mirror case: no measured prior-year registrations means no baseline, whatever the
    // warehouse says elsewhere, so the drawer falls back to its "no prior year" branch.
    it('reports no prior year when the prior-year total is zero', async () => {
      mockWithPacingHead({ ...eventRow, CREATED_LAST_YEAR: true }, 0);

      const result = await service.getEventDetail('evt-1', 'tlf');

      expect(result).not.toBeNull();
      expect(result!.hasPriorYear).toBe(false);
    });

    // A null prior-year total means "no prior edition" OR "the pacing read degraded", and the two
    // are not the same claim. Deriving the flag from the total alone made an unmaterialized table
    // report every event as a first-timer, which five consumers then assert — "no prior year",
    // "No pace signal", a dropped Last year series and "No prior event data". With no measurement
    // to prefer, the row flag is the better answer: wrong on some rows, but a statement about the
    // event rather than about the pipeline.
    it('falls back to the row flag when the pacing read is unavailable', async () => {
      execute.mockImplementation((sql: string) => {
        // No pacing head row, so getEventPacing returns its unavailable block (priorYear: null).
        if (String(sql).includes('MARKETING_EVENT_REGISTRATIONS r')) {
          return Promise.resolve({ rows: [{ ...eventRow, CREATED_LAST_YEAR: true }] });
        }
        return Promise.resolve({ rows: [] });
      });

      const result = await service.getEventDetail('evt-1', 'tlf');

      expect(result).not.toBeNull();
      expect(result!.pacing.available).toBe(false);
      expect(result!.hasPriorYear).toBe(true);
    });

    // The table holds duplicate (event, type, day) rows — 1,669 such groups, two rows carrying the
    // same values under different _KEYs. Summing them straight doubled that day alone: Open Source
    // Summit EU 2026 jumped 1,244 -> 2,488 on one day, drawing a vertical needle mid-curve. Each
    // registration type has to collapse to one row before the types are summed together.
    it('collapses duplicate rows per registration type before summing the curve', async () => {
      mockReads([eventRow], []);

      await service.getEventDetail('evt-1', 'tlf');

      const curve = execute.mock.calls
        .map(([sql]) => String(sql))
        .find((sql) => sql.includes('MARKETING_EVENT_REGISTRATION_PREDICTIONS') && sql.includes('DAYS_TO_EVENT'));

      expect(curve).toBeDefined();
      // Grouped by type in an inner query, so the outer SUM sees one row per type per day.
      expect(curve!).toContain('GROUP BY DAYS_TO_EVENT, EVENT_REGISTRATION_TYPE');
      // The raw columns must not be summed directly — that is the doubling.
      expect(curve!).not.toMatch(/SUM\(\s*CUMULATIVE_AVG_PREDICTED_REGISTRATIONS\s*\)/);
    });

    // Name matching cannot separate editions: the year-stripped pattern is there to catch campaigns
    // that omit the year, and it matches the 2025 edition of a 2026 event just as well. Without a
    // date bound last year's spend lands on this year's drawer. Nine months rather than twelve so
    // an annual event's window stops short of the previous edition's own campaign month.
    it("bounds the campaign match to this edition's run-up window", async () => {
      mockReads([eventRow], []);

      await service.getEventDetail('evt-1', 'cncf');

      const campaignReads = execute.mock.calls.filter(
        ([sql]) => String(sql).includes('PAID_SOCIAL_REACH_BY_PROJECT_CHANNEL_MONTH') || String(sql).includes('EMAIL_CAMPAIGN_PERFORMANCE')
      );
      expect(campaignReads.length).toBeGreaterThan(0);
      for (const [sql, binds] of campaignReads) {
        // Month-truncated, because CAMPAIGN_MONTH/PUBLISHED_DATE are month-grained: day-level
        // bounds off a mid-month event date clip the first lookback month.
        expect(sql).toContain("DATE_TRUNC('MONTH', DATEADD('MONTH', -9,");
        expect(sql).toContain("DATE_TRUNC('MONTH', DATEADD('MONTH', 2,");
        // The event's own start date bounds both ends of the window.
        expect(binds.slice(-2)).toEqual([eventRow.START_DATE, eventRow.START_DATE]);
      }
    });

    // The umbrella foundation deliberately spans every project, so it stays unfiltered — the same
    // exception buildFoundationFilter makes everywhere else. Asserted so a later "tighten the
    // scope" change cannot silently blank the umbrella view.
    it('leaves the umbrella foundation unfiltered on the campaign lookups', async () => {
      mockReads([eventRow], []);

      await service.getEventDetail('evt-1', 'tlf');

      const campaignReads = execute.mock.calls.filter(
        ([sql]) => String(sql).includes('PAID_SOCIAL_REACH_BY_PROJECT_CHANNEL_MONTH') || String(sql).includes('EMAIL_CAMPAIGN_PERFORMANCE')
      );
      expect(campaignReads.length).toBeGreaterThan(0);
      for (const [sql] of campaignReads) {
        expect(sql).not.toContain('FOUNDATION_SLUG = ?');
      }
    });

    // An event outside the caller's foundation is filtered out by the slug_resolve join, so it
    // is indistinguishable from a nonexistent one — no existence oracle for other foundations.
    it('returns null when the event is not in the caller’s foundation', async () => {
      mockReads([], []);

      await expect(service.getEventDetail('evt-1', 'other-foundation')).resolves.toBeNull();
    });

    // Same contract as the getSocialReach guard above: a real failure must not be laundered into
    // a legitimate-looking "no data yet" state. Only an unmaterialized table is unavailable.
    it('propagates a pacing query failure rather than reporting pacing unavailable', async () => {
      const failure = new Error('SQL compilation error: invalid identifier FOO');
      execute
        .mockResolvedValueOnce({ rows: [eventRow] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockRejectedValue(failure);

      await expect(service.getEventDetail('evt-1', 'tlf')).rejects.toBe(failure);
    });

    it('reports pacing unavailable when the prediction table is not materialized', async () => {
      execute
        .mockResolvedValueOnce({ rows: [eventRow] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockRejectedValue(new Error("Object 'MARKETING_EVENT_REGISTRATION_PREDICTIONS' does not exist or not authorized."));

      const result = await service.getEventDetail('evt-1', 'tlf');

      expect(result?.pacing.available).toBe(false);
    });

    it('propagates Snowflake failures rather than resolving a partial event', async () => {
      const failure = new Error('snowflake timeout');
      execute.mockRejectedValue(failure);

      await expect(service.getEventDetail('evt-1', 'tlf')).rejects.toBe(failure);
    });

    // The drawer binds eventUrl straight to [href]; a scheme-less warehouse value would resolve
    // as a relative LFX One path rather than the external event page.
    it('normalizes a scheme-less event URL instead of passing it through raw', async () => {
      mockReads([{ ...eventRow, EVENT_URL: 'events.example.org/kubecon' }], []);

      const result = await service.getEventDetail('evt-1', 'tlf');

      expect(result?.eventUrl).toBe('https://events.example.org/kubecon');
    });

    it('drops an unsafe event URL rather than exposing it', async () => {
      mockReads([{ ...eventRow, EVENT_URL: 'javascript:alert(1)' }], []);

      const result = await service.getEventDetail('evt-1', 'tlf');

      expect(result?.eventUrl).toBe('');
    });
  });

  // The roster's period handling is easy to get backwards: every month the picker offers has
  // already ended, so a bare range predicate silently drops every upcoming row and turns
  // "Including past" into "past only".
  describe('getEventRoster period scoping', () => {
    const month = { type: 'month', startDate: '2026-03-01', endDate: '2026-04-01', label: 'March 2026' } as any;

    it('leaves the upcoming roster unbounded when includePast is false', async () => {
      execute.mockResolvedValue({ rows: [] });

      await service.getEventRoster('tlf', false, month);

      const [sql, binds] = execute.mock.calls[0];
      expect(sql).toContain('EVENT_IS_PAST = FALSE');
      expect(sql).not.toContain('EVENT_START_DATE >=');
      expect(binds).toEqual(['tlf']);
    });

    // Regression guard: past events from the range are ADDED to the upcoming ones.
    it('adds past events from the period instead of replacing the upcoming roster', async () => {
      execute.mockResolvedValue({ rows: [] });

      await service.getEventRoster('tlf', true, month);

      const [sql, binds] = execute.mock.calls[0];
      expect(sql).toContain('EVENT_IS_PAST = FALSE OR');
      expect(binds).toEqual(['tlf', '2026-03-01', '2026-04-01']);
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
