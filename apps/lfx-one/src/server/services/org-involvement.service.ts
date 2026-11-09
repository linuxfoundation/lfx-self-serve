// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { createHash } from 'node:crypto';

import {
  OrgInvolvementContributorsMonthlyResponse,
  OrgInvolvementEventAttendanceMonthlyResponse,
  OrgFoundationCoverageResponse,
  OrgInvolvementMaintainersMonthlyResponse,
  OrgMaintainerRolesCountRow,
  OrgMaintainerRolesMonthlyRow,
} from '@lfx-one/shared';
import {
  DEFAULT_ORG_COMMIT_FILTERS,
  DEFAULT_ORG_SCOPE,
  DEFAULT_ORG_TEAM_MEMBERS,
  ORG_CONTRIBUTORS_MONTHLY_EXCLUDING_COLUMN,
  ORG_CONTRIBUTORS_MONTHLY_PEOPLE_VIEW,
  ORG_CONTRIBUTORS_MONTHLY_VIEW,
  ORG_EVENT_ATTENDANCE_METRIC_COLUMNS,
  ORG_EVENT_CROSS_ACCOUNT_PARTICIPANT_REF_COLUMN,
  ORG_LENS_DEFAULT_TIME_RANGE,
  ORG_LENS_TIME_RANGE_DAYS,
  ORG_MAINTAINER_ROLES_MONTHLY_EXCLUDING_COLUMN,
  ORG_OVERVIEW_MAINTAINER_ROLES_RANGE,
  VALKEY_CACHE,
} from '@lfx-one/shared/constants';
import type { OrgEventAttendanceMonthlyRow, OrgFamilyEventAttendanceMonthlyRow, OrgScopeFilter, OrgTeamMembersFilter } from '@lfx-one/shared/interfaces';

import { orgContributorsActivityPredicate } from '../helpers/org-contributors-sql.helper';
import { orgMaintainerRoleOverlap, readMaintainerRoles } from '../helpers/org-maintainer-roles-sql.helper';
import { orgProjectScopePredicate } from '../helpers/org-project-scope-sql.helper';
import { orgScopeColumn, orgScopeRowPredicate, resolveOrgScope } from '../helpers/org-scope.helper';
import { orgTeamMembersPredicate, orgTeamMembersQueryOptions, readWithOrgTeamMembersFallback } from '../helpers/org-team-members.helper';
import { isMissingObjectError } from '../helpers/snowflake-error.helper';
import { SnowflakeService } from './snowflake.service';
import { withOrgCache } from './valkey.service';

const formatMonthLabel = (date: Date): string => date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

interface FoundationCoverageRow {
  ACCOUNT_ID: string;
  FOUNDATION_ID: string;
  FOUNDATION_SLUG: string;
  FOUNDATION_NAME: string;
  FOUNDATION_COUNT: number;
}

interface ContributorsMonthlyRow {
  MONTH_START_DATE: Date;
  UNIQUE_CONTRIBUTORS: number;
}

/** Cross-foundation organization involvement analytics against the org_* platinum tables (account-level). */
export class OrgInvolvementService {
  private snowflakeService: SnowflakeService;

  public constructor() {
    this.snowflakeService = SnowflakeService.getInstance();
  }

  /**
   * Empty rows are a legitimate result (the org has zero coverage), not a not-found.
   * Endpoints in this service return a zero-shaped envelope so the client renders
   * an empty state instead of treating the call as an error.
   */
  public async getFoundationCoverage(accountId: string): Promise<OrgFoundationCoverageResponse> {
    return withOrgCache(
      accountId,
      'coverage',
      VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
      () => this.fetchFoundationCoverage(accountId),
      OrgInvolvementService.hasAccountId
    );
  }

