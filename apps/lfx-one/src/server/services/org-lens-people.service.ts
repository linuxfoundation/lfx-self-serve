// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  DEFAULT_ORG_COMMIT_FILTERS,
  ORG_PEOPLE_ALL_ROW_COLUMNS,
  ORG_PEOPLE_FOUNDATION_OPTION_COLUMNS,
  ORG_PEOPLE_UNKNOWN_MEMBER_NAME,
  ORG_PERSON_MAINTAINER_ROLES_DEFAULT_RANGE,
  VALKEY_CACHE,
} from '@lfx-one/shared/constants';
import type {
  CompactOrgAllEmployeesRawCache,
  OrgAllEmployeesRaw,
  OrgCommitFilters,
  OrgFormerEmployeeCheck,
  OrgPeopleAllRowRaw,
  OrgPeopleFoundationOptionRow,
  OrgAllEmployeeCodeContribution,
  OrgAllEmployeeCommitteeMembership,
  OrgAllEmployeeDetail,
  OrgAllEmployeeEvent,
  OrgAllEmployeeRowInternal,
  OrgAllEmployeeTraining,
  OrgAllEmployeeTrainingStatus,
  OrgAllEmployeeVotingStatus,
  OrgAllEmployeesInternalResponse,
  OrgAllEmployeesResponse,
  OrgLensTimeRange,
  OrgPeopleDirectoryView,
  OrgPersonCodeProjectRow,
  OrgPersonCodeView,
  OrgPersonCompanyEmailRow,
  OrgProjectScope,
  OrgPersonCompanyEmailsResponse,
  OrgPersonMaintainerRoleProjectRow,
  OrgPersonSource,
} from '@lfx-one/shared/interfaces';
import { fromColumnar, hasExactColumns, isColumnarAbsent, isColumnarTable, isFilterSafeIdentifier, splitDisplayName, toColumnar } from '@lfx-one/shared/utils';
import { createHash } from 'crypto';

import { Request } from 'express';

import { orgContributorCountColumn, orgContributorsActivityPredicate, orgContributorsCommitColumns } from '../helpers/org-contributors-sql.helper';
import { orgMaintainerRoleOverlap, readMaintainerRoles } from '../helpers/org-maintainer-roles-sql.helper';
import { readOrgFormerUsernames } from '../helpers/org-people-employment.helper';
import { orgProjectScopePredicate } from '../helpers/org-project-scope-sql.helper';
import { orgTrainingEnrolledWindowPredicate } from '../helpers/org-training-sql.helper';
import { logger } from './logger.service';
import { OrgPeopleDirectoryService } from './org-people-directory.service';
import { toWireResponse } from './org-people-wire.mapper';
import { SnowflakeService } from './snowflake.service';
import { withOrgCache, withOrgCompactCache } from './valkey.service';

interface CommitteeMembershipRow {
  ACCOUNT_ID: string;
  PERSON_KEY: string;
  COMMITTEE_ID: string;
  COMMITTEE_NAME: string | null;
  COMMITTEE_TYPE: string | null;
  IS_BOARD: boolean;
  COMMITTEE_ROLE: string | null;
  VOTING_STATUS: string | null;
  FOUNDATION_ID: string | null;
  FOUNDATION_NAME: string | null;
}

interface CodeContributionRow {
  ACCOUNT_ID: string;
  PERSON_KEY: string;
  PROJECT_ID: string;
  PROJECT_NAME: string | null;
  FOUNDATION_ID: string | null;
  FOUNDATION_NAME: string | null;
  /** The person's commit credit in this project: each commit lands on one project, so these sum to the person's total. */
  TOTAL_COMMITS: number;
  /** Distinct commits the person authored in this project; a mirrored commit counts in every project it appears in. */
  PROJECT_COMMITS: number;
  LAST_ACTIVITY_DATE: Date | string | null;
}

interface EventRow {
  ACCOUNT_ID: string;
  PERSON_KEY: string;
  EVENT_ID: string;
  EVENT_NAME: string | null;
  EVENT_END_DATE: Date | string | null;
  IS_SPEAKER: boolean;
  FOUNDATION_ID: string | null;
  FOUNDATION_NAME: string | null;
}

interface TrainingRow {
  ACCOUNT_ID: string;
  PERSON_KEY: string;
  COURSE_OR_CERT_ID: string;
  STATUS: string | null;
  COURSE_ID: string | null;
  COURSE_NAME: string | null;
}

interface EmployeeActivityRaw {
  committeeRows: CommitteeMembershipRow[];
  eventRows: EventRow[];
  trainingRows: TrainingRow[];
}

/** A Code tab project before its Maintainer pill is set. */
type CodeProjectCount = Omit<OrgAllEmployeeCodeContribution, 'isMaintainer'>;

/** The Code tab's projects and the total they are shown with. */
interface CodeContributions {
  projects: CodeProjectCount[];
  total: number;
}

/** No unique identity is available — distinct from a resolved empty lookup. */
const UNAVAILABLE_COMPANY_EMAILS: OrgPersonCompanyEmailsResponse = { companyEmails: [], primaryEmail: null, companyEmailsStatus: 'unavailable' };

/** The lookup ran and errored. The rest of the detail response still renders. */
const FAILED_COMPANY_EMAILS: OrgPersonCompanyEmailsResponse = { companyEmails: [], primaryEmail: null, companyEmailsStatus: 'failed' };

/** Org Lens "People → All Employees" analytics — backed by the PLATINUM_LFX_ONE.ORG_PEOPLE_* tables. Empty rows produce an empty envelope, never a 404. */
export class OrgLensPeopleService {
  private snowflakeService: SnowflakeService;
  // Lazily constructed: OrgPeopleDirectoryService's own constructor builds an OrgLensPeopleService,
  // so eagerly instantiating it here would recurse infinitely between the two constructors.
  private directoryService: OrgPeopleDirectoryService | undefined;

  public constructor() {
    this.snowflakeService = SnowflakeService.getInstance();
  }

  /** Bundled rows + stats + foundations payload for one time range and its commit filters (`null` range: the unranged roster, which the filters do not scope); the wire projection of the internal roster. */
  public async getAllEmployees(accountId: string, range: OrgLensTimeRange | null, filters: OrgCommitFilters): Promise<OrgAllEmployeesResponse> {
    return toWireResponse(await this.getAllEmployeesInternal(accountId, range, filters.projectScope), filters);
  }

  /**
   * Internal roster with merge-only fields retained — the live directory's stored seed. A time range
   * reads that range's current employees in the project scope, each row carrying all three code counts
   * (authored commits, merged commits, code activities) for the wire projection to pick from; `null`
   * reads the unranged ORG_PEOPLE_ALL roster the reassign pickers use. The cache holds raw warehouse rows
   * and both accessors map after every read.
   */
  public async getAllEmployeesInternal(
    accountId: string,
    range: OrgLensTimeRange | null,
    projectScope: OrgProjectScope
  ): Promise<OrgAllEmployeesInternalResponse> {
    // `people-all:v4:{range}:{projectScope}` | `people-all:v4:roster` (lfx-self-serve#4164): a ranged read is
    // scoped by project and carries every code count, so one entry serves every commit scope and metric.
    const raw = await withOrgCompactCache(
      accountId,
      `people-all:v4:${range ? `${range}:${projectScope}` : 'roster'}`,
      VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
      () => this.fetchAllEmployeesRaw(accountId, range, projectScope),
      {
        encode: encodeAllEmployeesRaw,
        decode: decodeAllEmployeesRaw,
        accept: isCompactAllEmployeesRaw,
      }
    );

    return {
      accountId,
      rows: raw.rowsRaw.map((row) => this.mapEmployeeRow(row)),
      foundations: raw.foundationRaw.map((row) => ({ foundationId: row.FOUNDATION_ID, foundationName: row.FOUNDATION_NAME })),
    };
  }

