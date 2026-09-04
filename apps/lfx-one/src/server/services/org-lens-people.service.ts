// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { EMPTY_ORG_ALL_EMPLOYEE_STATS, VALKEY_CACHE } from '@lfx-one/shared/constants';
import type {
  OrgAllEmployeeCodeContribution,
  OrgAllEmployeeCommitteeMembership,
  OrgAllEmployeeDetail,
  OrgAllEmployeeEvent,
  OrgAllEmployeeRow,
  OrgAllEmployeeStats,
  OrgAllEmployeeTraining,
  OrgAllEmployeeTrainingStatus,
  OrgAllEmployeeVotingStatus,
  OrgAllEmployeesResponse,
  OrgCompanyEmailsStatus,
  OrgPersonSource,
} from '@lfx-one/shared/interfaces';
import { isFilterSafeIdentifier, splitDisplayName } from '@lfx-one/shared/utils';

import { Request } from 'express';

import { isServerFeatureEnabled, ServerFeatureFlag } from '../helpers/server-feature-flag.helper';
import { logger } from './logger.service';
import { OrgPeopleDirectoryService } from './org-people-directory.service';
import { SnowflakeService } from './snowflake.service';
import { withOrgCache } from './valkey.service';

/** Per-(account, person) row from PLATINUM_LFX_ONE.ORG_PEOPLE_ALL. */
interface OrgPeopleAllRow {
  ACCOUNT_ID: string;
  PERSON_KEY: string;
  LFID: string | null;
  LF_USERNAME: string | null;
  CDP_MEMBER_ID: string | null;
  NAME: string | null;
  TITLE: string | null;
  EMAIL: string | null;
  PHOTO: string | null;
  SEATS_COUNT: number;
  BOARD_SEATS_COUNT: number;
  COMMITTEE_SEATS_COUNT: number;
  COMMITS_COUNT: number;
  EVENTS_COUNT: number;
  COURSES_COUNT: number;
}

/** Roster row including the raw ENGAGED_FOUNDATION_IDS column (Snowflake ARRAY may arrive as a JSON string or a parsed array). */
type OrgPeopleAllRowRaw = OrgPeopleAllRow & { ENGAGED_FOUNDATION_IDS: string | string[] | null };

/** One-row aggregate from PLATINUM_LFX_ONE.ORG_PEOPLE_ALL_STATS. */
interface OrgPeopleStatsRow {
  ACCOUNT_ID: string;
  ACTIVE_IN_OSS: number;
  IN_GOVERNANCE: number;
  CODE_CONTRIBUTORS: number;
  EVENT_ATTENDEES: number;
  TRAINEES: number;
}

/** Distinct (foundation_id, foundation_name) pair powering the All Foundations dropdown. */
interface FoundationOptionRow {
  FOUNDATION_ID: string;
  FOUNDATION_NAME: string;
}

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
  TOTAL_COMMITS: number;
  IS_MAINTAINER: boolean;
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

/** Org Lens "People → All Employees" analytics — backed by the 6 PLATINUM_LFX_ONE.ORG_PEOPLE_* tables. Empty rows produce an empty envelope, never a 404. */
/** Shape of a company-address read that reports how it went rather than throwing. */
interface CompanyEmailsResult {
  companyEmails: string[];
  companyEmailsStatus: OrgCompanyEmailsStatus;
}

/** No identity was available, so no lookup was attempted — distinct from a lookup that returned nothing. */
const UNAVAILABLE_COMPANY_EMAILS: CompanyEmailsResult = { companyEmails: [], companyEmailsStatus: 'unavailable' };

/** The lookup ran and errored. The rest of the detail response still renders. */
const FAILED_COMPANY_EMAILS: CompanyEmailsResult = { companyEmails: [], companyEmailsStatus: 'failed' };

export class OrgLensPeopleService {
  private snowflakeService: SnowflakeService;
  // Lazily constructed: OrgPeopleDirectoryService's own constructor builds an OrgLensPeopleService,
  // so eagerly instantiating it here would recurse infinitely between the two constructors.
  private directoryService: OrgPeopleDirectoryService | undefined;

  public constructor() {
    this.snowflakeService = SnowflakeService.getInstance();
  }

