// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import type { OrgLensTimeRange, OrgTrainingGroupBy, OrgTrainingStatsQuery, OrgTrainingTabId } from '@lfx-one/shared/interfaces';
import { orgLensTimeRangeDays } from '@lfx-one/shared/utils';

export const ORG_TRAINING_PAIRS_TABLE = 'ANALYTICS.PLATINUM_LFX_ONE.ORG_PEOPLE_TRAINING_PAIRS';

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

export function orgTrainingBuildRangePredicate(range: OrgLensTimeRange, accountId: string): { sql: string; binds: string[] } {
  if (range === 'all') return { sql: '', binds: [] };
  return {
    sql: `AND ACTIVITY_TS >= DATEADD(day, -${orgLensTimeRangeDays(range)}, TO_DATE((SELECT MAX(DBT_RUN_AT) FROM ${ORG_TRAINING_PAIRS_TABLE} WHERE ACCOUNT_ID = ?)))`,
    binds: [accountId],
  };
}

export function orgTrainingTabPredicate(tab: OrgTrainingTabId): string {
  return tab === 'certifications' ? "TRAINING_TAB = 'certifications'" : "TRAINING_TAB = 'trainings'";
}

/** Pair status predicate of the drawers: completed = certified pairs, in-progress = enrolled pairs. */
export function orgTrainingStatusPredicate(status: 'completed' | 'in-progress'): string {
  return status === 'completed' ? 'IS_CERTIFIED' : 'NOT IS_CERTIFIED';
}

/** `ACCOUNT_ID = ?` for one account, `ACCOUNT_ID IN (?, …)` for a family's; the account ids are bound, in order. */
export function orgTrainingAccountPredicate(accounts: readonly string[]): string {
  return accounts.length === 1 ? 'ACCOUNT_ID = ?' : `ACCOUNT_ID IN (${accounts.map(() => '?').join(', ')})`;
}

/**
 * The warehouse-resolved pairs of the people lists of one account or of a family's accounts as CTE `f`, narrowed to the
 * range and the set filters; one row per account and pair. `PAIR_KEY` and `PERSON_KEY` are the same in every account, so a
 * distinct count over a family counts each pair and each person once.
 * Binds: `[...accounts, range, ...set filter values in foundation, project, course, level, format order]`.
 */
export function buildOrgTrainingPairsCte(accounts: string | readonly string[], query: OrgTrainingStatsQuery): { cte: string; binds: string[] } {
  const accountIds = typeof accounts === 'string' ? [accounts] : [...accounts];
  const binds: string[] = [...accountIds, query.range];
  const conditions: string[] = [];
  for (const key of Object.keys(FILTER_COLUMNS) as (keyof typeof FILTER_COLUMNS)[]) {
    const value = query[key];
    if (value !== null) {
      conditions.push(`AND ${FILTER_COLUMNS[key]} = ?`);
      binds.push(value);
    }
  }

  const cte = `
    f AS (
      SELECT
        ACCOUNT_ID,
        PERSON_KEY,
        PAIR_KEY,
        IS_CERTIFIED,
        TRAINING_TAB,
        FOUNDATION_ID,
        FOUNDATION_NAME,
        PROJECT_ID,
        PROJECT_NAME,
        COURSE_NAME,
        COURSE_LEVEL,
        COURSE_FORMAT
      FROM ${ORG_TRAINING_PAIRS_TABLE}
      WHERE ${orgTrainingAccountPredicate(accountIds)}
        AND TIME_RANGE = ?
        AND IS_ON_PEOPLE_LIST
        ${conditions.join('\n        ')}
    )
  `;

  return { cte, binds };
}

/** Key-safe sub-resource suffix for result-changing params (base64url JSON, only `[A-Za-z0-9_-]`). */
export function orgTrainingParamSignature(parts: readonly (string | number | boolean | null)[]): string {
  return Buffer.from(JSON.stringify(parts), 'utf8').toString('base64url');
}
