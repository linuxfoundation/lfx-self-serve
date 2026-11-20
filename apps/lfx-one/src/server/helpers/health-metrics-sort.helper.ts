// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HEALTH_METRICS_SORT_TRIM_CODE_POINTS, HEALTH_METRICS_TABLE_DASH } from '@lfx-one/shared/constants';
// Deep import, as across the server: the `utils` barrel loads `@angular/forms`, which throws in the Node spec runtime.
import { healthMetricsTierSortRanks } from '@lfx-one/shared/utils/health-metrics-table.utils';

import type { HealthMetricsSqlSortColumn, HealthMetricsTableSort } from '@lfx-one/shared/interfaces';

/**
 * A server-paged table's ORDER BY body. A sort puts its column first, empty values last in both directions, then the
 * default order, so pages stay stable; no sort keeps the default. Every piece is trusted SQL from the service.
 */
export function buildHealthMetricsSortOrderBy<K extends string>(
  sort: HealthMetricsTableSort<K> | null,
  columns: Readonly<Record<K, HealthMetricsSqlSortColumn>>,
  defaultOrder: string
): string {
  if (!sort || !Object.prototype.hasOwnProperty.call(columns, sort.key)) return defaultOrder;

  const direction = sort.direction === 'asc' ? 'ASC' : 'DESC';
  return `${sortExpression(columns[sort.key])} ${direction} NULLS LAST, ${defaultOrder}`;
}

/** A tier column as its rank, matching `healthMetricsTierSortRank`: Diamond highest, Non-member 0, no tier `NULL`. */
export function healthMetricsTierRankSql(expression: string): string {
  const trimmed = trimmedSql(expression);
  const name = `REGEXP_REPLACE(LOWER(${trimmed}), '[^a-z]', '')`;
  const ranks = healthMetricsTierSortRanks()
    .map((tier) => `WHEN ${name} IN (${tier.names.map((alias) => `'${alias}'`).join(', ')}) THEN ${tier.rank}`)
    .join(' ');
  return `CASE WHEN ${emptyTextSql(trimmed)} THEN NULL ${ranks} ELSE 1 END`;
}

/** Case- and accent-insensitive, as the client's base-sensitivity collator; blank and "—" are empty, so they sort last. */
function sortExpression(column: HealthMetricsSqlSortColumn): string {
  if (column.kind === 'text') return `COLLATE(NULLIF(NULLIF(${trimmedSql(column.expression)}, ''), '${HEALTH_METRICS_TABLE_DASH}'), 'en-ci-ai')`;
  if (column.kind === 'tier') return healthMetricsTierRankSql(column.expression);
  return column.expression;
}

/** Trims the whitespace the client's `trim()` does, written as Snowflake `\uXXXX` escapes so the SQL stays ASCII. */
function trimmedSql(expression: string): string {
  const characters = HEALTH_METRICS_SORT_TRIM_CODE_POINTS.map((code) => `\\u${code.toString(16).padStart(4, '0')}`).join('');
  return `TRIM(${expression}, '${characters}')`;
}

function emptyTextSql(trimmed: string): string {
  return `${trimmed} IS NULL OR ${trimmed} IN ('', '${HEALTH_METRICS_TABLE_DASH}')`;
}
