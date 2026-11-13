// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FOUNDATION_PARTICIPATING_ORGS_EXPORT_MAX_ROWS } from '@lfx-one/shared/constants';
import type {
  FoundationParticipatingOrgsCompanyRow,
  FoundationParticipatingOrgsDataSource,
  FoundationParticipatingOrgsLineRow,
  FoundationParticipatingOrgsProjectRow,
  FoundationParticipatingOrgsRange,
  FoundationParticipatingOrgsSourceCompany,
  FoundationParticipatingOrgsSourceFoundation,
  FoundationParticipatingOrgsSourceLineFilter,
  FoundationParticipatingOrgsSourceProjectLine,
  MembershipTierClass,
} from '@lfx-one/shared/interfaces';

import { toIsoDate } from '../helpers/date-format.helper';
import { resolveLfxOnePlatinumSchema } from '../helpers/snowflake-schema.helper';
import { SnowflakeService } from './snowflake.service';
import { withProjectParticipatingOrgsCache } from './valkey.service';

/**
 * Reads Foundation Lens → Participating Companies from the lf-dbt `PROJECT_PARTICIPATING_ORGS` table the project page uses.
 *
 * The model fans every project's code activity out to each of its ancestors, so the row of a foundation's own project
 * (`project_id = foundation_id`) already holds that company's foundation-wide commits and its distinct people across every
 * project, with the previous-period figure and change from the same build. Reading those rows gives true unique
 * contributors for no extra cost, and nothing here sums contributor counts across projects. Person keys are never read.
 *
 * Cost: every read filters on `foundation_slug` and `time_range` and binds them. A foundation costs two queries per range
 * (companies, projects), shared-cached for an hour; a project scope or a company breakdown is one more.
 */
export class FoundationParticipatingOrgsSnowflakeSource implements FoundationParticipatingOrgsDataSource {
  private readonly snowflakeService = SnowflakeService.getInstance();

  public async getFoundation(slug: string, range: FoundationParticipatingOrgsRange): Promise<FoundationParticipatingOrgsSourceFoundation | null> {
    // Wrapped so a foundation with no rows is a cache hit too.
    const entry = await withProjectParticipatingOrgsCache(
      slug,
      'foundation-lens',
      [range],
      async () => ({ foundation: await this.fetchFoundation(slug, range) }),
      isFoundationEntry
    );
    return entry.foundation;
  }

  public async getProjectLines(
    slug: string,
    range: FoundationParticipatingOrgsRange,
    filter: FoundationParticipatingOrgsSourceLineFilter
  ): Promise<FoundationParticipatingOrgsSourceProjectLine[]> {
    // The export reads everything and is never cached; a project or a company is a small set worth sharing.
    if (filter.companyKeys || (!filter.projectSlug && !filter.companyKey)) return this.fetchLines(slug, range, filter);
    const entry = await withProjectParticipatingOrgsCache(
      slug,
      'foundation-lens-lines',
      [range, filter.projectSlug ?? '', filter.companyKey ?? ''],
      async () => ({ lines: await this.fetchLines(slug, range, filter) }),
      isLinesEntry
    );
    return entry.lines;
  }

  /** A missing table or revoked grant is an expected, alertable condition, not a failure for the shared Snowflake breaker. */
  private execute<T>(sql: string, binds: string[]) {
    return this.snowflakeService.execute<T>(sql, binds, { expectMissingObject: true });
  }

  private async fetchFoundation(slug: string, range: FoundationParticipatingOrgsRange): Promise<FoundationParticipatingOrgsSourceFoundation | null> {
    const table = tableName();
    const companiesSql = `
      WITH foundation AS (
        SELECT foundation_name, as_of_date, participant_key, account_id, participant_name, participant_logo_url, is_member,
               membership_tier_class, commits, commits_change, contributors, contributors_change
        FROM ${table}
        WHERE foundation_slug = ?
          AND time_range = ?
          AND project_id = foundation_id
          AND participant_key IS NOT NULL
      ),
      involved AS (
        SELECT participant_key, COUNT(DISTINCT project_id) AS projects_involved
        FROM ${table}
        WHERE foundation_slug = ?
          AND time_range = ?
          AND project_id <> foundation_id
          AND commits > 0
        GROUP BY participant_key
      )
      SELECT f.*, COALESCE(i.projects_involved, 0) AS projects_involved
      FROM foundation f
      LEFT JOIN involved i ON i.participant_key = f.participant_key
    `;
    // A project is known by its all-time activity, so a project quiet in this range is still a valid scope (it shows the empty
    // state); the range's commits only order the picker.
    const projectsSql = `
      SELECT a.project_slug, MAX(a.project_name) AS project_name, COALESCE(SUM(r.commits), 0) AS commits
      FROM ${table} a
      LEFT JOIN ${table} r
        ON r.foundation_slug = a.foundation_slug
        AND r.project_id = a.project_id
        AND r.participant_key = a.participant_key
        AND r.time_range = ?
      WHERE a.foundation_slug = ?
        AND a.time_range = 'all'
        AND a.project_id <> a.foundation_id
        AND (a.commits > 0 OR a.contributors > 0)
      GROUP BY a.project_slug
    `;

    const [companies, projects] = await Promise.all([
      this.execute<FoundationParticipatingOrgsCompanyRow>(companiesSql, [slug, range, slug, range]),
      this.execute<FoundationParticipatingOrgsProjectRow>(projectsSql, [range, slug]),
    ]);
    if (companies.rows.length === 0 && projects.rows.length === 0) return null;

    const first = companies.rows[0];
    return {
      slug,
      name: first?.FOUNDATION_NAME?.trim() || slug,
      asOfDate: toIsoDate(first?.AS_OF_DATE),
      projects: projects.rows
        .filter((row) => !!row.PROJECT_SLUG)
        .map((row) => ({
          slug: row.PROJECT_SLUG as string,
          name: row.PROJECT_NAME?.trim() || (row.PROJECT_SLUG as string),
          maturity: null,
          commits: Number(row.COMMITS ?? 0),
        })),
      companies: companies.rows.map(mapCompany),
    };
  }