  /**
   * The Overview's Active Contributors card, always at the default organization scope (lfx-self-serve-ops#1219): the
   * Overview has no scope picker, so it counts the account's Insights organization, or every related organization for an
   * account without one ({@link resolveOrgScope}'s fallback).
   */
  public async getContributorsMonthly(accountId: string): Promise<OrgInvolvementContributorsMonthlyResponse> {
    // `:{scope}` (lfx-self-serve-ops#1219): the effective organization scope, so an account without an Insights org
    // shares its `all` entry.
    const scope = await resolveOrgScope(this.snowflakeService, accountId, DEFAULT_ORG_SCOPE);
    // `contributors:v5`: the trend reads lf-dbt's ORG_CONTRIBUTORS_MONTHLY, now every project with team members left out
    // (lf-dbt#3149). (`v4`: the headline counts all projects over the last 2 years, the Org Lens default view
    // (lfx-self-serve#4694), and leaves out CDP team members as the People -> Contributors default does
    // (lfx-self-serve#4685); `v2`: the headline became the live People -> Contributors default count.) Set by the
    // fetcher, read by `storable`: a card read while the trend view or a team-member column is missing is served, never
    // stored.
    let degraded = false;
    return withOrgCache(
      accountId,
      `contributors:v5:${scope}`,
      VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
      async () => {
        const fetched = await this.fetchContributorsMonthly(accountId, scope);
        degraded = fetched.trendMissing || fetched.teamMembersUnavailable;
        return fetched.response;
      },
      OrgInvolvementService.hasAccountId,
      () => !degraded
    );
  }

  public async getFamilyContributorsMonthly(rollUpKey: string, accountIds: readonly string[]): Promise<OrgInvolvementContributorsMonthlyResponse> {
    const companies = [...new Set(accountIds)].sort();
    if (companies.length === 0) {
      return { accountId: rollUpKey, totalActiveContributors: 0, monthlyData: [], monthlyLabels: [] };
    }
    const scopes = await Promise.all(companies.map((accountId) => resolveOrgScope(this.snowflakeService, accountId, DEFAULT_ORG_SCOPE)));
    const insightsCompanies = companies.filter((_accountId, index) => scopes[index] === 'insights');
    const allCompanies = companies.filter((_accountId, index) => scopes[index] !== 'insights');
    const digest = createHash('sha256')
      .update(JSON.stringify([insightsCompanies, allCompanies]))
      .digest('hex')
      .slice(0, 16);
    // `contributors-family:v2`: the trend reads the warehouse's per-person monthly rows instead of rebuilding the months from the
    // daily table. Set by the fetcher, read by `storable`: a card read while that view or the team-member flag is missing
    // is served, never stored.
    let degraded = false;
    return withOrgCache(
      rollUpKey,
      `contributors-family:v2:${digest}`,
      VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
      async () => {
        const fetched = await this.fetchFamilyContributorsMonthly(rollUpKey, companies, insightsCompanies, allCompanies);
        degraded = fetched.trendMissing || fetched.teamMembersUnavailable;
        return fetched.response;
      },
      OrgInvolvementService.hasAccountId,
      () => !degraded
    );
  }

  public async getMaintainersMonthly(accountId: string): Promise<OrgInvolvementMaintainersMonthlyResponse> {
    // `maintainer-roles:v4`: the trend reads lf-dbt's ORG_MAINTAINER_ROLES_MONTHLY, now every project with team members'
    // roles left out (lf-dbt#3149). (`v3`: the headline counts all projects over the last 2 years, the Org Lens default
    // view (lfx-self-serve#4694), and leaves out CDP team members' roles (lfx-self-serve#4685); `v1`: maintainer roles
    // replaced the people count, lfx-self-serve#4482.) Set by the fetcher, read by `storable`: a card read while a roles
    // table, the trend view or a team-member column is missing is served, never stored.
    let degraded = false;
    return withOrgCache(
      accountId,
      'maintainer-roles:v4',
      VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
      async () => {
        const fetched = await this.fetchMaintainersMonthly(accountId);
        degraded = fetched.rolesMissing;
        return fetched.response;
      },
      OrgInvolvementService.hasAccountId,
      () => !degraded
    );
  }

