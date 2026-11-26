// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  EMPTY_ORG_TRAINEES_RESPONSE,
  ORG_TRAINEE_COURSE_DICTIONARY_COLUMNS,
  ORG_TRAINEE_DATE_COLUMNS,
  ORG_TRAINEE_OUTSIDE_KEY_PREFIX,
  ORG_TRAINEE_OUTSIDE_LEARNER_COLUMNS,
  ORG_TRAINEE_PAIR_COLUMNS,
  ORG_TRAINEE_ROW_COLUMNS,
  VALKEY_CACHE,
} from '@lfx-one/shared/constants';
import type {
  CompactOrgTraineesRawCache,
  OrgLensReadQualification,
  OrgLensTimeRange,
  OrgPeopleAllTraineeRow,
  OrgPeopleTrainingDateRow,
  OrgPeopleTrainingPairRow,
  OrgTraineeDateRow,
  OrgTraineeDetailRow,
  OrgTraineeOutsideLearner,
  OrgTraineePair,
  OrgTraineeRow,
  OrgTraineesRaw,
  OrgTraineesResponse,
  OrgTrainingOutsideLearnerRow,
  TraineeAsOfRow,
} from '@lfx-one/shared/interfaces';
import { dedupeByKey, fromColumnar, hasExactColumns, isColumnarAbsent, isColumnarTable, toColumnar, tupleKey } from '@lfx-one/shared/utils';

import { toIsoTimestamp } from '../helpers/date-format.helper';
import { ORG_TRAINING_PAIRS_TABLE, orgTrainingBuildRangePredicate } from '../helpers/org-training-pairs.sql';
import { SnowflakeService } from './snowflake.service';
import { withOrgCompactCache } from './valkey.service';

export class OrgPeopleTraineesService {
  private readonly snowflakeService: SnowflakeService;

  public constructor() {
    this.snowflakeService = SnowflakeService.getInstance();
  }

