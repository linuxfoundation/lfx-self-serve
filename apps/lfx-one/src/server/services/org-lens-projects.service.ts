// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  DEFAULT_LFX_ONE_PLATINUM_SCHEMA,
  DEFAULT_ALL_ACTIVITIES_PROJECT_LIMIT,
  DEFAULT_ORG_PROJECTS_WORKSPACE_ID,
  DEFAULT_ORG_PROJECTS_WORKSPACE_NAME,
  HEALTH_SCORE_LABELS,
  ORG_PROJECTS_MEMBER_SERVICE_BULK_ADD_CHUNK_SIZE,
  ORG_PROJECTS_OUTSIDE_LF_WAREHOUSE_SLUG,
  ORG_PROJECTS_OUTSIDE_LF_WIRE_SLUG,
  ORG_PROJECTS_SEARCH_MAX_RESULTS,
  ORG_PROJECTS_SEARCH_MIN_LENGTH,
  ORG_PROJECTS_SEARCH_PRELOAD_LIMIT,
  ORG_LENS_PROJECT_PEOPLE_COLUMNS,
  ORG_LENS_PROJECT_ROW_COLUMNS,
  VALKEY_CACHE,
} from '@lfx-one/shared/constants';
import {
  dedupeByKey,
  fromColumnar,
  hasExactColumns,
  isColumnarAbsent,
  isColumnarTable,
  normalizeHealthScoreCategoryV2,
  toColumnar,
  tupleKey,
} from '@lfx-one/shared/utils';
import type {
  CompactOrgLensProjectRow,
  CompactOrgLensProjectsCache,
  InfluenceBand,
  InfluenceTrendDirection,
  OrgLensProject,
  OrgLensProjectPersonRow,
  OrgLensProjectRow,
  OrgLensProjectFoundation,
  OrgLensProjectPerson,
  OrgLensProjectSearchResponse,
  OrgLensProjectsResponse,
  OrgProjectsMemberServiceWorkspaceProject,
  OrgProjectsWorkspace,
  OrgProjectsWorkspaceProjectResource,
  OrgProjectsWorkspaceResource,
  OrgProjectsWorkspacesResponse,
  QueryServiceResponse,
} from '@lfx-one/shared/interfaces';
import type { Request } from 'express';

import { MicroserviceError } from '../errors';
import { fetchAllQueryResources } from '../helpers/query-service.helper';
import { escapeSqlLikePattern } from '../helpers/validation.helper';
import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';
import { SnowflakeService } from './snowflake.service';
import { withOrgCompactCache } from './valkey.service';

export class OrgLensProjectsService {
  private static readonly memberServiceWriteHeaders = { 'X-Sync': 'true' };
  private readonly snowflakeService = SnowflakeService.getInstance();
  private readonly microserviceProxy = new MicroserviceProxyService();

  public async getProjects(accountId: string, orgName: string, slugs: string[] | null): Promise<OrgLensProjectsResponse> {
    // `v7` bump: what is stored is no longer the response but the compact, people-deduplicated
    // projection below (GH-1906). A `v6` entry decodes to nothing recognizable under the new
    // reader, so it must miss outright rather than be read back.
    const cacheKey = `projects:v7:${this.paramSignature([orgName, ...(slugs ?? ['__top__'])])}`;
    // Set by the fetcher below, read by `storable` immediately after it resolves. A flag rather
    // than a field on the response because it must never reach the browser or the stored value —
    // it describes this one fetch, not the page.
    let noActivityDegraded = false;
    return withOrgCompactCache(
      accountId,
      cacheKey,
      VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
      async () => {
        const fetched = await this.fetchProjects(accountId, orgName, slugs);
        noActivityDegraded = fetched.noActivityDegraded;
        return fetched.response;
      },
      { encode: encodeProjectsResponse, decode: decodeProjectsResponse, accept: isCompactProjectsCache },
      // A degraded response is silently missing projects the caller explicitly asked for. Serving
      // it once is the established fallback; storing it is not — and now that compaction brings
      // the largest orgs under the write cap for the first time, an unstored degraded response
      // would become an hour of wrong answers rather than a single one.
      () => !noActivityDegraded
    );
  }

  // NOTE: accountId is intentionally unused — this search spans the GLOBAL onboarded catalog (an admin can add any
  // project), not the caller's org-scoped ORG_LENS_PROJECTS. It's retained in the signature for parity with the
  // other service methods and as the hook for a future org-scoped authorization gate.
  public async searchProjects(accountId: string, query: string, excludeSlugs: readonly string[] = []): Promise<OrgLensProjectSearchResponse> {
    const trimmed = query.trim();
    if (trimmed.length > 0 && trimmed.length < ORG_PROJECTS_SEARCH_MIN_LENGTH) {
      return { results: [] };
    }

    const excluded = [...new Set(excludeSlugs.map((slug) => slug.trim().toLowerCase()).filter(Boolean))];
    // Match on the raw query, not the trimmed one, so this predicate is identical to the PrimeNG
    // multi-select's client-side substring filter (which matches the raw filter-box text). Trimming
    // here while the client filters on the raw text would let the client hide rows this query returned
    // for a stray leading/trailing space. `trimmed` still gates whether the filter applies at all.
    // Escape LIKE metacharacters + ESCAPE '!' so a typed % or _ matches literally — this also keeps the
    // predicate identical to the PrimeNG multi-select's client-side filter, which matches % and _
    // literally (plain substring), so the client can't hide a row the server returned.
    const like = `%${escapeSqlLikePattern(query)}%`;
    // Global onboarded catalog (not org-scoped ORG_LENS_PROJECTS) so an admin can add any project. Already-added
    // rows are marked via ALREADY_ADDED (bound first, positional) and dropped in code — not WHERE — so the UI can tell "already added" from a true no-match.
    const binds: string[] = [];
    let alreadyAddedExpr = '0';
    if (excluded.length) {
      alreadyAddedExpr = `CASE WHEN LOWER(PROJECT_SLUG) IN (${excluded.map(() => '?').join(', ')}) THEN 1 ELSE 0 END`;
      binds.push(...excluded);
    }
    const conditions: string[] = [];
    // Gate on raw query.length (not trimmed) so a whitespace-only filter like " " applies server-side too,
    // matching the client's raw-text predicate; `trimmed` still drives the min-length rule and typed-result cap.
    if (query.length) {
      conditions.push("(PROJECT_NAME ILIKE ? ESCAPE '!' OR PROJECT_SLUG ILIKE ? ESCAPE '!')");
      binds.push(like, like);
    }
    const whereClause = conditions.length ? `WHERE ${conditions.join('\n        AND ')}` : '';
    // Relevance ordering: addable first (ALREADY_ADDED asc), then the match-strength tier below (bound last, after
    // SELECT/WHERE binds). Empty-query preload has no tier and falls back to catalog rank.
    // PROJECT_SLUG is the unique final tiebreaker so the 50/500 LIMIT cap is deterministic across requests
    // (rows tied on rank/name can't reshuffle in and out of the cap) — required for paginated ORDER BY/LIMIT.
    // ONBOARDED_PROJECT_RANK is nullable: pin NULLS LAST so a session-level DEFAULT_NULL_ORDERING can't move
    // null-rank rows in/out of the cap, and end on PROJECT_SLUG (unique) so the 50/500 LIMIT is deterministic.
    let orderByClause = 'ORDER BY ALREADY_ADDED ASC, ONBOARDED_PROJECT_RANK ASC NULLS LAST, PROJECT_NAME ASC, PROJECT_SLUG ASC';
    if (trimmed.length) {
      const exactLike = escapeSqlLikePattern(trimmed);
      const prefixLike = `${exactLike}%`;
      // Tier by match strength so name matches beat slug-only matches: exact name/slug, then name-prefix, then
      // slug-prefix, then contains. Without the split, "kub" ranks the many kubernetes-sigs-* slug siblings
      // above the actual "Kubernetes" project (slug "k8s"); exact-slug still surfaces "k8s" at the very top.
      orderByClause = `ORDER BY
        ALREADY_ADDED ASC,
        CASE
          WHEN PROJECT_NAME ILIKE ? ESCAPE '!' OR PROJECT_SLUG ILIKE ? ESCAPE '!' THEN 0
          WHEN PROJECT_NAME ILIKE ? ESCAPE '!' THEN 1
          WHEN PROJECT_SLUG ILIKE ? ESCAPE '!' THEN 2
          ELSE 3
        END ASC,
        ONBOARDED_PROJECT_RANK ASC NULLS LAST,
        PROJECT_NAME ASC,
        PROJECT_SLUG ASC`;
      binds.push(exactLike, exactLike, prefixLike, prefixLike);
    }
    // Preload keeps the initial panel light; a typed query returns up to the safety cap so the user
    // can scroll the panel to the true end of the match list rather than hitting a hard 20-row wall.
    const limit = trimmed.length ? ORG_PROJECTS_SEARCH_MAX_RESULTS : ORG_PROJECTS_SEARCH_PRELOAD_LIMIT;
    const sql = `
      SELECT
        PROJECT_SLUG,
        PROJECT_NAME,
        PROJECT_LOGO_URL,
        FOUNDATION_SLUG,
        FOUNDATION_NAME,
        FOUNDATION_LOGO_URL,
        ${alreadyAddedExpr} AS ALREADY_ADDED
      FROM ${this.onboardedProjectsTable()}
      ${whereClause}
      ${orderByClause}
      LIMIT ${limit}
    `;

    const result = await this.snowflakeService.execute<OrgLensProjectRow & { ALREADY_ADDED?: number | string }>(sql, binds);
    const addable = result.rows.filter((row) => Number(row.ALREADY_ADDED) !== 1);
    return {
      results: addable.map((row) => ({
        slug: row.PROJECT_SLUG,
        name: row.PROJECT_NAME,
        logoUrl: row.PROJECT_LOGO_URL ?? '',
        foundation: this.mapFoundation(row),
      })),
      // Any returned row we dropped means the query matched a project that's already in the workspace.
      hasMatchesAlreadyInWorkspace: result.rows.length > addable.length,
    };
  }