  public async getFamilyMaintainersMonthly(rollUpKey: string, accountIds: readonly string[]): Promise<OrgInvolvementMaintainersMonthlyResponse> {
    const companies = [...new Set(accountIds)].sort();
    if (companies.length === 0) {
      return { accountId: rollUpKey, maintainerRoles: 0, monthlyData: [], monthlyLabels: [] };
    }
    const digest = createHash('sha256').update(JSON.stringify(companies)).digest('hex').slice(0, 16);
    let degraded = false;
    return withOrgCache(
      rollUpKey,
      `maintainer-roles-family:v2:${digest}`,
      VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
      async () => {
        const fetched = await this.fetchFamilyMaintainersMonthly(rollUpKey, companies);
        degraded = fetched.rolesMissing;
        return fetched.response;
      },
      OrgInvolvementService.hasAccountId,
      () => !degraded
    );
  }

  public async getEventAttendanceMonthly(accountId: string): Promise<OrgInvolvementEventAttendanceMonthlyResponse> {
    return withOrgCache(
      accountId,
      // `v5` (lfx-self-serve#5315): the response no longer carries `servedAttribution` (the Overview is always Employee match);
      // a `v4` entry holds the old shape.
      'events:v5',
      VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
      () => this.fetchEventAttendanceMonthly(accountId),
      OrgInvolvementService.hasAccountId
    );
  }

  public async getFamilyEventAttendanceMonthly(rollUpKey: string, accountIds: readonly string[]): Promise<OrgInvolvementEventAttendanceMonthlyResponse> {
    const companies = [...new Set(accountIds)].sort();
    if (companies.length === 0) {
      return {
        accountId: rollUpKey,
        accountName: '',
        totalAttended: 0,
        totalSpeakers: 0,
        attendeesMonthlyData: [],
        speakersMonthlyData: [],
        monthlyLabels: [],
      };
    }
    const digest = createHash('sha256').update(JSON.stringify(companies)).digest('hex').slice(0, 16);
    // `events-family:v2`: the months are the companies' months in ORG_EVENT_PARTICIPATION_MONTHLY, and no per-company
    // fallback count is served.
    return withOrgCache(
      rollUpKey,
      `events-family:v2:${digest}`,
      VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
      () => this.fetchFamilyEventAttendanceMonthly(rollUpKey, companies),
      OrgInvolvementService.hasAccountId
    );
  }

  // Rejects a corrupt/legacy entry (degrade to a miss); every response in this service carries `accountId`.
  private static hasAccountId(value: unknown): boolean {
    return value !== null && typeof value === 'object' && !Array.isArray(value) && typeof (value as { accountId?: unknown }).accountId === 'string';
  }

  private async fetchFoundationCoverage(accountId: string): Promise<OrgFoundationCoverageResponse> {
    const query = `
      SELECT
        ACCOUNT_ID,
        FOUNDATION_ID,
        FOUNDATION_SLUG,
        FOUNDATION_NAME,
        FOUNDATION_COUNT
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_FOUNDATION_COVERAGE
      WHERE ACCOUNT_ID = ?
      ORDER BY FOUNDATION_NAME ASC
    `;

    const result = await this.snowflakeService.execute<FoundationCoverageRow>(query, [accountId]);

    if (result.rows.length === 0) {
      return { accountId, foundationCount: 0, foundations: [] };
    }

    return {
      accountId: result.rows[0].ACCOUNT_ID,
      foundationCount: result.rows[0].FOUNDATION_COUNT || 0,
      foundations: result.rows.map((row) => ({
        foundationId: row.FOUNDATION_ID,
        foundationSlug: row.FOUNDATION_SLUG,
        foundationName: row.FOUNDATION_NAME,
      })),
    };
  }