  /** Bundled rows + stats + foundations payload; three Snowflake queries in parallel, served through the shared per-org cache. */
  public async getAllEmployees(accountId: string): Promise<OrgAllEmployeesResponse> {
    const raw = await withOrgCache(
      accountId,
      'people-all',
      VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
      () => this.fetchAllEmployeesRaw(accountId),
      isAllEmployeesRaw
    );

    return {
      accountId,
      rows: raw.rowsRaw.map((row) => this.mapEmployeeRow(row)),
      stats: this.mapStats(raw.statsRaw),
      foundations: raw.foundationRaw.map((row) => ({ foundationId: row.FOUNDATION_ID, foundationName: row.FOUNDATION_NAME })),
    };
  }

  /** Chevron-expansion detail for one person within an account; five Snowflake queries in parallel, served through the shared per-org cache. */
  public async getEmployeeDetail(req: Request, accountId: string, personKey: string): Promise<OrgAllEmployeeDetail> {
    // Live-only (synthetic) keys have no ORG_PEOPLE_ALL row at all — every one of the five detail
    // queries is a guaranteed-empty round trip for them. Short-circuit straight to the live-merged
    // roster (access/board/committee/keyContact sources) instead of burning five Snowflake
    // connections just to resolve an email.
    if (personKey.startsWith('live-')) {
      // A synthetic key joins to nothing in the warehouse, so resolve the person's LF username from
      // the live roster and read on that instead. Where the roster carries no username the set is
      // empty, and the drawer renders "not available from this view" rather than asserting the person
      // has no company address.
      const username = await this.resolveLiveOnlyUsername(req, accountId, personKey);
      const live = username ? await this.getCompanyEmailsByUsername(accountId, username) : UNAVAILABLE_COMPANY_EMAILS;
      return {
        personKey,
        boardSeats: [],
        committeeSeats: [],
        code: [],
        events: [],
        training: [],
        companyEmails: live.companyEmails,
        companyEmailsStatus: live.companyEmailsStatus,
      };
    }

    const { committeeRows, codeRows, eventRows, trainingRows, companyEmails, companyEmailsStatus } = await this.fetchEmployeeDetailRaw(accountId, personKey);

    const memberships = committeeRows.map((row) => this.mapCommitteeRow(row));
    const boardSeats = memberships.filter((m) => m.isBoard);
    const committeeSeats = memberships.filter((m) => !m.isBoard);

    // EVENTS detail is grained one-row-per-(account, person, event_id) so distinct rows == the parent events_count.
    const eventsCount = eventRows.length;
    const events = eventRows.map((row) => this.mapEventRow(row, eventsCount));

    // COUNT(DISTINCT) over the same id mapTrainingRow uses (COURSE_ID with COURSE_OR_CERT_ID fallback), so counts and rendered row keys agree.
    const distinctCourseIds = new Set<string>();
    const distinctCertifiedCourseIds = new Set<string>();
    for (const row of trainingRows) {
      const courseId = row.COURSE_ID ?? row.COURSE_OR_CERT_ID;
      if (courseId) {
        distinctCourseIds.add(courseId);
        if (row.STATUS === 'Certified') {
          distinctCertifiedCourseIds.add(courseId);
        }
      }
    }
    const coursesCount = distinctCourseIds.size;
    const certificationsCount = distinctCertifiedCourseIds.size;
    const training = trainingRows.map((row) => this.mapTrainingRow(row, coursesCount, certificationsCount));

    return {
      personKey,
      boardSeats,
      committeeSeats,
      code: codeRows.map((row) => this.mapCodeRow(row)),
      events,
      training,
      companyEmails,
      companyEmailsStatus,
    };
  }