  /**
   * `canEdit=false` (auditor-only callers) makes this a pure read: member-service rejects the
   * default-workspace bootstrap and seed writes for them, so skipping the writes returns the
   * indexed state instead of a 502 / empty-after-warning result.
   */
  public async getWorkspaces(req: Request, accountId: string, canEdit: boolean): Promise<OrgProjectsWorkspacesResponse> {
    let workspaces = await this.fetchWorkspaceMetadata(req, accountId);
    if (workspaces.length === 0 && !canEdit) {
      return { workspaces: [] };
    }
    if (workspaces.length === 0) {
      try {
        await this.bootstrapDefaultWorkspace(req, accountId);
      } catch (error: unknown) {
        logger.warning(req, 'bootstrap_org_projects_workspace', 'Default workspace bootstrap failed; re-checking metadata', {
          org_uid: accountId,
          err: error,
        });
      }
      workspaces = this.deduplicateDefaultWorkspaces(await this.fetchWorkspaceMetadata(req, accountId));
      if (workspaces.length === 0) {
        throw new MicroserviceError('Could not load or create the default projects workspace.', 502, 'WORKSPACE_BOOTSTRAP_FAILED', {
          operation: 'get_org_lens_workspaces',
          service: 'LFX_V2_MEMBER_SERVICE',
        });
      }
    } else {
      workspaces = this.deduplicateDefaultWorkspaces(workspaces);
    }

    const withProjects = await Promise.all(
      workspaces.map(async (workspace) => ({
        ...workspace,
        projectSlugs: this.isCanonicalDefaultWorkspace(workspace)
          ? // The retry waits for a seed write to be indexed; a read-only caller never writes one.
            await this.fetchWorkspaceProjectSlugsWithRetry(req, workspace.id, { retryIfEmpty: canEdit })
          : await this.fetchWorkspaceProjectSlugs(req, workspace.id),
      }))
    );

    if (!canEdit) {
      return { workspaces: withProjects };
    }
    return { workspaces: await Promise.all(withProjects.map((workspace) => this.ensureDefaultWorkspaceProjects(req, accountId, workspace))) };
  }

  public async createWorkspace(req: Request, accountId: string, name: string): Promise<OrgProjectsWorkspace> {
    const response = await this.microserviceProxy.proxyRequest<unknown>(
      req,
      'LFX_V2_MEMBER_SERVICE',
      `/b2b_orgs/${encodeURIComponent(accountId)}/workspaces`,
      'POST',
      undefined,
      {
        name,
      },
      OrgLensProjectsService.memberServiceWriteHeaders
    );
    const workspace = this.mapMemberServiceWorkspace(response, name);
    return { ...workspace, projectSlugs: [] };
  }

  public async renameWorkspace(req: Request, accountId: string, workspaceId: string, name: string): Promise<OrgProjectsWorkspace> {
    const response = await this.microserviceProxy.proxyRequest<unknown>(
      req,
      'LFX_V2_MEMBER_SERVICE',
      `/b2b_orgs/${encodeURIComponent(accountId)}/workspaces/${encodeURIComponent(workspaceId)}`,
      'PUT',
      undefined,
      { name },
      OrgLensProjectsService.memberServiceWriteHeaders
    );
    const workspace = this.mapMemberServiceWorkspace(response, name, workspaceId);
    const projectSlugs = await this.fetchWorkspaceProjectSlugsWithRetry(req, workspaceId).catch((error: unknown) => {
      logger.warning(req, 'rename_org_lens_workspace', 'Workspace renamed but project membership refresh failed; returning empty slug list', {
        org_uid: accountId,
        workspace_id: workspaceId,
        err: error,
      });
      return [] as string[];
    });
    return { ...workspace, projectSlugs };
  }

  public async deleteWorkspace(req: Request, accountId: string, workspaceId: string): Promise<void> {
    await this.microserviceProxy.proxyRequest<void>(
      req,
      'LFX_V2_MEMBER_SERVICE',
      `/b2b_orgs/${encodeURIComponent(accountId)}/workspaces/${encodeURIComponent(workspaceId)}`,
      'DELETE',
      undefined,
      undefined,
      OrgLensProjectsService.memberServiceWriteHeaders
    );
  }