  /**
   * Former employees at the account active in the time range and project scope (lfx-self-serve#4311), the
   * `IS_FORMER` rows of ORG_PEOPLE_ALL_RANGES. Only this read opts in to them, so the shared people
   * directory — and the reassign pickers that read it — never sees a former employee. Stats are
   * computed over these rows for the request's commit filters, so the tiles match the rows the "Former
   * employees" view shows. No address is sent for someone who left, and none stands in for a blank name.
   */
  public async getFormerEmployees(req: Request, accountId: string, range: OrgLensTimeRange, filters: OrgCommitFilters): Promise<OrgAllEmployeesResponse> {
    const raw = await this.getFormerEmployeesRaw(req, accountId, range, filters.projectScope);
    const rows = raw.rowsRaw.map((row) => ({ ...this.mapEmployeeRow({ ...row, NAME: formerDisplayName(row), TITLE: null, EMAIL: null }), isFormer: true }));
    return toWireResponse(
      { accountId, rows, foundations: raw.foundationRaw.map((row) => ({ foundationId: row.FOUNDATION_ID, foundationName: row.FOUNDATION_NAME })) },
      filters
    );
  }

  /**
   * Chevron-expansion detail for one person within an account: activity queries in parallel, served through the
   * shared per-org cache. Company addresses are a separate read (`getCompanyEmails`): they come from a live warehouse
   * view that takes seconds, so callers render activity without waiting for it. A code project carries the Maintainer
   * pill when the person holds a maintainer role on it overlapping `maintainerRange` (lfx-self-serve#4482) — the page
   * range for the All Employees row, the opener's range or the past 365 days for the drawer. When the roles table is
   * missing no project is pilled and the detail says so with `maintainerRolesUnavailable`.
   *
   * `codeFilters` (lfx-self-serve#4404) are the caller's page's project type and code count (the drawer's opener, or the
   * All Employees page for its expanded row): the Code projects and total are then that page's row for this person in
   * `maintainerRange`, and the detail echoes them as `codeView`. Without them the Code rows are every commit of the
   * trailing 12 months.
   */
  public async getEmployeeDetail(
    req: Request,
    accountId: string,
    personKey: string,
    maintainerRange: OrgLensTimeRange = ORG_PERSON_MAINTAINER_ROLES_DEFAULT_RANGE,
    codeFilters: OrgCommitFilters | null = null
  ): Promise<OrgAllEmployeeDetail> {
    const codeView: OrgPersonCodeView | null = codeFilters ? { range: maintainerRange, ...codeFilters } : null;
    const codeViewField = codeView ? { codeView } : {};
    // Live-only (synthetic) keys have no ORG_PEOPLE_ALL row at all — every activity query is a guaranteed-empty
    // round trip for them, so answer the empty detail without touching Snowflake.
    if (personKey.startsWith('live-')) {
      return { personKey, boardSeats: [], committeeSeats: [], code: [], totalCommits: 0, ...codeViewField, events: [], training: [] };
    }

    const [{ committeeRows, eventRows, trainingRows }, code, maintainerProjectIds] = await Promise.all([
      this.fetchEmployeeActivityRaw(accountId, personKey),
      codeView ? this.readCodeViewContributions(accountId, personKey, codeView) : this.readTrailingYearCodeContributions(accountId, personKey),
      this.fetchMaintainerProjectIds(accountId, personKey, maintainerRange),
    ]);
    const maintainerProjects = new Set(maintainerProjectIds ?? []);

    const memberships = committeeRows.map((row) => this.mapCommitteeRow(row));
    const boardSeats = memberships.filter((m) => m.isBoard);
    const committeeSeats = memberships.filter((m) => !m.isBoard);

    // EVENTS detail is grained one-row-per-(account, person, event_id) so distinct rows == the parent events_count.
    const eventsCount = eventRows.length;
    const events = eventRows.map((row) => this.mapEventRow(row, eventsCount));

    const training = this.collapseTrainingRows(trainingRows);

    return {
      personKey,
      boardSeats,
      committeeSeats,
      code: code.projects.map((project) => ({ ...project, isMaintainer: maintainerProjects.has(project.projectId) })),
      totalCommits: code.total,
      ...codeViewField,
      events,
      training,
      ...(maintainerProjectIds === null ? { maintainerRolesUnavailable: true } : {}),
    };
  }

  /**
   * Company-affiliated emails for a person identified by warehouse person key.
   *
   * A live-only (synthetic) key joins to nothing in the warehouse, so it reads on the live roster's LF
   * username instead. No username → unavailable, never "no company address".
   */
  public async getCompanyEmails(
    req: Request,
    accountId: string,
    personKey: string,
    directoryView: OrgPeopleDirectoryView | null = null
  ): Promise<OrgPersonCompanyEmailsResponse> {
    if (personKey.startsWith('live-')) {
      const username = await this.resolveLiveOnlyUsername(req, accountId, personKey, directoryView);
      return username ? this.getCompanyEmailsByUsername(req, accountId, username) : UNAVAILABLE_COMPANY_EMAILS;
    }
    return this.getCompanyEmailsForPersonKey(req, accountId, personKey);
  }

  /**
   * Company-affiliated emails for a person identified by LF username (governance surfaces).
   *
   * A username that resolves to one roster person (the same person `getEmployeeDetailByUsername` shows) reads that
   * person's addresses by person key, so an empty result is "none on record" and a NULL username on the address rows
   * cannot hide them. Any other username falls back to the address view's own username column, which also covers
   * people the roster's engagement gate excludes (most key contacts). Failures are never cached.
   */
  public async getCompanyEmailsByUsername(req: Request, accountId: string, username: string): Promise<OrgPersonCompanyEmailsResponse> {
    const normalizedUsername = username.trim().toLowerCase();
    if (!normalizedUsername) {
      return UNAVAILABLE_COMPANY_EMAILS;
    }
    try {
      const personKey = await this.resolvePersonKeyByUsername(accountId, normalizedUsername);
      if (personKey) {
        return await this.getCompanyEmailsForPersonKey(req, accountId, personKey);
      }
      const formerCheck = await this.checkFormerEmployee(req, accountId, { username: normalizedUsername });
      if (formerCheck.failed) {
        return FAILED_COMPANY_EMAILS;
      }
      if (formerCheck.isFormer) {
        return UNAVAILABLE_COMPANY_EMAILS;
      }
      return await withOrgCache(
        accountId,
        `people-username:${usernameDigest(normalizedUsername)}:emails`,
        VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
        () => this.fetchCompanyEmailsByUsername(accountId, normalizedUsername),
        isCompanyEmailsResponse,
        isCacheableCompanyEmails
      );
    } catch (error) {
      logger.warning(req, 'get_org_lens_people_company_emails_by_username', 'company email lookup failed', {
        err: error,
      });
      return FAILED_COMPANY_EMAILS;
    }
  }

