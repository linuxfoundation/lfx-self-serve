// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  EMPTY_ORG_TRAINEES_RESPONSE,
  ORG_TRAINEE_COURSE_DICTIONARY_COLUMNS,
  ORG_TRAINEE_DETAIL_COLUMNS,
  ORG_TRAINEE_OUTSIDE_KEY_PREFIX,
  ORG_TRAINEE_OUTSIDE_LEARNER_COLUMNS,
  ORG_TRAINEE_ROW_COLUMNS,
  VALKEY_CACHE,
} from '@lfx-one/shared/constants';
import type {
  CompactOrgTraineesRawCache,
  OrgDropdownOption,
  OrgLensTimeRange,
  OrgPeopleAllTraineeRow,
  OrgPeopleTrainingRow,
  OrgTraineeDetailRow,
  OrgTraineeFilterOptions,
  OrgTraineeRow,
  OrgTraineesResponse,
  OrgTrainingOutsideLearnerRow,
  TraineeAsOfRow,
} from '@lfx-one/shared/interfaces';
import {
  dedupeByKey,
  fromColumnar,
  hasExactColumns,
  isColumnarAbsent,
  isColumnarTable,
  orgLensTimeRangeDays,
  toColumnar,
  tupleKey,
} from '@lfx-one/shared/utils';

import { toIsoTimestamp } from '../helpers/date-format.helper';
import { SnowflakeService } from './snowflake.service';
import { withOrgCompactCache } from './valkey.service';

/** Trainees tab data access — one GET per range that backs the filters, four stat cards, main row, and lazy expanded section client-side. */
export class OrgPeopleTraineesService {
  private readonly snowflakeService: SnowflakeService;

  public constructor() {
    this.snowflakeService = SnowflakeService.getInstance();
  }

  /**
   * The range's trainees, details and filter dropdowns: parallel Snowflake reads over enrollments and certificates dated
   * in the range; the dropdowns are built from those details, and stats are recomputed client-side from the filtered
   * details, so the server ships none.
   */
  public async getTrainees(accountId: string, range: OrgLensTimeRange): Promise<OrgTraineesResponse> {
    if (!accountId) {
      return { ...EMPTY_ORG_TRAINEES_RESPONSE, timeRange: range };
    }

    // `people-trainees:v5:{range}` (lfx-self-serve#4159, #4916, #4287): ORG_PEOPLE_TRAINING holds enrollments of any age,
    // so the read is windowed per range here instead of shipping every row for the client to filter. `v5` adds the
    // table's build time, the project, level and format columns and the learners outside the people list, and drops the
    // two option reads; a `v4` entry must miss.
    const { traineeRows, outsideLearnerRows, detailRows, asOf } = await withOrgCompactCache(
      accountId,
      `people-trainees:v5:${range}`,
      VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
      () => this.fetchTraineesRaw(accountId, range),
      { encode: encodeTraineesRaw, decode: decodeTraineesRaw, accept: isCompactTraineesRaw }
    );

    // Only people-list members keep their warehouse key, which the person drawer reads. Every other key (a learner
    // outside the people list) is replaced by an opaque per-response key, the same in `trainees` and `details`.
    const listedKeys = new Set(traineeRows.map((row) => row.PERSON_KEY));
    const opaqueKeys = new Map<string, string>();
    const wireKey = (personKey: string): string => {
      if (listedKeys.has(personKey)) return personKey;
      let opaque = opaqueKeys.get(personKey);
      if (!opaque) {
        opaque = `${ORG_TRAINEE_OUTSIDE_KEY_PREFIX}${opaqueKeys.size + 1}`;
        opaqueKeys.set(personKey, opaque);
      }
      return opaque;
    };

    const trainees: OrgTraineeRow[] = [
      ...traineeRows.map((row) => ({
        personKey: row.PERSON_KEY,
        lfid: row.LFID,
        cdpMemberId: row.CDP_MEMBER_ID,
        name: row.NAME ?? '',
        title: row.TITLE,
        email: row.EMAIL,
        onPeopleList: true,
      })),
      // Name and training status only (lfx-self-serve#4287): no warehouse key, ids, title or email leave the BFF for these learners.
      ...outsideLearnerRows.map((row) => ({
        personKey: wireKey(row.PERSON_KEY),
        lfid: null,
        cdpMemberId: null,
        name: row.LEARNER_NAME ?? '',
        title: null,
        email: null,
        onPeopleList: false,
      })),
    ];

    // Drop null-ACTIVITY_TS rows; coercing to '' would corrupt downstream lex sorts and most-recent derivations.
    const details: OrgTraineeDetailRow[] = detailRows.flatMap<OrgTraineeDetailRow>((row) => {
      if (row.STATUS !== 'Enrolled' && row.STATUS !== 'Certified') return [];
      const activityTs = toIsoTimestamp(row.ACTIVITY_TS);
      if (!activityTs) return [];
      const personKey = wireKey(row.PERSON_KEY);
      const onPeopleList = listedKeys.has(row.PERSON_KEY);
      return [
        {
          personKey,
          status: row.STATUS === 'Certified' ? 'Certified' : 'Enrolled',
          // Blank for learners outside the people list (lfx-self-serve#4287): the enrollment / certificate id is a
          // per-person identifier, and no client reads it.
          courseOrCertId: onPeopleList ? row.COURSE_OR_CERT_ID : '',
          // COURSE_ID is 100% populated for both enrolled and certified rows (verified on a large covered organization 2026-06-01),
          // but fall back to COURSE_OR_CERT_ID so the client-side `(personKey, courseId)` grouping is never keyed on '' / undefined.
          courseId: row.COURSE_ID ?? row.COURSE_OR_CERT_ID,
          courseName: row.COURSE_NAME ?? row.COURSE_ID ?? row.COURSE_OR_CERT_ID,
          foundationId: row.FOUNDATION_ID,
          foundationName: row.FOUNDATION_NAME,
          projectId: row.PROJECT_ID,
          projectName: row.PROJECT_NAME,
          courseLevel: row.COURSE_LEVEL,
          courseFormat: row.COURSE_FORMAT,
          activityTs,
        },
      ];
    });

    return {
      accountId,
      timeRange: range,
      trainees,
      details,
      filterOptions: buildFilterOptions(details),
      asOf,
    };
  }