  /**
   * Overview Active Contributors card. The headline is the People -> Contributors default tile, counted live with the
   * same rule — distinct people with code at the Org Lens default view (all projects, the last 2 years to today), CDP
   * team members left out (lfx-self-serve#4685) — so the two agree. The trend is lf-dbt's ORG_CONTRIBUTORS_MONTHLY
   * view: the same people from the same table, per calendar month in every project, over the 12 months ending with this
   * one (to date), team members left out through its UNIQUE_CONTRIBUTORS_EXCLUDING_TEAM_MEMBERS column. The headline read
   * failing fails the card; a missing trend view answers an empty trend, and a missing team-member flag or column counts
   * team members.
   */
  private async fetchContributorsMonthly(
    accountId: string,
    scope: OrgScopeFilter
  ): Promise<{ response: OrgInvolvementContributorsMonthlyResponse; trendMissing: boolean; teamMembersUnavailable: boolean }> {
    // Under `insights` (lfx-self-serve-ops#1219) the headline keeps only rows with Insights-scoped code and the trend
    // reads the views' insights_ twins; under `all` both reads are unchanged.
    const headlineQuery = (teamMembers: OrgTeamMembersFilter): string => `
      SELECT COUNT(DISTINCT person_key) AS ACTIVE_CONTRIBUTORS
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_CONTRIBUTORS_DAILY
      WHERE account_id = ?
        ${orgContributorsActivityPredicate(ORG_LENS_DEFAULT_TIME_RANGE)}
        ${orgProjectScopePredicate(DEFAULT_ORG_COMMIT_FILTERS.projectScope)}
        ${orgTeamMembersPredicate(teamMembers)}
        ${orgScopeRowPredicate(scope, 'INSIGHTS_DAILY_CODE_ACTIVITIES')}
    `;
    const uniqueColumn = orgScopeColumn(scope, 'UNIQUE_CONTRIBUTORS');
    const excludingColumn = orgScopeColumn(scope, ORG_CONTRIBUTORS_MONTHLY_EXCLUDING_COLUMN);
    // Under `exclude` the trend reads the view's count without team members, aliased to the inclusive column's name.
    const trendQuery = (teamMembers: OrgTeamMembersFilter): string => `
      SELECT MONTH_START_DATE, ${teamMembers === 'exclude' ? excludingColumn : uniqueColumn}${scope === 'all' && teamMembers !== 'exclude' ? '' : ' AS UNIQUE_CONTRIBUTORS'}
      FROM ANALYTICS.PLATINUM_LFX_ONE.${ORG_CONTRIBUTORS_MONTHLY_VIEW}
      WHERE ACCOUNT_ID = ?
      ORDER BY MONTH_START_DATE ASC
    `;

    const [headline, trend] = await Promise.all([
      readWithOrgTeamMembersFallback(DEFAULT_ORG_TEAM_MEMBERS, 'get_org_involvement_contributors', (teamMembers) =>
        this.snowflakeService.execute<{ ACTIVE_CONTRIBUTORS: number | null }>(headlineQuery(teamMembers), [accountId], orgTeamMembersQueryOptions(teamMembers))
      ),
      readWithOrgTeamMembersFallback(
        DEFAULT_ORG_TEAM_MEMBERS,
        'get_org_involvement_contributors_trend',
        (teamMembers) =>
          this.snowflakeService
            .execute<ContributorsMonthlyRow>(trendQuery(teamMembers), [accountId], {
              expectMissingObject: ORG_CONTRIBUTORS_MONTHLY_VIEW,
              ...orgTeamMembersQueryOptions(teamMembers, excludingColumn),
            })
            .then((result) => result.rows)
            .catch((error: unknown) => {
              if (isMissingObjectError(error, ORG_CONTRIBUTORS_MONTHLY_VIEW)) return null;
              throw error;
            }),
        excludingColumn
      ),
    ]);

    return {
      response: {
        accountId,
        totalActiveContributors: headline.value.rows[0]?.ACTIVE_CONTRIBUTORS ?? 0,
        monthlyData: (trend.value ?? []).map((row) => row.UNIQUE_CONTRIBUTORS || 0),
        monthlyLabels: (trend.value ?? []).map((row) => formatMonthLabel(row.MONTH_START_DATE)),
      },
      trendMissing: trend.value === null,
      teamMembersUnavailable: headline.teamMembersUnavailable || trend.teamMembersUnavailable,
    };
  }

