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
  OrgLensTimeRange,
  OrgPeopleAllTraineeRow,
  OrgPeopleTrainingRow,
  OrgTraineeDetailRow,
  OrgTraineeFormerOnPeopleListCounts,
  OrgTraineeOutsideLearner,
  OrgTraineeRow,
  OrgTraineesResponse,
  OrgTrainingOutsideLearnerRow,
  TraineeAsOfRow,
} from '@lfx-one/shared/interfaces';
import { dedupeByKey, fromColumnar, hasExactColumns, isColumnarAbsent, isColumnarTable, toColumnar, tupleKey } from '@lfx-one/shared/utils';

import { toIsoTimestamp } from '../helpers/date-format.helper';
import type { OrgLensReadQualification } from '../helpers/org-lens-read-access.helper';
import { orgTrainingRangePredicate } from '../helpers/org-training-pairs.sql';
import { SnowflakeService } from './snowflake.service';
import { withOrgCompactCache } from './valkey.service';

/** Trainees tab data access — one GET per range: the people-list members, their course rows and the learners outside the list. The stat cards come from the shared stats call and the dropdowns from /filter-options. */
export class OrgPeopleTraineesService {
  private readonly snowflakeService: SnowflakeService;

  public constructor() {
    this.snowflakeService = SnowflakeService.getInstance();
  }

