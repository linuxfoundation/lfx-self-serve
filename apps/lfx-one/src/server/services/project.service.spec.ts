// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { ProjectFunding } from '@lfx-one/shared/enums';
import type { Project, QueryServiceResponse, ResolvedPeriodRange } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mirrors meeting.service.spec.ts: the `@lfx-one/shared/*` alias isn't wired into this app's
// vitest config, so every runtime (non-type-only) import needs a stub. `ProjectService`'s
// constructor also builds `NatsService`/`SnowflakeService`/`ETagService`; the Snowflake-backed
// suites below use only the `execute` mock, while the others stay trivial.
const {
  proxyRequest,
  addAccessToResources,
  addAccessToResource,
  checkAccess,
  checkSingleAccessStrict,
  execute,
  warning,
  startOperation,
  debug,
  success,
  fetchWithETag,
  updateWithETag,
  natsRequest,
} = vi.hoisted(() => ({
  proxyRequest: vi.fn(),
  addAccessToResources: vi.fn(),
  addAccessToResource: vi.fn(),
  checkAccess: vi.fn(),
  checkSingleAccessStrict: vi.fn(),
  execute: vi.fn(),
  warning: vi.fn(),
  // Typed rather than a bare `vi.fn(() => 0)` so the metadata-masking suite below can index
  // `mock.calls[n][2]`: a zero-arg implementation infers a `[]` args tuple, and that index is a
  // type error the app build rejects. The signature mirrors the real
  // `logger.startOperation(req, operation, metadata)`.
  startOperation: vi.fn<(req?: unknown, operation?: string, metadata?: Record<string, unknown>) => number>(() => 0),
  debug: vi.fn(),
  success: vi.fn(),
  fetchWithETag: vi.fn(),
  updateWithETag: vi.fn(),
  natsRequest: vi.fn(),
}));

vi.mock('@lfx-one/shared/constants', async () => {
  // Real value, not a hardcoded copy that can drift: updateProjectStaff re-codes its own
  // settings 404 with this constant, and the re-coding test asserts on it. The barrel is
  // mocked because it re-exports Angular-dependent constants; `project-staff.constants.ts`
  // itself only has a type-only import from `../interfaces`, so importing it directly is safe.
  const staffConstants = await vi.importActual<typeof import('../../../../../packages/shared/src/constants/project-staff.constants')>(
    '../../../../../packages/shared/src/constants/project-staff.constants'
  );
  // Real value, not a hardcoded copy that can drift: getFoundationProfileSummary returns this
  // exact object on the empty-rows/missing-table paths, and the tests assert equality against it.
  // dashboard-metrics.constants.ts has no Angular-dependent imports, so importing it directly is safe.
  const dashboardMetricsConstants = await vi.importActual<typeof import('../../../../../packages/shared/src/constants/dashboard-metrics.constants')>(
    '../../../../../packages/shared/src/constants/dashboard-metrics.constants'
  );
  // Real value, not a hardcoded copy: getHealthOverviewKpis iterates this set, so a stale copy
  // would keep passing after a real area is added/removed. Importing it directly is safe (no Angular deps).
  const healthMetricsOverviewConstants = await vi.importActual<typeof import('../../../../../packages/shared/src/constants/health-metrics-overview.constants')>(
    '../../../../../packages/shared/src/constants/health-metrics-overview.constants'
  );

  return {
    PROJECT_SETTINGS_NOT_FOUND_CODE: staffConstants.PROJECT_SETTINGS_NOT_FOUND_CODE,
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
    // Real values, not []: normalizeHealthScoreCategory (getFoundationProjectsDetail) validates the
    // upstream HEALTH_SCORE_CATEGORY_V2 string against this set, so an empty stub would silently null
    // out every genuine category.
    PROJECT_HEALTH_SCORE_CATEGORIES: ['critical', 'concerning', 'fair', 'healthy', 'excellent'],
    ROOT_PROJECT_SLUG: 'root',
    // Real values (3 / 40, matching foundation-projects.constants.ts), not 0/undefined: discoverSubFoundations
    // compares depth/budget against these at runtime, so a test exercising the depth or node cap needs the
    // actual numeric thresholds — not the arbitrary values a bare stub would produce.
    FOUNDATION_DESCENDANT_TRAVERSAL_MAX_DEPTH: 3,
    FOUNDATION_DESCENDANT_TRAVERSAL_MAX_NODES: 40,
    // Real values (8, matching foundation-projects.constants.ts): the detail-fetch and sibling-traversal
    // worker pools both size via Math.min() against these, so they must be real positive numbers.
    FOUNDATION_PROJECT_DETAIL_FETCH_CONCURRENCY: 8,
    FOUNDATION_DESCENDANT_TRAVERSAL_SIBLING_CONCURRENCY: 8,
    // Real value (100, matching the shared constant): getFoundationProjectUids compares its resolved
    // UID count against this to decide whether to warn about an unbatched filters_or fan-out.
    QUERY_SERVICE_FILTERS_OR_BATCH_SIZE: 100,
    HEALTH_METRICS_OVERVIEW_FOUNDATION_SUMMARY_DEFAULT: dashboardMetricsConstants.HEALTH_METRICS_OVERVIEW_FOUNDATION_SUMMARY_DEFAULT,
    HEALTH_METRICS_OVERVIEW_LIVE_KPI_AREAS: healthMetricsOverviewConstants.HEALTH_METRICS_OVERVIEW_LIVE_KPI_AREAS,
    // Real function, not a stub: both getHealthOverview* queries generate their period-suffixed
    // column list from this, so a stub would emit SQL that diverges from production.
    buildHealthMetricsOverviewPeriods: healthMetricsOverviewConstants.buildHealthMetricsOverviewPeriods,
    HEALTH_OVERVIEW_KPI_PERIOD_COLUMNS: healthMetricsOverviewConstants.HEALTH_OVERVIEW_KPI_PERIOD_COLUMNS,
    HEALTH_OVERVIEW_REVENUE_PERIOD_COLUMNS: healthMetricsOverviewConstants.HEALTH_OVERVIEW_REVENUE_PERIOD_COLUMNS,
  };
});
vi.mock('@lfx-one/shared/enums', async () => {
  // Real enum, not a stub: the directory-lookup tests assert which subject the NATS request was
  // sent on. nats.enum.ts is a bare string enum with no imports, so deep-importing it is safe.
  const natsEnum = await vi.importActual<typeof import('../../../../../packages/shared/src/enums/nats.enum')>(
    '../../../../../packages/shared/src/enums/nats.enum'
  );

  return {
    NatsSubjects: natsEnum.NatsSubjects,
    // Real enum, not a stub: discoverSubFoundations compares `child.stage !== ProjectStage.Active` at
    // runtime, so tests exercising the public/Active visibility gate need the actual string values.
    ProjectStage: {
      FormationExploratory: 'Formation - Exploratory',
      FormationEngaged: 'Formation - Engaged',
      FormationOnHold: 'Formation - On Hold',
      FormationDisengaged: 'Formation - Disengaged',
      FormationConfidential: 'Formation - Confidential',
      Active: 'Active',
      Archived: 'Archived',
      Prospect: 'Prospect',
    },
  };
});
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
  // The real normalizeHealthScoreCategoryV2, not a stub: the foundation-project-detail tests
  // assert actual category normalization behavior against this helper.
  const insightsUtils = await vi.importActual<typeof import('../../../../../packages/shared/src/utils/insights.utils')>(
    '../../../../../packages/shared/src/utils/insights.utils'
  );
  // The real nullifyEmptyStrings, not a stub: the updateProjectStaff tests assert the
  // empty-string → null sanitization actually reaches the PUT body (upstream rejects "" on
  // validated fields), and a vi.fn() would return undefined for every document.
  const objectUtils = await vi.importActual<typeof import('../../../../../packages/shared/src/utils/object.utils')>(
    '../../../../../packages/shared/src/utils/object.utils'
  );
  // The real maskEmailForLogs and maskIdentifierForLogs, not stubs: the directory-lookup log sites
  // call them on every address and identifier, and a vi.fn() returning undefined would make the
  // masking assertions vacuous.
  // email.utils only imports constants files, so deep-importing it directly is safe.
  const emailUtils = await vi.importActual<typeof import('../../../../../packages/shared/src/utils/email.utils')>(
    '../../../../../packages/shared/src/utils/email.utils'
  );
  // The real formatCurrency/formatNumber, not stubs: number.utils has no imports of its own, so
  // deep-importing it directly is safe, and the getHealthOverviewKpis tests assert actual formatted strings.
  const numberUtils = await vi.importActual<typeof import('../../../../../packages/shared/src/utils/number.utils')>(
    '../../../../../packages/shared/src/utils/number.utils'
  );
  return {
    computeIsFoundation: actual.computeIsFoundation,
    summarizeWriterGrants: actual.summarizeWriterGrants,
    maskEmailForLogs: emailUtils.maskEmailForLogs,
    maskIdentifierForLogs: emailUtils.maskIdentifierForLogs,
    normalizeToUrl: urlUtils.normalizeToUrl,
    normalizeHealthScoreCategoryV2: insightsUtils.normalizeHealthScoreCategoryV2,
    getDefaultMarketingImpactMonth: vi.fn(),
    nullifyEmptyStrings: objectUtils.nullifyEmptyStrings,
    resolvePeriodRange: vi.fn(),
    formatCurrency: numberUtils.formatCurrency,
    formatNumber: numberUtils.formatNumber,
    // Deep-importing health-metrics-overview.utils.ts here would pull in date-time.utils -> '../enums',
    // colliding with the incomplete @lfx-one/shared/enums mock above. The classification map itself
    // is exhaustively unit-tested in health-metrics-overview.utils.spec.ts, so re-implement it inline.
    resolveHealthMetricsOverviewKpiClassification: (status: string | null | undefined) => {
      const map: Record<string, string> = { healthy: 'ok', needs_attention: 'watch', needs_action: 'act' };
      const normalized = status?.trim().toLowerCase();
      return (normalized && map[normalized]) || 'none';
    },
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
    public addAccessToResource = addAccessToResource;
    public checkAccess = checkAccess;
    public checkSingleAccessStrict = checkSingleAccessStrict;
  },
}));
vi.mock('./nats.service', () => ({
  NatsService: class {
    public request = natsRequest;
    public getCodec = () => ({ encode: (v: string) => v, decode: (v: unknown) => String(v) });
  },
}));
vi.mock('./etag.service', () => ({
  // Controllable, per-test ETag client: updateProjectStaff's read-modify-write tests assert
  // which document and which ETag cross this boundary, so a bare stub class is not enough.
  ETagService: class {
    public fetchWithETag = fetchWithETag;
    public updateWithETag = updateWithETag;
  },
}));
vi.mock('./snowflake.service', () => ({ SnowflakeService: { getInstance: () => ({ execute }), isMissingObjectError: vi.fn(() => false) } }));
vi.mock('./logger.service', () => ({
  logger: { startOperation, success, error: vi.fn(), warning, debug, info: vi.fn(), sanitize: (v: unknown) => v },
}));

import type { Request } from 'express';

import {
  buildHealthMetricsOverviewPeriods,
  HEALTH_OVERVIEW_KPI_PERIOD_COLUMNS,
  HEALTH_OVERVIEW_REVENUE_PERIOD_COLUMNS,
  PROJECT_SETTINGS_NOT_FOUND_CODE,
} from '@lfx-one/shared/constants';