  /**
   * Overview Active Contributors card for a family, each company under its own organization scope. The headline is
   * counted live from the daily table with the single-company headline rule, over every company at once, so a person
   * credited to two companies counts once. The trend is the warehouse's ORG_CONTRIBUTORS_MONTHLY_PEOPLE rows (one per company,
   * person and month) counted distinct per month across the companies, over the months ORG_CONTRIBUTORS_MONTHLY lists
   * for them, so a month without code reads 0 and a family without code in the window has no months. A missing
   * per-person view answers an empty trend.
   */
  private async fetchFamilyContributorsMonthly(
    rollUpKey: string,
    companies: readonly string[],
    insightsCompanies: readonly string[],
    allCompanies: readonly string[]
  ): Promise<{ response: OrgInvolvementContributorsMonthlyResponse; trendMissing: boolean; teamMembersUnavailable: boolean }> {
    const placeholders = (values: readonly string[]): string => values.map(() => '?').join(', ');
    // Every company under `all` keeps every row, so only a family with an Insights-scoped company gets a predicate.
    const scopePredicate = (insightsRow: string): string => {
      if (insightsCompanies.length === 0) return '';
      const terms = [
        `(account_id IN (${placeholders(insightsCompanies)}) AND ${insightsRow})`,
        ...(allCompanies.length > 0 ? [`account_id IN (${placeholders(allCompanies)})`] : []),
      ];
      return `AND (${terms.join(' OR ')})`;
    };
    const scopeBinds = insightsCompanies.length > 0 ? [...insightsCompanies, ...allCompanies] : [];

    const headlineQuery = (teamMembers: OrgTeamMembersFilter): string => `
      SELECT COUNT(DISTINCT person_key) AS ACTIVE_CONTRIBUTORS
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_CONTRIBUTORS_DAILY
      WHERE account_id IN (${placeholders(companies)})
        ${orgContributorsActivityPredicate(ORG_LENS_DEFAULT_TIME_RANGE)}
        ${orgProjectScopePredicate(DEFAULT_ORG_COMMIT_FILTERS.projectScope)}
        ${orgTeamMembersPredicate(teamMembers)}
        ${scopePredicate('insights_daily_code_activities > 0')}
    `;
    const trendQuery = `
      WITH months AS (
        SELECT DISTINCT MONTH_START_DATE
        FROM ANALYTICS.PLATINUM_LFX_ONE.${ORG_CONTRIBUTORS_MONTHLY_VIEW}
        WHERE ACCOUNT_ID IN (${placeholders(companies)})
      ),
      people AS (
        SELECT month_start_date, person_key
        FROM ANALYTICS.PLATINUM_LFX_ONE.${ORG_CONTRIBUTORS_MONTHLY_PEOPLE_VIEW}
        WHERE account_id IN (${placeholders(companies)})
          ${orgTeamMembersPredicate(DEFAULT_ORG_TEAM_MEMBERS)}
          ${scopePredicate('is_insights_scope')}
      )
      SELECT m.MONTH_START_DATE, COUNT(DISTINCT p.person_key) AS UNIQUE_CONTRIBUTORS
      FROM months AS m
      LEFT JOIN people AS p ON p.month_start_date = m.MONTH_START_DATE
      GROUP BY m.MONTH_START_DATE
      ORDER BY m.MONTH_START_DATE ASC
    `;

    const [headline, trend] = await Promise.all([
      readWithOrgTeamMembersFallback(DEFAULT_ORG_TEAM_MEMBERS, 'get_org_involvement_family_contributors', (teamMembers) =>
        this.snowflakeService.execute<{ ACTIVE_CONTRIBUTORS: number | null }>(
          headlineQuery(teamMembers),
          [...companies, ...scopeBinds],
          orgTeamMembersQueryOptions(teamMembers)
        )
      ),
      this.snowflakeService
        .execute<ContributorsMonthlyRow>(trendQuery, [...companies, ...companies, ...scopeBinds], { expectMissingObject: ORG_CONTRIBUTORS_MONTHLY_PEOPLE_VIEW })
        .then((result) => result.rows)
        .catch((error: unknown) => {
          if (isMissingObjectError(error, ORG_CONTRIBUTORS_MONTHLY_PEOPLE_VIEW)) return null;
          throw error;
        }),
    ]);

    return {
      response: {
        accountId: rollUpKey,
        totalActiveContributors: headline.value.rows[0]?.ACTIVE_CONTRIBUTORS ?? 0,
        monthlyData: (trend ?? []).map((row) => row.UNIQUE_CONTRIBUTORS || 0),
        monthlyLabels: (trend ?? []).map((row) => formatMonthLabel(row.MONTH_START_DATE)),
      },
      trendMissing: trend === null,
      teamMembersUnavailable: headline.teamMembersUnavailable,
    };
  }