  /**
   * Detail for openers that carry only an LF username (Board/Committee/Key Contact/Access; lfx-self-serve-ops#894).
   * Resolves the username with a keyed read of the account's warehouse roster (ORG_PEOPLE_ALL, a table — not the
   * address view), cached per username digest. Fails closed: null when no roster row, or more than one person key,
   * carries the username. `maintainerRange` and `codeFilters` as for {@link getEmployeeDetail}.
   */
  public async getEmployeeDetailByUsername(
    req: Request,
    accountId: string,
    username: string,
    maintainerRange: OrgLensTimeRange = ORG_PERSON_MAINTAINER_ROLES_DEFAULT_RANGE,
    codeFilters: OrgCommitFilters | null = null
  ): Promise<OrgAllEmployeeDetail | null> {
    const normalizedUsername = username.trim().toLowerCase();
    if (!normalizedUsername) {
      return null;
    }
    const personKey = await this.resolvePersonKeyByUsername(accountId, normalizedUsername);
    return personKey ? this.getEmployeeDetail(req, accountId, personKey, maintainerRange, codeFilters) : null;
  }

  /**
   * Lowercased LF usernames of the account's former employees (the widest former population: `TIME_RANGE = 'all'`,
   * `PROJECT_SCOPE = 'all'`), cached per account. A warehouse error rejects, so callers decide how to degrade.
   */
  public async getFormerUsernames(accountId: string): Promise<string[]> {
    return readOrgFormerUsernames(this.snowflakeService, accountId);
  }

  /**
   * The LF username a person key carries, for callers that need the stronger identity key but only hold a
   * key — which is every person-key drawer opener. Resolved here rather than taken from the client so the
   * username never travels in a URL, where the request logger would record it (`reqSerializer` logs the
   * path, and `redactLoggedUrl` redacts credentials, not identities).
   */
  public async resolveUsernameByPersonKey(req: Request, accountId: string, personKey: string): Promise<string | null> {
    if (personKey.startsWith('live-')) {
      return this.resolveLiveOnlyUsername(req, accountId, personKey, null);
    }
    const { username } = await withOrgCache(
      accountId,
      `people-detail:${personKey}:username`,
      VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
      () => this.fetchUsernameByPersonKey(accountId, personKey),
      isUsernameLookup
    );
    return username;
  }

  /** The username on this account's roster row for a person key; null when the row carries none. */
  private async fetchUsernameByPersonKey(accountId: string, personKey: string): Promise<{ username: string | null }> {
    const query = `
      SELECT MAX(LOWER(TRIM(LF_USERNAME))) AS LF_USERNAME
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_ALL
      WHERE ACCOUNT_ID = ? AND PERSON_KEY = ? AND LF_USERNAME IS NOT NULL AND TRIM(LF_USERNAME) <> ''
      GROUP BY ACCOUNT_ID, PERSON_KEY
      HAVING COUNT(DISTINCT LOWER(TRIM(LF_USERNAME))) = 1
    `;
    const result = await this.snowflakeService.execute<{ LF_USERNAME: string | null }>(query, [accountId, personKey]);
    return { username: result.rows[0]?.LF_USERNAME ?? null };
  }

  /** The one roster person key carrying a normalized username at this account, cached per username digest; null when none or several do. */
  private async resolvePersonKeyByUsername(accountId: string, normalizedUsername: string): Promise<string | null> {
    const { personKey } = await withOrgCache(
      accountId,
      `people-username:${usernameDigest(normalizedUsername)}:person-key`,
      VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
      () => this.fetchPersonKeyByUsername(accountId, normalizedUsername),
      isPersonKeyLookup
    );
    return personKey;
  }

  /** The one roster person key carrying the username; null when none or several do (the HAVING guard fails closed). */
  private async fetchPersonKeyByUsername(accountId: string, username: string): Promise<{ personKey: string | null }> {
    const query = `
      SELECT MIN(PERSON_KEY) AS PERSON_KEY
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_ALL
      WHERE ACCOUNT_ID = ? AND LOWER(TRIM(LF_USERNAME)) = ?
      GROUP BY ACCOUNT_ID
      HAVING COUNT(DISTINCT PERSON_KEY) = 1
    `;
    const result = await this.snowflakeService.execute<{ PERSON_KEY: string | null }>(query, [accountId, username]);
    return { personKey: result.rows[0]?.PERSON_KEY ?? null };
  }

  /**
   * Looks up a live-only person's LF username from the live roster (access/board/committee/keyContact sources). First
   * from the directory the drawer was opened from, which the page has just filled, so the lookup is a cache hit.
   * Without one, or when it does not list the key, it falls back to the narrowest (`30d`) range: the ranges are nested,
   * so someone live-only in any range is live-only in `30d` too (a stored row in `30d` would be in every wider range),
   * and their `live-` key comes from the merge key, not the range. Live-only rows are listed under `all` and `lf` only
   * (`non_lf` lists stored people alone), and the `lf` roster is inside `all`, so someone live-only anywhere is
   * live-only in `30d`/`lf` (the metric and commit scope do not change who is listed).
   */
  private async resolveLiveOnlyUsername(
    req: Request,
    accountId: string,
    personKey: string,
    directoryView: OrgPeopleDirectoryView | null
  ): Promise<string | null> {
    if (!personKey.startsWith('live-')) {
      return null;
    }
    const views: OrgPeopleDirectoryView[] = [...(directoryView ? [directoryView] : []), { range: '30d', projectScope: 'lf' }];
    for (const { range, projectScope } of views) {
      const { rows } = await this.getDirectoryService().getLive(req, accountId, range, { ...DEFAULT_ORG_COMMIT_FILTERS, projectScope });
      const username = rows.find((row) => row.personKey === personKey)?.lfUsername;
      if (username) {
        return username;
      }
    }
    return null;
  }

  private getDirectoryService(): OrgPeopleDirectoryService {
    if (!this.directoryService) {
      this.directoryService = new OrgPeopleDirectoryService();
    }
    return this.directoryService;
  }

  /** A read whose foundation labels failed is served but not stored, so the dropdown recovers on the next request. */
  private getFormerEmployeesRaw(req: Request, accountId: string, range: OrgLensTimeRange, projectScope: OrgProjectScope): Promise<OrgAllEmployeesRaw> {
    let labelsFailed = false;
    // `people-former:v3:{range}:{projectScope}` (lfx-self-serve#4164): scoped by project and carrying every
    // code count, so a `v2` entry must miss and one entry serves every commit scope and metric.
    return withOrgCache(
      accountId,
      `people-former:v3:${range}:${projectScope}`,
      VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
      async () => {
        const result = await this.fetchFormerEmployeesRaw(req, accountId, range, projectScope);
        labelsFailed = result.labelsFailed;
        return result.raw;
      },
      isFormerEmployeesRaw,
      () => !labelsFailed
    );
  }