  private async fetchLines(
    slug: string,
    range: FoundationParticipatingOrgsRange,
    filter: FoundationParticipatingOrgsSourceLineFilter
  ): Promise<FoundationParticipatingOrgsSourceProjectLine[]> {
    const binds: string[] = [slug, range];
    const predicates: string[] = [];
    if (filter.projectSlug) {
      predicates.push('AND project_slug = ?');
      binds.push(filter.projectSlug);
    }
    if (filter.companyKey) {
      predicates.push('AND participant_key = ?');
      binds.push(filter.companyKey);
    }
    if (filter.companyKeys) {
      // One JSON bind, however many companies, matched through FLATTEN.
      predicates.push('AND participant_key IN (SELECT value::varchar FROM TABLE(FLATTEN(input => PARSE_JSON(?))))');
      binds.push(JSON.stringify(filter.companyKeys));
    }
    // Inlined, not bound: clamped to a positive integer first.
    const limit = filter.limit ? `LIMIT ${Math.max(1, Math.min(Math.floor(filter.limit), FOUNDATION_PARTICIPATING_ORGS_EXPORT_MAX_ROWS + 1))}` : '';
    const sql = `
      SELECT participant_key, project_slug, commits, commits_change, contributors, contributors_change
      FROM ${tableName()}
      WHERE foundation_slug = ?
        AND time_range = ?
        AND project_id <> foundation_id
        AND participant_key IS NOT NULL
        AND (commits > 0 OR contributors > 0)
        ${predicates.join('\n        ')}
      ORDER BY participant_key ASC, project_slug ASC
      ${limit}
    `;
    const result = await this.execute<FoundationParticipatingOrgsLineRow>(sql, binds);
    return result.rows
      .filter((row) => !!row.PARTICIPANT_KEY && !!row.PROJECT_SLUG)
      .map((row) => ({
        companyKey: row.PARTICIPANT_KEY as string,
        projectSlug: row.PROJECT_SLUG as string,
        commits: Number(row.COMMITS ?? 0),
        commitsChange: toNullableNumber(row.COMMITS_CHANGE),
        contributors: Number(row.CONTRIBUTORS ?? 0),
        contributorsChange: toNullableNumber(row.CONTRIBUTORS_CHANGE),
      }));
  }
}

function tableName(): string {
  return `${resolveLfxOnePlatinumSchema()}.PROJECT_PARTICIPATING_ORGS`;
}

function mapCompany(row: FoundationParticipatingOrgsCompanyRow): FoundationParticipatingOrgsSourceCompany {
  const isMember = row.IS_MEMBER === true;
  const key = row.PARTICIPANT_KEY as string;
  return {
    key,
    accountId: row.ACCOUNT_ID || null,
    name: row.PARTICIPANT_NAME?.trim() || key,
    logoUrl: row.PARTICIPANT_LOGO_URL || null,
    isMember,
    tier: isMember ? ((row.MEMBERSHIP_TIER_CLASS as MembershipTierClass | null) ?? null) : null,
    // The warehouse model carries no other-membership data for this page.
    otherMemberships: [],
    projectsInvolved: Number(row.PROJECTS_INVOLVED ?? 0),
    commits: Number(row.COMMITS ?? 0),
    commitsChange: toNullableNumber(row.COMMITS_CHANGE),
    contributors: Number(row.CONTRIBUTORS ?? 0),
    contributorsChange: toNullableNumber(row.CONTRIBUTORS_CHANGE),
  };
}

function toNullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function isFoundationEntry(value: unknown): boolean {
  if (!value || typeof value !== 'object' || !('foundation' in value)) return false;
  const foundation = (value as { foundation: Partial<FoundationParticipatingOrgsSourceFoundation> | null }).foundation;
  return foundation === null || (typeof foundation.slug === 'string' && Array.isArray(foundation.companies) && Array.isArray(foundation.projects));
}

function isLinesEntry(value: unknown): boolean {
  return !!value && typeof value === 'object' && Array.isArray((value as { lines?: unknown }).lines);
}