  public async addProjectsToWorkspace(req: Request, accountId: string, workspaceId: string, slugs: string[]): Promise<OrgProjectsWorkspace> {
    const uniqueSlugs = [...new Set(slugs.map((slug) => slug.trim().toLowerCase()).filter(Boolean))];
    let latestResponse: unknown = null;
    let memberServiceSlugs: string[] = [];
    const chunkSucceeded: string[] = [];
    for (let i = 0; i < uniqueSlugs.length; i += ORG_PROJECTS_MEMBER_SERVICE_BULK_ADD_CHUNK_SIZE) {
      const chunk = uniqueSlugs.slice(i, i + ORG_PROJECTS_MEMBER_SERVICE_BULK_ADD_CHUNK_SIZE);
      try {
        latestResponse = await this.microserviceProxy.proxyRequest<unknown>(
          req,
          'LFX_V2_MEMBER_SERVICE',
          `/b2b_orgs/${encodeURIComponent(accountId)}/workspaces/${encodeURIComponent(workspaceId)}/projects/bulk`,
          'POST',
          undefined,
          { projects: chunk.map((slug) => ({ project_slug: slug })) },
          OrgLensProjectsService.memberServiceWriteHeaders
        );
      } catch (error: unknown) {
        const partialSlugs = memberServiceSlugs.length ? memberServiceSlugs : [...new Set(chunkSucceeded)];
        if (partialSlugs.length > 0) {
          throw new MicroserviceError('Some of the selected projects could not be added to this workspace.', 400, 'WORKSPACE_PROJECTS_ADD_PARTIAL', {
            operation: 'add_org_lens_workspace_projects',
            service: 'LFX_V2_MEMBER_SERVICE',
            path: `/b2b_orgs/${accountId}/workspaces/${workspaceId}/projects/bulk`,
            errorBody: { response: latestResponse, partialSlugs },
          });
        }
        throw error;
      }
      const chunkWorkspace = this.mapMemberServiceWorkspaceWithProjects(latestResponse, '', workspaceId);
      if (chunkWorkspace.projectSlugs.length) {
        memberServiceSlugs = chunkWorkspace.projectSlugs;
      }
      const chunkSuccess = this.extractChunkSuccessfulProjectSlugs(latestResponse, chunk);
      const chunkMembership = new Set(chunkWorkspace.projectSlugs.map((slug) => slug.toLowerCase()));
      const confirmedChunkSlugs = [...new Set([...chunkSuccess, ...chunk.filter((slug) => chunkMembership.has(slug.toLowerCase()))])];
      chunkSucceeded.push(...confirmedChunkSlugs);
      const chunkMissing = chunk.filter((slug) => !confirmedChunkSlugs.includes(slug));
      if (chunkMissing.length > 0) {
        const partialSlugs = memberServiceSlugs.length ? memberServiceSlugs : [...new Set(chunkSucceeded)];
        if (partialSlugs.length > 0) {
          throw new MicroserviceError('Some of the selected projects could not be added to this workspace.', 400, 'WORKSPACE_PROJECTS_ADD_PARTIAL', {
            operation: 'add_org_lens_workspace_projects',
            service: 'LFX_V2_MEMBER_SERVICE',
            path: `/b2b_orgs/${accountId}/workspaces/${workspaceId}/projects/bulk`,
            errorBody: { response: latestResponse, partialSlugs },
          });
        }
        throw new MicroserviceError('None of the selected projects could be added to this workspace.', 400, 'WORKSPACE_PROJECTS_ADD_FAILED', {
          operation: 'add_org_lens_workspace_projects',
          service: 'LFX_V2_MEMBER_SERVICE',
          path: `/b2b_orgs/${accountId}/workspaces/${workspaceId}/projects/bulk`,
          errorBody: latestResponse,
        });
      }
    }

    const workspace = latestResponse
      ? this.mapMemberServiceWorkspaceWithProjects(latestResponse, '', workspaceId)
      : { id: workspaceId, name: '', projectSlugs: [] };
    const confirmedAdds = [...new Set(chunkSucceeded)];
    const missingRequested = uniqueSlugs.filter((slug) => !confirmedAdds.includes(slug));
    if (missingRequested.length > 0) {
      const partialSlugs = memberServiceSlugs.length ? memberServiceSlugs : confirmedAdds;
      if (partialSlugs.length > 0) {
        throw new MicroserviceError('Some of the selected projects could not be added to this workspace.', 400, 'WORKSPACE_PROJECTS_ADD_PARTIAL', {
          operation: 'add_org_lens_workspace_projects',
          service: 'LFX_V2_MEMBER_SERVICE',
          path: `/b2b_orgs/${accountId}/workspaces/${workspaceId}/projects/bulk`,
          errorBody: { response: latestResponse, partialSlugs },
        });
      }
      throw new MicroserviceError('None of the selected projects could be added to this workspace.', 400, 'WORKSPACE_PROJECTS_ADD_FAILED', {
        operation: 'add_org_lens_workspace_projects',
        service: 'LFX_V2_MEMBER_SERVICE',
        path: `/b2b_orgs/${accountId}/workspaces/${workspaceId}/projects/bulk`,
        errorBody: latestResponse,
      });
    }
    const responseSlugs = memberServiceSlugs.length ? memberServiceSlugs : confirmedAdds;
    if (uniqueSlugs.length > 0 && responseSlugs.length === 0) {
      throw new MicroserviceError('None of the selected projects could be added to this workspace.', 400, 'WORKSPACE_PROJECTS_ADD_FAILED', {
        operation: 'add_org_lens_workspace_projects',
        service: 'LFX_V2_MEMBER_SERVICE',
        path: `/b2b_orgs/${accountId}/workspaces/${workspaceId}/projects/bulk`,
        errorBody: latestResponse,
      });
    }
    const indexedSlugs = await this.fetchWorkspaceProjectSlugsWithRetry(req, workspaceId, { retryIfEmpty: true }).catch(() => []);
    const projectSlugs = responseSlugs.length ? responseSlugs : indexedSlugs;
    return {
      ...workspace,
      projectSlugs,
    };
  }

  public async removeProjectFromWorkspace(req: Request, accountId: string, workspaceId: string, slug: string): Promise<OrgProjectsWorkspace> {
    const normalizedSlug = slug.trim().toLowerCase();
    const { projectKey, memberServiceSlugs } = await this.resolveWorkspaceProjectDeleteContext(req, accountId, workspaceId, normalizedSlug);
    await this.microserviceProxy.proxyRequest<void>(
      req,
      'LFX_V2_MEMBER_SERVICE',
      `/b2b_orgs/${encodeURIComponent(accountId)}/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectKey)}`,
      'DELETE',
      undefined,
      undefined,
      OrgLensProjectsService.memberServiceWriteHeaders
    );

    const indexedSlugs = (await this.fetchWorkspaceProjectSlugs(req, workspaceId).catch(() => undefined))?.filter((item) => item !== normalizedSlug) ?? [];
    const fallbackSlugs = memberServiceSlugs.filter((item) => item !== normalizedSlug);
    return {
      id: workspaceId,
      name: '',
      projectSlugs: fallbackSlugs.length > 0 ? fallbackSlugs : indexedSlugs,
    };
  }

  /**
   * `noActivityDegraded` reports that the optional no-activity hydration failed, so the response is
   * well-formed but silently missing projects the caller asked for. Returned alongside the response
   * rather than set on it because it describes this fetch, not the page: it must never reach the
   * browser or the cached value — `getProjects` uses it only to decline the write.
   */
  private async fetchProjects(
    accountId: string,
    orgName: string,
    slugs: string[] | null
  ): Promise<{ response: OrgLensProjectsResponse; noActivityDegraded: boolean }> {
    const projectsResult = await this.snowflakeService.execute<OrgLensProjectRow>(this.buildProjectsQuery(slugs), this.buildProjectsBinds(accountId, slugs));
    const projectRows = projectsResult.rows;
    const projectSlugs = projectRows.map((row) => row.PROJECT_SLUG);
    let noActivityDegraded = false;
    // Run both slug-keyed reads concurrently to avoid a second sequential Snowflake round trip. fetchNoActivityProjects
    // fires only for requested slugs with no ORG_LENS_PROJECTS row (post-relaxation, no-activity participation is a real `full` row above).
    const [peopleRows, noActivityProjects] = await Promise.all([
      projectSlugs.length ? this.fetchPeopleRows(accountId, projectSlugs) : Promise.resolve([]),
      // No-activity hydration is a soft enhancement over the onboarded catalog (which may be mid-migration or
      // absent); never let its failure fail the whole response — degrade to activity rows only, as before.
      this.fetchNoActivityProjects(slugs, projectSlugs).catch((err) => {
        logger.warning(undefined, 'fetch_no_activity_org_projects', 'No-activity org project hydration failed; returning activity rows only', { err });
        noActivityDegraded = true;
        return [] as OrgLensProject[];
      }),
    ]);

    return {
      response: {
        orgSlug: this.slugify(orgName) || accountId,
        orgName: orgName || 'Your organization',
        dataUpdatedAt: this.latestTimestamp(projectRows) ?? new Date().toISOString(),
        projects: [...projectRows.map((row) => this.mapProject(row, peopleRows)), ...noActivityProjects],
      },
      noActivityDegraded,
    };
  }