import { ResourceNotFoundError } from '../errors';
import { ProjectService } from './project.service';
import { SnowflakeService } from './snowflake.service';

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

  describe('getProjects', () => {
    it('requests QUERY_SERVICE_PAGE_SIZE, overriding any caller-supplied page_size', async () => {
      proxyRequest.mockResolvedValueOnce(pageOf([{ uid: 'a', slug: 'a' }]));
      addAccessToResources.mockImplementationOnce((_req: Request, projects: Project[]) => Promise.resolve(projects));

      await service.getProjects(req, { page_size: 10 });

      expect(proxyRequest.mock.calls[0][4]).toMatchObject({ type: 'project', page_size: 500 });
    });

    it('follows page_token across pages and returns the accumulated projects', async () => {
      proxyRequest.mockResolvedValueOnce(pageOf([{ uid: 'a', slug: 'a' }], 'next-token'));
      proxyRequest.mockResolvedValueOnce(pageOf([{ uid: 'b', slug: 'b' }]));
      addAccessToResources.mockImplementationOnce((_req: Request, projects: Project[]) => Promise.resolve(projects));

      const result = await service.getProjects(req);

      expect(result.map((p) => p.uid).sort()).toEqual(['a', 'b']);
      expect(proxyRequest).toHaveBeenCalledTimes(2);
      expect(proxyRequest.mock.calls[1][4]).toMatchObject({ page_token: 'next-token' });
    });

    it('excludes the ROOT pseudo-project before the access check', async () => {
      proxyRequest.mockResolvedValueOnce(pageOf([{ uid: 'root', slug: 'root' }]));
      addAccessToResources.mockImplementationOnce((_req: Request, projects: Project[]) => Promise.resolve(projects));

      const result = await service.getProjects(req);

      expect(result).toEqual([]);
      expect(addAccessToResources).toHaveBeenCalledWith(req, [], 'project');
    });
  });

  describe('getProjectSlugs', () => {
    it('returns slug strings for all non-root projects', async () => {
      proxyRequest.mockResolvedValueOnce(
        pageOf([
          { uid: 'a', slug: 'a' },
          { uid: 'b', slug: 'b' },
        ])
      );

      const result = await service.getProjectSlugs(req);

      expect(result.sort()).toEqual(['a', 'b']);
    });

    it('excludes the ROOT pseudo-project without calling addAccessToResources', async () => {
      proxyRequest.mockResolvedValueOnce(pageOf([{ uid: 'root', slug: 'root' }]));

      const result = await service.getProjectSlugs(req);

      expect(result).toEqual([]);
      expect(addAccessToResources).not.toHaveBeenCalled();
    });

    it('follows page_token across pages and returns accumulated slugs', async () => {
      proxyRequest.mockResolvedValueOnce(pageOf([{ uid: 'a', slug: 'a' }], 'next-token'));
      proxyRequest.mockResolvedValueOnce(pageOf([{ uid: 'b', slug: 'b' }]));

      const result = await service.getProjectSlugs(req);

      expect(result.sort()).toEqual(['a', 'b']);
      expect(proxyRequest).toHaveBeenCalledTimes(2);
      expect(proxyRequest.mock.calls[0][4]).toMatchObject({ type: 'project', page_size: 500 });
      expect(proxyRequest.mock.calls[1][4]).toMatchObject({ type: 'project', page_size: 500, page_token: 'next-token' });
    });

    it('does not call addAccessToResources for a standard non-root project', async () => {
      proxyRequest.mockResolvedValueOnce(pageOf([{ uid: 'x', slug: 'x' }]));

      await service.getProjectSlugs(req);

      expect(addAccessToResources).not.toHaveBeenCalled();
    });

    it('throws when a subsequent page fails (failOnPartial: true — partial slug set drops affiliations)', async () => {
      // First page succeeds; second page fails. With failOnPartial: true the caller receives an
      // error rather than a truncated slug list that silently misrepresents affiliation state.
      proxyRequest.mockResolvedValueOnce(pageOf([{ uid: 'a', slug: 'a' }], 'next-token'));
      proxyRequest.mockRejectedValueOnce(new Error('page-fail'));

      await expect(service.getProjectSlugs(req)).rejects.toThrow('page-fail');
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

  describe('searchProjects', () => {
    it('requests relevance ordering so the closest name match is not buried alphabetically', async () => {
      // Without an explicit sort the query service defaults to name_asc, and OpenSearch drops
      // scoring whenever a non-_score sort is present — the caller then gets the alphabetically
      // first page of matches rather than the best ones (GH-2030).
      proxyRequest.mockResolvedValueOnce(pageOf([{ uid: 'cncf', slug: 'cncf' }]));

      const result = await service.searchProjects(req, 'Cloud Native');

      expect(result.map((p) => p.uid)).toEqual(['cncf']);
      expect(proxyRequest.mock.calls[0][4]).toMatchObject({ type: 'project', name: 'Cloud Native', sort: 'best_match' });
    });

    it('excludes the ROOT pseudo-project from results', async () => {
      proxyRequest.mockResolvedValueOnce(
        pageOf([
          { uid: 'root-uid', slug: 'root' },
          { uid: 'real', slug: 'real' },
        ])
      );

      const result = await service.searchProjects(req, 'anything');

      expect(result.map((p) => p.slug)).toEqual(['real']);
    });
  });

  describe('searchCreatableProjects', () => {
    it('queries name=<term> with a small page size and filters to writer-permitted matches', async () => {
      proxyRequest.mockResolvedValueOnce(pageOf([{ uid: 'match-1', slug: 'match-1' }]));
      addAccessToResources.mockImplementationOnce((_req: Request, projects: Project[]) => Promise.resolve(projects.map((p) => ({ ...p, writer: true }))));

      const result = await service.searchCreatableProjects(req, 'kubernetes');

      expect(result.map((p) => p.uid)).toEqual(['match-1']);
      expect(proxyRequest.mock.calls[0][4]).toMatchObject({ type: 'project', name: 'kubernetes', sort: 'best_match', page_size: 20 });
    });

    it('sorts by relevance on every page, not just the first', async () => {
      // This method truncates to pageSize and gives up after the page cap, so a later page that
      // silently fell back to the default name_asc would reorder results mid-scan (GH-2030).
      proxyRequest.mockResolvedValueOnce(pageOf([{ uid: 'visible-only', slug: 'visible-only' }], 'token-2'));
      proxyRequest.mockResolvedValueOnce(pageOf([{ uid: 'match-2', slug: 'match-2' }]));
      addAccessToResources.mockImplementation((_req: Request, projects: Project[]) =>
        Promise.resolve(projects.map((p) => ({ ...p, writer: p.uid === 'match-2' })))
      );

      await service.searchCreatableProjects(req, 'kubernetes');

      expect(proxyRequest.mock.calls[1][4]).toMatchObject({ sort: 'best_match', page_token: 'token-2' });
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
      // Positive form: asserting only the absence of DESC stays green if the ORDER BY is
      // deleted outright, which leaves plot order at Snowflake's discretion — the same reversed
      // chart by another route.
      expect(curve!).toMatch(/ORDER BY DAYS_TO_EVENT(?!\s+DESC)/i);
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

    // A zero total is not proof of absence. This table writes 0 rather than NULL for a prior-year
    // total, so a prior edition still at zero this far into its curve looks identical to an event
    // that never ran before — and early in a campaign, which is when this drawer is most used,
    // that is the normal state. The row flag decides it, and the earlier version of this test
    // asserted the opposite, pinning a first-timer verdict onto an event with a real baseline.
    it('reports a prior year when the total is zero but the row flag says an edition ran', async () => {
      mockWithPacingHead({ ...eventRow, CREATED_LAST_YEAR: true }, 0);

      const result = await service.getEventDetail('evt-1', 'tlf');

      expect(result).not.toBeNull();
      expect(result!.hasPriorYear).toBe(true);
    });

    // Both blind sources agreeing is what a genuine first-timer looks like.
    it('reports no prior year when neither the total nor the row flag finds one', async () => {
      mockWithPacingHead({ ...eventRow, CREATED_LAST_YEAR: false }, 0);

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
      // Every measure, not just the average. Naming one column let the doubling be restored on the
      // Last-year line and both band edges with this test still green — three of the five series.
      expect(curve!).not.toMatch(/SUM\(\s*(CUMULATIVE_(AVG|LOW|HIGH)_PREDICTED|PRIOR_EVENT_CUMULATIVE)_REGISTRATIONS\s*\)/);
    });

    // Deliberately NOT paired with a behavioural test here. The dedupe happens inside Snowflake,
    // and `execute` is mocked at the driver boundary — downstream of the collapse — so any fixture
    // this suite can write describes rows the query has ALREADY merged. A test asserting the
    // mapper does not re-multiply them passes with the whole subquery deleted, which makes it read
    // as coverage while binding nothing. The SQL assertions above are the honest guard at this
    // level; proving the collapse itself needs a live-warehouse test the suite does not have.

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

// IN-1252: getHealthMetricsDaily's v1→v2 column flip is covered above (in the daily-health-metrics
// describe block); these three cover the other call sites the same fix touched — each used to read
// (or remap through mapV1BandToV2) a v1 Snowflake column/shim and now reads HEALTH_SCORE_CATEGORY_V2
// directly.
describe('ProjectService — Health Score v2 categories', () => {
  let service: ProjectService;

  beforeEach(() => {
    execute.mockReset();
    service = new ProjectService();
  });

  describe('getFoundationHealthScoreDistribution', () => {
    it('reads HEALTH_SCORE_CATEGORY_V2 directly without remapping to a v1 band', async () => {
      execute.mockResolvedValueOnce({ rows: [{ HEALTH_SCORE_CATEGORY_V2: 'fair', PROJECT_COUNT: 4 }] });

      const result = await service.getFoundationHealthScoreDistribution('cncf');

      // fails before fix: the v1 query read HEALTH_SCORE_CATEGORY through mapV1BandToV2, so a
      // genuine v2 'fair' category would have fallen through to `unscored` instead of `fair`.
      expect(result.fair).toBe(4);
      expect(result.unscored).toBe(0);
      expect(execute.mock.calls[0][0]).toContain('HEALTH_SCORE_CATEGORY_V2');
    });
  });

  describe('getFoundationProjectsDetail', () => {
    it('normalizes healthScoreCategory from HEALTH_SCORE_CATEGORY_V2 without a v1 shim', async () => {
      execute.mockResolvedValueOnce({
        rows: [
          {
            PROJECT_ID: 'proj-1',
            PROJECT_NAME: 'Project One',
            PROJECT_SLUG: 'project-one',
            LIFECYCLE_STAGE: null,
            CONTRIBUTORS_90D_COUNT: 1,
            COMMITS_90D_COUNT: 1,
            MAINTAINERS_CURRENT_COUNT: 1,
            STARS_YTD_COUNT: 1,
            LAST_UPDATED_TS: '2026-01-01',
            HEALTH_SCORE_CATEGORY_V2: 'fair',
          },
        ],
      });

      const result = await service.getFoundationProjectsDetail('cncf');

      // fails before fix: normalizeHealthScoreCategory ran the v1 mapV1BandToV2 shim over this
      // column, so a genuine v2 'fair' category could be coerced instead of passing through as-is.
      expect(result.projects[0].healthScoreCategory).toBe('fair');
      expect(execute.mock.calls[0][0]).toContain('d.HEALTH_SCORE_CATEGORY_V2');
    });
  });

  describe('getMultiFoundationSummary', () => {
    it('reads HEALTH_SCORE_CATEGORY_V2 per foundation without remapping to a v1 band', async () => {
      execute.mockImplementation((sql: string) => {
        if (String(sql).includes('FOUNDATION_HEALTH_SCORE_DISTRIBUTION')) {
          return Promise.resolve({ rows: [{ FOUNDATION_SLUG: 'cncf', HEALTH_SCORE_CATEGORY_V2: 'fair', PROJECT_COUNT: 7 }] });
        }
        return Promise.resolve({ rows: [] });
      });

      const result = await service.getMultiFoundationSummary(req, ['cncf']);

      // fails before fix: the local HealthScoreRow type read HEALTH_SCORE_CATEGORY and remapped it
      // via mapV1BandToV2, so a v2 'fair' category wouldn't have passed straight through.
      expect(result.perFoundation['cncf'].healthScores.fair).toBe(7);
      expect(result.perFoundation['cncf'].healthScores.unscored).toBe(0);
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

/**
 * The ED dashboard distinguishes "could not measure" from "measured zero" by turning a failed
 * request into `undefined`, which the card renders as "Data unavailable". That only works if the
 * failure reaches the client as an HTTP error.
 *
 * These five methods used to catch a Snowflake failure and return a zero-filled body with a 200,
 * so the client saw a success, the undefined sentinel was never reached, and the card printed the
 * zeros as if measured — the reported AAIF defect, one layer below where it was first fixed.
 * getEventGrowth / getBrandReach / getBrandHealth already rethrew; these now match.
 *
 * A genuine no-data result (`rows.length === 0`) still returns its zero-filled shape — that is a
 * measurement, and it must stay distinguishable from an outage.
 */
describe('ProjectService — a Snowflake failure must not become a zero-filled 200', () => {
  let service: ProjectService;

  beforeEach(() => {
    execute.mockReset();
    service = new ProjectService();
  });

  const methods: { name: string; call: (s: ProjectService) => Promise<unknown> }[] = [
    {
      name: 'getWebActivitiesSummary',
      call: (s) => s.getWebActivitiesSummary('aaif', undefined, { type: 'trailing', startDate: '2026-01-01', endDate: '2026-06-30', label: 'Last 6 months' }),
    },
    { name: 'getMemberRetention', call: (s) => s.getMemberRetention('aaif') },
    { name: 'getMemberAcquisition', call: (s) => s.getMemberAcquisition('aaif') },
    { name: 'getEngagedCommunity', call: (s) => s.getEngagedCommunity('aaif') },
    { name: 'getFlywheelConversion', call: (s) => s.getFlywheelConversion('aaif') },
  ];

  for (const { name, call } of methods) {
    it(`${name} rethrows instead of returning zeros`, async () => {
      execute.mockRejectedValue(new Error('snowflake unavailable'));

      await expect(call(service)).rejects.toThrow('snowflake unavailable');
    });
  }
});

/**
 * getBrandReach runs two independent queries. A WEB failure fails the whole request (covered
 * above), but a SOCIAL failure is deliberately non-fatal so the measured web half still reaches
 * the user. Without a flag that partial success is indistinguishable from a foundation with no
 * followers — the reported AAIF defect, behind an HTTP 200 no undefined sentinel can catch.
 */
describe('ProjectService — a social-only failure is flagged, not silently zeroed', () => {
  let service: ProjectService;

  beforeEach(() => {
    execute.mockReset();
    service = new ProjectService();
  });

  it('sets socialUnavailable and still returns the measured web half', async () => {
    // Both WEB queries (domains + daily trend) run in parallel first and must succeed; every
    // social query after them rejects. Getting this order wrong fails the whole method and the
    // assertion below would pass for the wrong reason.
    execute
      .mockResolvedValueOnce({ rows: [{ LF_SUB_DOMAIN_CLASSIFICATION: 'Docs', TOTAL_SESSIONS: 3482 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValue(new Error('social query failed'));

    const result = await service.getBrandReach('aaif');

    expect(result.socialUnavailable).toBe(true);
    // The fabricated half must be flagged rather than presented as measured.
    expect(result.totalSocialFollowers).toBe(0);
    // The half that DID resolve must survive — blanking it would trade a false zero for a
    // false outage.
    expect(result.totalMonthlySessions).toBeGreaterThan(0);
  });
});

describe('ProjectService — a failed OPTIONAL email breakdown is flagged, not silently zeroed', () => {
  let service: ProjectService;

  beforeEach(() => {
    execute.mockReset();
    service = new ProjectService();
  });

  const EMAIL_CTR_PERIOD: ResolvedPeriodRange = { type: 'month', startDate: '2026-03-01', endDate: '2026-04-01', label: 'March 2026' };

  /**
   * `getEmailCtr` fires four queries in one Promise.all — summary, monthly, campaign, then the
   * per-send breakdown. Only the LAST is optional: it `.catch()`es to `rows: []` so a breakdown
   * outage does not blank the CTR that was genuinely measured. But an unflagged empty array is
   * indistinguishable from a period with no campaigns, and the drawer reduce()s over it — so the
   * degradation has to be reported, not just survived.
   *
   * Mock order is load-bearing: rejecting an earlier query would fail the whole method and the
   * assertions below would pass for the wrong reason rather than binding the optional path.
   */
  it('sets breakdownUnavailable and still returns the measured primary CTR', async () => {
    execute
      .mockResolvedValueOnce({ rows: [{ PROJECT_NAME: 'TLF', CTR_LAST_COMPLETED_MONTH: 2.5 }] })
      .mockResolvedValueOnce({ rows: [{ PUBLISHED_MONTH: 'Mar', PUBLISHED_MONTH_DATE: '2026-03-01', TOTAL_SENDS: 1000, TOTAL_OPENS: 250 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error('breakdown query failed'));

    const result = await service.getEmailCtr('tlf', undefined, EMAIL_CTR_PERIOD);

    expect(result.breakdownUnavailable).toBe(true);
    // The breakdown is empty because it FAILED, and the flag is the only thing that says so.
    expect(result.emailTypeBreakdown ?? []).toEqual([]);
    // The independent primary read must survive — rethrowing here would trade a partial
    // outage for a total one and blank a figure that was actually measured.
    expect(result.currentCtr).toBeGreaterThan(0);
  });

  it('leaves breakdownUnavailable false when every query succeeds', async () => {
    // The other side of the contract: an empty breakdown that was genuinely READ must not be
    // reported as an outage, or the fix trades a fabricated zero for a fabricated failure.
    execute
      .mockResolvedValueOnce({ rows: [{ PROJECT_NAME: 'TLF', CTR_LAST_COMPLETED_MONTH: 2.5 }] })
      .mockResolvedValueOnce({ rows: [{ PUBLISHED_MONTH: 'Mar', PUBLISHED_MONTH_DATE: '2026-03-01', TOTAL_SENDS: 1000, TOTAL_OPENS: 250 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await service.getEmailCtr('tlf', undefined, EMAIL_CTR_PERIOD);

    expect(result.breakdownUnavailable).toBe(false);
  });

  it('reports the breakdown failure even when the primary reads come back genuinely empty', async () => {
    // The early-return path: `summaryResult`/`monthlyResult` empty short-circuits before the
    // breakdown is ever mapped. The flag has to be carried there too — otherwise a period whose
    // breakdown was never read reports as a confident "no campaigns".
    execute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error('breakdown query failed'));

    const result = await service.getEmailCtr('tlf', undefined, EMAIL_CTR_PERIOD);

    expect(result.breakdownUnavailable).toBe(true);
  });
});

/**
 * getFoundationProjectsDetailGrouped (GH-1607) fans out getFoundationProjectsDetail across the
 * root foundation plus every discovered sub-foundation. getProjectBySlug/discoverSubFoundations
 * are stubbed directly rather than mocking their NATS/query-service internals — this suite is
 * testing the new fan-out/grouping orchestration, not the already-covered descendant walk.
 */
describe('ProjectService — getFoundationProjectsDetailGrouped', () => {
  let service: ProjectService;

  beforeEach(() => {
    execute.mockReset();
    service = new ProjectService();
    vi.spyOn(service, 'getProjectBySlug').mockResolvedValue({ uid: 'root-uid', slug: 'lfeurope', name: 'LF Europe' } as Project);
  });

  it('groups rows by which foundation slug they were fetched under', async () => {
    vi.spyOn(service as any, 'discoverSubFoundations').mockResolvedValue([
      { uid: 'sub-uid', slug: 'neonephos', name: 'NeoNephos', visible: true, groupSlug: 'neonephos', groupName: 'NeoNephos' },
    ]);
    execute
      .mockResolvedValueOnce({ rows: [{ PROJECT_ID: 'p1', PROJECT_NAME: 'Envoy', PROJECT_SLUG: 'envoy' }] })
      .mockResolvedValueOnce({ rows: [{ PROJECT_ID: 'p2', PROJECT_NAME: 'Nephio', PROJECT_SLUG: 'nephio' }] });

    const result = await service.getFoundationProjectsDetailGrouped(req, 'lfeurope');

    expect(result.groups).toEqual([
      expect.objectContaining({ foundationSlug: 'lfeurope', foundationName: 'LF Europe', projects: [expect.objectContaining({ projectSlug: 'envoy' })] }),
      expect.objectContaining({ foundationSlug: 'neonephos', foundationName: 'NeoNephos', projects: [expect.objectContaining({ projectSlug: 'nephio' })] }),
    ]);
    expect(result.totalCount).toBe(2);
  });

  it('omits a sub-foundation whose detail fetch fails instead of failing the whole request', async () => {
    vi.spyOn(service as any, 'discoverSubFoundations').mockResolvedValue([
      { uid: 'sub-uid', slug: 'neonephos', name: 'NeoNephos', visible: true, groupSlug: 'neonephos', groupName: 'NeoNephos' },
    ]);
    execute
      .mockResolvedValueOnce({ rows: [{ PROJECT_ID: 'p1', PROJECT_NAME: 'Envoy', PROJECT_SLUG: 'envoy' }] })
      .mockRejectedValueOnce(new Error('snowflake unavailable'));

    const result = await service.getFoundationProjectsDetailGrouped(req, 'lfeurope');

    expect(result.groups).toEqual([expect.objectContaining({ foundationSlug: 'lfeurope' })]);
    expect(result.totalCount).toBe(1);
  });

  it('excludes a discovered sub-foundation from its parent group instead of double-rendering it as a leaf row', async () => {
    vi.spyOn(service as any, 'discoverSubFoundations').mockResolvedValue([
      { uid: 'sub-uid', slug: 'neonephos', name: 'NeoNephos', visible: true, groupSlug: 'neonephos', groupName: 'NeoNephos' },
    ]);
    execute
      // The cube rolls NeoNephos up under lfeurope's own detail, so the raw root row includes it.
      .mockResolvedValueOnce({
        rows: [
          { PROJECT_ID: 'p1', PROJECT_NAME: 'Envoy', PROJECT_SLUG: 'envoy' },
          { PROJECT_ID: 'sub-uid', PROJECT_NAME: 'NeoNephos', PROJECT_SLUG: 'neonephos' },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ PROJECT_ID: 'p2', PROJECT_NAME: 'Nephio', PROJECT_SLUG: 'nephio' }] });

    const result = await service.getFoundationProjectsDetailGrouped(req, 'lfeurope');

    const rootGroup = result.groups.find((group) => group.foundationSlug === 'lfeurope');
    expect(rootGroup?.projects.map((p) => p.projectSlug)).toEqual(['envoy']);
    expect(result.totalCount).toBe(2);
  });

  it('falls back to the parent leaf row when a sub-foundation whose row appears there fails its own detail fetch', async () => {
    vi.spyOn(service as any, 'discoverSubFoundations').mockResolvedValue([
      { uid: 'sub-uid', slug: 'neonephos', name: 'NeoNephos', visible: true, groupSlug: 'neonephos', groupName: 'NeoNephos' },
    ]);
    execute
      // The cube rolls NeoNephos up under lfeurope's own detail, same as the successful case above.
      .mockResolvedValueOnce({
        rows: [
          { PROJECT_ID: 'p1', PROJECT_NAME: 'Envoy', PROJECT_SLUG: 'envoy' },
          { PROJECT_ID: 'sub-uid', PROJECT_NAME: 'NeoNephos', PROJECT_SLUG: 'neonephos' },
        ],
      })
      // NeoNephos's own section fetch fails — it must NOT also be stripped from the root row above,
      // or it vanishes from the response entirely instead of falling back to its parent's leaf row.
      .mockRejectedValueOnce(new Error('snowflake unavailable'));

    const result = await service.getFoundationProjectsDetailGrouped(req, 'lfeurope');

    expect(result.groups).toEqual([expect.objectContaining({ foundationSlug: 'lfeurope' })]);
    const rootGroup = result.groups.find((group) => group.foundationSlug === 'lfeurope');
    expect(rootGroup?.projects.map((p) => p.projectSlug)).toEqual(['envoy', 'neonephos']);
    expect(result.totalCount).toBe(2);
  });

  it('never runs more than FOUNDATION_PROJECT_DETAIL_FETCH_CONCURRENCY sub-foundation detail fetches at once', async () => {
    // 10 sub-foundations vs. a concurrency cap of 8 (mocked above): without the worker-pool fix
    // this would fire all 10 Snowflake queries simultaneously and risk overflowing the shared pool.
    const subs = Array.from({ length: 10 }, (_, i) => ({
      uid: `sub-${i}-uid`,
      slug: `sub-${i}`,
      name: `Sub ${i}`,
      visible: true,
      groupSlug: `sub-${i}`,
      groupName: `Sub ${i}`,
    }));
    vi.spyOn(service as any, 'discoverSubFoundations').mockResolvedValue(subs);

    let inFlight = 0;
    let maxInFlight = 0;
    execute.mockImplementation(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return { rows: [] };
    });

    await service.getFoundationProjectsDetailGrouped(req, 'lfeurope');

    // The root fetch runs alone and resolves before the sub-foundation pool starts, so the only
    // concurrency to bound is the 10 sub-foundation fetches — capped at 8, never all 10 at once.
    expect(maxInFlight).toBeLessThanOrEqual(8);
  });

  it('propagates a root foundation detail-fetch failure instead of degrading gracefully', async () => {
    vi.spyOn(service as any, 'discoverSubFoundations').mockResolvedValue([
      { uid: 'sub-uid', slug: 'neonephos', name: 'NeoNephos', visible: true, groupSlug: 'neonephos', groupName: 'NeoNephos' },
    ]);
    execute.mockRejectedValueOnce(new Error('snowflake unavailable'));

    await expect(service.getFoundationProjectsDetailGrouped(req, 'lfeurope')).rejects.toThrow('snowflake unavailable');
  });

  it('merges a hidden intermediary’s own detail fetch into the nearest visible ancestor’s section instead of dropping it', async () => {
    // neonephos is hidden (not its own section); its direct project rows are only discoverable via
    // its own slug's Snowflake query, and must fold into the visible root's group (GH-1676 review).
    vi.spyOn(service as any, 'discoverSubFoundations').mockResolvedValue([
      { uid: 'sub-uid', slug: 'neonephos', name: 'NeoNephos', visible: false, groupSlug: 'lfeurope', groupName: 'LF Europe' },
    ]);
    execute
      .mockResolvedValueOnce({ rows: [{ PROJECT_ID: 'p1', PROJECT_NAME: 'Envoy', PROJECT_SLUG: 'envoy' }] })
      .mockResolvedValueOnce({ rows: [{ PROJECT_ID: 'p2', PROJECT_NAME: 'Nephio', PROJECT_SLUG: 'nephio' }] });

    const result = await service.getFoundationProjectsDetailGrouped(req, 'lfeurope');

    expect(result.groups).toEqual([
      expect.objectContaining({
        foundationSlug: 'lfeurope',
        projects: expect.arrayContaining([expect.objectContaining({ projectSlug: 'envoy' }), expect.objectContaining({ projectSlug: 'nephio' })]),
      }),
    ]);
    expect(result.totalCount).toBe(2);
  });
});

describe('ProjectService — discoverSubFoundations', () => {
  let service: ProjectService;

  /** Minimal fixture satisfying computeIsFoundation AND the stricter public+Active gate. */
  function foundation(uid: string, slug: string, name: string, overrides: Partial<Project> = {}): Project {
    return {
      uid,
      slug,
      name,
      public: true,
      stage: 'Active',
      legal_entity_type: 'Corporation',
      funding: 'Funded' as ProjectFunding,
      funding_model: ['Membership'],
      ...overrides,
    } as Project;
  }

  /** Wires proxyRequest so each `parent: project:<uid>` query resolves to `childrenByParent[uid]` (default: empty page). */
  function mockChildrenByParent(childrenByParent: Record<string, Project[]>): void {
    proxyRequest.mockImplementation((_req: Request, _svc: string, _path: string, _method: string, params: Record<string, any>) => {
      const parentUid = String(params['parent']).replace('project:', '');
      return Promise.resolve(pageOf(childrenByParent[parentUid] ?? []));
    });
  }

  beforeEach(() => {
    proxyRequest.mockReset();
    service = new ProjectService();
  });

  it('recurses into a discovered sub-foundation to find its own nested sub-foundations', async () => {
    const n1 = foundation('n1-uid', 'n1-slug', 'N1');
    const n2 = foundation('n2-uid', 'n2-slug', 'N2');
    mockChildrenByParent({ 'root-uid': [n1], 'n1-uid': [n2] });

    const result = await (service as any).discoverSubFoundations(req, 'root-uid', 'root-slug', 'Root');

    expect(result).toEqual([
      { uid: 'n1-uid', slug: 'n1-slug', name: 'N1', visible: true, groupSlug: 'n1-slug', groupName: 'N1' },
      { uid: 'n2-uid', slug: 'n2-slug', name: 'N2', visible: true, groupSlug: 'n2-slug', groupName: 'N2' },
    ]);
  });

  it('stops at the depth cap without fetching the capped level’s own children', async () => {
    const n1 = foundation('n1-uid', 'n1-slug', 'N1');
    const n2 = foundation('n2-uid', 'n2-slug', 'N2');
    const n3 = foundation('n3-uid', 'n3-slug', 'N3');
    const n4 = foundation('n4-uid', 'n4-slug', 'N4');
    mockChildrenByParent({ 'root-uid': [n1], 'n1-uid': [n2], 'n2-uid': [n3], 'n3-uid': [n4] });

    const result = await (service as any).discoverSubFoundations(req, 'root-uid', 'root-slug', 'Root');

    // n4 is never discovered: reaching it would require fetching n3's children at depth 3,
    // which FOUNDATION_DESCENDANT_TRAVERSAL_MAX_DEPTH (3) blocks.
    expect(result.map((r: { slug: string }) => r.slug)).toEqual(['n1-slug', 'n2-slug', 'n3-slug']);
    expect(proxyRequest).not.toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', expect.objectContaining({ parent: 'project:n3-uid' }));
  });

  it('stops discovering once the total node cap is reached, regardless of remaining siblings', async () => {
    const children = Array.from({ length: 41 }, (_, i) => foundation(`c${i + 1}-uid`, `c${i + 1}-slug`, `C${i + 1}`));
    mockChildrenByParent({ 'root-uid': children });

    const result = await (service as any).discoverSubFoundations(req, 'root-uid', 'root-slug', 'Root');

    // FOUNDATION_DESCENDANT_TRAVERSAL_MAX_NODES (40) caps the total regardless of the 41st sibling existing.
    expect(result).toHaveLength(40);
    expect(result[39].slug).toBe('c40-slug');
  });

  it('counts a hidden (non-public/non-Active) traversed foundation against the node budget too', async () => {
    // 41 hidden children: none are visible, but the budget must still be decremented for each one
    // traversed — otherwise a wide hidden layer could recurse past FOUNDATION_DESCENDANT_TRAVERSAL_MAX_NODES
    // (GH-1676 review, second pass).
    const children = Array.from({ length: 41 }, (_, i) => foundation(`c${i + 1}-uid`, `c${i + 1}-slug`, `C${i + 1}`, { public: false }));
    mockChildrenByParent({ 'root-uid': children });

    const result = await (service as any).discoverSubFoundations(req, 'root-uid', 'root-slug', 'Root');

    expect(result).toHaveLength(40);
    expect(result.every((r: { visible: boolean }) => r.visible === false)).toBe(true);
  });

  it('folds a hidden intermediary’s own group target into the nearest visible ancestor', async () => {
    const hiddenIntermediary = foundation('hidden-uid', 'hidden-slug', 'Hidden', { public: false });
    const nestedVisible = foundation('nested-uid', 'nested-slug', 'Nested');
    mockChildrenByParent({ 'root-uid': [hiddenIntermediary], 'hidden-uid': [nestedVisible] });

    const result = await (service as any).discoverSubFoundations(req, 'root-uid', 'root-slug', 'Root');

    expect(result).toEqual([
      { uid: 'hidden-uid', slug: 'hidden-slug', name: 'Hidden', visible: false, groupSlug: 'root-slug', groupName: 'Root' },
      { uid: 'nested-uid', slug: 'nested-slug', name: 'Nested', visible: true, groupSlug: 'nested-slug', groupName: 'Nested' },
    ]);
  });

  it('marks non-public and non-Active foundations as not visible (but still discovers and returns them)', async () => {
    const publicActive = foundation('a-uid', 'a-slug', 'A');
    const privateActive = foundation('b-uid', 'b-slug', 'B', { public: false });
    const publicFormationEngaged = foundation('c-uid', 'c-slug', 'C', { stage: 'Formation - Engaged' });
    const notAFoundation = foundation('d-uid', 'd-slug', 'D', { funding: 'Unfunded' as ProjectFunding, funding_model: [] });
    mockChildrenByParent({ 'root-uid': [publicActive, privateActive, publicFormationEngaged, notAFoundation] });

    const result = await (service as any).discoverSubFoundations(req, 'root-uid', 'root-slug', 'Root');

    expect(result).toEqual([
      { uid: 'a-uid', slug: 'a-slug', name: 'A', visible: true, groupSlug: 'a-slug', groupName: 'A' },
      { uid: 'b-uid', slug: 'b-slug', name: 'B', visible: false, groupSlug: 'root-slug', groupName: 'Root' },
      { uid: 'c-uid', slug: 'c-slug', name: 'C', visible: false, groupSlug: 'root-slug', groupName: 'Root' },
    ]);
  });

  it('does not abort the whole traversal when a single branch’s children fetch fails', async () => {
    const n1 = foundation('n1-uid', 'n1-slug', 'N1');
    const n2 = foundation('n2-uid', 'n2-slug', 'N2');
    proxyRequest.mockImplementation((_req: Request, _svc: string, _path: string, _method: string, params: Record<string, any>) => {
      const parentUid = String(params['parent']).replace('project:', '');
      if (parentUid === 'root-uid') return Promise.resolve(pageOf([n1, n2]));
      if (parentUid === 'n1-uid') return Promise.reject(new Error('upstream unavailable'));
      return Promise.resolve(pageOf([]));
    });

    const result = await (service as any).discoverSubFoundations(req, 'root-uid', 'root-slug', 'Root');

    expect(result.map((r: { slug: string }) => r.slug)).toEqual(['n1-slug', 'n2-slug']);
  });
});

/**
 * getFoundationProjectUids (GH-2382) — historically walked only a foundation's direct children,
 * silently omitting every project nested under a sub-foundation (e.g. NeoNephos/OpenWallet under
 * Linux Foundation Europe). A later revision fixed that but only recursed into children flagged as
 * sub-foundations, still dropping descendants nested under an ordinary (non-foundation) project —
 * the repository explicitly supports child projects of "a foundation or project" (PR #2436 review,
 * Copilot). The implementation now does a plain depth/node-bounded breadth-first traversal over
 * every discovered project, regardless of its own foundation status, so no `discoverSubFoundations`
 * stubbing is needed here — every scenario below drives the traversal directly through `proxyRequest`.
 */
describe('ProjectService — getFoundationProjectUids', () => {
  let service: ProjectService;

  beforeEach(() => {
    proxyRequest.mockReset();
    warning.mockReset();
    service = new ProjectService();
  });

  it('includes the foundation itself and its direct children', async () => {
    proxyRequest.mockImplementation((_req: Request, _svc: string, _path: string, _method: string, params: Record<string, any>) => {
      const parentUid = String(params['parent']).replace('project:', '');
      if (parentUid === 'lfeurope-uid') return Promise.resolve(pageOf([{ uid: 'envoy-uid', slug: 'envoy' }]));
      return Promise.resolve(pageOf([]));
    });

    const result = await service.getFoundationProjectUids(req, 'lfeurope-uid');

    expect(result.sort()).toEqual(['envoy-uid', 'lfeurope-uid'].sort());
  });

  it('discovers descendants nested under a sub-foundation child', async () => {
    proxyRequest.mockImplementation((_req: Request, _svc: string, _path: string, _method: string, params: Record<string, any>) => {
      const parentUid = String(params['parent']).replace('project:', '');
      if (parentUid === 'lfeurope-uid') return Promise.resolve(pageOf([{ uid: 'neonephos-uid', slug: 'neonephos' }]));
      if (parentUid === 'neonephos-uid') return Promise.resolve(pageOf([{ uid: 'gardener-uid', slug: 'gardener' }]));
      return Promise.resolve(pageOf([]));
    });

    const result = await service.getFoundationProjectUids(req, 'lfeurope-uid');

    expect(result.sort()).toEqual(['gardener-uid', 'lfeurope-uid', 'neonephos-uid'].sort());
  });

  it('discovers descendants nested under an ordinary (non-foundation) project, not just sub-foundations (PR #2436 review, Copilot)', async () => {
    // project-a-uid is a plain project (no is_foundation involved anywhere in this traversal) with
    // its own child, project-b-uid — the exact hierarchy the prior foundation-gated recursion missed.
    proxyRequest.mockImplementation((_req: Request, _svc: string, _path: string, _method: string, params: Record<string, any>) => {
      const parentUid = String(params['parent']).replace('project:', '');
      if (parentUid === 'lfeurope-uid') return Promise.resolve(pageOf([{ uid: 'project-a-uid', slug: 'project-a' }]));
      if (parentUid === 'project-a-uid') return Promise.resolve(pageOf([{ uid: 'project-b-uid', slug: 'project-b' }]));
      return Promise.resolve(pageOf([]));
    });

    const result = await service.getFoundationProjectUids(req, 'lfeurope-uid');

    expect(result.sort()).toEqual(['lfeurope-uid', 'project-a-uid', 'project-b-uid'].sort());
  });

  it('stops recursing past the max traversal depth, so descendants beyond the cap are not discovered', async () => {
    const chain: Record<string, string> = {
      'lfeurope-uid': 'a-uid',
      'a-uid': 'b-uid',
      'b-uid': 'c-uid',
      'c-uid': 'd-uid',
    };
    proxyRequest.mockImplementation((_req: Request, _svc: string, _path: string, _method: string, params: Record<string, any>) => {
      const parentUid = String(params['parent']).replace('project:', '');
      const child = chain[parentUid];
      return Promise.resolve(pageOf(child ? [{ uid: child, slug: child }] : []));
    });

    const result = await service.getFoundationProjectUids(req, 'lfeurope-uid');

    // c-uid is depth 3 (lfeurope=0, a=1, b=2, c=3) — discovered as b-uid's child (b-uid is depth 2,
    // still within FOUNDATION_DESCENDANT_TRAVERSAL_MAX_DEPTH=3 and gets traversed), but c-uid itself
    // is never enqueued as a container since depth 3 hits the cap, so d-uid is never discovered.
    expect(result.sort()).toEqual(['a-uid', 'b-uid', 'c-uid', 'lfeurope-uid'].sort());
    expect(result).not.toContain('d-uid');
  });

  it('omits a container whose own children fetch fails instead of dropping the whole result', async () => {
    proxyRequest.mockImplementation((_req: Request, _svc: string, _path: string, _method: string, params: Record<string, any>) => {
      const parentUid = String(params['parent']).replace('project:', '');
      if (parentUid === 'lfeurope-uid')
        return Promise.resolve(
          pageOf([
            { uid: 'envoy-uid', slug: 'envoy' },
            { uid: 'neonephos-uid', slug: 'neonephos' },
          ])
        );
      if (parentUid === 'neonephos-uid') return Promise.reject(new Error('snowflake unavailable'));
      return Promise.resolve(pageOf([]));
    });

    const result = await service.getFoundationProjectUids(req, 'lfeurope-uid');

    expect(result.sort()).toEqual(['envoy-uid', 'lfeurope-uid', 'neonephos-uid'].sort());
  });

  it('excludes the ROOT pseudo-project from any container’s children', async () => {
    proxyRequest.mockResolvedValueOnce(pageOf([{ uid: 'root-uid', slug: 'root' }]));

    const result = await service.getFoundationProjectUids(req, 'lfeurope-uid');

    expect(result).toEqual(['lfeurope-uid']);
  });

  it('dedupes a project reachable as a child of more than one container', async () => {
    proxyRequest.mockImplementation((_req: Request, _svc: string, _path: string, _method: string, params: Record<string, any>) => {
      const parentUid = String(params['parent']).replace('project:', '');
      if (parentUid === 'lfeurope-uid') return Promise.resolve(pageOf([{ uid: 'shared-uid', slug: 'shared' }]));
      // shared-uid's own (mocked) child is itself, so the same UID is reachable both as
      // lfeurope-uid's direct child and as its own re-discovered child one level down.
      return Promise.resolve(pageOf([{ uid: 'shared-uid', slug: 'shared' }]));
    });

    const result = await service.getFoundationProjectUids(req, 'lfeurope-uid');

    expect(result.filter((uid) => uid === 'shared-uid')).toHaveLength(1);
  });

  it('logs a warning when the resolved UID set exceeds QUERY_SERVICE_FILTERS_OR_BATCH_SIZE (PR #2436)', async () => {
    // 150 unique direct children of the foundation itself — comfortably over the 100-item threshold,
    // and enough on its own without needing deeper traversal.
    const manyChildren = Array.from({ length: 150 }, (_, i) => ({ uid: `child-${i}-uid`, slug: `child-${i}` }));
    proxyRequest.mockImplementation((_req: Request, _svc: string, _path: string, _method: string, params: Record<string, any>) => {
      const parentUid = String(params['parent']).replace('project:', '');
      if (parentUid === 'lfeurope-uid') return Promise.resolve(pageOf(manyChildren));
      return Promise.resolve(pageOf([]));
    });

    const result = await service.getFoundationProjectUids(req, 'lfeurope-uid');

    expect(result.length).toBeGreaterThan(100);
    expect(warning).toHaveBeenCalledWith(
      req,
      'get_foundation_project_uids',
      expect.any(String),
      expect.objectContaining({ foundation_uid: 'lfeurope-uid', count: result.length, batch_size: 100 })
    );
  });
});

describe('ProjectService — getProjectsByIds', () => {
  let service: ProjectService;

  beforeEach(() => {
    proxyRequest.mockReset();
    warning.mockReset();
    service = new ProjectService();
  });

  it('warns once with only UIDs omitted from a successful batch', async () => {
    proxyRequest.mockResolvedValueOnce(pageOf([{ uid: 'resolved', slug: 'resolved' }]));

    const result = await service.getProjectsByIds(req, ['resolved', 'missing']);

    expect([...result.keys()]).toEqual(['resolved']);
    expect(warning).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith(req, 'get_projects_by_ids', 'Project batch response omitted requested UIDs', {
      missing_uids: ['missing'],
    });
  });

  it('does not warn when every requested UID resolves', async () => {
    proxyRequest.mockResolvedValueOnce(
      pageOf([
        { uid: 'one', slug: 'one' },
        { uid: 'two', slug: 'two' },
      ])
    );

    const result = await service.getProjectsByIds(req, ['one', 'two']);

    expect([...result.keys()]).toEqual(['one', 'two']);
    expect(warning).not.toHaveBeenCalled();
  });

  it('preserves the failed-batch warning and empty-map fallback', async () => {
    proxyRequest.mockRejectedValueOnce(new Error('query failed'));

    const result = await service.getProjectsByIds(req, ['one', 'two']);

    expect(result.size).toBe(0);
    expect(warning).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith(req, 'get_projects_by_ids', 'Batched project fetch failed for batch, skipping', {
      batch_size: 2,
      error: 'query failed',
    });
  });
});

describe('ProjectService — getProjectById / getProjectBySlug (GH-1955 auditor/meeting_coordinator gating)', () => {
  let service: ProjectService;

  beforeEach(() => {
    proxyRequest.mockReset();
    addAccessToResource.mockReset();
    checkSingleAccessStrict.mockReset();
    warning.mockReset();
    service = new ProjectService();
  });

  it('does not run the meeting_coordinator/auditor checks and returns neither field for a writer', async () => {
    proxyRequest.mockResolvedValueOnce({ uid: 'p1', slug: 'p1' });
    addAccessToResource.mockResolvedValueOnce({ uid: 'p1', slug: 'p1', writer: true });

    const result = await service.getProjectById(req, 'p1', true, true, true);

    expect(checkSingleAccessStrict).not.toHaveBeenCalled();
    expect(result.meetingCoordinator).toBeUndefined();
    expect(result.auditor).toBeUndefined();
  });

  it('leaves auditor undefined and warns when the strict FGA check rejects, rather than reporting false', async () => {
    proxyRequest.mockResolvedValueOnce({ uid: 'p1', slug: 'p1' });
    addAccessToResource.mockResolvedValueOnce({ uid: 'p1', slug: 'p1', writer: false });
    checkSingleAccessStrict.mockRejectedValueOnce(new Error('fga unavailable'));

    const result = await service.getProjectById(req, 'p1', true, false, true);

    expect(result.auditor).toBeUndefined();
    expect(warning).toHaveBeenCalledWith(req, 'get_project_by_id', 'auditor check failed, skipping field', {
      project_uid: 'p1',
      err: expect.any(Error),
    });
  });

  it('forwards includeAuditor from getProjectBySlug through to getProjectById', async () => {
    const spy = vi.spyOn(service, 'getProjectById').mockResolvedValueOnce({ uid: 'p1', slug: 'p1' } as Project);
    vi.spyOn(service, 'getProjectIdBySlug').mockResolvedValueOnce({ exists: true, uid: 'p1', slug: 'p1' });

    await service.getProjectBySlug(req, 'p1', false, true);

    expect(spy).toHaveBeenCalledWith(req, 'p1', true, false, true);
  });
});

describe('ProjectService — getHealthMetricsDaily', () => {
  let service: ProjectService;

  beforeEach(() => {
    execute.mockReset();
    service = new ProjectService();
  });

  it('reports the v2 health score, not the v1 score, for a project-level query', async () => {
    // Fixture row carries both v1 and v2 columns with deliberately different values.
    // The service must surface HEALTH_SCORE_V2 (80), not the legacy HEALTH_SCORE (50).
    execute.mockResolvedValueOnce({
      rows: [{ HEALTH_SCORE: 50, HEALTH_SCORE_V2: 80, HEALTH_SCORE_CATEGORY: 'Fair', HEALTH_SCORE_CATEGORY_V2: 'Good' }],
    });

    const result = await service.getHealthMetricsDaily('some-project', 'project');

    expect(result.currentAvgHealthScore).toBe(80);
    // Guard the actual regression: the SQL sent to Snowflake must select the v2 column, not
    // just return one from the mock, or a query that still reads HEALTH_SCORE would pass silently.
    expect(execute.mock.calls[0][0]).toContain('HEALTH_SCORE_V2');
  });

  it('reports the v2 health score, not the v1 score, for a foundation-level query', async () => {
    execute.mockResolvedValueOnce({
      rows: [{ FOUNDATION_SLUG: 'cncf', METRIC_DATE: '2026-01-01', AVG_HEALTH_SCORE: 80 }],
    });

    const result = await service.getHealthMetricsDaily('cncf', 'foundation');

    expect(result.currentAvgHealthScore).toBe(80);
    expect(execute.mock.calls[0][0]).toContain('AVG(HEALTH_SCORE_V2)');
  });
});

// Both HEALTH_OVERVIEW_* queries now read every period at once and alias each period-suffixed column
// `<COLUMN>__<RANGE>`. These builders expand a single period's fixture slice onto one range's keys and
// pass the period-invariant columns through untouched, leaving the other ranges NULL.
// Real list, not a copy: the query and the projection both key off it, so a stale copy here would
// keep asserting on aliases production no longer emits.
const PERIOD_SUFFIXED_KPI_COLUMNS = new Set<string>(HEALTH_OVERVIEW_KPI_PERIOD_COLUMNS);

const buildKpiWideRow = (slice: Record<string, number | string | null>, range = 'YTD'): Record<string, number | string | null> =>
  Object.fromEntries(Object.entries(slice).map(([column, value]) => [PERIOD_SUFFIXED_KPI_COLUMNS.has(column) ? `${column}__${range}` : column, value]));

const buildRevenueWideRow = (slice: Record<string, number | string | null>, range = 'YTD'): Record<string, number | string | null> =>
  Object.fromEntries(Object.entries(slice).map(([column, value]) => [column === 'REVENUE_DOMAIN' ? column : `${column}__${range}`, value]));

describe('ProjectService — getHealthOverviewRevenue', () => {
  let service: ProjectService;

  beforeEach(() => {
    execute.mockReset();
    service = new ProjectService();
  });

  it('marks the response as available and orders streams by domain when rows are returned', async () => {
    execute.mockResolvedValueOnce({
      rows: [
        buildRevenueWideRow({ REVENUE_DOMAIN: 'memberships', REVENUE_USD: 600_000, FOUNDATION_TOTAL_REVENUE_USD: 1_000_000 }),
        buildRevenueWideRow({ REVENUE_DOMAIN: 'events', REVENUE_USD: 400_000, FOUNDATION_TOTAL_REVENUE_USD: 1_000_000 }),
      ],
    });

    const result = await service.getHealthOverviewRevenue('cncf');

    expect(result['YTD']).toEqual({
      dataAvailable: true,
      total: 1_000_000,
      streams: [
        { key: 'memberships', value: 600_000 },
        { key: 'events', value: 400_000 },
      ],
    });
    expect(execute.mock.calls[0][0]).toContain('ORDER BY revenue_domain');
  });

  it('reports dataAvailable false for every range with a zeroed summary when no rows are returned, instead of a fake $0', async () => {
    execute.mockResolvedValueOnce({ rows: [] });

    const result = await service.getHealthOverviewRevenue('cncf');

    expect(Object.values(result)).toEqual(
      Array.from({ length: buildHealthMetricsOverviewPeriods().length }, () => ({
        dataAvailable: false,
        total: 0,
        streams: [],
      }))
    );
  });

  it('reports dataAvailable false for the ranges whose total is null while keeping the populated range available', async () => {
    execute.mockResolvedValueOnce({
      rows: [
        {
          REVENUE_DOMAIN: 'memberships',
          REVENUE_USD__YTD: 600_000,
          FOUNDATION_TOTAL_REVENUE_USD__YTD: 600_000,
          REVENUE_USD__COMPLETED_YEAR: null,
          FOUNDATION_TOTAL_REVENUE_USD__COMPLETED_YEAR: null,
        },
      ],
    });

    const result = await service.getHealthOverviewRevenue('cncf');

    expect(result['YTD']).toEqual({ dataAvailable: true, total: 600_000, streams: [{ key: 'memberships', value: 600_000 }] });
    expect(result['COMPLETED_YEAR']).toEqual({ dataAvailable: false, total: 0, streams: [] });
  });

  it('keeps a period available when the driver returns its high-precision totals as strings', async () => {
    // Snowflake can serialize a high-precision NUMBER as a string; rejecting it instead of coercing
    // would report a funded foundation as having no revenue data for the period.
    execute.mockResolvedValueOnce({
      rows: [{ REVENUE_DOMAIN: 'memberships', REVENUE_USD__YTD: '600000.00', FOUNDATION_TOTAL_REVENUE_USD__YTD: '1000000.00' }],
    });

    const result = await service.getHealthOverviewRevenue('cncf');

    expect(result['YTD']).toEqual({ dataAvailable: true, total: 1_000_000, streams: [{ key: 'memberships', value: 600_000 }] });
  });

  it('reads every selectable period in a single one-bind query and never emits the 4th-year-back suffix this table lacks', async () => {
    execute.mockResolvedValueOnce({ rows: [] });

    await service.getHealthOverviewRevenue('cncf');

    const [query, binds] = execute.mock.calls[0];
    expect(execute).toHaveBeenCalledTimes(1);
    expect(binds).toEqual(['cncf']);
    expect((query as string).match(/\?/g)).toHaveLength(1);
    // Columns come from the shared constant the service generates the SELECT from, so adding one
    // there without covering it here can't quietly leave a period unselected.
    for (const suffix of ['_ytd', '_last_completed_year', '_prev_completed_year', '_3rd_last_completed_year']) {
      for (const column of HEALTH_OVERVIEW_REVENUE_PERIOD_COLUMNS) {
        expect(query).toContain(`${column.toLowerCase()}${suffix}`);
      }
    }
    expect(query).not.toContain('_4th_last_completed_year');
  });
});

describe('ProjectService — getHealthOverviewKpis', () => {
  let service: ProjectService;

  beforeEach(() => {
    execute.mockReset();
    service = new ProjectService();
  });

  it('maps a fetched row to the five covered area states, pinning to a single row', async () => {
    execute.mockResolvedValueOnce({
      rows: [
        buildKpiWideRow({
          EVENTS_PCT_OF_REGISTRATION_GOAL: 81,
          EVENTS_STATUS: 'healthy',
          // >1,000 so formatNumber's compact notation is actually exercised, not just its identity
          // behavior on small integers (which the pre-formatNumber `String()` code also produced).
          CERTIFICATIONS_EARNED_COUNT: 1240,
          TRAINING_STATUS: 'needs_attention',
          // Deliberately distinct from the frontend's still-fixture-backed `code` stat value (184)
          // so this test can't pass by accident against stale fixture data.
          CONTRIBUTORS_COUNT: 2540,
          MEMBERS_RENEWING_90D_VALUE_USD: 250_000,
          MEMBERS_STATUS: 'needs_action',
          NON_MEMBERS_PIPELINE_VALUE_USD: 75_000,
          NON_MEMBERS_STATUS: 'healthy',
        }),
      ],
    });

    const result = (await service.getHealthOverviewKpis('cncf'))['YTD'];

    expect(result).toEqual([
      expect.objectContaining({ area: 'evt', statValue: '81%', statLabel: 'of registration goal', classification: 'ok', showStatus: true }),
      expect.objectContaining({ area: 'trn', statValue: '1.2K', statLabel: 'certifications earned', classification: 'watch' }),
      expect.objectContaining({ area: 'mem', statValue: '$250K', statLabel: 'renewing in next 90 days', classification: 'act' }),
      expect.objectContaining({ area: 'non', statValue: '$75K', statLabel: 'pipeline value', classification: 'ok' }),
      expect.objectContaining({ area: 'code', statValue: '2.5K', statLabel: 'active contributors', classification: 'none' }),
    ]);
    expect(execute.mock.calls[0][0]).toContain('LIMIT 1');
  });

  it('renders a blank stat with an alternate label for each NULL column instead of a fabricated 0, and hides the status chip when there is no registration goal', async () => {
    execute.mockResolvedValueOnce({
      rows: [
        buildKpiWideRow({
          EVENTS_PCT_OF_REGISTRATION_GOAL: null,
          EVENTS_STATUS: null,
          CERTIFICATIONS_EARNED_COUNT: null,
          TRAINING_STATUS: null,
          CONTRIBUTORS_COUNT: null,
          MEMBERS_RENEWING_90D_VALUE_USD: null,
          MEMBERS_STATUS: null,
          NON_MEMBERS_PIPELINE_VALUE_USD: null,
          NON_MEMBERS_STATUS: null,
        }),
      ],
    });

    const result = (await service.getHealthOverviewKpis('cncf'))['YTD'];

    expect(result).toEqual([
      expect.objectContaining({ area: 'evt', statValue: '—', statLabel: 'no registration goal set', classification: 'none', showStatus: false }),
      expect.objectContaining({ area: 'trn', statValue: '—', statLabel: 'certifications earned', classification: 'none' }),
      expect.objectContaining({ area: 'mem', statValue: '—', statLabel: 'renewing in next 90 days', classification: 'none' }),
      expect.objectContaining({ area: 'non', statValue: '—', statLabel: 'pipeline value', classification: 'none' }),
      expect.objectContaining({ area: 'code', statValue: '—', statLabel: 'active contributors', classification: 'none' }),
    ]);
  });

  it('renders a genuine zero contributor count as "0", not the neutral placeholder', async () => {
    execute.mockResolvedValueOnce({
      rows: [
        buildKpiWideRow({
          EVENTS_PCT_OF_REGISTRATION_GOAL: 81,
          EVENTS_STATUS: 'healthy',
          CERTIFICATIONS_EARNED_COUNT: 42,
          TRAINING_STATUS: 'needs_attention',
          CONTRIBUTORS_COUNT: 0,
          MEMBERS_RENEWING_90D_VALUE_USD: 250_000,
          MEMBERS_STATUS: 'needs_action',
          NON_MEMBERS_PIPELINE_VALUE_USD: 75_000,
          NON_MEMBERS_STATUS: 'healthy',
        }),
      ],
    });

    const result = (await service.getHealthOverviewKpis('cncf'))['YTD'];

    expect(result).toEqual(expect.arrayContaining([expect.objectContaining({ area: 'code', statValue: '0', statLabel: 'active contributors' })]));
  });

  it('renders a NULL stat value alongside a real status for a mixed row, instead of only ever testing the all-NULL/all-populated extremes', async () => {
    execute.mockResolvedValueOnce({
      rows: [
        buildKpiWideRow({
          EVENTS_PCT_OF_REGISTRATION_GOAL: 81,
          EVENTS_STATUS: 'healthy',
          CERTIFICATIONS_EARNED_COUNT: 42,
          TRAINING_STATUS: 'needs_attention',
          CONTRIBUTORS_COUNT: 2540,
          MEMBERS_RENEWING_90D_VALUE_USD: 250_000,
          MEMBERS_STATUS: 'needs_action',
          NON_MEMBERS_PIPELINE_VALUE_USD: null,
          NON_MEMBERS_STATUS: 'healthy',
        }),
      ],
    });

    const result = (await service.getHealthOverviewKpis('cncf'))['YTD'];

    expect(result).toEqual(
      expect.arrayContaining([expect.objectContaining({ area: 'non', statValue: '—', statLabel: 'pipeline value', classification: 'ok' })])
    );
  });

  it('shows the events status chip with a real classification when the goal is unset but EVENTS_STATUS is populated', async () => {
    execute.mockResolvedValueOnce({
      rows: [
        buildKpiWideRow({
          EVENTS_PCT_OF_REGISTRATION_GOAL: null,
          EVENTS_STATUS: 'healthy',
          CERTIFICATIONS_EARNED_COUNT: 42,
          TRAINING_STATUS: 'needs_attention',
          CONTRIBUTORS_COUNT: 2540,
          MEMBERS_RENEWING_90D_VALUE_USD: 250_000,
          MEMBERS_STATUS: 'needs_action',
          NON_MEMBERS_PIPELINE_VALUE_USD: 75_000,
          NON_MEMBERS_STATUS: 'healthy',
        }),
      ],
    });

    const result = (await service.getHealthOverviewKpis('cncf'))['YTD'];

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ area: 'evt', statValue: '—', statLabel: 'no registration goal set', classification: 'ok', showStatus: true }),
      ])
    );
  });

  it('shows an "Awaiting data" events status chip when the goal is set but EVENTS_STATUS is unpopulated, matching how trn/mem/non treat a null status', async () => {
    execute.mockResolvedValueOnce({
      rows: [
        buildKpiWideRow({
          EVENTS_PCT_OF_REGISTRATION_GOAL: 81,
          EVENTS_STATUS: null,
          CERTIFICATIONS_EARNED_COUNT: 42,
          TRAINING_STATUS: 'needs_attention',
          CONTRIBUTORS_COUNT: 2540,
          MEMBERS_RENEWING_90D_VALUE_USD: 250_000,
          MEMBERS_STATUS: 'needs_action',
          NON_MEMBERS_PIPELINE_VALUE_USD: 75_000,
          NON_MEMBERS_STATUS: 'healthy',
        }),
      ],
    });

    const result = (await service.getHealthOverviewKpis('cncf'))['YTD'];

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ area: 'evt', statValue: '81%', statLabel: 'of registration goal', classification: 'none', showStatus: true }),
      ])
    );
  });

  it('returns an empty array for every range when no row is returned for the foundation', async () => {
    execute.mockResolvedValueOnce({ rows: [] });

    const result = await service.getHealthOverviewKpis('cncf');

    expect(Object.keys(result)).toEqual(buildHealthMetricsOverviewPeriods().map((period) => period.range));
    expect(Object.values(result)).toEqual(buildHealthMetricsOverviewPeriods().map(() => []));
  });

  it('projects each range independently from the one wide row, so a populated YTD does not leak into an empty prior year', async () => {
    execute.mockResolvedValueOnce({
      rows: [
        {
          ...buildKpiWideRow({ CONTRIBUTORS_COUNT: 2540, MEMBERS_RENEWING_90D_VALUE_USD: 250_000 }),
          ...buildKpiWideRow({ CONTRIBUTORS_COUNT: null }, 'COMPLETED_YEAR'),
        },
      ],
    });

    const result = await service.getHealthOverviewKpis('cncf');

    expect(result['YTD']).toEqual(expect.arrayContaining([expect.objectContaining({ area: 'code', statValue: '2.5K' })]));
    expect(result['COMPLETED_YEAR']).toEqual(expect.arrayContaining([expect.objectContaining({ area: 'code', statValue: '—' })]));
    // Period-invariant columns are selected once, so they repeat across every range's projected row.
    expect(result['COMPLETED_YEAR']).toEqual(expect.arrayContaining([expect.objectContaining({ area: 'mem', statValue: '$250K' })]));
  });

  it('reads every selectable period in a single one-bind query, selects the invariant columns once, and never emits the 4th-year-back suffix', async () => {
    execute.mockResolvedValueOnce({ rows: [] });

    await service.getHealthOverviewKpis('cncf');

    const [query, binds] = execute.mock.calls[0];
    expect(execute).toHaveBeenCalledTimes(1);
    expect(binds).toEqual(['cncf']);
    expect((query as string).match(/\?/g)).toHaveLength(1);
    for (const suffix of ['_ytd', '_last_completed_year', '_prev_completed_year', '_3rd_last_completed_year']) {
      expect(query).toContain(`events_pct_of_registration_goal${suffix}`);
      expect(query).toContain(`contributors_count${suffix}`);
      // The members/non-members columns carry no suffix — they must never be generated per range.
      expect(query).not.toContain(`members_renewing_90d_value_usd${suffix}`);
    }
    expect((query as string).match(/members_renewing_90d_value_usd/g)).toHaveLength(1);
    expect((query as string).match(/non_members_pipeline_value_usd/g)).toHaveLength(1);
    expect(query).not.toContain('_4th_last_completed_year');
  });
});

describe('ProjectService — getFoundationProfileSummary', () => {
  let service: ProjectService;

  beforeEach(() => {
    execute.mockReset();
    vi.mocked(SnowflakeService.isMissingObjectError).mockReturnValue(false);
    service = new ProjectService();
  });

  it('formats a fetched row into display strings, pinning to a single row', async () => {
    execute.mockResolvedValueOnce({
      rows: [{ PROJECT_COUNT: 14, MEMBERSHIP_TIER_COUNT: 4, BOARD_SEAT_COUNT: 12, RENEWALS_NEXT_90D_COUNT: 5 }],
    });

    const result = await service.getFoundationProfileSummary('cncf');

    expect(result).toEqual({ projects: 14, tiers: '4 tiers', board: '12 seats', nextRenewals: '5 in the next 90 days' });
    expect(execute.mock.calls[0][0]).toContain('LIMIT 1');
  });

  it('singularizes tier and seat labels when the count is exactly 1', async () => {
    execute.mockResolvedValueOnce({
      rows: [{ PROJECT_COUNT: 1, MEMBERSHIP_TIER_COUNT: 1, BOARD_SEAT_COUNT: 1, RENEWALS_NEXT_90D_COUNT: 0 }],
    });

    const result = await service.getFoundationProfileSummary('cncf');

    expect(result).toEqual({ projects: 1, tiers: '1 tier', board: '1 seat', nextRenewals: '0 in the next 90 days' });
  });

  it('returns the zero-filled default when no row is returned for the foundation', async () => {
    execute.mockResolvedValueOnce({ rows: [] });

    const result = await service.getFoundationProfileSummary('cncf');

    expect(result).toEqual({ projects: 0, tiers: 'N/A', board: 'N/A', nextRenewals: 'N/A' });
  });

  it('returns the zero-filled default instead of a 5xx when the table is not deployed yet', async () => {
    vi.mocked(SnowflakeService.isMissingObjectError).mockReturnValue(true);
    execute.mockRejectedValueOnce(new Error('Object does not exist'));

    const result = await service.getFoundationProfileSummary('cncf');

    expect(result).toEqual({ projects: 0, tiers: 'N/A', board: 'N/A', nextRenewals: 'N/A' });
  });
});

describe('ProjectService — enrichWithProjectData', () => {
  let service: ProjectService;

  // Membership-funded + Active + not an Internal Allocation, per the real computeIsFoundation.
  function foundationProject(uid: string, overrides: Partial<Project> = {}): Project {
    return {
      uid,
      slug: uid,
      name: `name-${uid}`,
      stage: 'Active',
      legal_entity_type: '',
      funding: 'Funded' as ProjectFunding,
      funding_model: ['Membership'],
      ...overrides,
    } as Project;
  }
  // Missing the Membership funding model — the real computeIsFoundation returns false.
  function childProject(uid: string, parentUid: string, overrides: Partial<Project> = {}): Project {
    return {
      uid,
      slug: uid,
      name: `name-${uid}`,
      stage: 'Active',
      legal_entity_type: '',
      funding: 'Funded' as ProjectFunding,
      funding_model: [],
      parent_uid: parentUid,
      ...overrides,
    } as Project;
  }

  beforeEach(() => {
    proxyRequest.mockReset();
    service = new ProjectService();
  });

  it('deduplicates project_uids into a single batched lookup', async () => {
    const getProjectsByIds = vi.spyOn(service, 'getProjectsByIds').mockResolvedValue(new Map());

    await service.enrichWithProjectData(req, [{ project_uid: 'a' }, { project_uid: 'a' }, { project_uid: 'b' }]);

    expect(getProjectsByIds).toHaveBeenCalledTimes(1);
    expect(getProjectsByIds).toHaveBeenCalledWith(req, ['a', 'b']);
  });

  it('prefers freshly fetched project fields over the item payload and computes is_foundation from the fresh project', async () => {
    vi.spyOn(service, 'getProjectsByIds').mockResolvedValue(
      new Map([
        ['fdn', foundationProject('fdn', { name: 'Fresh Foundation', slug: 'fresh-fdn' })],
        ['child', childProject('child', 'fdn', { name: 'Fresh Child', slug: 'fresh-child' })],
      ])
    );

    const result = await service.enrichWithProjectData(req, [
      { project_uid: 'fdn', project_name: 'stale', project_slug: 'stale', is_foundation: false, parent_project_uid: '' },
      { project_uid: 'child', project_name: 'stale', project_slug: 'stale', is_foundation: true, parent_project_uid: 'stale-parent' },
    ]);

    // Fresh fields win on every mapped column — including is_foundation flipping both ways
    // (stale false -> computed true for the foundation; stale true -> computed false for the child).
    expect(result).toEqual([
      { project_uid: 'fdn', project_name: 'Fresh Foundation', project_slug: 'fresh-fdn', is_foundation: true, parent_project_uid: '' },
      { project_uid: 'child', project_name: 'Fresh Child', project_slug: 'fresh-child', is_foundation: false, parent_project_uid: 'fdn' },
    ]);
  });

  it('keeps payload fallbacks and leaves is_foundation undefined (not false) for unresolved projects', async () => {
    vi.spyOn(service, 'getProjectsByIds').mockResolvedValue(new Map());

    const result = await service.enrichWithProjectData(req, [
      { project_uid: 'gone', project_name: 'Payload Name', project_slug: 'payload-slug', parent_project_uid: 'payload-parent' },
      { project_uid: 'gone2', project_name: 'Tiered', project_slug: 'tiered', is_foundation: true, parent_project_uid: 'p' },
    ]);

    expect(result[0]).toEqual({
      project_uid: 'gone',
      project_name: 'Payload Name',
      project_slug: 'payload-slug',
      parent_project_uid: 'payload-parent',
      is_foundation: undefined,
    });
    // The fail-soft contract: consumers treat undefined as "tier unknown" and fall back safely;
    // a coerced false would mislabel a foundation-owned entity as project-owned.
    expect(result[0].is_foundation).toBeUndefined();
    // An item's own tier signal survives the ?? fallback untouched.
    expect(result[1].is_foundation).toBe(true);
  });

  it('resolves the projects the batch returns and falls back per-row for the rest', async () => {
    vi.spyOn(service, 'getProjectsByIds').mockResolvedValue(new Map([['ok', childProject('ok', 'fdn', { name: 'Resolved', slug: 'resolved' })]]));

    const result = await service.enrichWithProjectData(req, [
      { project_uid: 'ok', project_name: 'stale', project_slug: 'stale', parent_project_uid: 'stale' },
      { project_uid: 'skipped', project_name: 'Kept', project_slug: 'kept', parent_project_uid: 'kept-parent' },
    ]);

    expect(result[0]).toMatchObject({ project_name: 'Resolved', project_slug: 'resolved', is_foundation: false, parent_project_uid: 'fdn' });
    expect(result[1]).toMatchObject({ project_name: 'Kept', project_slug: 'kept', parent_project_uid: 'kept-parent' });
    expect(result[1].is_foundation).toBeUndefined();
  });

  it('keeps item-level fields untouched when every batch fails', async () => {
    // getProjectsByIds warn-and-skips failed batches internally, so a full query-service outage
    // surfaces here as an empty map — the same net merge outcome as the old all-null per-item
    // failures, with no exception escaping the enrichment.
    vi.spyOn(service, 'getProjectsByIds').mockResolvedValue(new Map());

    const result = await service.enrichWithProjectData(req, [
      { project_uid: 'x', project_name: 'Last Known', project_slug: 'last-known', is_foundation: true, parent_project_uid: 'p' },
    ]);

    expect(result[0]).toMatchObject({ project_name: 'Last Known', project_slug: 'last-known', is_foundation: true, parent_project_uid: 'p' });
  });
});

describe('ProjectService.updateProjectPermissions', () => {
  let service: ProjectService;
  const req = { path: '/api/projects/project-1/permissions' } as Request;

  const member = { name: 'Sam Chen', email: 'sam.chen@cascade-data.example', username: 'sam.chen' };

  function mockFetch(settings: Record<string, unknown> = { writers: [member], auditors: [] }): void {
    fetchWithETag.mockResolvedValue({ data: settings, etag: 'etag-1' });
    updateWithETag.mockImplementation(async (_req: unknown, _svc: unknown, _path: unknown, _etag: unknown, body: unknown) => body);
  }

  beforeEach(() => {
    fetchWithETag.mockReset();
    updateWithETag.mockReset();
    natsRequest.mockReset();
    checkSingleAccessStrict.mockReset();
    // Authorized writer unless a test says otherwise — the guard runs before everything else.
    checkSingleAccessStrict.mockResolvedValue(true);
    service = new ProjectService();
  });

  it('rejects a non-writer before the settings read or the directory lookup (#2728 review)', async () => {
    checkSingleAccessStrict.mockResolvedValue(false);
    mockFetch();

    await expect(service.updateProjectPermissions(req, 'project-1', 'add', 'nobody@partner-corp.example', 'view')).rejects.toMatchObject({
      statusCode: 403,
      code: 'AUTHORIZATION_REQUIRED',
    });

    expect(checkSingleAccessStrict).toHaveBeenCalledWith(req, { resource: 'project', id: 'project-1', access: 'writer' });
    // Nothing may run before the gate: the directory lookup answers "is this address known?"
    // with a distinguishable 404, so reaching it would leak directory membership to a reader.
    expect(natsRequest).not.toHaveBeenCalled();
    expect(fetchWithETag).not.toHaveBeenCalled();
    expect(updateWithETag).not.toHaveBeenCalled();
  });

  it('fails closed when the access check itself cannot be resolved', async () => {
    checkSingleAccessStrict.mockRejectedValue(new Error('fga unavailable'));
    mockFetch();

    await expect(service.updateProjectPermissions(req, 'project-1', 'add', 'nobody@partner-corp.example', 'view')).rejects.toThrow('fga unavailable');
    expect(fetchWithETag).not.toHaveBeenCalled();
  });

  it('refuses to re-add someone already on the project instead of silently re-filing their role', async () => {
    mockFetch({ writers: [member], auditors: [] });

    await expect(service.updateProjectPermissions(req, 'project-1', 'add', 'sam.chen', 'view')).rejects.toMatchObject({
      statusCode: 409,
      code: 'ALREADY_ON_PROJECT',
    });

    expect(updateWithETag).not.toHaveBeenCalled();
  });

  it('still adds a manual (email-only) entry that is not yet listed, without a directory lookup', async () => {
    mockFetch({ writers: [member], auditors: [] });

    const result = await service.updateProjectPermissions(req, 'project-1', 'add', 'kim.park@partner-corp.example', 'view', {
      name: 'Kim Park',
      email: 'kim.park@partner-corp.example',
    });

    expect(natsRequest).not.toHaveBeenCalled();
    expect(updateWithETag).toHaveBeenCalledTimes(1);
    expect(result.auditors).toEqual([{ name: 'Kim Park', email: 'kim.park@partner-corp.example' }]);
    expect(result.writers).toEqual([member]);
  });

  it('still lets update re-file an existing member under a new role', async () => {
    mockFetch({ writers: [member], auditors: [] });

    const result = await service.updateProjectPermissions(req, 'project-1', 'update', 'sam.chen', 'view');

    expect(result.writers).toEqual([]);
    expect(result.auditors).toEqual([member]);
  });
});

describe('ProjectService.updateProjectStaff', () => {
  let service: ProjectService;

  beforeEach(() => {
    fetchWithETag.mockReset();
    updateWithETag.mockReset();
    checkSingleAccessStrict.mockReset();
    // Authorized writer unless a test says otherwise — the guard runs before everything else.
    checkSingleAccessStrict.mockResolvedValue(true);
    service = new ProjectService();
  });

  // Settings document as fetchWithETag hands it over: both staff roles assigned, plus one
  // blank string field (description) so the nullifyEmptyStrings sanitization is observable.
  function currentSettings() {
    return {
      executive_director: { name: 'Current ED', email: 'ed@example.com', username: 'currented' },
      program_manager: { name: 'Current PM', email: 'pm@example.com', username: 'currentpm' },
      description: '',
      website_url: 'https://example.com',
    };
  }

  function mockFetch(): void {
    fetchWithETag.mockResolvedValue({ data: currentSettings(), etag: 'W/"42"' });
  }

  /** The settings document updateWithETag was asked to PUT. */
  function putBody(): Record<string, unknown> {
    return updateWithETag.mock.calls[0][4];
  }

  it('clears the role on assignee null, preserves untouched settings, sanitizes blanks, and forwards the ETag', async () => {
    mockFetch();
    const updated = { ...currentSettings(), executive_director: null };
    updateWithETag.mockResolvedValue(updated);

    const result = await service.updateProjectStaff(req, 'project-1', 'executive_director', null);

    expect(fetchWithETag).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', '/projects/project-1/settings', 'update_project_staff_settings');
    expect(updateWithETag).toHaveBeenCalledTimes(1);
    const [, , path, etag] = updateWithETag.mock.calls[0];
    expect(path).toBe('/projects/project-1/settings');
    // The ETag from the read must be the one forwarded to the write — otherwise the
    // read-modify-write loses its concurrent-modification guard.
    expect(etag).toBe('W/"42"');
    const body = putBody();
    expect(body['executive_director']).toBeNull();
    // Untouched settings survive the full-document write...
    expect(body['program_manager']).toEqual(currentSettings().program_manager);
    expect(body['website_url']).toBe('https://example.com');
    // ...and empty strings cross as null (upstream rejects "" on validated fields).
    expect(body['description']).toBeNull();
    expect(result).toEqual(updated);
  });

  it('writes a manual assignee (trimmed name, lowercased email) without a directory lookup', async () => {
    mockFetch();
    updateWithETag.mockResolvedValue({});
    const getUserInfoSpy = vi.spyOn(service, 'getUserInfo').mockResolvedValue({ name: '', email: '', username: '' });

    await service.updateProjectStaff(req, 'project-1', 'program_manager', { email: '  New@Example.COM ', name: '  New Person  ' });

    // A name on the assignee means the writer confirmed a manual entry after the directory
    // 404 — the NATS lookup would 404 again and must be skipped.
    expect(getUserInfoSpy).not.toHaveBeenCalled();
    const body = putBody();
    expect(body['program_manager']).toEqual({ name: 'New Person', email: 'new@example.com' });
    expect(body['executive_director']).toEqual(currentSettings().executive_director);
  });

  it('resolves an email-only assignee through the directory lookup and writes the resolved UserInfo', async () => {
    mockFetch();
    updateWithETag.mockResolvedValue({});
    const userInfo = { name: 'Resolved User', email: 'resolved@example.com', username: 'resolved', avatar: 'https://img.example/avatar.png' };
    const getUserInfoSpy = vi.spyOn(service, 'getUserInfo').mockResolvedValue(userInfo);

    await service.updateProjectStaff(req, 'project-1', 'executive_director', { email: 'resolved@example.com' });

    expect(getUserInfoSpy).toHaveBeenCalledWith(req, 'resolved@example.com');
    const body = putBody();
    expect(body['executive_director']).toEqual(userInfo);
    expect(body['program_manager']).toEqual(currentSettings().program_manager);
  });

  it('propagates a directory miss as the generic NOT_FOUND so the client can offer manual entry', async () => {
    mockFetch();
    // The 404 getUserInfo raises for an email that is not in the directory. It must reach the
    // client with the generic NOT_FOUND code: the settings read/write 404s are re-coded to
    // PROJECT_SETTINGS_NOT_FOUND precisely so this one stays the only NOT_FOUND on the route,
    // and the dialog gates its manual-entry fallback on that code.
    vi.spyOn(service, 'getUserInfo').mockRejectedValue(
      new ResourceNotFoundError('User', 'nobody@example.com', { operation: 'get_user_info', service: 'project_service' })
    );

    await expect(service.updateProjectStaff(req, 'project-1', 'executive_director', { email: 'nobody@example.com' })).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    });

    // The role must be left as it was — an unresolved assignee never reaches the write.
    expect(updateWithETag).not.toHaveBeenCalled();
  });

  it('re-codes a settings 404 so it cannot be mistaken for a directory miss', async () => {
    const notFound = Object.assign(new Error('Project settings not found'), { statusCode: 404, code: 'NOT_FOUND' });
    fetchWithETag.mockRejectedValue(notFound);

    await expect(service.updateProjectStaff(req, 'missing-project', 'executive_director', { email: 'resolved@example.com' })).rejects.toMatchObject({
      statusCode: 404,
      code: PROJECT_SETTINGS_NOT_FOUND_CODE,
    });

    expect(updateWithETag).not.toHaveBeenCalled();
  });

  it('rejects a non-writer before the settings read or the directory lookup', async () => {
    checkSingleAccessStrict.mockResolvedValue(false);
    mockFetch();
    const getUserInfoSpy = vi.spyOn(service, 'getUserInfo');

    await expect(service.updateProjectStaff(req, 'project-1', 'executive_director', { email: 'nobody@example.com' })).rejects.toMatchObject({
      statusCode: 403,
      code: 'AUTHORIZATION_REQUIRED',
    });

    expect(checkSingleAccessStrict).toHaveBeenCalledWith(req, { resource: 'project', id: 'project-1', access: 'writer' });
    // Nothing may run before the gate. The directory lookup in particular distinguishes a
    // known email (reaches the write) from an unknown one (404), so letting an unauthorized
    // caller reach it would leak directory membership; the settings read is skipped too.
    expect(getUserInfoSpy).not.toHaveBeenCalled();
    expect(fetchWithETag).not.toHaveBeenCalled();
    expect(updateWithETag).not.toHaveBeenCalled();
  });

  it('fails closed when the access check itself cannot be resolved', async () => {
    // Strict, not the degrading variant: an FGA outage must not be reported as "not a writer"
    // and must never fall through to the write.
    checkSingleAccessStrict.mockRejectedValue(new Error('fga unavailable'));
    mockFetch();

    await expect(service.updateProjectStaff(req, 'project-1', 'executive_director', null)).rejects.toThrow('fga unavailable');

    expect(fetchWithETag).not.toHaveBeenCalled();
    expect(updateWithETag).not.toHaveBeenCalled();
  });
});

describe('ProjectService — the assignee email never reaches structured logs', () => {
  let service: ProjectService;

  beforeEach(() => {
    startOperation.mockClear();
    success.mockClear();
    debug.mockClear();
    warning.mockClear();
    natsRequest.mockReset();
    service = new ProjectService();
  });

  /** Every metadata object handed to the logger during the call, flattened for inspection. */
  function loggedMetadata(): Record<string, unknown>[] {
    return [
      ...startOperation.mock.calls.map((call) => call[2]),
      ...success.mock.calls.map((call) => call[3]),
      ...debug.mock.calls.map((call) => call[3]),
      ...warning.mock.calls.map((call) => call[3]),
    ].filter((meta): meta is Record<string, unknown> => typeof meta === 'object' && meta !== null);
  }

  it('masks the address on a successful directory resolution', async () => {
    natsRequest.mockResolvedValue({ data: JSON.stringify('adalovelace') });

    await expect(service.resolveEmailToUsername(req, 'Ada.Lovelace@example.com')).resolves.toBe('adalovelace');

    const metadata = loggedMetadata();
    expect(metadata.length).toBeGreaterThan(0);
    // Neither redact.paths nor SENSITIVE_FIELDS covers `email`, so an unmasked address here is
    // retained by the log destination indefinitely — the mask is the only thing preventing it.
    for (const meta of metadata) {
      expect(JSON.stringify(meta)).not.toContain('ada.lovelace@example.com');
      expect(JSON.stringify(meta)).not.toContain('Ada.Lovelace@example.com');
    }
    expect(metadata.some((meta) => meta['email'] === '***@example.com')).toBe(true);
  });

  it('masks the address on the directory miss, which is the path a staff edit actually hits', async () => {
    // The shape NATS returns for an unknown address — the warning log on this branch was the
    // one Copilot flagged, and it is reached on every failed staff assignment.
    natsRequest.mockResolvedValue({ data: JSON.stringify({ success: false, error: 'not found' }) });

    await expect(service.resolveEmailToUsername(req, 'nobody@example.com')).rejects.toMatchObject({ statusCode: 404 });

    const metadata = loggedMetadata();
    expect(metadata.length).toBeGreaterThan(0);
    for (const meta of metadata) {
      expect(JSON.stringify(meta)).not.toContain('nobody@example.com');
    }
    expect(metadata.some((meta) => meta['email'] === '***@example.com')).toBe(true);
  });

  it('masks the resolved identifier when the directory hands back the address as the username', async () => {
    // Some accounts' directory identifier *is* their address (the NATS sub equals the email, and a
    // manually-added user's identifier is what was typed). Masking `email` alone then leaves the
    // same address in the `username` field of the very same log line.
    natsRequest.mockResolvedValue({ data: JSON.stringify('ada.lovelace@example.com') });

    await expect(service.resolveEmailToUsername(req, 'Ada.Lovelace@example.com')).resolves.toBe('ada.lovelace@example.com');

    const metadata = loggedMetadata();
    expect(metadata.length).toBeGreaterThan(0);
    for (const meta of metadata) {
      expect(JSON.stringify(meta)).not.toContain('ada.lovelace@example.com');
      expect(JSON.stringify(meta)).not.toContain('Ada.Lovelace@example.com');
    }
    expect(metadata.some((meta) => meta['username'] === '***@example.com')).toBe(true);
  });
});

describe('ProjectService — directory lookup failure classification', () => {
  let service: ProjectService;

  beforeEach(() => {
    natsRequest.mockReset();
    service = new ProjectService();
  });

  // Both manual-entry gates key on 404 NOT_FOUND, so a lost or unusable directory answer must
  // surface as 5xx — never as a miss.

  it('keeps the explicit directory miss on 404 NOT_FOUND, with no transport marker', async () => {
    natsRequest.mockResolvedValue({ data: JSON.stringify({ success: false, error: 'not found' }) });

    await expect(service.resolveEmailToUsername(req, 'nobody@example.com')).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
      transportFailure: undefined,
    });
  });

  it('maps a lost answer (NATS timeout) to 503 SERVICE_UNAVAILABLE with the transport marker', async () => {
    natsRequest.mockRejectedValue(new Error('nats request timeout'));

    await expect(service.resolveEmailToUsername(req, 'ada@example.com')).rejects.toMatchObject({
      statusCode: 503,
      code: 'SERVICE_UNAVAILABLE',
      transportFailure: true,
    });
  });

  it('maps a NATS 503 no-responder to 503, propagated through getUserInfo unchanged', async () => {
    natsRequest.mockRejectedValue(new Error('503 No Responders'));

    // The email path resolves via resolveEmailToUsername first; its 503 must survive getUserInfo
    // rather than degrade into a miss on the second leg.
    await expect(service.getUserInfo(req, 'ada@example.com')).rejects.toMatchObject({
      statusCode: 503,
      code: 'SERVICE_UNAVAILABLE',
      transportFailure: true,
    });
  });

  it('maps an empty username in an otherwise-successful reply to 502 BAD_GATEWAY', async () => {
    natsRequest.mockResolvedValue({ data: JSON.stringify({ success: true, username: '   ' }) });

    await expect(service.resolveEmailToUsername(req, 'ada@example.com')).rejects.toMatchObject({
      statusCode: 502,
      code: 'BAD_GATEWAY',
    });
  });

  it('maps a metadata reply that is not an object to 502 BAD_GATEWAY', async () => {
    // A plain username, so the email-resolution leg is skipped and only USER_METADATA_READ runs.
    natsRequest.mockResolvedValue({ data: JSON.stringify(null) });

    await expect(service.getUserInfo(req, 'adalovelace')).rejects.toMatchObject({
      statusCode: 502,
      code: 'BAD_GATEWAY',
    });
  });

  it('maps a lost answer on the sub lookup to 503 as well', async () => {
    natsRequest.mockRejectedValue(new Error('nats request timeout'));

    await expect(service.resolveEmailToSub(req, 'ada@example.com')).rejects.toMatchObject({
      statusCode: 503,
      code: 'SERVICE_UNAVAILABLE',
      transportFailure: true,
    });
  });
});
