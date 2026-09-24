// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  EMPTY_ORG_TRAINEES_RESPONSE,
  ORG_TRAINEE_COURSE_DICTIONARY_COLUMNS,
  ORG_TRAINEE_COURSE_OPTION_COLUMNS,
  ORG_TRAINEE_DETAIL_COLUMNS,
  ORG_TRAINEE_FOUNDATION_OPTION_COLUMNS,
  ORG_TRAINEE_ROW_COLUMNS,
  VALKEY_CACHE,
} from '@lfx-one/shared/constants';
import type {
  CompactOrgTraineesRawCache,
  OrgPeopleAllTraineeRow,
  OrgPeopleTrainingRow,
  OrgTraineeCourseOption,
  OrgTraineeDetailRow,
  OrgTraineeFoundationOption,
  OrgTraineeRow,
  OrgTraineesResponse,
  TraineeCourseOptionRow,
  TraineeFoundationOptionRow,
} from '@lfx-one/shared/interfaces';
import { dedupeByKey, fromColumnar, hasExactColumns, isColumnarTable, toColumnar } from '@lfx-one/shared/utils';

import { SnowflakeService } from './snowflake.service';
import { withOrgCompactCache } from './valkey.service';

/** Trainees tab data access — single bundled GET that backs the filter trio, four stat cards, main row, and lazy expanded section client-side. */
export class OrgPeopleTraineesService {
  private readonly snowflakeService: SnowflakeService;

  public constructor() {
    this.snowflakeService = SnowflakeService.getInstance();
  }

  /** Bundled rows + details + filter dropdowns. Four parallel Snowflake queries; stats are recomputed client-side from filtered details so the server ships none. */
  public async getTrainees(accountId: string): Promise<OrgTraineesResponse> {
    if (!accountId) {
      return { ...EMPTY_ORG_TRAINEES_RESPONSE };
    }

    // `people-trainees:v2`: the stored value is now the compact projection below (GH-1906), with the
    // course- and foundation-level columns lifted out of the per-(person, course) detail rows — a
    // `v1` entry is a different shape entirely and must miss.
    const { traineeRows, detailRows, foundationRows, courseRows } = await withOrgCompactCache(
      accountId,
      'people-trainees:v2',
      VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
      () => this.fetchTraineesRaw(accountId),
      { encode: encodeTraineesRaw, decode: decodeTraineesRaw, accept: isCompactTraineesRaw }
    );

    const trainees: OrgTraineeRow[] = traineeRows.map((row) => ({
      personKey: row.PERSON_KEY,
      lfid: row.LFID,
      cdpMemberId: row.CDP_MEMBER_ID,
      name: row.NAME ?? '',
      title: row.TITLE,
      email: row.EMAIL,
    }));

    // Drop null-ACTIVITY_TS rows; coercing to '' would corrupt downstream lex sorts and most-recent derivations.
    const details: OrgTraineeDetailRow[] = detailRows.flatMap<OrgTraineeDetailRow>((row) => {
      if (row.STATUS !== 'Enrolled' && row.STATUS !== 'Certified') return [];
      const activityTs = toIsoTimestamp(row.ACTIVITY_TS);
      if (!activityTs) return [];
      return [
        {
          personKey: row.PERSON_KEY,
          status: row.STATUS === 'Certified' ? 'Certified' : 'Enrolled',
          courseOrCertId: row.COURSE_OR_CERT_ID,
          // COURSE_ID is 100% populated for both enrolled and certified rows (verified Red Hat 2026-06-01),
          // but fall back to COURSE_OR_CERT_ID so the client-side `(personKey, courseId)` grouping is never keyed on '' / undefined.
          courseId: row.COURSE_ID ?? row.COURSE_OR_CERT_ID,
          courseName: row.COURSE_NAME ?? row.COURSE_ID ?? row.COURSE_OR_CERT_ID,
          foundationId: row.FOUNDATION_ID,
          foundationName: row.FOUNDATION_NAME,
          activityTs,
        },
      ];
    });

    const foundationOptions: OrgTraineeFoundationOption[] = foundationRows.map((row) => ({
      foundationId: row.FOUNDATION_ID,
      foundationName: row.FOUNDATION_NAME,
    }));

    const courseOptions: OrgTraineeCourseOption[] = courseRows.map((row) => ({
      courseId: row.COURSE_ID,
      courseName: row.COURSE_NAME,
    }));

    return {
      accountId,
      trainees,
      details,
      foundationOptions,
      courseOptions,
    };
  }