  /**
   * Former employees' rows for the range and project scope (the EMAIL column is never selected) and the foundations
   * of their code in that scope. The labels read the full-history daily code rows, the source of the rows'
   * ENGAGED_FOUNDATION_IDS, so a foundation they only contributed to years ago still has one for `all`. A failed
   * roster read fails the request; a failed label read only empties the dropdown (`labelsFailed`).
   */
  private async fetchFormerEmployeesRaw(
    req: Request,
    accountId: string,
    range: OrgLensTimeRange,
    projectScope: OrgProjectScope
  ): Promise<{ raw: OrgAllEmployeesRaw; labelsFailed: boolean }> {
    const rowsQuery = `
      SELECT
        ACCOUNT_ID,
        PERSON_KEY,
        LFID,
        LF_USERNAME,
        CDP_MEMBER_ID,
        NAME,
        NULL AS TITLE,
        NULL AS EMAIL,
        PHOTO,
        SEATS_COUNT,
        BOARD_SEATS_COUNT,
        COMMITTEE_SEATS_COUNT,
        COMMITS_COUNT,
        MERGED_COMMITS_COUNT,
        CODE_ACTIVITIES_COUNT,
        EVENTS_COUNT,
        COURSES_COUNT,
        ENGAGED_FOUNDATION_IDS
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_ALL_RANGES
      WHERE ACCOUNT_ID = ? AND TIME_RANGE = ? AND PROJECT_SCOPE = ? AND IS_FORMER = TRUE
      ORDER BY NAME ASC NULLS LAST
    `;

    const foundationQuery = `
      SELECT DISTINCT c.FOUNDATION_ID, c.FOUNDATION_NAME
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_CONTRIBUTORS_DAILY c
      INNER JOIN ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_ALL_RANGES f
        ON f.ACCOUNT_ID = c.ACCOUNT_ID AND f.PERSON_KEY = c.PERSON_KEY
      WHERE c.ACCOUNT_ID = ? AND f.TIME_RANGE = ? AND f.PROJECT_SCOPE = ? AND f.IS_FORMER = TRUE
        AND c.FOUNDATION_ID IS NOT NULL AND c.FOUNDATION_NAME IS NOT NULL
        ${orgProjectScopePredicate(projectScope, 'c.IS_LF_PROJECT')}
      ORDER BY c.FOUNDATION_NAME ASC
    `;

    const [rowsResult, foundationResult] = await Promise.allSettled([
      this.snowflakeService.execute<OrgPeopleAllRowRaw>(rowsQuery, [accountId, range, projectScope]),
      this.snowflakeService.execute<OrgPeopleFoundationOptionRow>(foundationQuery, [accountId, range, projectScope]),
    ]);
    if (rowsResult.status === 'rejected') {
      throw rowsResult.reason;
    }
    if (foundationResult.status === 'rejected') {
      logger.warning(req, 'get_org_lens_people_former', 'former employee foundation labels failed; serving rows without labels', {
        err: foundationResult.reason,
      });
      return { raw: { rowsRaw: rowsResult.value.rows, foundationRaw: [] }, labelsFailed: true };
    }
    return { raw: { rowsRaw: rowsResult.value.rows, foundationRaw: foundationResult.value.rows }, labelsFailed: false };
  }

  /**
   * A former employee's company addresses are never read: they left, and the address model covers the
   * account's current people only. Checked against the widest former population (`TIME_RANGE = 'all'`,
   * `PROJECT_SCOPE = 'all'`), whatever range and scope the caller is viewing. One keyed read per person,
   * cached per person. A failed read answers `failed` so callers fail closed without reading any address,
   * and is not cached, so a warehouse blip does not outlive the request.
   */
  private async checkFormerEmployee(req: Request, accountId: string, identity: { personKey: string } | { username: string }): Promise<OrgFormerEmployeeCheck> {
    const byPersonKey = 'personKey' in identity;
    const fetcher = async (): Promise<OrgFormerEmployeeCheck> => {
      try {
        const result = await this.snowflakeService.execute<{ IS_FORMER: number }>(
          `
            SELECT 1 AS IS_FORMER
            FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_ALL_RANGES
            WHERE ACCOUNT_ID = ? AND TIME_RANGE = 'all' AND PROJECT_SCOPE = 'all' AND IS_FORMER = TRUE
              AND ${byPersonKey ? 'PERSON_KEY = ?' : 'LOWER(TRIM(LF_USERNAME)) = ?'}
            LIMIT 1
          `,
          [accountId, byPersonKey ? identity.personKey : identity.username]
        );
        return { isFormer: result.rows.length > 0, failed: false };
      } catch (error) {
        logger.warning(req, 'get_org_lens_people_former_lookup', 'former employee lookup failed', { err: error });
        return { isFormer: false, failed: true };
      }
    };
    if (byPersonKey && !isFilterSafeIdentifier(identity.personKey)) {
      return fetcher();
    }
    // `v3` (lfx-self-serve#4164): ORG_PEOPLE_ALL_RANGES gained a PROJECT_SCOPE grain; the check reads the `all` scope.
    const key = byPersonKey ? `people-former-check:v3:${identity.personKey}` : `people-former-check:v3:username:${usernameDigest(identity.username)}`;
    return withOrgCache(accountId, key, VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS, fetcher, isFormerCheck, (check) => !check.failed);
  }

  /**
   * Two parallel Snowflake reads returning raw rows (the current employees, and the foundation pairs);
   * mapping happens after the cache read. A range reads that range's current rows of
   * ORG_PEOPLE_ALL_RANGES in the project scope, with all three code counts; `null` reads the unranged
   * ORG_PEOPLE_ALL roster, whose one code count stands in for all three.
   */
  private async fetchAllEmployeesRaw(accountId: string, range: OrgLensTimeRange | null, projectScope: OrgProjectScope): Promise<OrgAllEmployeesRaw> {
    const source = range
      ? {
          from: 'ORG_PEOPLE_ALL_RANGES',
          counts: 'COMMITS_COUNT, MERGED_COMMITS_COUNT, CODE_ACTIVITIES_COUNT',
          where: 'ACCOUNT_ID = ? AND TIME_RANGE = ? AND PROJECT_SCOPE = ? AND IS_FORMER = FALSE',
          binds: [accountId, range, projectScope],
        }
      : {
          from: 'ORG_PEOPLE_ALL',
          counts: 'COMMITS_COUNT, COMMITS_COUNT AS MERGED_COMMITS_COUNT, COMMITS_COUNT AS CODE_ACTIVITIES_COUNT',
          where: 'ACCOUNT_ID = ?',
          binds: [accountId],
        };
    const rowsQuery = `
      SELECT
        ACCOUNT_ID,
        PERSON_KEY,
        LFID,
        LF_USERNAME,
        CDP_MEMBER_ID,
        NAME,
        TITLE,
        EMAIL,
        PHOTO,
        SEATS_COUNT,
        BOARD_SEATS_COUNT,
        COMMITTEE_SEATS_COUNT,
        ${source.counts},
        EVENTS_COUNT,
        COURSES_COUNT,
        ENGAGED_FOUNDATION_IDS
      FROM ANALYTICS.PLATINUM_LFX_ONE.${source.from}
      WHERE ${source.where}
      ORDER BY NAME ASC NULLS LAST
    `;

    // Distinct (foundation_id, foundation_name) pairs across the four detail sources; keeps the BFF confined to PLATINUM_LFX_ONE.
    // Code labels read the full-history daily code rows (ENGAGED_FOUNDATION_IDS' code source), not the 12-month
    // ORG_PEOPLE_CODE_CONTRIBUTIONS, so an `all` range keeps a label for code older than a year.
    const foundationQuery = `
      WITH pairs AS (
        SELECT DISTINCT FOUNDATION_ID, FOUNDATION_NAME
        FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_COMMITTEE_MEMBERSHIP
        WHERE ACCOUNT_ID = ? AND FOUNDATION_ID IS NOT NULL AND FOUNDATION_NAME IS NOT NULL
        UNION
        SELECT DISTINCT FOUNDATION_ID, FOUNDATION_NAME
        FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_CONTRIBUTORS_DAILY
        WHERE ACCOUNT_ID = ? AND FOUNDATION_ID IS NOT NULL AND FOUNDATION_NAME IS NOT NULL
        UNION
        SELECT DISTINCT FOUNDATION_ID, FOUNDATION_NAME
        FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_EVENTS
        WHERE ACCOUNT_ID = ? AND FOUNDATION_ID IS NOT NULL AND FOUNDATION_NAME IS NOT NULL
        UNION
        SELECT DISTINCT FOUNDATION_ID, FOUNDATION_NAME
        FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_TRAINING
        WHERE ACCOUNT_ID = ? AND FOUNDATION_ID IS NOT NULL AND FOUNDATION_NAME IS NOT NULL
      )
      SELECT FOUNDATION_ID, FOUNDATION_NAME
      FROM pairs
      ORDER BY FOUNDATION_NAME ASC
    `;

    const [rowsResult, foundationResult] = await Promise.all([
      this.snowflakeService.execute<OrgPeopleAllRowRaw>(rowsQuery, source.binds),
      this.snowflakeService.execute<OrgPeopleFoundationOptionRow>(foundationQuery, [accountId, accountId, accountId, accountId]),
    ]);

    return { rowsRaw: rowsResult.rows, foundationRaw: foundationResult.rows };
  }