  /**
   * Company-affiliated emails for a person the caller identifies by LF username (governance surfaces).
   *
   * Returns a status, not a bare list, because an empty list has two very different meanings here and
   * the panel must not conflate them (FR-009). `unavailable` when the server-side flag is off, or when
   * the username is not on the address model's spine at this account — an Org Lens Access principal
   * who is not a committee member, key contact or roster person has no warehouse presence, so the
   * address model cannot speak to them at all. `resolved` with `[]` only when the spine knows the
   * person and they genuinely hold no qualifying address.
   *
   * The spine probe runs only when the address read came back empty: the common path (addresses found)
   * stays one query, and the spine is a view — a three-way UNION re-evaluated per call — so probing it
   * unconditionally would double the cost of every governance-drawer open. SC-005 measures this path.
   */
  public async getCompanyEmailsByUsername(accountId: string, username: string): Promise<CompanyEmailsResult> {
    if (!isServerFeatureEnabled(ServerFeatureFlag.OrgLensCompanyEmails)) {
      return UNAVAILABLE_COMPANY_EMAILS;
    }
    const read = await this.tryFetchCompanyEmailsByUsername(accountId, username);
    if (read.companyEmailsStatus !== 'resolved' || read.companyEmails.length > 0) {
      return read;
    }
    try {
      return (await this.isUsernameOnSpine(accountId, username)) ? read : UNAVAILABLE_COMPANY_EMAILS;
    } catch (error) {
      logger.info(undefined, 'get_org_lens_people_company_emails_by_username', 'spine probe failed; serving unavailable', { err: error });
      return FAILED_COMPANY_EMAILS;
    }
  }

  /**
   * Whether the address model's spine knows this username at this account. Probed on the SPINE
   * (`_ORG_PEOPLE_SPINE`), not on the emails table: the emails table only has rows where addresses
   * exist, so it cannot distinguish "not on spine" from "no addresses".
   */
  private async isUsernameOnSpine(accountId: string, username: string): Promise<boolean> {
    const query = `
      SELECT 1 AS PRESENT
      FROM ANALYTICS.PLATINUM_LFX_ONE._ORG_PEOPLE_SPINE
      WHERE ACCOUNT_ID = ? AND LF_USERNAME = ?
      LIMIT 1
    `;
    const result = await this.snowflakeService.execute<{ PRESENT: number }>(query, [accountId, username]);
    return result.rows.length > 0;
  }

  /** Looks up a live-only person's LF username from the live roster (access/board/committee/keyContact sources). */
  private async resolveLiveOnlyUsername(req: Request, accountId: string, personKey: string): Promise<string | null> {
    if (!personKey.startsWith('live-')) {
      return null;
    }
    const { rows } = await this.getDirectoryService().getLive(req, accountId);
    return rows.find((row) => row.personKey === personKey)?.lfUsername ?? null;
  }

  private getDirectoryService(): OrgPeopleDirectoryService {
    if (!this.directoryService) {
      this.directoryService = new OrgPeopleDirectoryService();
    }
    return this.directoryService;
  }

  /** Three parallel Snowflake reads returning raw rows; mapping happens after the cache read. */
  private async fetchAllEmployeesRaw(
    accountId: string
  ): Promise<{ rowsRaw: OrgPeopleAllRowRaw[]; statsRaw: OrgPeopleStatsRow[]; foundationRaw: FoundationOptionRow[] }> {
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
        COMMITS_COUNT,
        EVENTS_COUNT,
        COURSES_COUNT,
        ENGAGED_FOUNDATION_IDS
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_ALL
      WHERE ACCOUNT_ID = ?
      ORDER BY NAME ASC NULLS LAST
    `;

    const statsQuery = `
      SELECT
        ACCOUNT_ID,
        ACTIVE_IN_OSS,
        IN_GOVERNANCE,
        CODE_CONTRIBUTORS,
        EVENT_ATTENDEES,
        TRAINEES
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_ALL_STATS
      WHERE ACCOUNT_ID = ?
    `;

    // Distinct (foundation_id, foundation_name) pairs across the four detail tables; keeps the BFF confined to PLATINUM_LFX_ONE.
    const foundationQuery = `
      WITH pairs AS (
        SELECT DISTINCT FOUNDATION_ID, FOUNDATION_NAME
        FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_COMMITTEE_MEMBERSHIP
        WHERE ACCOUNT_ID = ? AND FOUNDATION_ID IS NOT NULL AND FOUNDATION_NAME IS NOT NULL
        UNION
        SELECT DISTINCT FOUNDATION_ID, FOUNDATION_NAME
        FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_CODE_CONTRIBUTIONS
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

    const [rowsResult, statsResult, foundationResult] = await Promise.all([
      this.snowflakeService.execute<OrgPeopleAllRowRaw>(rowsQuery, [accountId]),
      this.snowflakeService.execute<OrgPeopleStatsRow>(statsQuery, [accountId]),
      this.snowflakeService.execute<FoundationOptionRow>(foundationQuery, [accountId, accountId, accountId, accountId]),
    ]);

    return { rowsRaw: rowsResult.rows, statsRaw: statsResult.rows, foundationRaw: foundationResult.rows };
  }

  private mapEmployeeRow(row: OrgPeopleAllRowRaw): OrgAllEmployeeRow {
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
      eventsCount: row.EVENTS_COUNT ?? 0,
      coursesCount: row.COURSES_COUNT ?? 0,
      engagedFoundationIds: this.parseFoundationIdArray(row.ENGAGED_FOUNDATION_IDS),
    };
  }

