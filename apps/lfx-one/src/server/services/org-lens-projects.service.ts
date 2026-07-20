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
  ORG_PROJECTS_SEARCH_LIMIT,
  ORG_PROJECTS_SEARCH_MIN_LENGTH,
  VALKEY_CACHE,
} from '@lfx-one/shared/constants';
import { classifyHealthScore } from '@lfx-one/shared/utils';
import type {
  HealthScore,
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
import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';
import { SnowflakeService } from './snowflake.service';
import { buildOrgCacheKey, valkeyService } from './valkey.service';

export class OrgLensProjectsService {
  private static readonly memberServiceWriteHeaders = { 'X-Sync': 'true' };
  private readonly snowflakeService = SnowflakeService.getInstance();
  private readonly microserviceProxy = new MicroserviceProxyService();

  public async getProjects(accountId: string, orgName: string, slugs: string[] | null): Promise<OrgLensProjectsResponse> {
    const cacheKey = `projects:${this.paramSignature([orgName, ...(slugs ?? ['__top__'])])}`;
    const key = buildOrgCacheKey(accountId, cacheKey);
    if (key !== null) {
      const cached = await valkeyService.getJson<OrgLensProjectsResponse>(key, OrgLensProjectsService.isProjectsResponse);
      if (cached !== null) {
        return cached;
      }
    }

    const response = await this.fetchProjects(accountId, orgName, slugs);
    if (key !== null) {
      await valkeyService.setJson(key, response, VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS);
    }
    return response;
  }

  public async searchProjects(accountId: string, query: string, excludeSlugs: readonly string[] = []): Promise<OrgLensProjectSearchResponse> {
    const trimmed = query.trim();
    if (trimmed.length > 0 && trimmed.length < ORG_PROJECTS_SEARCH_MIN_LENGTH) {
      return { results: [] };
    }

    const excluded = [...new Set(excludeSlugs.map((slug) => slug.trim().toLowerCase()).filter(Boolean))];
    const like = `%${trimmed}%`;
    const searchFilter = trimmed.length ? 'AND (PROJECT_NAME ILIKE ? OR PROJECT_SLUG ILIKE ?)' : '';
    const excludeFilter = excluded.length ? `AND PROJECT_SLUG NOT IN (${excluded.map(() => '?').join(', ')})` : '';
    const sql = `
      SELECT
        PROJECT_SLUG,
        PROJECT_NAME,
        PROJECT_LOGO_URL,
        FOUNDATION_SLUG,
        FOUNDATION_NAME,
        FOUNDATION_LOGO_URL
      FROM ${this.projectsTable()}
      WHERE ACCOUNT_ID = ?
        ${searchFilter}
        ${excludeFilter}
      ORDER BY ORG_PROJECT_RANK ASC, PROJECT_NAME ASC
      LIMIT ${ORG_PROJECTS_SEARCH_LIMIT}
    `;

    const binds = trimmed.length ? [accountId, like, like, ...excluded] : [accountId, ...excluded];
    const result = await this.snowflakeService.execute<OrgLensProjectRow>(sql, binds);
    return {
      results: result.rows.map((row) => ({
        slug: row.PROJECT_SLUG,
        name: row.PROJECT_NAME,
        logoUrl: row.PROJECT_LOGO_URL ?? '',
        foundation: this.mapFoundation(row),
      })),
    };
  }

  public async getWorkspaces(req: Request, accountId: string): Promise<OrgProjectsWorkspacesResponse> {
    let workspaces = await this.fetchWorkspaceMetadata(req, accountId);
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
          ? await this.fetchWorkspaceProjectSlugsWithRetry(req, workspace.id, { retryIfEmpty: true })
          : await this.fetchWorkspaceProjectSlugs(req, workspace.id),
      }))
    );

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

  private async fetchProjects(accountId: string, orgName: string, slugs: string[] | null): Promise<OrgLensProjectsResponse> {
    const projectsResult = await this.snowflakeService.execute<OrgLensProjectRow>(this.buildProjectsQuery(slugs), this.buildProjectsBinds(accountId, slugs));
    const projectRows = projectsResult.rows;
    const projectSlugs = projectRows.map((row) => row.PROJECT_SLUG);
    const peopleRows = projectSlugs.length ? await this.fetchPeopleRows(accountId, projectSlugs) : [];

    return {
      orgSlug: this.slugify(orgName) || accountId,
      orgName: orgName || 'Your organization',
      dataUpdatedAt: this.latestTimestamp(projectRows) ?? new Date().toISOString(),
      projects: projectRows.map((row) => this.mapProject(row, peopleRows)),
    };
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
        HEALTH_OVERALL_SCORE,
        HEALTH_CONTRIBUTOR_PERCENTAGE,
        HEALTH_POPULARITY_PERCENTAGE,
        HEALTH_DEVELOPMENT_PERCENTAGE,
        HEALTH_SECURITY_PERCENTAGE,
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
    const healthScore = row.HEALTH_OVERALL_SCORE;
    const hasHealthScore = healthScore !== null && healthScore !== undefined;
    return {
      slug: row.PROJECT_SLUG,
      name: row.PROJECT_NAME,
      logoUrl: row.PROJECT_LOGO_URL ?? '',
      foundation: this.mapFoundation(row),
      health: hasHealthScore ? this.mapHealthScore(healthScore) : 'unavailable',
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
      healthMetrics: hasHealthScore ? this.mapHealthMetrics(row) : [],
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

  private mapHealthScore(score: number): Exclude<HealthScore, 'unavailable'> {
    return classifyHealthScore(score);
  }

  private mapHealthMetrics(row: OrgLensProjectRow): OrgLensProject['healthMetrics'] {
    return [
      { label: 'Contributors', value: this.roundMetric(row.HEALTH_CONTRIBUTOR_PERCENTAGE) },
      { label: 'Popularity', value: this.roundMetric(row.HEALTH_POPULARITY_PERCENTAGE) },
      { label: 'Development', value: this.roundMetric(row.HEALTH_DEVELOPMENT_PERCENTAGE) },
      { label: 'Security', value: this.roundMetric(row.HEALTH_SECURITY_PERCENTAGE) },
    ];
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

  private roundMetric(value: number | null | undefined): number {
    return Math.max(0, Math.min(100, Math.round(value ?? 0)));
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

  private projectPeopleTable(): string {
    return `${this.lfxOnePlatinumSchema()}.ORG_LENS_PROJECT_PEOPLE`;
  }

  private static isProjectsResponse(value: unknown): value is OrgLensProjectsResponse {
    if (value === null || typeof value !== 'object') {
      return false;
    }
    const candidate = value as OrgLensProjectsResponse;
    if (typeof candidate.orgSlug !== 'string' || typeof candidate.orgName !== 'string' || !Array.isArray(candidate.projects)) {
      return false;
    }
    return candidate.projects.every(
      (project) =>
        typeof project.slug === 'string' &&
        typeof project.name === 'string' &&
        Object.prototype.hasOwnProperty.call(HEALTH_SCORE_LABELS, project.health) &&
        Array.isArray(project.healthMetrics) &&
        Array.isArray(project.maintainers) &&
        Array.isArray(project.contributors)
    );
  }
}