  private mapEmployeeRow(row: OrgPeopleAllRowRaw): OrgAllEmployeeRowInternal {
    const name = cleanDisplayName(row.NAME, row.EMAIL);
    const [firstName, lastName] = splitDisplayName(name);
    return {
      personKey: row.PERSON_KEY,
      lfid: row.LFID,
      lfUsername: (row.LF_USERNAME ?? '').trim().toLowerCase() || null,
      cdpMemberId: row.CDP_MEMBER_ID,
      name,
      firstName,
      lastName,
      title: row.TITLE,
      email: row.EMAIL,
      emails: row.EMAIL ? [row.EMAIL.trim().toLowerCase()] : [],
      avatarUrl: row.PHOTO ?? null,
      sources: ['snowflake'] as OrgPersonSource[],
      seatsCount: row.SEATS_COUNT ?? 0,
      boardSeatsCount: row.BOARD_SEATS_COUNT ?? 0,
      committeeSeatsCount: row.COMMITTEE_SEATS_COUNT ?? 0,
      commitsCount: row.COMMITS_COUNT ?? 0,
      mergedCommitsCount: row.MERGED_COMMITS_COUNT ?? 0,
      codeActivitiesCount: row.CODE_ACTIVITIES_COUNT ?? 0,
      eventsCount: row.EVENTS_COUNT ?? 0,
      coursesCount: row.COURSES_COUNT ?? 0,
      engagedFoundationIds: this.parseFoundationIdArray(row.ENGAGED_FOUNDATION_IDS),
    };
  }

  /**
   * Committee, event and training rows. `v5`: the code rows moved to their own reads, which follow the opener's code
   * filters (lfx-self-serve#4404), so a `v4` entry must miss.
   */
  private fetchEmployeeActivityRaw(accountId: string, personKey: string): Promise<EmployeeActivityRaw> {
    return this.withPersonCache(
      accountId,
      personKey,
      `people-detail:v5:${personKey}`,
      () => this.runEmployeeActivityFetch(accountId, personKey),
      isEmployeeActivityRaw
    );
  }

  private async runEmployeeActivityFetch(accountId: string, personKey: string): Promise<EmployeeActivityRaw> {
    const [committeeRows, eventRows, trainingRows] = await Promise.all([
      this.fetchCommitteeMembershipRows(accountId, personKey),
      this.fetchEventRows(accountId, personKey),
      this.fetchTrainingRows(accountId, personKey),
    ]);
    return { committeeRows, eventRows, trainingRows };
  }

  /** The Code tab without opener filters: every commit of the trailing 12 months (ORG_PEOPLE_CODE_CONTRIBUTIONS). */
  private async readTrailingYearCodeContributions(accountId: string, personKey: string): Promise<CodeContributions> {
    const rows = await this.withPersonCache(
      accountId,
      personKey,
      `people-detail-code:v1:${personKey}`,
      () => this.fetchCodeContributionRows(accountId, personKey),
      isCodeContributionRows
    );
    return {
      projects: rows.map((row) => toCodeProjectCount(row, row.PROJECT_COMMITS, row.LAST_ACTIVITY_DATE)),
      // The per-project counts overlap on mirrored commits; the total sums the per-person credit instead.
      total: rows.reduce((sum, row) => sum + (row.TOTAL_COMMITS ?? 0), 0),
    };
  }

  /**
   * The Code tab in the opener's view: this person's People → Contributors project rows for the range and project
   * scope, each counting what the view's commit filters pick, sorted as that tab's expanded row is (count, then last
   * activity, then name). Each row credits a commit to one project in the scope, so they sum to the person's row count —
   * the Contributors and All Employees (ORG_PEOPLE_ALL_RANGES sums the same columns) row. One cache entry per range and
   * scope carries every count, so it serves every code-count option.
   */
  private async readCodeViewContributions(accountId: string, personKey: string, view: OrgPersonCodeView): Promise<CodeContributions> {
    const rows = await this.withPersonCache(
      accountId,
      personKey,
      `people-detail-code-view:v1:${personKey}:${view.range}:${view.projectScope}`,
      () => this.fetchCodeViewRows(accountId, personKey, view.range, view.projectScope),
      isCodeContributionRows
    );
    const column = orgContributorCountColumn(view);
    const projects = rows
      .map((row) => toCodeProjectCount(row, row[column], row.LAST_ACTIVE_DATE))
      .sort(
        (a, b) =>
          b.commits - a.commits ||
          (b.lastActivityDate ?? '').localeCompare(a.lastActivityDate ?? '') ||
          a.projectName.localeCompare(b.projectName) ||
          a.projectId.localeCompare(b.projectId)
      );
    return { projects, total: projects.reduce((sum, project) => sum + project.commits, 0) };
  }

  /** People → Contributors' per-(person, project) aggregate, for one person: same table, window, scope and columns. */
  private async fetchCodeViewRows(
    accountId: string,
    personKey: string,
    range: OrgLensTimeRange,
    projectScope: OrgProjectScope
  ): Promise<OrgPersonCodeProjectRow[]> {
    const columns = orgContributorsCommitColumns(projectScope);
    const query = `
      SELECT
        project_id AS PROJECT_ID,
        MAX(project_name) AS PROJECT_NAME,
        MAX(foundation_id) AS FOUNDATION_ID,
        MAX(foundation_name) AS FOUNDATION_NAME,
        SUM(${columns.commits}) AS COMMITS,
        SUM(${columns.mergedCommits}) AS MERGED_COMMITS,
        SUM(daily_code_activities) AS CODE_ACTIVITIES,
        MAX(activity_date) AS LAST_ACTIVE_DATE
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_CONTRIBUTORS_DAILY
      WHERE account_id = ? AND person_key = ?
        ${orgContributorsActivityPredicate(range)}
        ${orgProjectScopePredicate(projectScope)}
      GROUP BY project_id
    `;
    const result = await this.snowflakeService.execute<OrgPersonCodeProjectRow>(query, [accountId, personKey]);
    return result.rows;
  }