  /**
   * Overview Maintainers card. The headline counts roles overlapping the Org Lens default view (all projects, the last
   * 2 years to today) with the same rule as People -> Contributors, so the two default views agree; CDP team members'
   * roles are left out, as LFX Insights does (lfx-self-serve#4685). The trend is lf-dbt's ORG_MAINTAINER_ROLES_MONTHLY
   * view: the roles in every project held in each calendar month, over the 12 months ending with this one (to date),
   * team members' roles left out through its ACTIVE_ROLES_EXCLUDING_TEAM_MEMBERS column.
   */
  private async fetchMaintainersMonthly(accountId: string): Promise<{ response: OrgInvolvementMaintainersMonthlyResponse; rolesMissing: boolean }> {
    const overlap = orgMaintainerRoleOverlap(ORG_OVERVIEW_MAINTAINER_ROLES_RANGE);
    const headlineQuery = (teamMembers: OrgTeamMembersFilter): string => `
      SELECT COUNT(DISTINCT MEMBER_ID, SEGMENT_ID) AS MAINTAINER_ROLES
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_MAINTAINER_ROLES
      WHERE ACCOUNT_ID = ?
        AND ${overlap.sql}
        ${orgProjectScopePredicate(DEFAULT_ORG_COMMIT_FILTERS.projectScope, 'IS_LF_PROJECT')}
        ${orgTeamMembersPredicate(teamMembers, 'IS_CDP_TEAM_MEMBER')}
    `;
    const trendQuery = (teamMembers: OrgTeamMembersFilter): string => `
      SELECT METRIC_MONTH, ${teamMembers === 'exclude' ? `${ORG_MAINTAINER_ROLES_MONTHLY_EXCLUDING_COLUMN} AS ` : ''}ACTIVE_ROLES
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_MAINTAINER_ROLES_MONTHLY
      WHERE ACCOUNT_ID = ?
      ORDER BY METRIC_MONTH ASC
    `;

    // Each part degrades on its own: a missing roles table answers an unavailable (null) headline, a missing trend view
    // an empty trend, a missing team-member flag or column a headline or trend with team members — never an error.
    const [headline, trend] = await Promise.all([
      readWithOrgTeamMembersFallback(DEFAULT_ORG_TEAM_MEMBERS, 'get_org_involvement_maintainer_roles', (teamMembers) =>
        readMaintainerRoles<OrgMaintainerRolesCountRow>(
          this.snowflakeService,
          'ORG_MAINTAINER_ROLES',
          headlineQuery(teamMembers),
          [accountId, ...overlap.binds],
          orgTeamMembersQueryOptions(teamMembers)
        )
      ),
      readWithOrgTeamMembersFallback(
        DEFAULT_ORG_TEAM_MEMBERS,
        'get_org_involvement_maintainer_roles_trend',
        (teamMembers) =>
          readMaintainerRoles<OrgMaintainerRolesMonthlyRow>(
            this.snowflakeService,
            'ORG_MAINTAINER_ROLES_MONTHLY',
            trendQuery(teamMembers),
            [accountId],
            orgTeamMembersQueryOptions(teamMembers, ORG_MAINTAINER_ROLES_MONTHLY_EXCLUDING_COLUMN)
          ),
        ORG_MAINTAINER_ROLES_MONTHLY_EXCLUDING_COLUMN
      ),
    ]);

    return {
      response: {
        accountId,
        maintainerRoles: headline.value === null ? null : (headline.value[0]?.MAINTAINER_ROLES ?? 0),
        monthlyData: (trend.value ?? []).map((row) => row.ACTIVE_ROLES ?? 0),
        monthlyLabels: (trend.value ?? []).map((row) => formatMonthLabel(row.METRIC_MONTH)),
      },
      rolesMissing: headline.value === null || trend.value === null || headline.teamMembersUnavailable || trend.teamMembersUnavailable,
    };
  }