  private async fetchTraineesRaw(
    accountId: string,
    range: OrgLensTimeRange
  ): Promise<{
    traineeRows: OrgPeopleAllTraineeRow[];
    outsideLearnerRows: OrgTrainingOutsideLearnerRow[];
    detailRows: OrgPeopleTrainingRow[];
    asOf: string | null;
  }> {
    const inRange = trainingRangePredicate(range);
    const [traineeRows, outsideLearnerRows, detailRows, asOf] = await Promise.all([
      this.fetchTraineeRows(accountId, inRange),
      this.fetchOutsideLearnerRows(accountId, inRange),
      this.fetchDetailRows(accountId, inRange),
      this.fetchAsOf(accountId),
    ]);
    return { traineeRows, outsideLearnerRows, detailRows, asOf };
  }

  /**
   * Identity of everyone on the people list with a training row in the range. ORG_PEOPLE_TRAINING has no name columns,
   * and ORG_PEOPLE_ALL counts only the last 12 months of enrollments, so identity comes from the all-time, all-projects
   * ranges row, which every current employee with a course signal has (lf-dbt test). Only the current-employee row: a
   * former employee's row carries a personal address the People tabs must never send. Only people-list training rows:
   * a learner outside the list can share a former employee's key, and is read by {@link fetchOutsideLearnerRows}.
   */
  private async fetchTraineeRows(accountId: string, inRange: string): Promise<OrgPeopleAllTraineeRow[]> {
    const query = `
      SELECT
        PERSON_KEY,
        LFID,
        CDP_MEMBER_ID,
        NAME,
        TITLE,
        EMAIL
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_ALL_RANGES
      WHERE ACCOUNT_ID = ?
        AND TIME_RANGE = 'all'
        AND PROJECT_SCOPE = 'all'
        AND IS_FORMER = FALSE
        AND PERSON_KEY IN (
          SELECT PERSON_KEY
          FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_TRAINING
          WHERE ACCOUNT_ID = ?
            AND ON_PEOPLE_LIST
            ${inRange}
        )
      ORDER BY NAME ASC NULLS LAST
    `;
    const result = await this.snowflakeService.execute<OrgPeopleAllTraineeRow>(query, [accountId, accountId]);
    return result.rows;
  }

  /**
   * Learners attributed to the organization by their enrollment who are not on the people list (lfx-self-serve#4287),
   * with a training row in the range: the name, nothing else.
   */
  private async fetchOutsideLearnerRows(accountId: string, inRange: string): Promise<OrgTrainingOutsideLearnerRow[]> {
    const query = `
      SELECT
        PERSON_KEY,
        LEARNER_NAME
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_TRAINING_OUTSIDE_LEARNERS
      WHERE ACCOUNT_ID = ?
        AND PERSON_KEY IN (
          SELECT PERSON_KEY
          FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_TRAINING
          WHERE ACCOUNT_ID = ?
            AND NOT ON_PEOPLE_LIST
            ${inRange}
        )
      ORDER BY LEARNER_NAME ASC NULLS LAST
    `;
    const result = await this.snowflakeService.execute<OrgTrainingOutsideLearnerRow>(query, [accountId, accountId]);
    return result.rows;
  }