  private async fetchNoActivityProjects(requestedSlugs: string[] | null, returnedSlugs: string[]): Promise<OrgLensProject[]> {
    if (!requestedSlugs?.length) {
      return [];
    }
    const returned = new Set(returnedSlugs.map((slug) => slug.toLowerCase()));
    const missing = [...new Set(requestedSlugs.map((slug) => slug.trim().toLowerCase()).filter(Boolean))].filter((slug) => !returned.has(slug));
    if (!missing.length) {
      return [];
    }
    // Select project-global health so a fallback row can still render Health (sub-case A). These alias the columns
    // mapProject reads, so health maps with no extra branch; org-relative metrics (bands, trend, people) stay blank.
    const sql = `
      SELECT
        PROJECT_SLUG,
        PROJECT_NAME,
        PROJECT_LOGO_URL,
        FOUNDATION_SLUG,
        FOUNDATION_NAME,
        FOUNDATION_LOGO_URL,
        HEALTH_SCORE_CATEGORY_V2,
        COVERED_CATEGORY_COUNT_V2,
        HEALTH_MAX_SCORE_V2,
        HEALTH_OVERALL_SCORE_V2,
        HEALTH_MAINTAINER_V2,
        HEALTH_SECURITY_V2,
        HEALTH_DEVELOPMENT_V2
      FROM ${this.onboardedProjectsTable()}
      WHERE LOWER(PROJECT_SLUG) IN (${missing.map(() => '?').join(', ')})
    `;
    const result = await this.snowflakeService.execute<OrgLensProjectRow>(sql, missing);
    // mapProject fills unselected org-relative metrics with placeholders and maps health from the columns above.
    // metricsState reflects only health availability — derived from mapProject's `health` so the two can't drift.
    // Emit both discriminators: metricsState for the new frontend, noActivityYet for a still-running pre-close-out
    // frontend during a rolling deploy.
    return result.rows.map((row) => {
      const project = this.mapProject(row, []);
      return {
        ...project,
        metricsState: project.health === 'unavailable' ? ('unavailable' as const) : ('health-only' as const),
        noActivityYet: true,
      };
    });
  }

  private buildProjectsQuery(slugs: string[] | null): string {
    const slugFilter = slugs?.length ? `AND PROJECT_SLUG IN (${slugs.map(() => '?').join(', ')})` : '';
    const limit = slugs?.length ? '' : `LIMIT ${DEFAULT_ALL_ACTIVITIES_PROJECT_LIMIT}`;
    return `
      SELECT
        ACCOUNT_ID,
        PROJECT_ID,
        PROJECT_SLUG,
        PROJECT_NAME,
        PROJECT_LOGO_URL,
        FOUNDATION_ID,
        FOUNDATION_SLUG,
        FOUNDATION_NAME,
        FOUNDATION_LOGO_URL,
        TECHNICAL_INFLUENCE,
        ECOSYSTEM_INFLUENCE,
        INFLUENCE_SCORE,
        PRIOR_YEAR_SCORE,
        DELTA_PCT,
        TECHNICAL_DELTA_PCT,
        ECOSYSTEM_DELTA_PCT,
        TREND_DIRECTION,
        COMBINED_SCORE_SERIES,
        DBT_RUN_AT,
        HEALTH_SCORE_CATEGORY_V2,
        COVERED_CATEGORY_COUNT_V2,
        HEALTH_MAX_SCORE_V2,
        HEALTH_OVERALL_SCORE_V2,
        HEALTH_MAINTAINER_V2,
        HEALTH_SECURITY_V2,
        HEALTH_DEVELOPMENT_V2,
        DESCRIPTION
      FROM ${this.projectsTable()}
      WHERE ACCOUNT_ID = ?
        ${slugFilter}
      ORDER BY ORG_PROJECT_RANK ASC, PROJECT_NAME ASC
      ${limit}
    `;
  }

  private buildProjectsBinds(accountId: string, slugs: string[] | null): string[] {
    return slugs?.length ? [accountId, ...slugs] : [accountId];
  }

  private async fetchPeopleRows(accountId: string, projectSlugs: string[]): Promise<OrgLensProjectPersonRow[]> {
    const sql = `
      SELECT
        PROJECT_SLUG,
        PARTICIPANT_ID,
        INVOLVEMENT_ROLE,
        PARTICIPANT_NAME,
        PARTICIPANT_AVATAR_URL
      FROM ${this.projectPeopleTable()}
      WHERE ACCOUNT_ID = ?
        AND PROJECT_SLUG IN (${projectSlugs.map(() => '?').join(', ')})
      ORDER BY PROJECT_SLUG ASC, INVOLVEMENT_ROLE ASC, PARTICIPANT_NAME ASC
    `;
    const result = await this.snowflakeService.execute<OrgLensProjectPersonRow>(sql, [accountId, ...projectSlugs]);
    return result.rows;
  }

  private mapProject(row: OrgLensProjectRow, peopleRows: OrgLensProjectPersonRow[]): OrgLensProject {
    const people = peopleRows.filter((person) => person.PROJECT_SLUG === row.PROJECT_SLUG);
    const category = normalizeHealthScoreCategoryV2(row.HEALTH_SCORE_CATEGORY_V2);
    if (row.HEALTH_SCORE_CATEGORY_V2 != null && !category) {
      logger.warning(undefined, 'map_org_project_health', 'Unrecognized warehouse health_score_category_v2; treating as unavailable', {
        slug: row.PROJECT_SLUG,
        category: row.HEALTH_SCORE_CATEGORY_V2,
      });
    }
    // Availability rule: see OrgLensProject.health. When unavailable every health field is null so the badge,
    // popup, accessible name and CSV can never disagree.
    const available = category != null && row.HEALTH_OVERALL_SCORE_V2 != null;
    return {
      slug: row.PROJECT_SLUG,
      name: row.PROJECT_NAME,
      logoUrl: row.PROJECT_LOGO_URL ?? '',
      foundation: this.mapFoundation(row),
      health: available ? category : 'unavailable',
      // Sourced straight from the same warehouse snapshot row as the label — never recomputed. Covered
      // breakdowns render off their own null-ness (missing → `-/N`), matching the Insights breakdown port.
      healthOverallScore: available ? row.HEALTH_OVERALL_SCORE_V2 : null,
      healthMaxScore: available ? (row.HEALTH_MAX_SCORE_V2 ?? null) : null,
      healthCoveredCategoryCount: available ? (row.COVERED_CATEGORY_COUNT_V2 ?? null) : null,
      healthMaintainer: available ? (row.HEALTH_MAINTAINER_V2 ?? null) : null,
      healthSecurity: available ? (row.HEALTH_SECURITY_V2 ?? null) : null,
      healthDevelopment: available ? (row.HEALTH_DEVELOPMENT_V2 ?? null) : null,
      // These 'silent'/'non-lf' fallbacks are only user-visible for real (activity) rows. For no-activity rows the
      // UI shows "Unavailable" and compareInfluenceAvailability sinks them past measured rows, so the fallback band
      // is never compared against a measured one — it only affects the (tied) ordering of two no-activity rows.
      technicalInfluence: this.mapInfluence(row.TECHNICAL_INFLUENCE, 'silent'),
      ecosystemInfluence: this.mapInfluence(row.ECOSYSTEM_INFLUENCE, 'non-lf'),
      influenceScore: this.round1(row.INFLUENCE_SCORE ?? 0),
      priorYearScore: this.round1(row.PRIOR_YEAR_SCORE ?? 0),
      trend: {
        deltaPct: this.round1(row.DELTA_PCT ?? 0),
        technicalDeltaPct: this.round1(row.TECHNICAL_DELTA_PCT ?? 0),
        ecosystemDeltaPct: this.round1(row.ECOSYSTEM_DELTA_PCT ?? 0),
        direction: this.mapTrendDirection(row.TREND_DIRECTION),
        series: this.parseNumberArray(row.COMBINED_SCORE_SERIES),
      },
      maintainers: this.mapPeople(people, 'maintainer'),
      contributors: this.mapPeople(people, 'contributor'),
      participants: this.mapPeople(people, 'participant'),
      // Wire-contract placeholders until warehouse supplies commits1y / changeDriver.
      commits1y: 0,
      changeDriver: { label: 'Not calculated yet', direction: 'flat' },
      description: row.DESCRIPTION ?? `${row.PROJECT_NAME} is an open source project in the ${this.mapFoundation(row).name} ecosystem.`,
      // Real org-scoped row (org-dashboard parity): every metric is genuine, including participating
      // projects with activity_count = 0. fetchNoActivityProjects overrides this for its fallback rows.
      metricsState: 'full',
    };
  }

