// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ORG_PEOPLE_ALL_ROW_COLUMNS, ORG_PEOPLE_FOUNDATION_OPTION_COLUMNS, VALKEY_CACHE } from '@lfx-one/shared/constants';
import type {
  CompactOrgAllEmployeesRawCache,
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
  OrgPeopleTimeRange,
  OrgPersonCompanyEmailsResponse,
  OrgPersonSource,
} from '@lfx-one/shared/interfaces';
import {
  computeOrgAllEmployeeStats,
  fromColumnar,
  hasExactColumns,
  isColumnarAbsent,
  isColumnarTable,
  isFilterSafeIdentifier,
  splitDisplayName,
  toColumnar,
} from '@lfx-one/shared/utils';
import { createHash } from 'crypto';

import { Request } from 'express';

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

interface EmployeeActivityRaw {
  committeeRows: CommitteeMembershipRow[];
  codeRows: CodeContributionRow[];
  eventRows: EventRow[];
  trainingRows: TrainingRow[];
}

/** Raw All Employees reads for one range: roster rows and the foundation dropdown pairs. */
interface AllEmployeesRaw {
  rowsRaw: OrgPeopleAllRowRaw[];
  foundationRaw: OrgPeopleFoundationOptionRow[];
}

/** Answer of the keyed former-employee check; `failed` answers are never cached. */
interface FormerCheck {
  isFormer: boolean;
  failed: boolean;
}

/** No unique identity is available — distinct from a resolved empty lookup. */
const UNAVAILABLE_COMPANY_EMAILS: OrgPersonCompanyEmailsResponse = { companyEmails: [], companyEmailsStatus: 'unavailable' };

/** The lookup ran and errored. The rest of the detail response still renders. */
const FAILED_COMPANY_EMAILS: OrgPersonCompanyEmailsResponse = { companyEmails: [], companyEmailsStatus: 'failed' };

/** Org Lens "People → All Employees" analytics — backed by the PLATINUM_LFX_ONE.ORG_PEOPLE_* tables. Empty rows produce an empty envelope, never a 404. */
export class OrgLensPeopleService {
  private snowflakeService: SnowflakeService;
  // Lazily constructed: OrgPeopleDirectoryService's own constructor builds an OrgLensPeopleService,
  // so eagerly instantiating it here would recurse infinitely between the two constructors.
  private directoryService: OrgPeopleDirectoryService | undefined;

  public constructor() {
    this.snowflakeService = SnowflakeService.getInstance();
  }

  /** Bundled rows + stats + foundations payload for one time range (`null`: the unranged roster); the wire projection of the internal roster. */
  public async getAllEmployees(accountId: string, range: OrgPeopleTimeRange | null): Promise<OrgAllEmployeesResponse> {
    return toWireResponse(await this.getAllEmployeesInternal(accountId, range));
  }

  /**
   * Internal roster with merge-only fields retained — the live directory's stored seed. A time range
   * reads that range's current employees; `null` reads the unranged ORG_PEOPLE_ALL roster the
   * reassign pickers use. The cache holds raw warehouse rows and both accessors map after every read,
   * so this split changes no cached shape. Stats are counted over the rows, so the tiles match the table.
   */
  public async getAllEmployeesInternal(accountId: string, range: OrgPeopleTimeRange | null): Promise<OrgAllEmployeesInternalResponse> {
    // `people-all:v3:{range|roster}` (lfx-self-serve#4163): one entry per time range plus the unranged
    // roster, none carrying a stats table, so a `v2` (with stats) entry must miss rather than decode.
    const raw = await withOrgCompactCache(
      accountId,
      `people-all:v3:${range ?? 'roster'}`,
      VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
      () => this.fetchAllEmployeesRaw(accountId, range),
      {
        encode: encodeAllEmployeesRaw,
        decode: decodeAllEmployeesRaw,
        accept: isCompactAllEmployeesRaw,
      }
    );

    const rows = raw.rowsRaw.map((row) => this.mapEmployeeRow(row));
    return {
      accountId,
      rows,
      stats: computeOrgAllEmployeeStats(rows),
      foundations: raw.foundationRaw.map((row) => ({ foundationId: row.FOUNDATION_ID, foundationName: row.FOUNDATION_NAME })),
    };
  }