  private async fetchDetailRows(accountId: string, inRange: string): Promise<OrgPeopleTrainingRow[]> {
    const query = `
      SELECT
        PERSON_KEY,
        STATUS,
        COURSE_OR_CERT_ID,
        COURSE_ID,
        COURSE_NAME,
        ACTIVITY_TS,
        FOUNDATION_ID,
        FOUNDATION_NAME,
        PROJECT_ID,
        PROJECT_NAME,
        COURSE_LEVEL,
        COURSE_FORMAT
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_TRAINING
      WHERE ACCOUNT_ID = ?
        ${inRange}
      ORDER BY PERSON_KEY ASC, ACTIVITY_TS DESC NULLS LAST
    `;
    const result = await this.snowflakeService.execute<OrgPeopleTrainingRow>(query, [accountId]);
    return result.rows;
  }

  /** When the training table was built: every range of the account reads the same build, so this is not windowed. */
  private async fetchAsOf(accountId: string): Promise<string | null> {
    const query = `
      SELECT MAX(DBT_RUN_AT) AS AS_OF
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_TRAINING
      WHERE ACCOUNT_ID = ?
    `;
    const result = await this.snowflakeService.execute<TraineeAsOfRow>(query, [accountId]);
    return toIsoTimestamp(result.rows[0]?.AS_OF);
  }
}

/**
 * The five Trainees dropdowns from the details the response ships, so an option exists only when a row of the range
 * carries it and picking it on its own can never empty the table. Rows without the field are reachable only through
 * "All": a certified row has no format, a few courses have no level.
 */
function buildFilterOptions(details: OrgTraineeDetailRow[]): OrgTraineeFilterOptions {
  const foundations = new Map<string, string>();
  const projects = new Map<string, string>();
  const courses = new Map<string, string>();
  const levels = new Map<string, string>();
  const formats = new Map<string, string>();
  for (const row of details) {
    if (row.foundationId && row.foundationName) foundations.set(row.foundationId, row.foundationName);
    if (row.projectId && row.projectName) projects.set(row.projectId, row.projectName);
    // Keyed on the name: several course ids share one (course versions), and one entry has to cover all of their rows.
    if (row.courseName) courses.set(row.courseName, row.courseName);
    if (row.courseLevel) levels.set(row.courseLevel, row.courseLevel);
    if (row.courseFormat) formats.set(row.courseFormat, row.courseFormat);
  }
  const toOptions = (entries: Map<string, string>): OrgDropdownOption[] =>
    [...entries].map(([value, label]) => ({ label, value })).sort((a, b) => a.label.localeCompare(b.label));
  return {
    foundations: toOptions(foundations),
    projects: toOptions(projects),
    courses: toOptions(courses),
    levels: toOptions(levels),
    formats: toOptions(formats),
  };
}

/**
 * `ACTIVITY_TS` (enrollment or certificate date) on or after N days before today; empty for all time. Inline, not bound —
 * the day count comes from the allow-listed range — so the planner can fold it.
 */
function trainingRangePredicate(range: OrgLensTimeRange): string {
  return range === 'all' ? '' : `AND ACTIVITY_TS >= DATEADD(day, -${orgLensTimeRangeDays(range)}, CURRENT_DATE())`;
}

/**
 * Compacts the raw reads for Valkey storage (GH-1906).
 *
 * Same shape of waste as the event-attendees payload: `detailRows` is grained per (person,
 * course-or-cert), so every row for a course repeats that course's columns
 * ({@link ORG_TRAINEE_COURSE_DICTIONARY_COLUMNS}). Those are stored once per distinct set; what stays
 * per row is `PERSON_KEY`, `STATUS`, `COURSE_OR_CERT_ID` (the enrollment/certification instance,
 * genuinely per row) and `ACTIVITY_TS`.
 */
function encodeTraineesRaw(raw: {
  traineeRows: OrgPeopleAllTraineeRow[];
  outsideLearnerRows: OrgTrainingOutsideLearnerRow[];
  detailRows: OrgPeopleTrainingRow[];
  asOf: string | null;
}): CompactOrgTraineesRawCache {
  // Keyed on the whole tuple, not on COURSE_ID: two rows sharing a course id but disagreeing on a
  // name or foundation must not collapse onto the first one seen, or the rebuilt rows would differ
  // from the uncached ones. COURSE_ID is also nullable, and the tuple key handles that for free.
  // Keyed once per row and reused for both the dictionary and the index array: the key is the
  // expensive part of the encode, and computing it twice per row bought nothing.
  const keys = new Map<OrgPeopleTrainingRow, string>(
    raw.detailRows.map((row) => [row, tupleKey(ORG_TRAINEE_COURSE_DICTIONARY_COLUMNS.map((column) => row[column]))])
  );
  const courses = dedupeByKey(raw.detailRows, (row) => keys.get(row)!);

  return {
    traineeRows: toColumnar(raw.traineeRows, ORG_TRAINEE_ROW_COLUMNS),
    outsideLearnerRows: toColumnar(raw.outsideLearnerRows, ORG_TRAINEE_OUTSIDE_LEARNER_COLUMNS),
    courses: toColumnar(courses.values, ORG_TRAINEE_COURSE_DICTIONARY_COLUMNS),
    details: toColumnar(raw.detailRows, ORG_TRAINEE_DETAIL_COLUMNS),
    // Every detail row was part of the set `courses` was built from, so the lookup always resolves.
    detailCourses: raw.detailRows.map((row) => courses.indexOf.get(keys.get(row)!)!),
    asOf: raw.asOf,
  };
}