  /** A non-filter-safe personKey bypasses the shared cache to keep the key namespace intact. */
  private withPersonCache<T>(accountId: string, personKey: string, key: string, fetcher: () => Promise<T>, accept: (value: unknown) => boolean): Promise<T> {
    return isFilterSafeIdentifier(personKey) ? withOrgCache(accountId, key, VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS, fetcher, accept) : fetcher();
  }

  /**
   * Projects in which the person holds a maintainer role overlapping the range; cached per (person, range) like the
   * activity rows. `null` (roles table missing) is unavailable — no pill — and is never stored.
   */
  private async fetchMaintainerProjectIds(accountId: string, personKey: string, range: OrgLensTimeRange): Promise<string[] | null> {
    if (!isFilterSafeIdentifier(personKey)) {
      return this.runMaintainerProjectIdsFetch(accountId, personKey, range);
    }
    return withOrgCache(
      accountId,
      `people-detail-roles:v1:${personKey}:${range}`,
      VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
      () => this.runMaintainerProjectIdsFetch(accountId, personKey, range),
      (value) => Array.isArray(value) && value.every((projectId) => typeof projectId === 'string'),
      (value) => value !== null
    );
  }

  private async runMaintainerProjectIdsFetch(accountId: string, personKey: string, range: OrgLensTimeRange): Promise<string[] | null> {
    const overlap = orgMaintainerRoleOverlap(range);
    const query = `
      SELECT DISTINCT PROJECT_ID
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_MAINTAINER_ROLES
      WHERE ACCOUNT_ID = ? AND PERSON_KEY = ?
        AND ${overlap.sql}
    `;
    const rows = await readMaintainerRoles<OrgPersonMaintainerRoleProjectRow>(this.snowflakeService, 'ORG_MAINTAINER_ROLES', query, [
      accountId,
      personKey,
      ...overlap.binds,
    ]);
    return rows?.map((row) => row.PROJECT_ID) ?? null;
  }

  /**
   * A failure is answered as `failed` and is never cached.
   *
   * A `cdp:` person key (no Salesforce identity to join on) and a former employee of the account
   * short-circuit to `unavailable` before the cache: not available, never "none on record". A failed
   * former check answers `failed` before the cache too: no address is read for someone who may have left.
   */
  private async getCompanyEmailsForPersonKey(req: Request, accountId: string, personKey: string): Promise<OrgPersonCompanyEmailsResponse> {
    if (personKey.startsWith('cdp:')) {
      return UNAVAILABLE_COMPANY_EMAILS;
    }
    const formerCheck = await this.checkFormerEmployee(req, accountId, { personKey });
    if (formerCheck.failed) {
      return FAILED_COMPANY_EMAILS;
    }
    if (formerCheck.isFormer) {
      return UNAVAILABLE_COMPANY_EMAILS;
    }
    const fetcher = async (): Promise<OrgPersonCompanyEmailsResponse> => ({
      ...toCompanyEmails(await this.fetchCompanyEmails(accountId, personKey)),
      companyEmailsStatus: 'resolved',
    });
    try {
      if (!isFilterSafeIdentifier(personKey)) {
        return await fetcher();
      }
      return await withOrgCache(
        accountId,
        `people-company-emails:${personKey}`,
        VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
        fetcher,
        isCompanyEmailsResponse,
        isCacheableCompanyEmails
      );
    } catch (error) {
      logger.warning(req, 'get_org_lens_people_company_emails', 'company email lookup failed', {
        person_key: personKey,
        err: error,
      });
      return FAILED_COMPANY_EMAILS;
    }
  }

  /**
   * The person's company-affiliated addresses at this account. Inclusion rules live in the warehouse
   * model; this is a plain keyed read with no cap.
   *
   * Keyed on identity only. Resolving a person from an address is prohibited: that direction contains
   * false links and would attribute one person's addresses to another.
   */
  private async fetchCompanyEmails(accountId: string, personKey: string): Promise<OrgPersonCompanyEmailRow[]> {
    const query = `
      SELECT EMAIL, IS_PRIMARY
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_COMPANY_EMAILS
      WHERE ACCOUNT_ID = ? AND PERSON_KEY = ?
      -- NULLS LAST is explicit: Snowflake sorts NULL above non-NULL on DESC, which would put an
      -- unflagged address ahead of the primary and break the primary-first contract.
      ORDER BY IS_PRIMARY DESC NULLS LAST, EMAIL ASC
    `;
    const result = await this.snowflakeService.execute<OrgPersonCompanyEmailRow>(query, [accountId, personKey]);
    return result.rows;
  }

  /**
   * As above, keyed on LF username for the governance surfaces (Board, Committee, Key Contacts, Access).
   *
   * Reads only the materialized address table; identity is never re-resolved against the spine view at
   * request time. The HAVING guard fails closed if two people collide after normalization. Zero rows is
   * `unavailable`, never "none on record": this read cannot tell a known person without addresses from
   * an unknown username.
   */
  private async fetchCompanyEmailsByUsername(accountId: string, username: string): Promise<OrgPersonCompanyEmailsResponse> {
    const query = `
      WITH resolved_person AS (
        SELECT ACCOUNT_ID, MIN(PERSON_KEY) AS PERSON_KEY
        FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_COMPANY_EMAILS
        WHERE ACCOUNT_ID = ? AND LOWER(TRIM(LF_USERNAME)) = ?
        GROUP BY ACCOUNT_ID
        HAVING COUNT(DISTINCT PERSON_KEY) = 1
      )
      SELECT emails.EMAIL, emails.IS_PRIMARY
      FROM resolved_person AS person
      INNER JOIN ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_COMPANY_EMAILS AS emails
        ON emails.ACCOUNT_ID = person.ACCOUNT_ID AND emails.PERSON_KEY = person.PERSON_KEY
      ORDER BY emails.IS_PRIMARY DESC NULLS LAST, emails.EMAIL ASC
    `;
    const result = await this.snowflakeService.execute<OrgPersonCompanyEmailRow>(query, [accountId, username]);
    const resolved = toCompanyEmails(result.rows);
    if (resolved.companyEmails.length === 0) {
      return UNAVAILABLE_COMPANY_EMAILS;
    }
    return { ...resolved, companyEmailsStatus: 'resolved' };
  }

  private async fetchCommitteeMembershipRows(accountId: string, personKey: string): Promise<CommitteeMembershipRow[]> {
    const query = `
      SELECT
        ACCOUNT_ID,
        PERSON_KEY,
        COMMITTEE_ID,
        COMMITTEE_NAME,
        COMMITTEE_TYPE,
        IS_BOARD,
        COMMITTEE_ROLE,
        VOTING_STATUS,
        FOUNDATION_ID,
        FOUNDATION_NAME
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_COMMITTEE_MEMBERSHIP
      WHERE ACCOUNT_ID = ? AND PERSON_KEY = ?
      ORDER BY IS_BOARD DESC, COMMITTEE_NAME ASC NULLS LAST
    `;
    const result = await this.snowflakeService.execute<CommitteeMembershipRow>(query, [accountId, personKey]);
    return result.rows;
  }

  private async fetchCodeContributionRows(accountId: string, personKey: string): Promise<CodeContributionRow[]> {
    const query = `
      SELECT
        ACCOUNT_ID,
        PERSON_KEY,
        PROJECT_ID,
        PROJECT_NAME,
        FOUNDATION_ID,
        FOUNDATION_NAME,
        TOTAL_COMMITS,
        PROJECT_COMMITS,
        LAST_ACTIVITY_DATE
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_CODE_CONTRIBUTIONS
      WHERE ACCOUNT_ID = ? AND PERSON_KEY = ?
      ORDER BY PROJECT_COMMITS DESC NULLS LAST, PROJECT_NAME ASC NULLS LAST
    `;
    const result = await this.snowflakeService.execute<CodeContributionRow>(query, [accountId, personKey]);
    return result.rows;
  }

