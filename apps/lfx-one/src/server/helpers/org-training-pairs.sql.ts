// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { CERTIFICATION_PRODUCT_TYPE, MAX_ORG_TRAINING_FILTER_VALUE_LENGTH } from '@lfx-one/shared/constants';
import type { OrgLensTimeRange, OrgTrainingGroupBy, OrgTrainingStatsQuery, OrgTrainingTabId } from '@lfx-one/shared/interfaces';
import { orgLensTimeRangeDays } from '@lfx-one/shared/utils';

const PEOPLE_TRAINING_TABLE = 'ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_TRAINING';

/**
 * A free-text attribute as a request value names it: leading and trailing spaces trimmed (Snowflake `TRIM` takes spaces only, as
 * `normalizeOrgTrainingFilterValue` in shared utils), cut to the filter value length, and blank as NULL. The pairs read the course name, level
 * and format this way, so a pair's attribute, its filter, its group key and its dropdown option are one string.
 */
function normalizedAttribute(column: string): string {
  return `NULLIF(TRIM(LEFT(TRIM(${column}), ${MAX_ORG_TRAINING_FILTER_VALUE_LENGTH})), '')`;
}

/** Pair attribute column each filter narrows (all bound as params, never inlined). */
const FILTER_COLUMNS = {
  foundation: 'FOUNDATION_ID',
  project: 'PROJECT_ID',
  course: 'COURSE_NAME',
  level: 'COURSE_LEVEL',
  format: 'COURSE_FORMAT',
} as const;

/** Key / label SQL expressions of each group-by (over the `f` pairs). */
export const ORG_TRAINING_GROUP_SQL: Readonly<Record<OrgTrainingGroupBy, { key: string; label: string }>> = {
  course: { key: "COALESCE(COURSE_NAME, '')", label: 'MAX(COURSE_NAME)' },
  foundation: { key: "COALESCE(FOUNDATION_ID, '')", label: 'MAX(FOUNDATION_NAME)' },
  project: { key: "COALESCE(PROJECT_ID, '')", label: 'MAX(PROJECT_NAME)' },
  level: { key: "COALESCE(COURSE_LEVEL, '')", label: 'MAX(COURSE_LEVEL)' },
  format: { key: "COALESCE(COURSE_FORMAT, '')", label: 'MAX(COURSE_FORMAT)' },
};

/**
 * `ACTIVITY_TS` (enrollment or certificate date) on or after N days before today; empty for all time. Inline, not bound:
 * the day count comes from the allow-listed range.
 */
export function orgTrainingRangePredicate(range: OrgLensTimeRange): string {
  return range === 'all' ? '' : `AND ACTIVITY_TS >= DATEADD(day, -${orgLensTimeRangeDays(range)}, CURRENT_DATE())`;
}

/** Product-type split of the Training page tabs; a pair without a product type counts as a Training. */
export function orgTrainingTabPredicate(tab: OrgTrainingTabId): string {
  return tab === 'certifications' ? `PRODUCT_TYPE = '${CERTIFICATION_PRODUCT_TYPE}'` : `COALESCE(PRODUCT_TYPE, '') <> '${CERTIFICATION_PRODUCT_TYPE}'`;
}

/** Pair status predicate of the drawers: completed = certified pairs, in-progress = enrolled pairs. */
export function orgTrainingStatusPredicate(status: 'completed' | 'in-progress'): string {
  return status === 'completed' ? 'IS_CERTIFIED' : 'NOT IS_CERTIFIED';
}

/**
 * The one definition of a person-course pair in a range: `WITH rows_in_range, pairs, f` where `f` is the pairs of the
 * org's people list left after the filters. Every Training / Trainees number reads `f`, so the same query always counts
 * the same pairs. A pair exists when it has a row in range; it is Certified when any of them is a certificate. The pair's
 * attributes (the course name, level and format trimmed of spaces, see `normalizedAttribute`) are resolved from ALL its in-range rows first (the highest value of each, names by the highest id, the format
 * of the latest row that has one: a certificate row without a format never erases the enrollment's), and only then do the
 * filters apply, so a filter never turns a certified pair into an enrolled one. `resolveOrgTraineePairs` mirrors this.
 * Binds: `[accountId, ...set filter values in foundation, project, course, level, format order]`.
 */
export function buildOrgTrainingPairsCte(accountId: string, query: OrgTrainingStatsQuery): { cte: string; binds: string[] } {
  const binds: string[] = [accountId];
  const conditions: string[] = [];
  for (const key of Object.keys(FILTER_COLUMNS) as (keyof typeof FILTER_COLUMNS)[]) {
    const value = query[key];
    if (value !== null) {
      conditions.push(`AND ${FILTER_COLUMNS[key]} = ?`);
      binds.push(value);
    }
  }

  const cte = `
    rows_in_range AS (
      SELECT
        PERSON_KEY,
        COALESCE(COURSE_ID, COURSE_OR_CERT_ID) AS COURSE_KEY,
        STATUS,
        ACTIVITY_TS,
        PRODUCT_TYPE,
        FOUNDATION_ID,
        FOUNDATION_NAME,
        PROJECT_ID,
        PROJECT_NAME,
        ${normalizedAttribute('COURSE_NAME')}   AS COURSE_NAME,
        ${normalizedAttribute('COURSE_LEVEL')}  AS COURSE_LEVEL,
        ${normalizedAttribute('COURSE_FORMAT')} AS COURSE_FORMAT
      FROM ${PEOPLE_TRAINING_TABLE}
      WHERE ACCOUNT_ID = ?
        AND IS_ON_PEOPLE_LIST
        AND STATUS IN ('Enrolled', 'Certified')
        AND ACTIVITY_TS IS NOT NULL
        ${orgTrainingRangePredicate(query.range)}
    ),
    pairs AS (
      SELECT
        PERSON_KEY,
        COURSE_KEY,
        BOOLOR_AGG(STATUS = 'Certified')        AS IS_CERTIFIED,
        MAX(PRODUCT_TYPE)                       AS PRODUCT_TYPE,
        MAX(FOUNDATION_ID)                      AS FOUNDATION_ID,
        MAX_BY(FOUNDATION_NAME, FOUNDATION_ID)  AS FOUNDATION_NAME,
        MAX(PROJECT_ID)                         AS PROJECT_ID,
        MAX_BY(PROJECT_NAME, PROJECT_ID)        AS PROJECT_NAME,
        MAX(COURSE_NAME)                        AS COURSE_NAME,
        MAX(COURSE_LEVEL)                       AS COURSE_LEVEL,
        MAX_BY(COURSE_FORMAT, IFF(COURSE_FORMAT IS NOT NULL, ACTIVITY_TS, NULL)) AS COURSE_FORMAT
      FROM rows_in_range
      GROUP BY PERSON_KEY, COURSE_KEY
    ),
    f AS (
      SELECT * FROM pairs
      WHERE 1 = 1
        ${conditions.join('\n        ')}
    )
  `;

  return { cte, binds };
}

/** Key-safe sub-resource suffix for result-changing params (base64url JSON, only `[A-Za-z0-9_-]`). */
export function orgTrainingParamSignature(parts: readonly (string | number | boolean | null)[]): string {
  return Buffer.from(JSON.stringify(parts), 'utf8').toString('base64url');
}