/** Rebuilds the raw rows {@link encodeTraineesRaw} stored, so the mapping above sees exactly what a cache miss would hand it. */
function decodeTraineesRaw(value: CompactOrgTraineesRawCache): {
  traineeRows: OrgPeopleAllTraineeRow[];
  outsideLearnerRows: OrgTrainingOutsideLearnerRow[];
  detailRows: OrgPeopleTrainingRow[];
  asOf: string | null;
} {
  const courses = fromColumnar<OrgPeopleTrainingRow>(value.courses);
  const detailRows = fromColumnar<OrgPeopleTrainingRow>(value.details);
  detailRows.forEach((row, index) => Object.assign(row, courses[value.detailCourses[index]]));
  return {
    traineeRows: fromColumnar<OrgPeopleAllTraineeRow>(value.traineeRows),
    outsideLearnerRows: fromColumnar<OrgTrainingOutsideLearnerRow>(value.outsideLearnerRows),
    detailRows,
    asOf: value.asOf,
  };
}

function isCompactTraineesRaw(value: unknown): boolean {
  const cache = value as Partial<CompactOrgTraineesRawCache> | null;
  if (
    !cache ||
    typeof cache !== 'object' ||
    // Required, not optional: a `v4`-shaped entry under this key would otherwise serve no as-of date for the whole TTL.
    !(cache.asOf === null || typeof cache.asOf === 'string') ||
    !isColumnarTable(cache.traineeRows) ||
    !isColumnarTable(cache.outsideLearnerRows) ||
    !isColumnarTable(cache.courses) ||
    !isColumnarTable(cache.details) ||
    // Exact columns, not a subset: a duplicated, extra, reordered or short-rowed entry decodes
    // "successfully" into rows missing data the writer always emits, which is worse than a miss —
    // the tab renders with holes in it for the rest of the TTL instead of refetching.
    !hasExactColumns(cache.traineeRows, ORG_TRAINEE_ROW_COLUMNS) ||
    !hasExactColumns(cache.outsideLearnerRows, ORG_TRAINEE_OUTSIDE_LEARNER_COLUMNS) ||
    !hasExactColumns(cache.courses, ORG_TRAINEE_COURSE_DICTIONARY_COLUMNS) ||
    !hasExactColumns(cache.details, ORG_TRAINEE_DETAIL_COLUMNS)
  ) {
    return false;
  }
  // Exact columns prove the SHAPE; these prove the VALUES, and both are needed — the column check
  // does NOT subsume them. A current-shape entry whose required cell is absent or mistyped decodes
  // into a row the mapper then reads, so it has to be a miss.
  // A guard must never be STRICTER than the uncached path: the mapper passes a null column straight
  // through, so demanding a string would turn one null row into a permanent miss for that org.
  // Absence and wrong types are still rejected — those the mapper cannot survive.
  const personKeyIndex = ORG_TRAINEE_DETAIL_COLUMNS.indexOf('PERSON_KEY');
  const courseOrCertIndex = ORG_TRAINEE_DETAIL_COLUMNS.indexOf('COURSE_OR_CERT_ID');
  const traineeKeyIndex = ORG_TRAINEE_ROW_COLUMNS.indexOf('PERSON_KEY');
  const outsideKeyIndex = ORG_TRAINEE_OUTSIDE_LEARNER_COLUMNS.indexOf('PERSON_KEY');
  if (
    !cache.details.r.every((row) => isStoredNullableString(row[personKeyIndex]) && isStoredNullableString(row[courseOrCertIndex])) ||
    !cache.traineeRows.r.every((row) => isStoredNullableString(row[traineeKeyIndex])) ||
    !cache.outsideLearnerRows.r.every((row) => isStoredNullableString(row[outsideKeyIndex]))
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

/** A required stored cell: present (not the absence marker) and a string. */
function isStoredString(cell: unknown): boolean {
  return typeof cell === 'string' && !isColumnarAbsent(cell);
}

/** As {@link isStoredString}, but `null` is a legal warehouse value the uncached mapper already handles. */
function isStoredNullableString(cell: unknown): boolean {
  return cell === null || isStoredString(cell);
}