  /**
   * Returns the range's trainees, their warehouse-resolved training pairs, the date rows for the expanded sub-table, and
   * the learners outside the people list.
   *
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

    const { traineeRows, outsideLearnerRows, pairRows, dateRows, formerOnPeopleList, asOf } =
      qualification === 'org-grant'
        ? await withOrgCompactCache(
            accountId,
            `people-trainees:v11:${range}`,
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

    const listedKeys = new Set(trainees.map((row) => row.personKey));
    let opaqueCount = 0;

    // Name and one overall status only (lfx-self-serve#4287): no warehouse key, ids, course, project, foundation, level,
    // format or date leaves the BFF for these learners.
    const outsideLearners: OrgTraineeOutsideLearner[] = outsideLearnerRows.map((row) => ({
      personKey: `${ORG_TRAINEE_OUTSIDE_KEY_PREFIX}${++opaqueCount}`,
      name: row.LEARNER_NAME || null,
      status: row.IS_CERTIFIED === true ? 'Certified' : 'Enrolled',
    }));

    const pairs: OrgTraineePair[] = pairRows.flatMap<OrgTraineePair>((row) =>
      listedKeys.has(row.PERSON_KEY)
        ? [
            {
              personKey: row.PERSON_KEY,
              courseId: row.COURSE_KEY,
              status: row.IS_CERTIFIED === true ? 'Certified' : 'Enrolled',
              productType: row.PRODUCT_TYPE,
              courseName: row.COURSE_NAME,
              courseLevel: row.COURSE_LEVEL,
              courseFormat: row.COURSE_FORMAT,
              foundationId: row.FOUNDATION_ID,
              foundationName: row.FOUNDATION_NAME,
              projectId: row.PROJECT_ID,
              projectName: row.PROJECT_NAME,
              lastActivityTs: toIsoTimestamp(row.LAST_ACTIVITY_TS),
            },
          ]
        : []
    );

    const pairByKey = new Map<string, OrgTraineePair>(pairs.map((pair) => [pairKeyOf(pair.personKey, pair.courseId), pair]));
    const details: OrgTraineeDetailRow[] = dateRows.flatMap<OrgTraineeDetailRow>((row) => {
      const activityTs = toIsoTimestamp(row.ACTIVITY_TS);
      const pair = pairByKey.get(pairKeyOf(row.PERSON_KEY, row.COURSE_KEY));
      if (!activityTs || !pair || (row.STATUS !== 'Enrolled' && row.STATUS !== 'Certified')) return [];
      return [
        {
          personKey: row.PERSON_KEY,
          courseId: row.COURSE_KEY,
          status: row.STATUS,
          activityTs,
          // Remove after one release: tabs loaded before pairs were served still count and filter from these.
          productType: pair.productType,
          courseName: pair.courseName,
          courseLevel: pair.courseLevel,
          courseFormat: pair.courseFormat,
          foundationId: pair.foundationId,
          foundationName: pair.foundationName,
          projectId: pair.projectId,
          projectName: pair.projectName,
        },
      ];
    });

    return {
      accountId,
      timeRange: range,
      trainees,
      pairs,
      details,
      outsideLearners,
      formerOnPeopleList,
      asOf,
    };
  }

  private async fetchTraineesRaw(accountId: string, range: OrgLensTimeRange): Promise<OrgTraineesRaw> {
    const [traineeRows, outsideLearnerRows, allPairRows, allDateRows, asOf] = await Promise.all([
      this.fetchTraineeRows(accountId, range),
      this.fetchOutsideLearnerRows(accountId, range),
      this.fetchPairRows(accountId, range),
      this.fetchDateRows(accountId, range),
      this.fetchAsOf(accountId),
    ]);
    const listedKeys = new Set(traineeRows.map((row) => row.PERSON_KEY));
    const pairRows = allPairRows.filter((row) => listedKeys.has(row.PERSON_KEY));
    const pairKeys = new Set(pairRows.map((row) => pairKeyOf(row.PERSON_KEY, row.COURSE_KEY)));
    const dateRows = allDateRows.flatMap<OrgTraineeDateRow>((row) => {
      const courseKey = row.COURSE_ID ?? row.COURSE_OR_CERT_ID;
      return pairKeys.has(pairKeyOf(row.PERSON_KEY, courseKey))
        ? [{ PERSON_KEY: row.PERSON_KEY, COURSE_KEY: courseKey, STATUS: row.STATUS, ACTIVITY_TS: row.ACTIVITY_TS }]
        : [];
    });
    const formerPairs = allPairRows.filter((row) => !listedKeys.has(row.PERSON_KEY));
    const formerOnPeopleList = { people: new Set(formerPairs.map((row) => row.PERSON_KEY)).size, pairs: formerPairs.length };
    return { traineeRows, outsideLearnerRows, pairRows, dateRows, formerOnPeopleList, asOf };
  }

  private async fetchTraineeRows(accountId: string, range: OrgLensTimeRange): Promise<OrgPeopleAllTraineeRow[]> {
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
          FROM ${ORG_TRAINING_PAIRS_TABLE}
          WHERE ACCOUNT_ID = ?
            AND TIME_RANGE = ?
            AND IS_ON_PEOPLE_LIST
        )
      ORDER BY NAME ASC NULLS LAST
    `;
    const result = await this.snowflakeService.execute<OrgPeopleAllTraineeRow>(query, [accountId, accountId, range]);
    return result.rows;
  }

  private async fetchOutsideLearnerRows(accountId: string, range: OrgLensTimeRange): Promise<OrgTrainingOutsideLearnerRow[]> {
    const query = `
      SELECT
        o.LEARNER_NAME,
        p.IS_CERTIFIED
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_TRAINING_OUTSIDE_LEARNERS o
      INNER JOIN (
        SELECT
          PERSON_KEY,
          BOOLOR_AGG(IS_CERTIFIED) AS IS_CERTIFIED
        FROM ${ORG_TRAINING_PAIRS_TABLE}
        WHERE ACCOUNT_ID = ?
          AND TIME_RANGE = ?
          AND NOT IS_ON_PEOPLE_LIST
          AND PERSON_KEY NOT IN (
            SELECT PERSON_KEY
            FROM ${ORG_TRAINING_PAIRS_TABLE}
            WHERE ACCOUNT_ID = ?
              AND TIME_RANGE = ?
              AND IS_ON_PEOPLE_LIST
              AND PERSON_KEY IS NOT NULL
          )
        GROUP BY PERSON_KEY
      ) p
        ON p.PERSON_KEY = o.PERSON_KEY
      WHERE o.ACCOUNT_ID = ?
      ORDER BY o.LEARNER_NAME ASC NULLS LAST
    `;
    const result = await this.snowflakeService.execute<OrgTrainingOutsideLearnerRow>(query, [accountId, range, accountId, range, accountId]);
    return result.rows;
  }

  private async fetchPairRows(accountId: string, range: OrgLensTimeRange): Promise<OrgPeopleTrainingPairRow[]> {
    const query = `
      SELECT
        PERSON_KEY,
        COURSE_KEY,
        IS_CERTIFIED,
        PRODUCT_TYPE,
        COURSE_NAME,
        COURSE_LEVEL,
        COURSE_FORMAT,
        FOUNDATION_ID,
        FOUNDATION_NAME,
        PROJECT_ID,
        PROJECT_NAME,
        LAST_ACTIVITY_TS
      FROM ${ORG_TRAINING_PAIRS_TABLE}
      WHERE ACCOUNT_ID = ?
        AND TIME_RANGE = ?
        AND IS_ON_PEOPLE_LIST
      ORDER BY PERSON_KEY ASC, COURSE_KEY ASC
    `;
    const result = await this.snowflakeService.execute<OrgPeopleTrainingPairRow>(query, [accountId, range]);
    return result.rows;
  }

  private async fetchDateRows(accountId: string, range: OrgLensTimeRange): Promise<OrgPeopleTrainingDateRow[]> {
    const inRange = orgTrainingBuildRangePredicate(range, accountId);
    const query = `
      SELECT
        PERSON_KEY,
        COURSE_ID,
        COURSE_OR_CERT_ID,
        STATUS,
        ACTIVITY_TS
      FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_TRAINING
      WHERE ACCOUNT_ID = ?
        AND IS_ON_PEOPLE_LIST
        AND STATUS IN ('Enrolled', 'Certified')
        AND ACTIVITY_TS IS NOT NULL
        ${inRange.sql}
      ORDER BY PERSON_KEY ASC, ACTIVITY_TS DESC
    `;
    const result = await this.snowflakeService.execute<OrgPeopleTrainingDateRow>(query, [accountId, ...inRange.binds]);
    return result.rows;
  }

  private async fetchAsOf(accountId: string): Promise<string | null> {
    const query = `
      SELECT MAX(DBT_RUN_AT) AS AS_OF
      FROM ${ORG_TRAINING_PAIRS_TABLE}
      WHERE ACCOUNT_ID = ?
    `;
    const result = await this.snowflakeService.execute<TraineeAsOfRow>(query, [accountId]);
    return toIsoTimestamp(result.rows[0]?.AS_OF);
  }
}

function pairKeyOf(personKey: string, courseKey: string): string {
  return tupleKey([personKey, courseKey]);
}

/**
 * Compacts the raw reads for Valkey storage (GH-1906).
 */
function encodeTraineesRaw(raw: OrgTraineesRaw): CompactOrgTraineesRawCache {
  const keys = new Map<OrgPeopleTrainingPairRow, string>(
    raw.pairRows.map((row) => [row, tupleKey(ORG_TRAINEE_COURSE_DICTIONARY_COLUMNS.map((column) => row[column]))])
  );
  const courses = dedupeByKey(raw.pairRows, (row) => keys.get(row)!);
  const pairIndex = new Map<string, number>(raw.pairRows.map((row, index) => [pairKeyOf(row.PERSON_KEY, row.COURSE_KEY), index]));
  const dateRows = raw.dateRows.filter((row) => pairIndex.has(pairKeyOf(row.PERSON_KEY, row.COURSE_KEY)));

  return {
    traineeRows: toColumnar(raw.traineeRows, ORG_TRAINEE_ROW_COLUMNS),
    outsideLearnerRows: toColumnar(raw.outsideLearnerRows, ORG_TRAINEE_OUTSIDE_LEARNER_COLUMNS),
    courses: toColumnar(courses.values, ORG_TRAINEE_COURSE_DICTIONARY_COLUMNS),
    pairs: toColumnar(raw.pairRows, ORG_TRAINEE_PAIR_COLUMNS),
    pairCourses: raw.pairRows.map((row) => courses.indexOf.get(keys.get(row)!)!),
    dates: toColumnar(dateRows, ORG_TRAINEE_DATE_COLUMNS),
    datePairs: dateRows.map((row) => pairIndex.get(pairKeyOf(row.PERSON_KEY, row.COURSE_KEY))!),
    formerOnPeopleList: raw.formerOnPeopleList,
    asOf: raw.asOf,
  };
}

/** Rebuilds the raw rows {@link encodeTraineesRaw} stored, so the mapping above sees exactly what a cache miss would hand it. */
function decodeTraineesRaw(value: CompactOrgTraineesRawCache): OrgTraineesRaw {
  const courses = fromColumnar<OrgPeopleTrainingPairRow>(value.courses);
  const pairRows = fromColumnar<OrgPeopleTrainingPairRow>(value.pairs);
  pairRows.forEach((row, index) => Object.assign(row, courses[value.pairCourses[index]]));
  const dateRows = fromColumnar<OrgTraineeDateRow>(value.dates);
  dateRows.forEach((row, index) => {
    const pair = pairRows[value.datePairs[index]];
    row.PERSON_KEY = pair.PERSON_KEY;
    row.COURSE_KEY = pair.COURSE_KEY;
  });
  return {
    traineeRows: fromColumnar<OrgPeopleAllTraineeRow>(value.traineeRows),
    outsideLearnerRows: fromColumnar<OrgTrainingOutsideLearnerRow>(value.outsideLearnerRows),
    pairRows,
    dateRows,
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
    !isColumnarTable(cache.pairs) ||
    !isColumnarTable(cache.dates) ||
    // Exact columns, not a subset: a duplicated, extra, reordered or short-rowed entry decodes
    // "successfully" into rows missing data the writer always emits, which is worse than a miss —
    // the tab renders with holes in it for the rest of the TTL instead of refetching.
    !hasExactColumns(cache.traineeRows, ORG_TRAINEE_ROW_COLUMNS) ||
    !hasExactColumns(cache.outsideLearnerRows, ORG_TRAINEE_OUTSIDE_LEARNER_COLUMNS) ||
    !hasExactColumns(cache.courses, ORG_TRAINEE_COURSE_DICTIONARY_COLUMNS) ||
    !hasExactColumns(cache.pairs, ORG_TRAINEE_PAIR_COLUMNS) ||
    !hasExactColumns(cache.dates, ORG_TRAINEE_DATE_COLUMNS)
  ) {
    return false;
  }
  // Exact columns prove the SHAPE; these prove the VALUES, and both are needed — the column check
  // does NOT subsume them. A current-shape entry whose required cell is absent or mistyped decodes
  // into a row the mapper then reads, so it has to be a miss.
  // A guard must never be STRICTER than the uncached path: the mapper passes a null column straight
  // through, so demanding a string would turn one null row into a permanent miss for that org.
  // Absence and wrong types are still rejected — those the mapper cannot survive.
  const pairPersonIndex = ORG_TRAINEE_PAIR_COLUMNS.indexOf('PERSON_KEY');
  const courseKeyIndex = ORG_TRAINEE_COURSE_DICTIONARY_COLUMNS.indexOf('COURSE_KEY');
  const traineeKeyIndex = ORG_TRAINEE_ROW_COLUMNS.indexOf('PERSON_KEY');
  if (
    !cache.pairs.r.every((row) => isStoredString(row[pairPersonIndex])) ||
    !cache.courses.r.every((row) => isStoredString(row[courseKeyIndex])) ||
    !cache.traineeRows.r.every((row) => isStoredNullableString(row[traineeKeyIndex]))
  ) {
    return false;
  }
  return (
    isIndexArray(cache.pairCourses, cache.pairs.r.length, cache.courses.r.length) && isIndexArray(cache.datePairs, cache.dates.r.length, cache.pairs.r.length)
  );
}

function isIndexArray(value: unknown, length: number, size: number): boolean {
  return Array.isArray(value) && value.length === length && value.every((index) => Number.isInteger(index) && index >= 0 && index < size);
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