  private async fetchEventRows(accountId: string, personKey: string): Promise<EventRow[]> {
    const query = `
      SELECT
        ACCOUNT_ID,
        PERSON_KEY,
        EVENT_ID,
        EVENT_NAME,
        EVENT_END_DATE,
        IS_SPEAKER,
        FOUNDATION_ID,
        FOUNDATION_NAME
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_EVENTS
      WHERE ACCOUNT_ID = ? AND PERSON_KEY = ?
      ORDER BY EVENT_END_DATE DESC NULLS LAST, EVENT_NAME ASC NULLS LAST
    `;
    const result = await this.snowflakeService.execute<EventRow>(query, [accountId, personKey]);
    return result.rows;
  }

  /** Certificates of any age, enrollments from the last 12 months only (the window the drawer has always shown). */
  private async fetchTrainingRows(accountId: string, personKey: string): Promise<TrainingRow[]> {
    const query = `
      SELECT
        ACCOUNT_ID,
        PERSON_KEY,
        COURSE_OR_CERT_ID,
        STATUS,
        COURSE_ID,
        COURSE_NAME
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_TRAINING
      WHERE ACCOUNT_ID = ? AND PERSON_KEY = ?
        AND (STATUS = 'Certified' OR (${orgTrainingEnrolledWindowPredicate()}))
      ORDER BY STATUS ASC NULLS LAST, COURSE_NAME ASC NULLS LAST
    `;
    const result = await this.snowflakeService.execute<TrainingRow>(query, [accountId, personKey]);
    return result.rows;
  }

  private mapCommitteeRow(row: CommitteeMembershipRow): OrgAllEmployeeCommitteeMembership {
    return {
      committeeId: row.COMMITTEE_ID,
      committeeName: row.COMMITTEE_NAME ?? row.COMMITTEE_ID,
      foundationId: row.FOUNDATION_ID ?? '',
      foundationName: row.FOUNDATION_NAME ?? '',
      committeeRole: row.COMMITTEE_ROLE ?? '',
      votingStatus: mapVotingStatus(row.VOTING_STATUS),
      isBoard: row.IS_BOARD === true,
    };
  }

  private mapEventRow(row: EventRow, eventsCount: number): OrgAllEmployeeEvent {
    return {
      eventId: row.EVENT_ID,
      eventName: row.EVENT_NAME ?? row.EVENT_ID,
      foundationId: row.FOUNDATION_ID ?? '',
      foundationName: row.FOUNDATION_NAME ?? '',
      isSpeaker: row.IS_SPEAKER === true,
      eventsCount,
      lastEventEndDate: toDateString(row.EVENT_END_DATE),
    };
  }

  /**
   * One drawer row per course (`COURSE_ID`, else `COURSE_OR_CERT_ID`), Certified superseding Enrolled: since
   * lf-dbt#3118 a person can carry a certificate row and a later re-enrollment row for the same course. Counts are
   * over the collapsed rows, so they match what renders.
   */
  private collapseTrainingRows(trainingRows: TrainingRow[]): OrgAllEmployeeTraining[] {
    const byCourse = new Map<string, TrainingRow>();
    for (const row of trainingRows) {
      const courseId = row.COURSE_ID ?? row.COURSE_OR_CERT_ID;
      if (!courseId) {
        continue;
      }
      const kept = byCourse.get(courseId);
      if (!kept || (kept.STATUS !== 'Certified' && row.STATUS === 'Certified')) {
        byCourse.set(courseId, row);
      }
    }
    const rows = [...byCourse.values()];
    const certificationsCount = rows.filter((row) => row.STATUS === 'Certified').length;
    return rows.map((row) => this.mapTrainingRow(row, rows.length, certificationsCount));
  }

  private mapTrainingRow(row: TrainingRow, coursesCount: number, certificationsCount: number): OrgAllEmployeeTraining {
    const status: OrgAllEmployeeTrainingStatus = row.STATUS === 'Certified' ? 'Certified' : 'Enrolled';
    return {
      courseId: row.COURSE_ID ?? row.COURSE_OR_CERT_ID,
      courseName: row.COURSE_NAME ?? row.COURSE_ID ?? row.COURSE_OR_CERT_ID,
      status,
      certificationsCount,
      coursesCount,
    };
  }

  /** Snowflake ARRAY may arrive as a JSON string or an already-parsed array depending on driver config. */
  private parseFoundationIdArray(raw: string | string[] | null | undefined): string[] {
    if (!raw) return [];
    if (Array.isArray(raw)) {
      return raw.filter((id): id is string => typeof id === 'string' && id.length > 0);
    }
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((id): id is string => typeof id === 'string' && id.length > 0);
      }
    } catch {
      // single-value fall-through
    }
    return typeof raw === 'string' && raw.length > 0 ? [raw] : [];
  }
}

/** A former employee's NAME can be an email address; never surface it, falling back to their LF username or the generic label. */
function formerDisplayName(row: OrgPeopleAllRowRaw): string | null {
  if (!row.NAME?.includes('@')) {
    return row.NAME;
  }
  return (row.LF_USERNAME ?? '').trim() || ORG_PEOPLE_UNKNOWN_MEMBER_NAME;
}

/** Upstream occasionally carries bracketed placeholder names (e.g. "[[Unknown]] [[unknown]]") or a blank name; surface the email instead so the row stays identifiable, with a generic label only when no email exists. */
function cleanDisplayName(rawName: string | null, email: string | null): string {
  const name = (rawName ?? '').trim();
  const isPlaceholder = name === '' || /\[\[[^\]]*\]\]/.test(name);
  if (!isPlaceholder) {
    return name;
  }
  return (email ?? '').trim() || ORG_PEOPLE_UNKNOWN_MEMBER_NAME;
}

/**
 * Compacts the raw reads for Valkey storage (GH-1906). The roster is the bulk of the payload
 * — well past the 1 MiB write cap at the largest org measured, so it was never actually stored —
 * and almost half of that was the same 15 uppercase warehouse column names repeated on every row.
 * Columnar storage carries them once.
 */
function encodeAllEmployeesRaw(raw: OrgAllEmployeesRaw): CompactOrgAllEmployeesRawCache {
  return {
    // The roster query filters on ACCOUNT_ID, so every row carries the same value — stored once
    // here and put back on each row at decode. Normalized to null when the rows don't carry it at
    // all: an entry rejected for a missing hoisted field would be a cache that silently never
    // hits, which is the exact failure this compaction exists to remove.
    accountId: raw.rowsRaw.length ? (raw.rowsRaw[0].ACCOUNT_ID ?? null) : null,
    // `ENGAGED_FOUNDATION_IDS` is stored exactly as the driver returned it (a JSON string or a
    // parsed array) so `parseFoundationIdArray` sees the same input it would on a cache miss.
    rowsRaw: toColumnar(raw.rowsRaw, ORG_PEOPLE_ALL_ROW_COLUMNS),
    foundationRaw: toColumnar(raw.foundationRaw, ORG_PEOPLE_FOUNDATION_OPTION_COLUMNS),
  };
}

