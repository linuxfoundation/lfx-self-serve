// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  MAX_SNOWFLAKE_PAGINATION_PAGE,
  PROJECT_PARTICIPATING_ORGS_EXPORT_MAX_ROWS,
  PROJECT_PARTICIPATING_ORGS_MAX_PAGE_SIZE,
  PROJECT_PARTICIPATING_ORGS_PAGE_SIZE,
} from '@lfx-one/shared/constants';

import { toIsoDate } from '../helpers/date-format.helper';
import { filterReadableAccountIds } from '../helpers/org-analytics-access.helper';
import { resolveLfxOnePlatinumSchema } from '../helpers/snowflake-schema.helper';
import { executeSnowflakeViewRead } from '../helpers/snowflake-view-read.helper';
import { clampInteger, escapeSqlLikePattern } from '../helpers/validation.helper';
import { logger } from './logger.service';
import { SnowflakeService } from './snowflake.service';

import type {
  MembershipTierClass,
  ProjectParticipatingOrg,
  ProjectParticipatingOrgsExportFilters,
  ProjectParticipatingOrgsPage,
  ProjectParticipatingOrgsPageRow,
  ProjectParticipatingOrgsQuery,
  ProjectParticipatingOrgsRange,
  ProjectParticipatingOrgsRow,
  ProjectParticipatingOrgsSortDirection,
  ProjectParticipatingOrgsSortField,
  ProjectParticipatingOrgsSummary,
  ProjectParticipatingOrgsSummaryRow,
} from '@lfx-one/shared/interfaces';
import type { Request } from 'express';

const ORG_COLUMNS = `participant_key, account_id, participant_name, participant_logo_url, is_unidentified, is_member,
          membership_tier_class, tier_rank, commits, commits_prev, contributors, contributors_prev`;

// Allowlisted ORDER BY expressions; request input only ever selects a key, never reaches the SQL.
// `tier` ranks members only, so non-members land last in both directions.
const SORT_EXPRESSIONS: Record<ProjectParticipatingOrgsSortField, (prefix: string) => string> = {
  name: (p) => `LOWER(${p}participant_name)`,
  tier: (p) => `CASE WHEN ${p}is_member THEN ${p}tier_rank END`,
  commits: (p) => `${p}commits`,
  contributors: (p) => `${p}contributors`,
};

const SORT_DIRECTIONS: Record<ProjectParticipatingOrgsSortDirection, string> = { asc: 'ASC', desc: 'DESC' };

/** Reads Project Lens → Participating Organizations from the lf-dbt project_lens tables. */
export class ProjectParticipatingOrgsService {
  private readonly snowflakeService: SnowflakeService;

  public constructor() {
    this.snowflakeService = SnowflakeService.getInstance();
  }

  /** Tiles and tab counts; null when the project has no code activity in the range. */
  public async getSummary(req: Request, slug: string, range: ProjectParticipatingOrgsRange): Promise<ProjectParticipatingOrgsSummary | null> {
    const summaryTable = `${resolveLfxOnePlatinumSchema()}.PROJECT_PARTICIPATING_ORGS_SUMMARY`;
    const sql = `
      SELECT
        s.project_slug,
        s.foundation_slug,
        -- The summary table has no foundation name; every list row of the project carries the same one.
        (SELECT MAX(o.foundation_name) FROM ${listTableName()} o WHERE o.project_slug = s.project_slug AND o.time_range = s.time_range) AS foundation_name,
        s.as_of_date,
        s.orgs_count,
        s.members_count,
        s.non_members_count,
        s.unidentified_count,
        s.member_commits,
        s.company_commits,
        s.all_commits,
        s.member_commit_share_of_company_commits,
        s.member_commit_share_of_all_commits
      FROM ${summaryTable} s
      WHERE s.project_slug = ?
        AND s.time_range = ?
      -- One row per (project, range) by the dbt grain; the newest build wins if that ever breaks.
      ORDER BY s.as_of_date DESC
      LIMIT 1
    `;

    const result = await executeSnowflakeViewRead<ProjectParticipatingOrgsSummaryRow>(this.snowflakeService, req, sql, [slug, range], {
      view: summaryTable,
      operation: 'get_project_participating_orgs_summary',
      clientMessage: 'Participating organizations are unavailable right now.',
    });

    const row = result.rows[0];
    if (!row) return null;

    return {
      projectSlug: row.PROJECT_SLUG,
      foundationSlug: row.FOUNDATION_SLUG || null,
      foundationName: row.FOUNDATION_NAME || null,
      range,
      asOfDate: toIsoDate(row.AS_OF_DATE) ?? '',
      orgsCount: Number(row.ORGS_COUNT ?? 0),
      membersCount: Number(row.MEMBERS_COUNT ?? 0),
      nonMembersCount: Number(row.NON_MEMBERS_COUNT ?? 0),
      unidentifiedCount: Number(row.UNIDENTIFIED_COUNT ?? 0),
      memberCommits: Number(row.MEMBER_COMMITS ?? 0),
      companyCommits: Number(row.COMPANY_COMMITS ?? 0),
      allCommits: Number(row.ALL_COMMITS ?? 0),
      memberCommitShareOfCompanyCommits: toNullableNumber(row.MEMBER_COMMIT_SHARE_OF_COMPANY_COMMITS),
      memberCommitShareOfAllCommits: toNullableNumber(row.MEMBER_COMMIT_SHARE_OF_ALL_COMMITS),
    };
  }