  private mapStats(rows: OrgPeopleStatsRow[]): OrgAllEmployeeStats {
    if (rows.length === 0) {
      return EMPTY_ORG_ALL_EMPLOYEE_STATS;
    }

    const row = rows[0];
    return {
      activeInOss: row.ACTIVE_IN_OSS ?? 0,
      inGovernance: row.IN_GOVERNANCE ?? 0,
      codeContributors: row.CODE_CONTRIBUTORS ?? 0,
      eventAttendees: row.EVENT_ATTENDEES ?? 0,
      trainees: row.TRAINEES ?? 0,
    };
  }

  /** Cached per-org detail bundle (four raw row arrays plus the person's company addresses); a non-filter-safe personKey bypasses the shared cache to keep the key namespace intact. */
  private async fetchEmployeeDetailRaw(
    accountId: string,
    personKey: string
  ): Promise<{
    committeeRows: CommitteeMembershipRow[];
    codeRows: CodeContributionRow[];
    eventRows: EventRow[];
    trainingRows: TrainingRow[];
    companyEmails: string[];
    companyEmailsStatus: OrgCompanyEmailsStatus;
  }> {
    if (!isFilterSafeIdentifier(personKey)) {
      return this.runEmployeeDetailFetch(accountId, personKey);
    }

    // The flag state is part of the key. A dark-launch response (`unavailable`, no addresses) is a
    // valid cacheable shape, so without this a flag-OFF read would be memoized and flipping the flag
    // ON would keep serving "not available" for the rest of the TTL.
    const emailsSuffix = isServerFeatureEnabled(ServerFeatureFlag.OrgLensCompanyEmails) ? 'emails' : 'noemails';
    return withOrgCache(
      accountId,
      `people-detail:${personKey}:${emailsSuffix}`,
      VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
      () => this.runEmployeeDetailFetch(accountId, personKey),
      isEmployeeDetailRaw,
      isCacheableEmployeeDetail
    );
  }

  private async runEmployeeDetailFetch(
    accountId: string,
    personKey: string
  ): Promise<{
    committeeRows: CommitteeMembershipRow[];
    codeRows: CodeContributionRow[];
    eventRows: EventRow[];
    trainingRows: TrainingRow[];
    companyEmails: string[];
    companyEmailsStatus: OrgCompanyEmailsStatus;
  }> {
    // The address read runs alongside the activity reads so the panel opens no slower, but its
    // rejection must not take the rest down with it: a warehouse hiccup on this one table would
    // otherwise blank every activity tab and report the person's details as unloadable. It resolves
    // to a status instead of throwing, which is also what lets the header say "couldn't be loaded"
    // rather than the untrue "no company address on record".
    const [committeeRows, codeRows, eventRows, trainingRows, companyEmailsResult] = await Promise.all([
      this.fetchCommitteeMembershipRows(accountId, personKey),
      this.fetchCodeContributionRows(accountId, personKey),
      this.fetchEventRows(accountId, personKey),
      this.fetchTrainingRows(accountId, personKey),
      this.tryFetchCompanyEmailsForPersonKey(accountId, personKey),
    ]);
    return {
      committeeRows,
      codeRows,
      eventRows,
      trainingRows,
      companyEmails: companyEmailsResult.companyEmails,
      companyEmailsStatus: companyEmailsResult.companyEmailsStatus,
    };
  }

