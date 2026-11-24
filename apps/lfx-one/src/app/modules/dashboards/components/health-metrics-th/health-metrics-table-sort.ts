// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, inject, linkedSignal } from '@angular/core';
import { healthMetricsAriaSort, healthMetricsColumnSortState, nextHealthMetricsSort } from '@lfx-one/shared/utils';
import { ProjectContextService } from '@services/project-context.service';

import type { HealthMetricsSortColumn, HealthMetricsSortHeaderView, HealthMetricsTableSort } from '@lfx-one/shared/interfaces';

/**
 * A table's sort, kept out of the URL (tab links keep the query string) and reset to `defaultSort` on a foundation change;
 * a tab or page change destroys the table. A paged consumer resets its own page when `sort` changes.
 */
export function injectHealthMetricsTableSort<K extends string>(columns: readonly HealthMetricsSortColumn<K>[], defaultSort: HealthMetricsTableSort<K> | null) {
  const projectContextService = inject(ProjectContextService);

  const sort = linkedSignal<string, HealthMetricsTableSort<K> | null>({
    source: () => projectContextService.selectedFoundation()?.slug ?? '',
    computation: () => defaultSort,
  });
  const headers = computed(
    () =>
      Object.fromEntries(
        columns.map((column) => {
          const state = healthMetricsColumnSortState(sort(), column.key);
          return [column.key, { state, ariaSort: healthMetricsAriaSort(state) }];
        })
      ) as Record<K, HealthMetricsSortHeaderView>
  );

  // The default sort only marks the table's own order (a view's rank, say), which a re-sort could reorder; `order` keeps it.
  const order = computed(() => {
    const current = sort();
    return current && defaultSort && current.key === defaultSort.key && current.direction === defaultSort.direction ? null : current;
  });

  return {
    sort: sort.asReadonly(),
    /** The sort to apply: `null` while the table sits on its default, so the rows keep the order they arrive in. */
    order,
    headers,
    /** Back to the table's default, as when a sorted read fails and the rows on screen are the default ones. */
    reset(): void {
      sort.set(defaultSort);
    },
    /** Sorts by the column, or flips it when it is already the sort. */
    toggle(key: K): void {
      const column = columns.find((candidate) => candidate.key === key);
      if (column) sort.set(nextHealthMetricsSort(sort(), column));
    },
  };
}