  /** One page plus the filtered total and the parent foundation slug, in one round trip. */
  public async getPage(req: Request, slug: string, query: ProjectParticipatingOrgsQuery): Promise<ProjectParticipatingOrgsPage> {
    const table = listTableName();
    const { matchClause, binds } = buildMatch(slug, query);
    const pageSize = clampInteger(query.pageSize, 1, PROJECT_PARTICIPATING_ORGS_MAX_PAGE_SIZE, PROJECT_PARTICIPATING_ORGS_PAGE_SIZE);
    const offset = clampInteger(query.offset, 0, MAX_SNOWFLAKE_PAGINATION_PAGE * pageSize, 0);

    const sql = `
      WITH scoped AS (
        SELECT ${ORG_COLUMNS}, foundation_slug
        FROM ${table}
        WHERE project_slug = ?
          AND time_range = ?
      ),
      matched AS (
        SELECT * FROM scoped ${matchClause}
      ),
      totals AS (
        SELECT
          (SELECT COUNT(*) FROM matched) AS total_records,
          -- From the unfiltered scope, so the member link survives a search that matches nothing.
          (SELECT MAX(foundation_slug) FROM scoped) AS foundation_slug_total
      ),
      page AS (
        SELECT *, TRUE AS is_page_row
        FROM matched
        ORDER BY ${orderBy('', query.sort, query.dir)}
        LIMIT ${pageSize} OFFSET ${offset}
      )
      -- ON TRUE keeps the single totals row when the page selected nothing.
      SELECT totals.*, page.*
      FROM totals
      LEFT JOIN page ON TRUE
      ORDER BY ${orderBy('page.', query.sort, query.dir)}
    `;

    const result = await executeSnowflakeViewRead<ProjectParticipatingOrgsPageRow>(this.snowflakeService, req, sql, binds, {
      view: table,
      operation: 'get_project_participating_orgs',
      clientMessage: 'Participating organizations are unavailable right now.',
    });

    const first = result.rows[0];
    const pageRows = result.rows.filter((row) => row.IS_PAGE_ROW === true && !!row.PARTICIPANT_KEY);
    const readable = await this.readableMemberAccountIds(req, pageRows);

    return {
      rows: pageRows.map((row) => mapOrg(row, readable)),
      totalRecords: Number(first?.TOTAL_RECORDS ?? 0),
      foundationSlug: first?.FOUNDATION_SLUG_TOTAL || null,
    };
  }

  /**
   * The full filtered list for the CSV, in list order, up to the export cap. Reads one row past the
   * cap so a capped export can be told apart from one that fits exactly. No Org Lens checks: the CSV
   * carries no links.
   */
  public async getExportRows(
    req: Request,
    slug: string,
    filters: ProjectParticipatingOrgsExportFilters
  ): Promise<{ rows: ProjectParticipatingOrg[]; truncated: boolean }> {
    const table = listTableName();
    const { matchClause, binds } = buildMatch(slug, filters);

    const sql = `
      WITH scoped AS (
        SELECT ${ORG_COLUMNS}
        FROM ${table}
        WHERE project_slug = ?
          AND time_range = ?
      )
      SELECT * FROM scoped ${matchClause}
      ORDER BY ${orderBy('', filters.sort, filters.dir)}
      LIMIT ${PROJECT_PARTICIPATING_ORGS_EXPORT_MAX_ROWS + 1}
    `;

    const result = await executeSnowflakeViewRead<ProjectParticipatingOrgsRow>(this.snowflakeService, req, sql, binds, {
      view: table,
      operation: 'export_project_participating_orgs',
      clientMessage: 'Participating organizations are unavailable right now.',
    });

    const rows = result.rows.filter((row) => !!row.PARTICIPANT_KEY);
    const truncated = rows.length > PROJECT_PARTICIPATING_ORGS_EXPORT_MAX_ROWS;
    const none = new Set<string>();
    return { rows: rows.slice(0, PROJECT_PARTICIPATING_ORGS_EXPORT_MAX_ROWS).map((row) => mapOrg(row, none)), truncated };
  }