  /**
   * Wraps the keyed read so a failure degrades this one section rather than the whole detail response.
   *
   * Two identity states short-circuit to `unavailable` before any query: the server-side flag being off,
   * and a `cdp:`-prefixed person key. The latter is a CDP roster member for whom the platform identity
   * crosswalk (`silver_dim_member_user_mapping`) produced no Salesforce user — either they hold no LF
   * identity, or they hold one but have no Crowd.dev activity since the mapping's activity window
   * (measured: 10,093 current roster members with an LFID fall on that side). The address model is
   * keyed on the Salesforce user, so a `cdp:` key can never join to it. Querying would return an empty
   * set that the panel renders as "no company email on record" — a false statement for anyone in that
   * population who holds a qualifying address. No verified identity resolved → not available, never
   * none on record (DR-005 corollary 2, DR-011).
   */
  private async tryFetchCompanyEmailsForPersonKey(accountId: string, personKey: string): Promise<CompanyEmailsResult> {
    if (!isServerFeatureEnabled(ServerFeatureFlag.OrgLensCompanyEmails) || personKey.startsWith('cdp:')) {
      return UNAVAILABLE_COMPANY_EMAILS;
    }
    try {
      return { companyEmails: await this.fetchCompanyEmails(accountId, personKey), companyEmailsStatus: 'resolved' };
    } catch (error) {
      logger.info(undefined, 'get_org_lens_people_detail', 'company email lookup failed; serving detail without addresses', {
        person_key: personKey,
        err: error,
      });
      return FAILED_COMPANY_EMAILS;
    }
  }

  /** As above, for the username-keyed read. */
  private async tryFetchCompanyEmailsByUsername(accountId: string, username: string): Promise<CompanyEmailsResult> {
    try {
      return { companyEmails: await this.fetchCompanyEmailsByUsername(accountId, username), companyEmailsStatus: 'resolved' };
    } catch (error) {
      logger.info(undefined, 'get_org_lens_people_company_emails_by_username', 'company email lookup failed; serving detail without addresses', {
        err: error,
      });
      return FAILED_COMPANY_EMAILS;
    }
  }

  /**
   * The person's company-affiliated addresses at this account.
   *
   * Every inclusion rule lives in the warehouse model, so this is a plain keyed read: the addresses a
   * person holds that are personal or belong to another employer are not filtered here, they are never
   * returned. No cap — the observed maximum is ten for one person, and truncating would misrepresent
   * the set the panel exists to show.
   *
   * Keyed on identity only. Resolving a person from an address is prohibited: that direction is known
   * to contain false links, so it would attribute one named individual's addresses to another.
   */
  private async fetchCompanyEmails(accountId: string, personKey: string): Promise<string[]> {
    const query = `
      SELECT EMAIL
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_COMPANY_EMAILS
      WHERE ACCOUNT_ID = ? AND PERSON_KEY = ?
      ORDER BY IS_PRIMARY DESC, EMAIL ASC
    `;
    const result = await this.snowflakeService.execute<{ EMAIL: string }>(query, [accountId, personKey]);
    return result.rows.map((row) => row.EMAIL).filter((email): email is string => !!email);
  }