  private async fetchFamilyMaintainersMonthly(
    rollUpKey: string,
    companies: readonly string[]
  ): Promise<{ response: OrgInvolvementMaintainersMonthlyResponse; rolesMissing: boolean }> {
    const accountList = companies.map(() => '?').join(', ');
    // Both views carry IS_CDP_TEAM_MEMBER from the roles table, so only the view itself can be missing.
    const headlineQuery = `
      SELECT COUNT(DISTINCT MEMBER_ID, SEGMENT_ID) AS MAINTAINER_ROLES
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_MAINTAINER_ROLES_RECENT
      WHERE ACCOUNT_ID IN (${accountList})
        AND IS_ACTIVE_LAST_TWO_YEARS
        ${orgProjectScopePredicate(DEFAULT_ORG_COMMIT_FILTERS.projectScope, 'IS_LF_PROJECT')}
        ${orgTeamMembersPredicate(DEFAULT_ORG_TEAM_MEMBERS, 'IS_CDP_TEAM_MEMBER')}
    `;
    const trendQuery = `
      WITH months AS (
        SELECT DISTINCT METRIC_MONTH
        FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_MAINTAINER_ROLES_MONTHLY
        WHERE ACCOUNT_ID IN (${accountList})
      )
      SELECT m.METRIC_MONTH, COUNT(DISTINCT r.MEMBER_ID, r.SEGMENT_ID) AS ACTIVE_ROLES
      FROM months AS m
      LEFT JOIN ANALYTICS.PLATINUM_LFX_ONE.ORG_MAINTAINER_ROLE_MONTHS AS r
        ON r.METRIC_MONTH = m.METRIC_MONTH
        AND r.ACCOUNT_ID IN (${accountList})
        ${orgProjectScopePredicate(DEFAULT_ORG_COMMIT_FILTERS.projectScope, 'IS_LF_PROJECT')}
        ${orgTeamMembersPredicate(DEFAULT_ORG_TEAM_MEMBERS, 'IS_CDP_TEAM_MEMBER')}
      GROUP BY m.METRIC_MONTH
      ORDER BY m.METRIC_MONTH ASC
    `;

    const [headline, trend] = await Promise.all([
      readMaintainerRoles<OrgMaintainerRolesCountRow>(this.snowflakeService, 'ORG_MAINTAINER_ROLES_RECENT', headlineQuery, [...companies]),
      readMaintainerRoles<OrgMaintainerRolesMonthlyRow>(this.snowflakeService, 'ORG_MAINTAINER_ROLE_MONTHS', trendQuery, [...companies, ...companies]),
    ]);

    return {
      response: {
        accountId: rollUpKey,
        maintainerRoles: headline === null ? null : (headline[0]?.MAINTAINER_ROLES ?? 0),
        monthlyData: (trend ?? []).map((row) => row.ACTIVE_ROLES ?? 0),
        monthlyLabels: (trend ?? []).map((row) => formatMonthLabel(row.METRIC_MONTH)),
      },
      rolesMissing: headline === null || trend === null,
    };
  }

  /**
   * Overview Event Attendees / Event Speakers: pinned to the defaults (Employee match, registered or attended, 2 years). dbt
   * computes every number; this reads the default attribution's columns (`ATTENDEES_ALL_VERIFIED` for attendees: people who
   * registered or attended). The headline is the distinct-people total, not the sum of the monthly points.
   */
  private async fetchEventAttendanceMonthly(accountId: string): Promise<OrgInvolvementEventAttendanceMonthlyResponse> {
    const query = `
      SELECT
        ACCOUNT_ID,
        ACCOUNT_NAME,
        MONTH_START_DATE,
        ${ORG_EVENT_ATTENDANCE_METRIC_COLUMNS.join(',\n        ')}
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_EVENT_PARTICIPATION_MONTHLY
      WHERE ACCOUNT_ID = ?
      ORDER BY MONTH_START_DATE ASC
    `;

    const result = await this.snowflakeService.execute<OrgEventAttendanceMonthlyRow>(query, [accountId]);

    if (result.rows.length === 0) {
      return {
        accountId,
        accountName: '',
        totalAttended: 0,
        totalSpeakers: 0,
        attendeesMonthlyData: [],
        speakersMonthlyData: [],
        monthlyLabels: [],
      };
    }

    const firstRow = result.rows[0];

    return {
      accountId: firstRow.ACCOUNT_ID,
      accountName: firstRow.ACCOUNT_NAME,
      totalAttended: firstRow.TOTAL_ATTENDEES_ALL_VERIFIED || 0,
      totalSpeakers: firstRow.TOTAL_SPEAKERS_VERIFIED || 0,
      attendeesMonthlyData: result.rows.map((row) => row.ATTENDEES_ALL_VERIFIED || 0),
      speakersMonthlyData: result.rows.map((row) => row.SPEAKERS_VERIFIED || 0),
      monthlyLabels: result.rows.map((row) => formatMonthLabel(row.MONTH_START_DATE)),
    };
  }