  private mapFoundation(
    row: Pick<OrgLensProjectRow, 'FOUNDATION_SLUG' | 'FOUNDATION_ID' | 'FOUNDATION_NAME' | 'FOUNDATION_LOGO_URL'>
  ): OrgLensProjectFoundation {
    const rawSlug = row.FOUNDATION_SLUG ?? row.FOUNDATION_ID ?? ORG_PROJECTS_OUTSIDE_LF_WAREHOUSE_SLUG;
    const slug = rawSlug === ORG_PROJECTS_OUTSIDE_LF_WAREHOUSE_SLUG ? ORG_PROJECTS_OUTSIDE_LF_WIRE_SLUG : rawSlug;
    return {
      slug,
      name: row.FOUNDATION_NAME ?? 'Outside LF',
      logoUrl: row.FOUNDATION_LOGO_URL ?? '',
    };
  }

  private mapPeople(rows: OrgLensProjectPersonRow[], role: OrgLensProjectPersonRow['INVOLVEMENT_ROLE']): OrgLensProjectPerson[] {
    return rows
      .filter((row) => row.INVOLVEMENT_ROLE === role)
      .map((row) => ({
        id: row.PARTICIPANT_ID,
        name: row.PARTICIPANT_NAME ?? row.PARTICIPANT_ID,
        avatarUrl: row.PARTICIPANT_AVATAR_URL ?? '',
      }));
  }

  private mapInfluence(value: string | null, fallback: InfluenceBand): InfluenceBand {
    switch (value) {
      case 'leading':
      case 'contributing':
      case 'participating':
      case 'silent':
      case 'non-lf':
        return value;
      default:
        return fallback;
    }
  }

  private mapTrendDirection(value: string | null): InfluenceTrendDirection {
    return value === 'up' || value === 'down' || value === 'flat' ? value : 'flat';
  }