  /**
   * As above, for the governance surfaces (Board, Committee, Key Contacts, Access) whose rows carry an
   * LF username rather than a person_key.
   *
   * The username is resolved inside the model rather than translated to a person_key here. Translating
   * via ORG_PEOPLE_ALL would re-apply that model's engagement gate, which drops roughly three quarters
   * of corporate key contacts — the panel would then report "no company address on record" for people
   * whose addresses the warehouse holds.
   */
  private async fetchCompanyEmailsByUsername(accountId: string, username: string): Promise<string[]> {
    const query = `
      SELECT EMAIL
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_COMPANY_EMAILS
      WHERE ACCOUNT_ID = ? AND LF_USERNAME = ?
      ORDER BY IS_PRIMARY DESC, EMAIL ASC
    `;
    const result = await this.snowflakeService.execute<{ EMAIL: string }>(query, [accountId, username]);
    return result.rows.map((row) => row.EMAIL).filter((email): email is string => !!email);
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
        IS_MAINTAINER,
        LAST_ACTIVITY_DATE
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_CODE_CONTRIBUTIONS
      WHERE ACCOUNT_ID = ? AND PERSON_KEY = ?
      ORDER BY TOTAL_COMMITS DESC NULLS LAST, PROJECT_NAME ASC NULLS LAST
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

  private mapCodeRow(row: CodeContributionRow): OrgAllEmployeeCodeContribution {
    return {
      projectId: row.PROJECT_ID,
      projectName: row.PROJECT_NAME ?? row.PROJECT_ID,
      foundationId: row.FOUNDATION_ID ?? '',
      foundationName: row.FOUNDATION_NAME ?? '',
      totalCommits: row.TOTAL_COMMITS ?? 0,
      lastActivityDate: toDateString(row.LAST_ACTIVITY_DATE),
      isMaintainer: row.IS_MAINTAINER === true,
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

/** Upstream occasionally carries bracketed placeholder names (e.g. "[[Unknown]] [[unknown]]") or a blank name; surface the email instead so the row stays identifiable, with a generic label only when no email exists. */
function cleanDisplayName(rawName: string | null, email: string | null): string {
  const name = (rawName ?? '').trim();
  const isPlaceholder = name === '' || /\[\[[^\]]*\]\]/.test(name);
  if (!isPlaceholder) {
    return name;
  }
  return (email ?? '').trim() || 'Unknown member';
}

function isAllEmployeesRaw(value: unknown): boolean {
  const v = value as { rowsRaw?: unknown; statsRaw?: unknown; foundationRaw?: unknown } | null;
  return (
    !!v &&
    Array.isArray(v.rowsRaw) &&
    Array.isArray(v.statsRaw) &&
    Array.isArray(v.foundationRaw) &&
    // Every row must carry LF_USERNAME, so entries cached before it was selected are rejected as a miss
    // rather than replayed. A replayed row maps to a null username, which silently returns the people
    // directory to email-only matching for the rest of the TTL. The value may legitimately be null, so
    // this checks presence, not truthiness.
    v.rowsRaw.every((row) => {
      if (!row || typeof row !== 'object' || !('LF_USERNAME' in row)) return false;
      const username = (row as { LF_USERNAME: unknown }).LF_USERNAME;
      return username === null || typeof username === 'string';
    })
  );
}

function isEmployeeDetailRaw(value: unknown): boolean {
  const v = value as {
    committeeRows?: unknown;
    codeRows?: unknown;
    eventRows?: unknown;
    trainingRows?: unknown;
    companyEmails?: unknown;
    companyEmailsStatus?: unknown;
  } | null;
  return (
    !!v &&
    Array.isArray(v.committeeRows) &&
    Array.isArray(v.codeRows) &&
    Array.isArray(v.eventRows) &&
    Array.isArray(v.trainingRows) &&
    // Gates on `companyEmails`, which replaced the earlier single `email` field. An entry written
    // before this change carries `email` and no `companyEmails`, so it fails here and is refetched
    // rather than replayed — otherwise the fabricated addresses that field fed would keep being
    // served from cache long after the code producing them was deleted.
    Array.isArray(v.companyEmails) &&
    v.companyEmails.every((email) => typeof email === 'string') &&
    // Also gates on the status, so a cached entry that predates it is refetched rather than replayed
    // with an undefined status the client would fall back to rendering as "none on record".
    // 'failed' is NOT accepted: an entry in that state should never have been written (see
    // isCacheableEmployeeDetail), and one left behind by an earlier deployment must expire on first
    // read rather than keep reporting an outage that is over.
    (v.companyEmailsStatus === 'resolved' || v.companyEmailsStatus === 'unavailable')
  );
}

/**
 * Whether a freshly fetched detail is eligible to be WRITTEN to the cache.
 *
 * `tryFetchCompanyEmails` deliberately turns a warehouse error into a fulfilled
 * `{ status: 'failed' }` so one bad table cannot blank the activity tabs. That degradation is right
 * for the response and wrong for the cache: persisting it would replay a single transient blip for
 * the full one-hour Org Lens TTL, so a warehouse hiccup lasting seconds would hide addresses for an
 * hour with no way to retry. The detail is returned to this caller and simply not stored, so the
 * next drawer open tries the warehouse again.
 *
 * 'unavailable' IS cacheable — it means no identity existed to look up, which is a stable property
 * of the row rather than a fault.
 */
function isCacheableEmployeeDetail(value: { companyEmailsStatus: OrgCompanyEmailsStatus }): boolean {
  return value.companyEmailsStatus !== 'failed';
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