  private async fetchTraineesRaw(accountId: string): Promise<{
    traineeRows: OrgPeopleAllTraineeRow[];
    detailRows: OrgPeopleTrainingRow[];
    foundationRows: TraineeFoundationOptionRow[];
    courseRows: TraineeCourseOptionRow[];
  }> {
    const [traineeRows, detailRows, foundationRows, courseRows] = await Promise.all([
      this.fetchTraineeRows(accountId),
      this.fetchDetailRows(accountId),
      this.fetchFoundationOptions(accountId),
      this.fetchCourseOptions(accountId),
    ]);
    return { traineeRows, detailRows, foundationRows, courseRows };
  }

  private async fetchTraineeRows(accountId: string): Promise<OrgPeopleAllTraineeRow[]> {
    const query = `
      SELECT
        PERSON_KEY,
        LFID,
        CDP_MEMBER_ID,
        NAME,
        TITLE,
        EMAIL
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_ALL
      WHERE ACCOUNT_ID = ? AND COURSES_COUNT > 0
      ORDER BY NAME ASC NULLS LAST
    `;
    const result = await this.snowflakeService.execute<OrgPeopleAllTraineeRow>(query, [accountId]);
    return result.rows;
  }

  private async fetchDetailRows(accountId: string): Promise<OrgPeopleTrainingRow[]> {
    const query = `
      SELECT
        PERSON_KEY,
        STATUS,
        COURSE_OR_CERT_ID,
        COURSE_ID,
        COURSE_NAME,
        ACTIVITY_TS,
        FOUNDATION_ID,
        FOUNDATION_NAME
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_TRAINING
      WHERE ACCOUNT_ID = ?
      ORDER BY PERSON_KEY ASC, ACTIVITY_TS DESC NULLS LAST
    `;
    const result = await this.snowflakeService.execute<OrgPeopleTrainingRow>(query, [accountId]);
    return result.rows;
  }

  private async fetchFoundationOptions(accountId: string): Promise<TraineeFoundationOptionRow[]> {
    const query = `
      SELECT DISTINCT FOUNDATION_ID, FOUNDATION_NAME
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_TRAINING
      WHERE ACCOUNT_ID = ?
        AND FOUNDATION_ID IS NOT NULL
        AND FOUNDATION_NAME IS NOT NULL
      ORDER BY FOUNDATION_NAME ASC
    `;
    const result = await this.snowflakeService.execute<TraineeFoundationOptionRow>(query, [accountId]);
    return result.rows;
  }

  private async fetchCourseOptions(accountId: string): Promise<TraineeCourseOptionRow[]> {
    const query = `
      SELECT DISTINCT COURSE_ID, COURSE_NAME
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_TRAINING
      WHERE ACCOUNT_ID = ?
        AND COURSE_ID IS NOT NULL
        AND COURSE_NAME IS NOT NULL
      ORDER BY COURSE_NAME ASC
    `;
    const result = await this.snowflakeService.execute<TraineeCourseOptionRow>(query, [accountId]);
    return result.rows;
  }
}

/**
 * Compacts the four raw reads for Valkey storage (GH-1906).
 *
 * Same shape of waste as the event-attendees payload: `detailRows` is grained per (person,
 * course-or-cert), so every row for a course repeats that course's `COURSE_ID`, `COURSE_NAME`,
 * `FOUNDATION_ID` and `FOUNDATION_NAME`. Those four are stored once per distinct course; what stays
 * per row is `PERSON_KEY`, `STATUS`, `COURSE_OR_CERT_ID` (the enrollment/certification instance,
 * genuinely per row) and `ACTIVITY_TS`.
 */