  /**
   * Overview Event Attendees / Event Speakers for a family, with the single-company rule (Employee match, registered or
   * attended, ended events in the last 2 years) over every company of the family at once. The months are the ones
   * ORG_EVENT_PARTICIPATION_MONTHLY lists for those companies, so a family of one has that company's own series; the
   * people are counted distinct per month and over the window from the person-level participation table through the
   * participant number every company shares, so a person credited to two companies counts once. Until that column is in
   * the warehouse the read fails rather than serve per-company counts that would count such a person twice.
   */
  private async fetchFamilyEventAttendanceMonthly(rollUpKey: string, companies: readonly string[]): Promise<OrgInvolvementEventAttendanceMonthlyResponse> {
    const accountList = companies.map(() => '?').join(', ');
    const query = `
      WITH months AS (
        SELECT DISTINCT MONTH_START_DATE
        FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_EVENT_PARTICIPATION_MONTHLY
        WHERE ACCOUNT_ID IN (${accountList})
      ),
      participants AS (
        SELECT
          DATE_TRUNC('MONTH', event_date)::DATE AS MONTH_START_DATE,
          ${ORG_EVENT_CROSS_ACCOUNT_PARTICIPANT_REF_COLUMN} AS PARTICIPANT,
          is_counted_all_verified AS IS_ATTENDEE,
          is_counted_speaker_verified AS IS_SPEAKER
        FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_EVENT_PARTICIPATION
        WHERE account_id IN (${accountList})
          AND event_date < CURRENT_DATE()
          AND event_date >= DATEADD(DAY, 0 - ?, CURRENT_DATE())
      )
      SELECT
        m.MONTH_START_DATE,
        COUNT(DISTINCT IFF(p.IS_ATTENDEE, p.PARTICIPANT, NULL)) AS ATTENDEES,
        COUNT(DISTINCT IFF(p.IS_SPEAKER, p.PARTICIPANT, NULL)) AS SPEAKERS,
        (SELECT COUNT(DISTINCT IFF(IS_ATTENDEE, PARTICIPANT, NULL)) FROM participants) AS TOTAL_ATTENDEES,
        (SELECT COUNT(DISTINCT IFF(IS_SPEAKER, PARTICIPANT, NULL)) FROM participants) AS TOTAL_SPEAKERS
      FROM months AS m
      LEFT JOIN participants AS p ON p.MONTH_START_DATE = m.MONTH_START_DATE
      GROUP BY m.MONTH_START_DATE
      ORDER BY m.MONTH_START_DATE ASC
    `;

    // The column is expected to be missing until it is built, so its absence does not count toward the circuit breaker.
    const { rows } = await this.snowflakeService.execute<OrgFamilyEventAttendanceMonthlyRow>(
      query,
      [...companies, ...companies, ORG_LENS_TIME_RANGE_DAYS['730d']],
      { expectInvalidIdentifier: ORG_EVENT_CROSS_ACCOUNT_PARTICIPANT_REF_COLUMN }
    );

    return {
      accountId: rollUpKey,
      accountName: '',
      totalAttended: rows[0]?.TOTAL_ATTENDEES ?? 0,
      totalSpeakers: rows[0]?.TOTAL_SPEAKERS ?? 0,
      attendeesMonthlyData: rows.map((row) => row.ATTENDEES ?? 0),
      speakersMonthlyData: rows.map((row) => row.SPEAKERS ?? 0),
      monthlyLabels: rows.map((row) => formatMonthLabel(row.MONTH_START_DATE)),
    };
  }
}