  /**
   * The page's member account ids the caller can open in Org Lens. An authorizer outage degrades
   * every link to plain text rather than failing the list.
   */
  private async readableMemberAccountIds(req: Request, rows: ProjectParticipatingOrgsRow[]): Promise<Set<string>> {
    const memberIds = [...new Set(rows.filter((row) => row.IS_MEMBER === true && !!row.ACCOUNT_ID).map((row) => row.ACCOUNT_ID as string))];
    if (memberIds.length === 0) return new Set();

    try {
      return new Set(await filterReadableAccountIds(req, memberIds, 'get_project_participating_orgs'));
    } catch (error) {
      logger.warning(req, 'get_project_participating_orgs', 'Org Lens access check failed; member links disabled for this page', {
        member_count: memberIds.length,
        err: error,
      });
      return new Set();
    }
  }
}

function listTableName(): string {
  return `${resolveLfxOnePlatinumSchema()}.PROJECT_PARTICIPATING_ORGS`;
}

/** Segment, tier and search predicates over `scoped`, with binds in placeholder order (slug and range first). */
function buildMatch(slug: string, filters: ProjectParticipatingOrgsExportFilters): { matchClause: string; binds: string[] } {
  const binds: string[] = [slug, filters.range];
  const predicates: string[] = [];

  if (filters.segment === 'members' || filters.tier) predicates.push('is_member');
  if (filters.segment === 'non_members') predicates.push('NOT is_member');
  if (filters.tier) {
    predicates.push('membership_tier_class = ?');
    binds.push(filters.tier);
  }
  if (filters.search) {
    predicates.push("participant_name ILIKE ? ESCAPE '!'");
    binds.push(`%${escapeSqlLikePattern(filters.search)}%`);
  }

  return { matchClause: predicates.length ? `WHERE ${predicates.join(' AND ')}` : '', binds };
}

/** Allowlisted sort, NULLS LAST in both directions, then commits and the stable row key break ties. */
function orderBy(prefix: string, sort: ProjectParticipatingOrgsSortField, dir: ProjectParticipatingOrgsSortDirection): string {
  const expression = (SORT_EXPRESSIONS[sort] ?? SORT_EXPRESSIONS.commits)(prefix);
  const direction = SORT_DIRECTIONS[dir] ?? SORT_DIRECTIONS.desc;
  return `${expression} ${direction} NULLS LAST, ${prefix}commits DESC NULLS LAST, ${prefix}participant_key ASC`;
}

function mapOrg(row: ProjectParticipatingOrgsRow, readableAccountIds: Set<string>): ProjectParticipatingOrg {
  const isMember = row.IS_MEMBER === true;
  const accountId = row.ACCOUNT_ID || null;

  return {
    participantKey: row.PARTICIPANT_KEY as string,
    accountId,
    name: row.PARTICIPANT_NAME || (row.PARTICIPANT_KEY as string),
    logoUrl: row.PARTICIPANT_LOGO_URL || null,
    isUnidentified: row.IS_UNIDENTIFIED === true,
    isMember,
    membershipTierClass: isMember ? ((row.MEMBERSHIP_TIER_CLASS as MembershipTierClass | null) ?? null) : null,
    commits: Number(row.COMMITS ?? 0),
    commitsPrev: toNullableNumber(row.COMMITS_PREV),
    contributors: Number(row.CONTRIBUTORS ?? 0),
    contributorsPrev: toNullableNumber(row.CONTRIBUTORS_PREV),
    canOpenOrgLens: isMember && accountId !== null && readableAccountIds.has(accountId),
  };
}

function toNullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}