  private async fetchWorkspaceMetadata(req: Request, accountId: string): Promise<OrgProjectsWorkspace[]> {
    const rows = await fetchAllQueryResources<OrgProjectsWorkspaceResource>(
      req,
      (pageToken) =>
        this.microserviceProxy.proxyRequest<QueryServiceResponse<OrgProjectsWorkspaceResource>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
          type: 'org_workspace',
          tags: `b2b_org_uid:${accountId}`,
          ...(pageToken && { page_token: pageToken }),
        }),
      { failOnPartial: true }
    );

    return rows
      .map((row) => {
        const id = row.uid ?? row.id ?? '';
        const name = row.name ?? 'Workspace';
        return {
          id,
          name,
          projectSlugs: [],
        };
      })
      .filter((workspace) => workspace.id)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private async fetchWorkspaceProjectRows(req: Request, workspaceId: string): Promise<OrgProjectsWorkspaceProjectResource[]> {
    return fetchAllQueryResources<OrgProjectsWorkspaceProjectResource>(
      req,
      (pageToken) =>
        this.microserviceProxy.proxyRequest<QueryServiceResponse<OrgProjectsWorkspaceProjectResource>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
          type: 'org_workspace_project',
          tags: `b2b_org_workspace_uid:${workspaceId}`,
          ...(pageToken && { page_token: pageToken }),
        }),
      { failOnPartial: true }
    );
  }

  private async fetchWorkspaceProjectSlugs(req: Request, workspaceId: string): Promise<string[]> {
    const rows = await this.fetchWorkspaceProjectRows(req, workspaceId);
    return [...new Set(rows.map((row) => this.normalizeWorkspaceProjectSlug(row.project_slug)).filter((slug): slug is string => !!slug))];
  }

  private async fetchWorkspaceProjectSlugsWithRetry(
    req: Request,
    workspaceId: string,
    options: { retryIfEmpty?: boolean; attempts?: number } = {}
  ): Promise<string[]> {
    const { retryIfEmpty = false, attempts = 3 } = options;
    let slugs: string[] = [];
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      slugs = await this.fetchWorkspaceProjectSlugs(req, workspaceId);
      if (slugs.length > 0 || !retryIfEmpty || attempt === attempts - 1) {
        return slugs;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return slugs;
  }

  private async bootstrapDefaultWorkspace(req: Request, accountId: string): Promise<OrgProjectsWorkspace> {
    const projectSlugs = await this.fetchDefaultProjectSlugs(accountId);
    try {
      const workspace = await this.createWorkspace(req, accountId, DEFAULT_ORG_PROJECTS_WORKSPACE_NAME);
      if (!projectSlugs.length) {
        return workspace;
      }
      return this.addProjectsToWorkspace(req, accountId, workspace.id, projectSlugs);
    } catch (error: unknown) {
      logger.warning(req, 'bootstrap_org_projects_workspace', 'Workspace bootstrap write failed', {
        org_uid: accountId,
        project_count: projectSlugs.length,
        err: error,
      });
      const existing = await this.fetchWorkspaceMetadata(req, accountId);
      const defaultWorkspace = existing.find((workspace) => workspace.name === DEFAULT_ORG_PROJECTS_WORKSPACE_NAME);
      if (defaultWorkspace) {
        if (!projectSlugs.length) {
          return { ...defaultWorkspace, projectSlugs: [] };
        }
        return this.addProjectsToWorkspace(req, accountId, defaultWorkspace.id, projectSlugs);
      }
      throw error;
    }
  }

  private async ensureDefaultWorkspaceProjects(req: Request, accountId: string, workspace: OrgProjectsWorkspace): Promise<OrgProjectsWorkspace> {
    if (!this.isCanonicalDefaultWorkspace(workspace)) {
      return workspace;
    }

    if (workspace.projectSlugs.length > 0) {
      return workspace;
    }

    let seedSlugs: string[] = [];
    try {
      seedSlugs = await this.fetchDefaultProjectSlugs(accountId);
    } catch (error: unknown) {
      logger.warning(req, 'populate_org_projects_default_workspace', 'Default workspace project lookup failed', {
        org_uid: accountId,
        workspace_id: workspace.id,
        err: error,
      });
      return workspace;
    }

    if (seedSlugs.length === 0) {
      return workspace;
    }

    try {
      const probeSlug = seedSlugs[0]!.trim().toLowerCase();
      const memberSlugs = await this.probeWorkspaceMembershipViaBulkUpsert(req, accountId, workspace.id, probeSlug);
      const probeOnlyMembership = memberSlugs.length === 1 && memberSlugs[0]?.trim().toLowerCase() === probeSlug;

      if (memberSlugs.length > 0 && !probeOnlyMembership) {
        return { ...workspace, projectSlugs: memberSlugs };
      }

      const updated = await this.addProjectsToWorkspace(req, accountId, workspace.id, seedSlugs);
      return { ...workspace, name: updated.name || workspace.name, projectSlugs: updated.projectSlugs };
    } catch (error: unknown) {
      logger.warning(
        req,
        'populate_org_projects_default_workspace',
        'Default workspace project bootstrap write failed; returning member-service membership when available',
        {
          org_uid: accountId,
          workspace_id: workspace.id,
          project_count: seedSlugs.length,
          err: error,
        }
      );
      try {
        const memberSlugs = await this.probeWorkspaceMembershipViaBulkUpsert(req, accountId, workspace.id, seedSlugs[0]!.trim().toLowerCase());
        return { ...workspace, projectSlugs: memberSlugs };
      } catch {
        return { ...workspace, projectSlugs: [] };
      }
    }
  }

  /**
   * Probe workspace membership via member-service bulk upsert.
   * Query-service project reads can lag behind writes; posting the probe slug is an
   * intentional idempotent write that returns the current membership list.
   */
  private async probeWorkspaceMembershipViaBulkUpsert(req: Request, accountId: string, workspaceId: string, probeSlug: string): Promise<string[]> {
    const response = await this.microserviceProxy.proxyRequest<unknown>(
      req,
      'LFX_V2_MEMBER_SERVICE',
      `/b2b_orgs/${encodeURIComponent(accountId)}/workspaces/${encodeURIComponent(workspaceId)}/projects/bulk`,
      'POST',
      undefined,
      { projects: [{ project_slug: probeSlug }] },
      OrgLensProjectsService.memberServiceWriteHeaders
    );
    return this.mapMemberServiceWorkspaceWithProjects(response, '', workspaceId).projectSlugs;
  }

  private deduplicateDefaultWorkspaces(workspaces: OrgProjectsWorkspace[]): OrgProjectsWorkspace[] {
    const defaults = workspaces.filter((workspace) => workspace.name === DEFAULT_ORG_PROJECTS_WORKSPACE_NAME);
    if (defaults.length <= 1) {
      return workspaces;
    }
    const primary = defaults[0]!;
    return workspaces.filter((workspace) => workspace.name !== DEFAULT_ORG_PROJECTS_WORKSPACE_NAME || workspace.id === primary.id);
  }

  private isCanonicalDefaultWorkspace(workspace: Pick<OrgProjectsWorkspace, 'id' | 'name'>): boolean {
    return workspace.id === DEFAULT_ORG_PROJECTS_WORKSPACE_ID || workspace.name === DEFAULT_ORG_PROJECTS_WORKSPACE_NAME;
  }

  private async fetchDefaultProjectSlugs(accountId: string): Promise<string[]> {
    const sql = `
      SELECT PROJECT_SLUG
      FROM ${this.projectsTable()}
      WHERE ACCOUNT_ID = ?
      ORDER BY ORG_PROJECT_RANK ASC
      LIMIT ${DEFAULT_ALL_ACTIVITIES_PROJECT_LIMIT}
    `;
    const result = await this.snowflakeService.execute<{ PROJECT_SLUG: string }>(sql, [accountId]);
    return result.rows.map((row) => row.PROJECT_SLUG);
  }

  private mapMemberServiceWorkspace(response: unknown, fallbackName: string, fallbackId?: string): Omit<OrgProjectsWorkspace, 'projectSlugs'> {
    const responseRecord = this.asRecord(response);
    const data = this.asRecord(responseRecord['workspace'] ?? responseRecord['data'] ?? response);
    const idValue = data['uid'] ?? data['id'] ?? data['workspace_uid'] ?? fallbackId;
    if (typeof idValue !== 'string' || !idValue) {
      throw new MicroserviceError('Workspace response did not include a workspace id', 502, 'WORKSPACE_RESPONSE_INVALID', {
        operation: 'map_member_service_workspace',
        service: 'member_service',
      });
    }
    const nameValue = data['name'];
    return {
      id: idValue,
      name: typeof nameValue === 'string' ? nameValue : fallbackName,
    };
  }

  private mapMemberServiceWorkspaceWithProjects(response: unknown, fallbackName: string, fallbackId?: string): OrgProjectsWorkspace {
    const responseRecord = this.asRecord(response);
    const dataRecord = this.asRecord(responseRecord['data']);
    const data = this.asRecord(responseRecord['workspace'] ?? dataRecord['workspace'] ?? responseRecord['data'] ?? response);
    const workspace = this.mapMemberServiceWorkspace(data, fallbackName, fallbackId);
    const projects = Array.isArray(data['projects']) ? (data['projects'] as OrgProjectsMemberServiceWorkspaceProject[]) : [];
    return {
      ...workspace,
      projectSlugs: [...new Set(projects.map((project) => this.extractProjectSlug(project.project_slug)).filter((slug): slug is string => !!slug))],
    };
  }

  private extractChunkSuccessfulProjectSlugs(response: unknown, requestedSlugs: string[]): string[] {
    const requested = new Set(requestedSlugs.map((slug) => slug.toLowerCase()));
    const responseRecord = this.asRecord(response);
    const responseRoot = this.asRecord(responseRecord['data'] ?? response);
    const succeededRaw = Array.isArray(responseRoot['succeeded']) ? responseRoot['succeeded'] : [];
    const fromSucceeded = succeededRaw
      .map((item) => {
        if (typeof item === 'string') {
          return this.extractProjectSlug(item);
        }
        const record = this.asRecord(item);
        let slugValue: string | undefined;
        if (typeof record['slug'] === 'string') {
          slugValue = record['slug'];
        } else if (typeof record['project_slug'] === 'string') {
          slugValue = record['project_slug'];
        }
        return this.extractProjectSlug(slugValue);
      })
      .filter((slug): slug is string => !!slug && requested.has(slug));
    return [...new Set(fromSucceeded)];
  }

  private extractProjectSlug(slug: string | undefined): string | null {
    return slug?.trim().toLowerCase() || null;
  }

  private async resolveWorkspaceProjectDeleteContext(
    req: Request,
    accountId: string,
    workspaceId: string,
    slug: string
  ): Promise<{ projectKey: string; memberServiceSlugs: string[] }> {
    const rows = await this.fetchWorkspaceProjectRows(req, workspaceId);
    const match = rows.find((row) => this.workspaceProjectSlugMatches(row.project_slug, slug));
    if (match?.project_uid) {
      const indexedSlugs = rows.map((row) => this.normalizeWorkspaceProjectSlug(row.project_slug)).filter((item): item is string => !!item);
      return { projectKey: match.project_uid, memberServiceSlugs: indexedSlugs };
    }

    const response = await this.microserviceProxy.proxyRequest<unknown>(
      req,
      'LFX_V2_MEMBER_SERVICE',
      `/b2b_orgs/${encodeURIComponent(accountId)}/workspaces/${encodeURIComponent(workspaceId)}/projects/bulk`,
      'POST',
      undefined,
      { projects: [{ project_slug: slug }] },
      OrgLensProjectsService.memberServiceWriteHeaders
    );
    const projectKey = this.extractProjectUidFromMemberServiceResponse(response, slug);
    if (!projectKey) {
      throw new MicroserviceError('Project association not found in this workspace.', 404, 'WORKSPACE_PROJECT_NOT_FOUND', {
        operation: 'remove_org_lens_workspace_project',
        service: 'LFX_V2_MEMBER_SERVICE',
        path: `/b2b_orgs/*/workspaces/${workspaceId}/projects`,
      });
    }
    return {
      projectKey,
      memberServiceSlugs: this.mapMemberServiceWorkspaceWithProjects(response, '', workspaceId).projectSlugs,
    };
  }

  private extractProjectUidFromMemberServiceResponse(response: unknown, slug: string): string | null {
    const responseRecord = this.asRecord(response);
    const responseRoot = this.asRecord(responseRecord['data'] ?? response);
    const data = this.asRecord(responseRoot['workspace'] ?? responseRoot);
    const projects: OrgProjectsMemberServiceWorkspaceProject[] = Array.isArray(data['projects'])
      ? (data['projects'] as OrgProjectsMemberServiceWorkspaceProject[])
      : [];
    const match = projects.find((project) => this.workspaceProjectSlugMatches(project.project_slug, slug));
    return match?.project_uid ?? null;
  }

  private workspaceProjectSlugMatches(storedSlug: string | undefined, requestedSlug: string): boolean {
    const normalizedRequested = requestedSlug.trim().toLowerCase();
    const normalizedStored = this.normalizeWorkspaceProjectSlug(storedSlug);
    return normalizedStored === normalizedRequested;
  }

  private normalizeWorkspaceProjectSlug(raw: string | undefined): string | null {
    const slug = raw?.trim().toLowerCase();
    if (!slug) {
      return null;
    }
    const compositeMatch = slug.match(/^[0-9a-f-]{36}[:/](.+)$/);
    if (compositeMatch?.[1] && !/^[0-9a-f-]{36}$/.test(compositeMatch[1])) {
      return compositeMatch[1];
    }
    return slug;
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  }

  private slugify(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }

  private round1(value: number): number {
    return Math.round(value * 10) / 10;
  }

  private parseNumberArray(value: unknown): number[] {
    if (Array.isArray(value)) {
      return value
        .map(Number)
        .filter(Number.isFinite)
        .map((item) => this.round1(item));
    }
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed)
          ? parsed
              .map(Number)
              .filter(Number.isFinite)
              .map((item) => this.round1(item))
          : [];
      } catch {
        return [];
      }
    }
    return [];
  }

  private latestTimestamp(rows: OrgLensProjectRow[]): string | null {
    const timestamps = rows
      .map((row) => (row.DBT_RUN_AT instanceof Date ? row.DBT_RUN_AT.toISOString() : row.DBT_RUN_AT))
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .sort();
    return timestamps.at(-1) ?? null;
  }

  private paramSignature(parts: readonly (string | number | boolean | null)[]): string {
    return parts.map((part) => encodeURIComponent(String(part))).join('|');
  }

  private snowflakeQualifier(value: string | undefined): string | null {
    const trimmed = value?.trim();
    return trimmed && /^[A-Z0-9_]+(\.[A-Z0-9_]+){1,2}$/i.test(trimmed) ? trimmed.toUpperCase() : null;
  }

  private lfxOnePlatinumSchema(): string {
    return this.snowflakeQualifier(process.env['LFX_ONE_PLATINUM_SCHEMA']) ?? DEFAULT_LFX_ONE_PLATINUM_SCHEMA;
  }

  private projectsTable(): string {
    return `${this.lfxOnePlatinumSchema()}.ORG_LENS_PROJECTS`;
  }

  private onboardedProjectsTable(): string {
    return `${this.lfxOnePlatinumSchema()}.ONBOARDED_PROJECTS`;
  }

  private projectPeopleTable(): string {
    return `${this.lfxOnePlatinumSchema()}.ORG_LENS_PROJECT_PEOPLE`;
  }
}