  /**
   * The range's trainees and details: parallel Snowflake reads over enrollments and certificates dated in the range.
   * The cards come from the shared stats call and the dropdowns from /filter-options, so the server ships neither here.
   *
   * Cached in the shared Valkey entry for an `org-grant` caller only; a caller the roster does not list and the authorizer
   * admitted (`auditor-entitlement`) is read directly and nothing is read from or stored in the shared cache, as on the
   * Training endpoints.
   */
  public async getTrainees(accountId: string, range: OrgLensTimeRange, qualification: OrgLensReadQualification): Promise<OrgTraineesResponse> {
    if (!accountId) {
      return { ...EMPTY_ORG_TRAINEES_RESPONSE, timeRange: range };
    }

    // `people-trainees:v10:{range}` (lfx-self-serve#4159, #4916, #4287): ORG_PEOPLE_TRAINING holds enrollments of any age,
    // so the read is windowed per range here instead of shipping every row for the client to filter. `v6` added the
    // table's build time, the project, level and format columns and the learners outside the people list (name and
    // certified flag, no detail rows), and dropped the two option reads; `v7` stops caching those learners' warehouse
    // key, so a `v6` entry, which still holds it, must miss, and reads the renamed `IS_ON_PEOPLE_LIST` column; `v8`
    // drops a learner whose warehouse key also has people-list rows in the range, so a `v7` entry may count them twice; `v9` adds the row's product type
    // (Certification | Training), so a `v8` entry without it must miss, and the dropdowns moved to /filter-options; `v10` adds
    // the counts of unlisted former employees' pairs (`formerOnPeopleList`, no keys), so a `v9` entry without them must miss.
    const { traineeRows, outsideLearnerRows, detailRows, formerOnPeopleList, asOf } =
      qualification === 'org-grant'
        ? await withOrgCompactCache(
            accountId,
            `people-trainees:v10:${range}`,
            VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
            () => this.fetchTraineesRaw(accountId, range),
            {
              encode: encodeTraineesRaw,
              decode: decodeTraineesRaw,
              accept: isCompactTraineesRaw,
            }
          )
        : await this.fetchTraineesRaw(accountId, range);

    const trainees: OrgTraineeRow[] = traineeRows.map((row) => ({
      personKey: row.PERSON_KEY,
      lfid: row.LFID,
      cdpMemberId: row.CDP_MEMBER_ID,
      name: row.NAME ?? '',
      title: row.TITLE,
      email: row.EMAIL,
    }));

    // Only people-list members keep their warehouse key, which the person drawer reads, and only their course rows are
    // sent: the cards come from /stats, so the rows of a person behind people-list training rows who has no
    // current-employee row (a former employee) have no reader. fetchTraineesRaw already drops those rows (and their
    // enrollment or certificate ids) before the cache, so this filter only guards an entry stored before that. Each learner
    // outside the people list gets an opaque per-response key from one counter. A learner whose warehouse key also has
    // people-list rows in the range is dropped before caching (see fetchTraineesRaw), so no course row on the wire is ever
    // tied to an outside learner's name.
    const listedKeys = new Set(trainees.map((row) => row.personKey));
    let opaqueCount = 0;

    // Name and one overall status only (lfx-self-serve#4287): no warehouse key, ids, course, project, foundation, level,
    // format or date leaves the BFF for these learners.
    const outsideLearners: OrgTraineeOutsideLearner[] = outsideLearnerRows.map((row) => ({
      personKey: `${ORG_TRAINEE_OUTSIDE_KEY_PREFIX}${++opaqueCount}`,
      name: row.LEARNER_NAME || null,
      status: row.IS_CERTIFIED === true ? 'Certified' : 'Enrolled',
    }));

    // Listed people's rows only (the read filters on IS_ON_PEOPLE_LIST). Drop null-ACTIVITY_TS rows; coercing to '' would
    // corrupt downstream lex sorts and most-recent derivations.
    const details: OrgTraineeDetailRow[] = detailRows.flatMap<OrgTraineeDetailRow>((row) => {
      const activityTs = countedActivityTs(row);
      if (!activityTs || !listedKeys.has(row.PERSON_KEY)) return [];
      // COURSE_ID is 100% populated for both enrolled and certified rows (verified on a large covered organization 2026-06-01).
      // Fall back to COURSE_OR_CERT_ID so the client-side `(personKey, courseId)` grouping is never keyed on '' / undefined.
      // The name is sent as the warehouse has it (null when absent): the client resolves a pair's name over real names only,
      // as the SQL MAX does, and falls back to the course id for display afterwards.
      return [
        {
          personKey: row.PERSON_KEY,
          status: row.STATUS === 'Certified' ? 'Certified' : 'Enrolled',
          courseOrCertId: row.COURSE_OR_CERT_ID,
          courseId: row.COURSE_ID ?? row.COURSE_OR_CERT_ID,
          courseName: row.COURSE_NAME,
          foundationId: row.FOUNDATION_ID,
          foundationName: row.FOUNDATION_NAME,
          projectId: row.PROJECT_ID,
          projectName: row.PROJECT_NAME,
          courseLevel: row.COURSE_LEVEL,
          courseFormat: row.COURSE_FORMAT,
          productType: row.PRODUCT_TYPE,
          activityTs,
        },
      ];
    });

    return {
      accountId,
      timeRange: range,
      trainees,
      details,
      outsideLearners,
      formerOnPeopleList,
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
    formerOnPeopleList: OrgTraineeFormerOnPeopleListCounts;
    asOf: string | null;
  }> {
    const inRange = orgTrainingRangePredicate(range);
    const [traineeRows, keyedOutsideLearnerRows, allDetailRows, asOf] = await Promise.all([
      this.fetchTraineeRows(accountId, inRange),
      this.fetchOutsideLearnerRows(accountId, inRange),
      this.fetchDetailRows(accountId, inRange),
      this.fetchAsOf(accountId),
    ]);
    // One person per warehouse key, as the Training page's COUNT(DISTINCT PERSON_KEY): a learner outside the list whose
    // key also has counted people-list rows in the range is that person, already counted (and, when listed, named)
    // through those rows, so their outside entry is dropped. lf-dbt keeps IS_ON_PEOPLE_LIST constant per key, so this
    // only guards against that invariant breaking. The key is used here only: never cached, never sent.
    const countedKeys = new Set(allDetailRows.filter((row) => countedActivityTs(row) !== null).map((row) => row.PERSON_KEY));
    const outsideLearnerRows = keyedOutsideLearnerRows.flatMap((row) =>
      countedKeys.has(row.PERSON_KEY) ? [] : [{ LEARNER_NAME: row.LEARNER_NAME, IS_CERTIFIED: row.IS_CERTIFIED }]
    );
    // Course rows of people with a current-employee row only, after the de-duplication above (which needs every people-list
    // key) and before the cache: a former employee's warehouse key and enrollment or certificate ids have no reader and are never stored.
    const listedKeys = new Set(traineeRows.map((row) => row.PERSON_KEY));
    const detailRows = allDetailRows.filter((row) => listedKeys.has(row.PERSON_KEY));
    // The cards count these people's pairs but the table lists none of them: counted here, from the same rows and the same
    // (person, course) pair rule as the stats, and only the two counts leave this method; an unlisted key never does.
    const formerOnPeopleList = countFormerOnPeopleList(allDetailRows.filter((row) => !listedKeys.has(row.PERSON_KEY)));
    return { traineeRows, outsideLearnerRows, detailRows, formerOnPeopleList, asOf };
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
            AND IS_ON_PEOPLE_LIST
            ${inRange}
        )
      ORDER BY NAME ASC NULLS LAST
    `;
    const result = await this.snowflakeService.execute<OrgPeopleAllTraineeRow>(query, [accountId, accountId]);
    return result.rows;
  }

  /**
   * Learners attributed to the organization by their enrollment who are not on the people list (lfx-self-serve#4287),
   * with a training row in the range: the name and whether any of those rows is a certificate, nothing else. The flag
   * is aggregated here so none of their course rows is read or cached. Same row rules as the detail mapping: a known
   * status and a dated row.
   */
  private async fetchOutsideLearnerRows(accountId: string, inRange: string): Promise<(OrgTrainingOutsideLearnerRow & { PERSON_KEY: string })[]> {
    // The warehouse key is selected only so fetchTraineesRaw can drop a learner already counted on the people list.
    const query = `
      SELECT
        o.PERSON_KEY,
        o.LEARNER_NAME,
        t.IS_CERTIFIED
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_TRAINING_OUTSIDE_LEARNERS o
      INNER JOIN (
        SELECT
          PERSON_KEY,
          BOOLOR_AGG(STATUS = 'Certified') AS IS_CERTIFIED
        FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_TRAINING
        WHERE ACCOUNT_ID = ?
          AND NOT IS_ON_PEOPLE_LIST
          AND STATUS IN ('Enrolled', 'Certified')
          AND ACTIVITY_TS IS NOT NULL
          ${inRange}
        GROUP BY PERSON_KEY
      ) t
        ON t.PERSON_KEY = o.PERSON_KEY
      WHERE o.ACCOUNT_ID = ?
      ORDER BY o.LEARNER_NAME ASC NULLS LAST
    `;
    const result = await this.snowflakeService.execute<OrgTrainingOutsideLearnerRow & { PERSON_KEY: string }>(query, [accountId, accountId]);
    return result.rows;
  }

  /** The people list's training rows in the range; a learner outside the list is read by {@link fetchOutsideLearnerRows}. */
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
        COURSE_FORMAT,
        PRODUCT_TYPE
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_TRAINING
      WHERE ACCOUNT_ID = ?
        AND IS_ON_PEOPLE_LIST
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
 * A detail row's activity date when the Trainees cards count the row (a known status and a parseable date), else null.
 * Shared by the detail mapping and the outside-learner dedupe, so both agree on which people the cards count.
 */
function countedActivityTs(row: OrgPeopleTrainingRow): string | null {
  if (row.STATUS !== 'Enrolled' && row.STATUS !== 'Certified') return null;
  return toIsoTimestamp(row.ACTIVITY_TS);
}

/**
 * Distinct people and distinct (person, course) pairs among the rows the cards count (a known status and a parseable date).
 * The pair is keyed as the stats' pairs CTE keys it, on `COALESCE(COURSE_ID, COURSE_OR_CERT_ID)`; each pair counts once however many
 * enrollment and certificate rows it has. Counts only: the keys stay in this function.
 */
function countFormerOnPeopleList(rows: readonly OrgPeopleTrainingRow[]): OrgTraineeFormerOnPeopleListCounts {
  const coursesByPerson = new Map<string, Set<string>>();
  for (const row of rows) {
    if (countedActivityTs(row) === null) continue;
    const courseKey = row.COURSE_ID ?? row.COURSE_OR_CERT_ID;
    const courses = coursesByPerson.get(row.PERSON_KEY);
    if (courses) courses.add(courseKey);
    else coursesByPerson.set(row.PERSON_KEY, new Set([courseKey]));
  }
  let pairs = 0;
  for (const courses of coursesByPerson.values()) pairs += courses.size;
  return { people: coursesByPerson.size, pairs };
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
  formerOnPeopleList: OrgTraineeFormerOnPeopleListCounts;
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
    formerOnPeopleList: raw.formerOnPeopleList,
    asOf: raw.asOf,
  };
}

/** Rebuilds the raw rows {@link encodeTraineesRaw} stored, so the mapping above sees exactly what a cache miss would hand it. */
function decodeTraineesRaw(value: CompactOrgTraineesRawCache): {
  traineeRows: OrgPeopleAllTraineeRow[];
  outsideLearnerRows: OrgTrainingOutsideLearnerRow[];
  detailRows: OrgPeopleTrainingRow[];
  formerOnPeopleList: OrgTraineeFormerOnPeopleListCounts;
  asOf: string | null;
} {
  const courses = fromColumnar<OrgPeopleTrainingRow>(value.courses);
  const detailRows = fromColumnar<OrgPeopleTrainingRow>(value.details);
  detailRows.forEach((row, index) => Object.assign(row, courses[value.detailCourses[index]]));
  return {
    traineeRows: fromColumnar<OrgPeopleAllTraineeRow>(value.traineeRows),
    outsideLearnerRows: fromColumnar<OrgTrainingOutsideLearnerRow>(value.outsideLearnerRows),
    detailRows,
    formerOnPeopleList: value.formerOnPeopleList,
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
    !isStoredCount(cache.formerOnPeopleList?.people) ||
    !isStoredCount(cache.formerOnPeopleList?.pairs) ||
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
  if (
    !cache.details.r.every((row) => isStoredNullableString(row[personKeyIndex]) && isStoredNullableString(row[courseOrCertIndex])) ||
    !cache.traineeRows.r.every((row) => isStoredNullableString(row[traineeKeyIndex]))
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

/** A stored count: a non-negative integer, so a `v9`-shaped entry (no counts) or a corrupt one is a miss. */
function isStoredCount(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}