  /**
   * Former employees at the account active in the time range (lfx-self-serve#4311), the
   * `IS_FORMER` rows of ORG_PEOPLE_ALL_RANGES. Only this read opts in to them, so the shared people
   * directory — and the reassign pickers that read it — never sees a former employee. Stats are
   * computed over these rows, so the tiles match the rows the "Former employees" view shows. No
   * address is sent for someone who left, and none stands in for a blank name.
   */
  public async getFormerEmployees(accountId: string, range: OrgPeopleTimeRange): Promise<OrgAllEmployeesResponse> {
    const raw = await this.getFormerEmployeesRaw(accountId, range);
    const rows = raw.rowsRaw.map((row) => ({ ...this.mapEmployeeRow({ ...row, EMAIL: null }), isFormer: true }));
    return toWireResponse({
      accountId,
      rows,
      stats: computeOrgAllEmployeeStats(rows),
      foundations: raw.foundationRaw.map((row) => ({ foundationId: row.FOUNDATION_ID, foundationName: row.FOUNDATION_NAME })),
    });
  }

  /**
   * Chevron-expansion detail for one person within an account: four activity queries in parallel, served
   * through the shared per-org cache. Company addresses are a separate read (`getCompanyEmails`): they come
   * from a live warehouse view that takes seconds, so callers render activity without waiting for it.
   */
  public async getEmployeeDetail(req: Request, accountId: string, personKey: string): Promise<OrgAllEmployeeDetail> {
    // Live-only (synthetic) keys have no ORG_PEOPLE_ALL row at all — every activity query is a guaranteed-empty
    // round trip for them, so answer the empty detail without touching Snowflake.
    if (personKey.startsWith('live-')) {
      return { personKey, boardSeats: [], committeeSeats: [], code: [], events: [], training: [] };
    }

    const { committeeRows, codeRows, eventRows, trainingRows } = await this.fetchEmployeeActivityRaw(accountId, personKey);

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
    };
  }

  /**
   * Company-affiliated emails for a person identified by warehouse person key.
   *
   * A live-only (synthetic) key joins to nothing in the warehouse, so it reads on the live roster's LF
   * username instead. No username → unavailable, never "no company address".
   */
  public async getCompanyEmails(req: Request, accountId: string, personKey: string): Promise<OrgPersonCompanyEmailsResponse> {
    if (personKey.startsWith('live-')) {
      const username = await this.resolveLiveOnlyUsername(req, accountId, personKey);
      return username ? this.getCompanyEmailsByUsername(accountId, username) : UNAVAILABLE_COMPANY_EMAILS;
    }
    return this.getCompanyEmailsForPersonKey(accountId, personKey);
  }

  /**
   * Company-affiliated emails for a person identified by LF username (governance surfaces).
   *
   * A username that resolves to one roster person (the same person `getEmployeeDetailByUsername` shows) reads that
   * person's addresses by person key, so an empty result is "none on record" and a NULL username on the address rows
   * cannot hide them. Any other username falls back to the address view's own username column, which also covers
   * people the roster's engagement gate excludes (most key contacts). Failures are never cached.
   */
  public async getCompanyEmailsByUsername(accountId: string, username: string): Promise<OrgPersonCompanyEmailsResponse> {
    const normalizedUsername = username.trim().toLowerCase();
    if (!normalizedUsername) {
      return UNAVAILABLE_COMPANY_EMAILS;
    }
    try {
      const personKey = await this.resolvePersonKeyByUsername(accountId, normalizedUsername);
      if (personKey) {
        return await this.getCompanyEmailsForPersonKey(accountId, personKey);
      }
      if (await this.isFormerEmployee(accountId, { username: normalizedUsername })) {
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
      logger.info(undefined, 'get_org_lens_people_company_emails_by_username', 'company email lookup failed', {
        err: error,
      });
      return FAILED_COMPANY_EMAILS;
    }
  }

  /**
   * Detail for openers that carry only an LF username (Board/Committee/Key Contact/Access; lfx-self-serve-ops#894).
   * Resolves the username with a keyed read of the account's warehouse roster (ORG_PEOPLE_ALL, a table — not the
   * address view), cached per username digest. Fails closed: null when no roster row, or more than one person key,
   * carries the username.
   */
  public async getEmployeeDetailByUsername(req: Request, accountId: string, username: string): Promise<OrgAllEmployeeDetail | null> {
    const normalizedUsername = username.trim().toLowerCase();
    if (!normalizedUsername) {
      return null;
    }
    const personKey = await this.resolvePersonKeyByUsername(accountId, normalizedUsername);
    return personKey ? this.getEmployeeDetail(req, accountId, personKey) : null;
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
   * Looks up a live-only person's LF username from the live roster (access/board/committee/keyContact
   * sources). Read on the narrowest (`30d`) range: the ranges are nested, so someone live-only in any range is
   * live-only in `30d` too (a stored row in `30d` would be in every wider range), and their `live-` key comes
   * from the merge key, not the range. A wider range would miss someone who is live-only in the range on
   * screen but has a stored row in the wider one.
   */
  private async resolveLiveOnlyUsername(req: Request, accountId: string, personKey: string): Promise<string | null> {
    if (!personKey.startsWith('live-')) {
      return null;
    }
    const { rows } = await this.getDirectoryService().getLive(req, accountId, '30d');
    return rows.find((row) => row.personKey === personKey)?.lfUsername ?? null;
  }

  private getDirectoryService(): OrgPeopleDirectoryService {
    if (!this.directoryService) {
      this.directoryService = new OrgPeopleDirectoryService();
    }
    return this.directoryService;
  }

  private getFormerEmployeesRaw(accountId: string, range: OrgPeopleTimeRange): Promise<AllEmployeesRaw> {
    // `people-former:v2:{range}` (lfx-self-serve#4163): read per time range from ORG_PEOPLE_ALL_RANGES.
    return withOrgCache(
      accountId,
      `people-former:v2:${range}`,
      VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
      () => this.fetchFormerEmployeesRaw(accountId, range),
      isFormerEmployeesRaw
    );
  }

  /** Former employees' rows for the range (the EMAIL column is never selected) and the foundations of their code rows. */
  private async fetchFormerEmployeesRaw(accountId: string, range: OrgPeopleTimeRange): Promise<AllEmployeesRaw> {
    const rowsQuery = `
      SELECT
        ACCOUNT_ID,
        PERSON_KEY,
        LFID,
        LF_USERNAME,
        CDP_MEMBER_ID,
        NAME,
        TITLE,
        NULL AS EMAIL,
        PHOTO,
        SEATS_COUNT,
        BOARD_SEATS_COUNT,
        COMMITTEE_SEATS_COUNT,
        COMMITS_COUNT,
        EVENTS_COUNT,
        COURSES_COUNT,
        ENGAGED_FOUNDATION_IDS
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_ALL_RANGES
      WHERE ACCOUNT_ID = ? AND TIME_RANGE = ? AND IS_FORMER = TRUE
      ORDER BY NAME ASC NULLS LAST
    `;

    const foundationQuery = `
      SELECT DISTINCT c.FOUNDATION_ID, c.FOUNDATION_NAME
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_CODE_CONTRIBUTIONS c
      INNER JOIN ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_ALL_RANGES f
        ON f.ACCOUNT_ID = c.ACCOUNT_ID AND f.PERSON_KEY = c.PERSON_KEY
      WHERE c.ACCOUNT_ID = ? AND f.TIME_RANGE = ? AND f.IS_FORMER = TRUE
        AND c.FOUNDATION_ID IS NOT NULL AND c.FOUNDATION_NAME IS NOT NULL
      ORDER BY c.FOUNDATION_NAME ASC
    `;

    const [rowsResult, foundationResult] = await Promise.all([
      this.snowflakeService.execute<OrgPeopleAllRowRaw>(rowsQuery, [accountId, range]),
      this.snowflakeService.execute<OrgPeopleFoundationOptionRow>(foundationQuery, [accountId, range]),
    ]);

    return { rowsRaw: rowsResult.rows, foundationRaw: foundationResult.rows };
  }

  /**
   * A former employee's company addresses are never read: they left, and the address model covers the
   * account's current people only. Checked against the widest former population (`TIME_RANGE = 'all'`),
   * whatever range the caller is viewing. One keyed read per person, cached per person. A failed read
   * answers `false` so it never blocks the address read, and is not cached, so a warehouse blip cannot
   * drop the guard for the whole TTL.
   */
  private async isFormerEmployee(accountId: string, identity: { personKey: string } | { username: string }): Promise<boolean> {
    const byPersonKey = 'personKey' in identity;
    const fetcher = async (): Promise<FormerCheck> => {
      try {
        const result = await this.snowflakeService.execute<{ IS_FORMER: number }>(
          `
            SELECT 1 AS IS_FORMER
            FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_ALL_RANGES
            WHERE ACCOUNT_ID = ? AND TIME_RANGE = 'all' AND IS_FORMER = TRUE
              AND ${byPersonKey ? 'PERSON_KEY = ?' : 'LOWER(TRIM(LF_USERNAME)) = ?'}
            LIMIT 1
          `,
          [accountId, byPersonKey ? identity.personKey : identity.username]
        );
        return { isFormer: result.rows.length > 0, failed: false };
      } catch (error) {
        logger.info(undefined, 'get_org_lens_people_former_lookup', 'former employee lookup failed', { err: error });
        return { isFormer: false, failed: true };
      }
    };
    if (byPersonKey && !isFilterSafeIdentifier(identity.personKey)) {
      return (await fetcher()).isFormer;
    }
    // `v2` (lfx-self-serve#4163): the former population is now the all-time former rows of
    // ORG_PEOPLE_ALL_RANGES, so an answer cached against the retired former-employees model must miss.
    const key = byPersonKey ? `people-former-check:v2:${identity.personKey}` : `people-former-check:v2:username:${usernameDigest(identity.username)}`;
    const { isFormer } = await withOrgCache(accountId, key, VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS, fetcher, isFormerCheck, (check) => !check.failed);
    return isFormer;
  }

  /**
   * Two parallel Snowflake reads returning raw rows (the current employees, and the foundation pairs);
   * mapping happens after the cache read. A range reads that range's current rows of
   * ORG_PEOPLE_ALL_RANGES; `null` reads the unranged ORG_PEOPLE_ALL roster.
   */
  private async fetchAllEmployeesRaw(accountId: string, range: OrgPeopleTimeRange | null): Promise<AllEmployeesRaw> {
    const source = range
      ? { from: 'ORG_PEOPLE_ALL_RANGES', where: 'ACCOUNT_ID = ? AND TIME_RANGE = ? AND IS_FORMER = FALSE', binds: [accountId, range] }
      : { from: 'ORG_PEOPLE_ALL', where: 'ACCOUNT_ID = ?', binds: [accountId] };
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
      FROM ANALYTICS.PLATINUM_LFX_ONE.${source.from}
      WHERE ${source.where}
      ORDER BY NAME ASC NULLS LAST
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
      eventsCount: row.EVENTS_COUNT ?? 0,
      coursesCount: row.COURSES_COUNT ?? 0,
      engagedFoundationIds: this.parseFoundationIdArray(row.ENGAGED_FOUNDATION_IDS),
    };
  }

  /** A non-filter-safe personKey bypasses the shared cache to keep the key namespace intact. */
  private fetchEmployeeActivityRaw(accountId: string, personKey: string): Promise<EmployeeActivityRaw> {
    if (!isFilterSafeIdentifier(personKey)) {
      return this.runEmployeeActivityFetch(accountId, personKey);
    }
    return withOrgCache(
      accountId,
      `people-detail:${personKey}`,
      VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
      () => this.runEmployeeActivityFetch(accountId, personKey),
      isEmployeeActivityRaw
    );
  }

  private async runEmployeeActivityFetch(accountId: string, personKey: string): Promise<EmployeeActivityRaw> {
    const [committeeRows, codeRows, eventRows, trainingRows] = await Promise.all([
      this.fetchCommitteeMembershipRows(accountId, personKey),
      this.fetchCodeContributionRows(accountId, personKey),
      this.fetchEventRows(accountId, personKey),
      this.fetchTrainingRows(accountId, personKey),
    ]);
    return { committeeRows, codeRows, eventRows, trainingRows };
  }

  /**
   * A failure is answered as `failed` and is never cached.
   *
   * A `cdp:` person key (no Salesforce identity to join on) and a former employee of the account
   * short-circuit to `unavailable` before the cache: not available, never "none on record".
   */
  private async getCompanyEmailsForPersonKey(accountId: string, personKey: string): Promise<OrgPersonCompanyEmailsResponse> {
    if (personKey.startsWith('cdp:') || (await this.isFormerEmployee(accountId, { personKey }))) {
      return UNAVAILABLE_COMPANY_EMAILS;
    }
    const fetcher = async (): Promise<OrgPersonCompanyEmailsResponse> => ({
      companyEmails: await this.fetchCompanyEmails(accountId, personKey),
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
      logger.info(undefined, 'get_org_lens_people_company_emails', 'company email lookup failed', {
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
      SELECT emails.EMAIL
      FROM resolved_person AS person
      INNER JOIN ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_COMPANY_EMAILS AS emails
        ON emails.ACCOUNT_ID = person.ACCOUNT_ID AND emails.PERSON_KEY = person.PERSON_KEY
      ORDER BY emails.IS_PRIMARY DESC, emails.EMAIL ASC
    `;
    const result = await this.snowflakeService.execute<{ EMAIL: string | null }>(query, [accountId, username]);
    const companyEmails = result.rows.map((row) => row.EMAIL).filter((email): email is string => !!email);
    if (companyEmails.length === 0) {
      return UNAVAILABLE_COMPANY_EMAILS;
    }
    return { companyEmails, companyEmailsStatus: 'resolved' };
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

/**
 * Compacts the raw reads for Valkey storage (GH-1906). The roster is the bulk of the payload
 * — well past the 1 MiB write cap at the largest org measured, so it was never actually stored —
 * and almost half of that was the same 15 uppercase warehouse column names repeated on every row.
 * Columnar storage carries them once.
 */
function encodeAllEmployeesRaw(raw: AllEmployeesRaw): CompactOrgAllEmployeesRawCache {
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
function decodeAllEmployeesRaw(value: CompactOrgAllEmployeesRawCache): AllEmployeesRaw {
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
  return !!v && Array.isArray(v.committeeRows) && Array.isArray(v.codeRows) && Array.isArray(v.eventRows) && Array.isArray(v.trainingRows);
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

/** Hashed so a raw username is never a `:`-delimited cache-key segment. */
function usernameDigest(normalizedUsername: string): string {
  return createHash('sha256').update(normalizedUsername).digest('hex').slice(0, 16);
}

/** Reject legacy/failed cache entries; unavailable identities cannot carry addresses. */
function isCompanyEmailsResponse(value: unknown): boolean {
  const response = value as Partial<OrgPersonCompanyEmailsResponse> | null;
  return (
    !!response &&
    Array.isArray(response.companyEmails) &&
    response.companyEmails.every((email) => typeof email === 'string') &&
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