/**
 * Compacts the response for Valkey storage (GH-1906): one deduplicated people dictionary for the
 * whole response plus per-project index lists, and every remaining project field columnar.
 *
 * The dictionary is what makes this payload cacheable at all. Each project embeds its full
 * maintainer/contributor/participant arrays, and a person appears in every project they touch: the
 * largest org's default top-50 view carried ~36k person entries drawn from ~1.8k distinct people,
 * serializing to 6.3 MB — six times the 1 MiB write cap, so that org never got a cache hit and
 * every request paid the full Snowflake round trip. Truncating isn't available: the page needs
 * complete membership for its counts, its sort, its CSV export and its employee filter (which keys
 * on person id). Storing each person once is the only lever, and it is a large one.
 */
function encodeProjectsResponse(response: OrgLensProjectsResponse): CompactOrgLensProjectsCache {
  // Keyed on the whole triple rather than on `id`: two entries sharing an id but disagreeing on
  // name or avatar must not collapse onto the first one seen, or the decoded response would differ
  // from the uncached one. Rows that genuinely agree still collapse, so nothing is lost.
  //
  // `JSON.stringify` of the tuple rather than a delimiter join, matching the other dictionaries
  // here: any single-character separator is itself a legal character inside a display name or a
  // URL, so a join is ambiguous — `['p', 'a\u0000b', 'c']` and `['p', 'a', 'b\u0000c']` join to the
  // same string and would silently replace one person with the other.
  const everyPerson = response.projects.flatMap((project) => [...project.maintainers, ...project.contributors, ...project.participants]);
  // Keyed once per row and reused for both the dictionary and the index array: the key is the
  // expensive part of the encode, and computing it twice per row bought nothing.
  const keys = new Map<OrgLensProjectPerson, string>(everyPerson.map((person) => [person, tupleKey([person.id, person.name, person.avatarUrl])]));
  const people = dedupeByKey(everyPerson, (person) => keys.get(person)!);
  // Every person here came from the array `people` was built from, so the lookup always resolves.
  const indicesOf = (persons: readonly OrgLensProjectPerson[]): number[] => persons.map((person) => people.indexOf.get(keys.get(person)!)!);

  const rows: CompactOrgLensProjectRow[] = response.projects.map((project) => ({
    slug: project.slug,
    name: project.name,
    logoUrl: project.logoUrl,
    foundationSlug: project.foundation.slug,
    foundationName: project.foundation.name,
    foundationLogoUrl: project.foundation.logoUrl,
    health: project.health,
    healthOverallScore: project.healthOverallScore,
    healthMaxScore: project.healthMaxScore,
    healthCoveredCategoryCount: project.healthCoveredCategoryCount,
    healthMaintainer: project.healthMaintainer,
    healthSecurity: project.healthSecurity,
    healthDevelopment: project.healthDevelopment,
    technicalInfluence: project.technicalInfluence,
    ecosystemInfluence: project.ecosystemInfluence,
    influenceScore: project.influenceScore,
    priorYearScore: project.priorYearScore,
    trendDeltaPct: project.trend.deltaPct,
    trendTechnicalDeltaPct: project.trend.technicalDeltaPct,
    trendEcosystemDeltaPct: project.trend.ecosystemDeltaPct,
    trendDirection: project.trend.direction,
    trendSeries: project.trend.series,
    commits1y: project.commits1y,
    changeDriverLabel: project.changeDriver.label,
    changeDriverDirection: project.changeDriver.direction,
    description: project.description,
    metricsState: project.metricsState,
    // Passed straight through, `undefined` included: `toColumnar` stores an absent field distinctly
    // from a null one and `fromColumnar` restores the absence, so a project that never carried this
    // transitional flag doesn't start carrying `noActivityYet: null` on a cache hit.
    noActivityYet: project.noActivityYet,
  }));

  return {
    orgSlug: response.orgSlug,
    orgName: response.orgName,
    dataUpdatedAt: response.dataUpdatedAt,
    people: toColumnar(people.values, ORG_LENS_PROJECT_PEOPLE_COLUMNS),
    projects: toColumnar(rows, ORG_LENS_PROJECT_ROW_COLUMNS),
    maintainers: response.projects.map((project) => indicesOf(project.maintainers)),
    contributors: response.projects.map((project) => indicesOf(project.contributors)),
    participants: response.projects.map((project) => indicesOf(project.participants)),
  };
}

