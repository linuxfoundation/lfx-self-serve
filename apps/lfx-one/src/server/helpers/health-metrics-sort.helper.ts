// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

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
  const name = `LOWER(REGEXP_REPLACE(${expression}, '[^A-Za-z]', ''))`;
  const ranks = healthMetricsTierSortRanks()
    .map((tier) => `WHEN ${name} = '${tier.name}' THEN ${tier.rank}`)
    .join(' ');
  return `CASE WHEN ${name} IS NULL OR ${name} = '' THEN NULL ${ranks} ELSE 1 END`;
}

function sortExpression(column: HealthMetricsSqlSortColumn): string {
  // Case- and accent-insensitive, as the client's `localeCompare` with base sensitivity.
  if (column.kind === 'text') return `COLLATE(NULLIF(TRIM(${column.expression}), ''), 'en-ci-ai')`;
  if (column.kind === 'tier') return healthMetricsTierRankSql(column.expression);
  return column.expression;
}