/** Rebuilds the raw rows {@link encodeAllEmployeesRaw} stored, so both accessors map exactly what a cache miss would hand them. */
function decodeAllEmployeesRaw(value: CompactOrgAllEmployeesRawCache): OrgAllEmployeesRaw {
  const rowsRaw = fromColumnar<OrgPeopleAllRowRaw>(value.rowsRaw);
  if (value.accountId !== null) {
    for (const row of rowsRaw) {
      row.ACCOUNT_ID = value.accountId;
    }
  }
  return {
    rowsRaw,
    foundationRaw: fromColumnar<OrgPeopleFoundationOptionRow>(value.foundationRaw),
  };
}

function isCompactAllEmployeesRaw(value: unknown): boolean {
  const cache = value as Partial<CompactOrgAllEmployeesRawCache> | null;
  if (
    !cache ||
    typeof cache !== 'object' ||
    (cache.accountId !== null && typeof cache.accountId !== 'string') ||
    !isColumnarTable(cache.rowsRaw) ||
    !isColumnarTable(cache.foundationRaw) ||
    // Exact columns, not `includes`: a duplicated, extra, reordered or short-rowed entry decodes
    // "successfully" into rows missing data the writer always emits, which is worse than a miss.
    // This is a SHAPE check only — the per-cell value checks below are separate and necessary.
    !hasExactColumns(cache.rowsRaw, ORG_PEOPLE_ALL_ROW_COLUMNS) ||
    !hasExactColumns(cache.foundationRaw, ORG_PEOPLE_FOUNDATION_OPTION_COLUMNS)
  ) {
    return false;
  }
  // Exact columns prove the SHAPE; this proves the VALUE, and both are needed. The pre-compaction
  // guard asserted per row that LF_USERNAME is present and either null or a string; a column-name
  // check alone would let a current-shape entry holding a number or an object there through, and
  // `mapEmployeeRow` would then call `.trim()` on it — turning a cache HIT into a 500 rather than a
  // miss. Absence is rejected for the same reason it was before: a row mapped to a null username
  // silently returns the people directory to email-only matching for the rest of the TTL.
  const usernameIndex = ORG_PEOPLE_ALL_ROW_COLUMNS.indexOf('LF_USERNAME');
  return cache.rowsRaw.r.every((row) => {
    const username = row[usernameIndex];
    return username === null || (typeof username === 'string' && !isColumnarAbsent(username));
  });
}

function isEmployeeActivityRaw(value: unknown): boolean {
  const v = value as Partial<Record<keyof EmployeeActivityRaw, unknown>> | null;
  return !!v && Array.isArray(v.committeeRows) && Array.isArray(v.eventRows) && Array.isArray(v.trainingRows);
}

/** A stored code read: an array of project rows, each keyed by a project id. */
function isCodeContributionRows(value: unknown): boolean {
  return Array.isArray(value) && value.every((row: unknown) => !!row && typeof row === 'object' && 'PROJECT_ID' in row && typeof row.PROJECT_ID === 'string');
}

/** One Code tab project from either code read, counting `count` (a missing count is 0). */
function toCodeProjectCount(
  row: Pick<CodeContributionRow, 'PROJECT_ID' | 'PROJECT_NAME' | 'FOUNDATION_ID' | 'FOUNDATION_NAME'>,
  count: number | null,
  lastActivityDate: Date | string | null
): CodeProjectCount {
  return {
    projectId: row.PROJECT_ID,
    projectName: row.PROJECT_NAME ?? row.PROJECT_ID,
    foundationId: row.FOUNDATION_ID ?? '',
    foundationName: row.FOUNDATION_NAME ?? '',
    commits: count ?? 0,
    lastActivityDate: toDateString(lastActivityDate),
  };
}

function isFormerEmployeesRaw(value: unknown): boolean {
  const v = value as { rowsRaw?: unknown; foundationRaw?: unknown } | null;
  return !!v && Array.isArray(v.rowsRaw) && Array.isArray(v.foundationRaw);
}

function isFormerCheck(value: unknown): boolean {
  return !!value && typeof value === 'object' && 'isFormer' in value && typeof value.isFormer === 'boolean' && 'failed' in value && value.failed === false;
}

/** Failed lookups are never cached: a transient warehouse error must not hide addresses for the full TTL. `unavailable` is a stable property and is cacheable. */
function isCacheableCompanyEmails(value: OrgPersonCompanyEmailsResponse): boolean {
  return value.companyEmailsStatus !== 'failed';
}

/** Cached username → person-key lookups: a key, or a stable `null` when no single roster person carries the username. */
function isPersonKeyLookup(value: unknown): boolean {
  const lookup = value as { personKey?: unknown } | null;
  return !!lookup && (lookup.personKey === null || typeof lookup.personKey === 'string');
}

/** Cached person-key → username lookups: a username, or a stable `null` when the roster row carries none. */
function isUsernameLookup(value: unknown): boolean {
  const lookup = value as { username?: unknown } | null;
  return !!lookup && (lookup.username === null || typeof lookup.username === 'string');
}

/** Hashed so a raw username is never a `:`-delimited cache-key segment. */
function usernameDigest(normalizedUsername: string): string {
  return createHash('sha256').update(normalizedUsername).digest('hex').slice(0, 16);
}

/**
 * Split the warehouse rows into the ordered address list plus the primary. `IS_PRIMARY` is advisory:
 * the list order already comes from the query, and a person with no primary flagged simply has none.
 */
function toCompanyEmails(rows: OrgPersonCompanyEmailRow[]): { companyEmails: string[]; primaryEmail: string | null } {
  const named = rows.filter((row): row is OrgPersonCompanyEmailRow & { EMAIL: string } => !!row.EMAIL);
  return {
    companyEmails: named.map((row) => row.EMAIL),
    primaryEmail: named.find((row) => row.IS_PRIMARY === true || row.IS_PRIMARY === 1)?.EMAIL ?? null,
  };
}

/** Reject legacy/failed cache entries; unavailable identities cannot carry addresses. */
function isCompanyEmailsResponse(value: unknown): boolean {
  const response = value as Partial<OrgPersonCompanyEmailsResponse> | null;
  return (
    !!response &&
    Array.isArray(response.companyEmails) &&
    response.companyEmails.every((email) => typeof email === 'string') &&
    // Written before `primaryEmail` existed → undefined, and read as "no primary on record".
    (response.primaryEmail === undefined || response.primaryEmail === null || typeof response.primaryEmail === 'string') &&
    (response.companyEmailsStatus === 'resolved' || (response.companyEmailsStatus === 'unavailable' && response.companyEmails.length === 0))
  );
}

/** Narrow upstream free-text voting status to the three badges; unknown values collapse to 'Non-voting'. */
function mapVotingStatus(raw: string | null): OrgAllEmployeeVotingStatus {
  if (!raw) return 'Non-voting';
  const normalized = raw.trim();
  if (normalized === 'Voting Rep' || normalized === 'Voting') return 'Voting';
  if (normalized === 'Observer') return 'Observer';
  return 'Non-voting';
}

/** Normalize Snowflake `Date | string | null` to an ISO `YYYY-MM-DD` string, or null when missing/unparseable; mirrors ProjectService.toIsoDate so non-ISO strings can't leak "Invalid Da" garbage to the client. */
function toDateString(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === 'string') {
    const match = value.match(/^\d{4}-\d{2}-\d{2}/);
    if (match) return match[0];
  }
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}