/**
 * Rebuilds the exact `OrgLensProjectsResponse` {@link encodeProjectsResponse} stored — the wire
 * contract is unchanged by the compaction, only what Valkey holds.
 *
 * Projects sharing a person share that person's decoded object rather than each getting a copy.
 * That is safe here and deliberately so: this response is serialized straight to JSON by the route
 * and nothing mutates a person in place. It also keeps the decode's allocation proportional to the
 * ~1.8k distinct people rather than to the ~36k references to them.
 */
function decodeProjectsResponse(value: CompactOrgLensProjectsCache): OrgLensProjectsResponse {
  const people = fromColumnar<OrgLensProjectPerson>(value.people);
  const rows = fromColumnar<CompactOrgLensProjectRow>(value.projects);
  return {
    orgSlug: value.orgSlug,
    orgName: value.orgName,
    dataUpdatedAt: value.dataUpdatedAt,
    projects: rows.map((row, index) => {
      const project: OrgLensProject = {
        slug: row.slug,
        name: row.name,
        logoUrl: row.logoUrl,
        foundation: { slug: row.foundationSlug, name: row.foundationName, logoUrl: row.foundationLogoUrl },
        health: row.health,
        healthOverallScore: row.healthOverallScore,
        healthMaxScore: row.healthMaxScore,
        healthCoveredCategoryCount: row.healthCoveredCategoryCount,
        healthMaintainer: row.healthMaintainer,
        healthSecurity: row.healthSecurity,
        healthDevelopment: row.healthDevelopment,
        technicalInfluence: row.technicalInfluence,
        ecosystemInfluence: row.ecosystemInfluence,
        influenceScore: row.influenceScore,
        priorYearScore: row.priorYearScore,
        trend: {
          deltaPct: row.trendDeltaPct,
          technicalDeltaPct: row.trendTechnicalDeltaPct,
          ecosystemDeltaPct: row.trendEcosystemDeltaPct,
          direction: row.trendDirection,
          series: row.trendSeries,
        },
        maintainers: value.maintainers[index].map((personIndex) => people[personIndex]),
        contributors: value.contributors[index].map((personIndex) => people[personIndex]),
        participants: value.participants[index].map((personIndex) => people[personIndex]),
        commits1y: row.commits1y,
        changeDriver: { label: row.changeDriverLabel, direction: row.changeDriverDirection },
        description: row.description,
        metricsState: row.metricsState,
      };
      // Appended last, and only when the stored row actually carried it, so the rebuilt project is
      // key-for-key identical to the uncached one — `fetchNoActivityProjects` likewise appends this
      // transitional flag after `metricsState`, and `mapProject` omits it entirely.
      if ('noActivityYet' in row) {
        project.noActivityYet = row.noActivityYet;
      }
      return project;
    }),
  };
}

/** Rejects anything that isn't a current-shape compact entry, so a legacy or partial value misses instead of decoding into garbage. */
function isCompactProjectsCache(value: unknown): boolean {
  const cache = value as Partial<CompactOrgLensProjectsCache> | null;
  if (!cache || typeof cache !== 'object') {
    return false;
  }
  if (typeof cache.orgSlug !== 'string' || typeof cache.orgName !== 'string' || typeof cache.dataUpdatedAt !== 'string') {
    return false;
  }
  if (!isColumnarTable(cache.people) || !isColumnarTable(cache.projects)) {
    return false;
  }
  // Exact columns, not a subset: a duplicated, extra, reordered or short-rowed entry decodes
  // "successfully" into projects missing data the writer always emits, which is worse than a miss —
  // the page renders with holes in it for the rest of the TTL instead of refetching.
  if (!hasExactColumns(cache.people, ORG_LENS_PROJECT_PEOPLE_COLUMNS) || !hasExactColumns(cache.projects, ORG_LENS_PROJECT_ROW_COLUMNS)) {
    return false;
  }
  // Exact columns prove the SHAPE; these prove the VALUES, and both are needed. This is the same
  // set of per-project checks the pre-compaction guard made, applied to the stored cells instead of
  // to decoded objects — a corrupt entry has to miss rather than decode into a malformed response
  // the browser then renders. `hasExactColumns` has already proved `k` matches the declared list
  // position for position, so the cells can be read positionally from that list.
  const slugIndex = ORG_LENS_PROJECT_ROW_COLUMNS.indexOf('slug');
  const nameIndex = ORG_LENS_PROJECT_ROW_COLUMNS.indexOf('name');
  const healthIndex = ORG_LENS_PROJECT_ROW_COLUMNS.indexOf('health');
  const metricsStateIndex = ORG_LENS_PROJECT_ROW_COLUMNS.indexOf('metricsState');
  // Every health field is `number | null`; the pre-compaction guard only asserted it for
  // `healthOverallScore`, but the rest feed the popup's scores and denominators just as directly.
  const healthScoreIndexes = (
    ['healthOverallScore', 'healthMaxScore', 'healthCoveredCategoryCount', 'healthMaintainer', 'healthSecurity', 'healthDevelopment'] as const
  ).map((column) => ORG_LENS_PROJECT_ROW_COLUMNS.indexOf(column));
  const isStoredString = (cell: unknown): boolean => typeof cell === 'string' && !isColumnarAbsent(cell);
  const isStoredNumberOrNull = (cell: unknown): boolean => cell === null || typeof cell === 'number';
  const projectValuesValid = cache.projects.r.every((row) => {
    const metricsState = row[metricsStateIndex];
    return (
      isStoredString(row[slugIndex]) &&
      isStoredString(row[nameIndex]) &&
      // Reject entries missing the discriminator (e.g. pre-close-out cache rows) so they refetch as
      // current-shape payloads instead of serving a mixed schema from Valkey.
      (metricsState === 'full' || metricsState === 'health-only' || metricsState === 'unavailable') &&
      // An unrecognized band would render as a blank badge rather than the explicit "unavailable"
      // treatment, so it has to be one the UI knows.
      Object.prototype.hasOwnProperty.call(HEALTH_SCORE_LABELS, String(row[healthIndex])) &&
      healthScoreIndexes.every((index) => isStoredNumberOrNull(row[index]))
    );
  });
  if (!projectValuesValid) {
    return false;
  }
  // The people dictionary is validated the same way: every decoded person reaches the browser.
  const peopleValuesValid = cache.people.r.every((row) => row.every((cell) => isStoredString(cell)));
  if (!peopleValuesValid) {
    return false;
  }
  // Every reference must resolve, so the decode above can rebuild without a fallback for a
  // dangling index — a truncated or hand-written entry is a miss, not a half-populated response.
  const projectCount = cache.projects.r.length;
  const peopleCount = cache.people.r.length;
  return [cache.maintainers, cache.contributors, cache.participants].every(
    (lists) =>
      Array.isArray(lists) &&
      lists.length === projectCount &&
      lists.every((indices) => Array.isArray(indices) && indices.every((index) => Number.isInteger(index) && index >= 0 && index < peopleCount))
  );
}