function encodeTraineesRaw(raw: {
  traineeRows: OrgPeopleAllTraineeRow[];
  detailRows: OrgPeopleTrainingRow[];
  foundationRows: TraineeFoundationOptionRow[];
  courseRows: TraineeCourseOptionRow[];
}): CompactOrgTraineesRawCache {
  // Keyed on the whole tuple, not on COURSE_ID: two rows sharing a course id but disagreeing on a
  // name or foundation must not collapse onto the first one seen, or the rebuilt rows would differ
  // from the uncached ones. COURSE_ID is also nullable, and the tuple key handles that for free.
  const keyOf = (row: OrgPeopleTrainingRow): string => JSON.stringify([row.COURSE_ID, row.COURSE_NAME, row.FOUNDATION_ID, row.FOUNDATION_NAME]);
  const courses = dedupeByKey(raw.detailRows, keyOf);

  return {
    traineeRows: toColumnar(raw.traineeRows, ORG_TRAINEE_ROW_COLUMNS),
    courses: toColumnar(courses.values, ORG_TRAINEE_COURSE_DICTIONARY_COLUMNS),
    details: toColumnar(raw.detailRows, ORG_TRAINEE_DETAIL_COLUMNS),
    // Every detail row was part of the set `courses` was built from, so the lookup always resolves.
    detailCourses: raw.detailRows.map((row) => courses.indexOf.get(keyOf(row))!),
    foundationRows: toColumnar(raw.foundationRows, ORG_TRAINEE_FOUNDATION_OPTION_COLUMNS),
    courseRows: toColumnar(raw.courseRows, ORG_TRAINEE_COURSE_OPTION_COLUMNS),
  };
}

/** Rebuilds the raw rows {@link encodeTraineesRaw} stored, so the mapping above sees exactly what a cache miss would hand it. */
function decodeTraineesRaw(value: CompactOrgTraineesRawCache): {
  traineeRows: OrgPeopleAllTraineeRow[];
  detailRows: OrgPeopleTrainingRow[];
  foundationRows: TraineeFoundationOptionRow[];
  courseRows: TraineeCourseOptionRow[];
} {
  const courses = fromColumnar<OrgPeopleTrainingRow>(value.courses);
  const detailRows = fromColumnar<OrgPeopleTrainingRow>(value.details);
  detailRows.forEach((row, index) => Object.assign(row, courses[value.detailCourses[index]]));
  return {
    traineeRows: fromColumnar<OrgPeopleAllTraineeRow>(value.traineeRows),
    detailRows,
    foundationRows: fromColumnar<TraineeFoundationOptionRow>(value.foundationRows),
    courseRows: fromColumnar<TraineeCourseOptionRow>(value.courseRows),
  };
}

function isCompactTraineesRaw(value: unknown): boolean {
  const cache = value as Partial<CompactOrgTraineesRawCache> | null;
  if (
    !cache ||
    typeof cache !== 'object' ||
    !isColumnarTable(cache.traineeRows) ||
    !isColumnarTable(cache.courses) ||
    !isColumnarTable(cache.details) ||
    !isColumnarTable(cache.foundationRows) ||
    !isColumnarTable(cache.courseRows) ||
    // Exact columns, not a subset: a duplicated, extra, reordered or short-rowed entry decodes
    // "successfully" into rows missing data the writer always emits, which is worse than a miss —
    // the tab renders with holes in it for the rest of the TTL instead of refetching.
    !hasExactColumns(cache.traineeRows, ORG_TRAINEE_ROW_COLUMNS) ||
    !hasExactColumns(cache.courses, ORG_TRAINEE_COURSE_DICTIONARY_COLUMNS) ||
    !hasExactColumns(cache.details, ORG_TRAINEE_DETAIL_COLUMNS) ||
    !hasExactColumns(cache.foundationRows, ORG_TRAINEE_FOUNDATION_OPTION_COLUMNS) ||
    !hasExactColumns(cache.courseRows, ORG_TRAINEE_COURSE_OPTION_COLUMNS)
  ) {
    return false;
  }
  // Every reference must resolve, so the decode can rebuild each detail row in full rather than
  // silently emitting one missing its whole course — a truncated entry is a miss, not a partial hit.
  const courseCount = cache.courses.r.length;
  return (
    Array.isArray(cache.detailCourses) &&
    cache.detailCourses.length === cache.details.r.length &&
    cache.detailCourses.every((index) => Number.isInteger(index) && index >= 0 && index < courseCount)
  );
}

/** Normalize Snowflake `Date | string | null` to a full ISO string, or null when missing / unparseable; preserves time-of-day so client-side time-window predicates and tiebreaker chains stay precise. */
function toIsoTimestamp(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === 'string') {
    // Treat Snowflake NTZ strings (no timezone marker) as UTC, not server-local - same drift `toIsoDate` prevents on the date helper.
    const isoLike = value.includes(' ') ? value.replace(' ', 'T') : value;
    const normalized = /[zZ]|[+-]\d{2}:?\d{2}$/.test(isoLike) ? isoLike : `${isoLike}Z`;
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  return null;
}
