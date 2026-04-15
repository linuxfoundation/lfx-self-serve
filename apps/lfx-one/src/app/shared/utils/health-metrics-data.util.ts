// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DestroyRef, InputSignal, WritableSignal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ProjectContextService } from '@services/project-context.service';
import { combineLatest, filter, map, Observable, switchMap, tap } from 'rxjs';

import type { HealthMetricsRange } from '@lfx-one/shared/interfaces';

export interface RangeDataFetchingOptions<T> {
  projectContextService: ProjectContextService;
  range: InputSignal<HealthMetricsRange>;
  loading: WritableSignal<boolean>;
  data: WritableSignal<T>;
  defaultValue: T;
  /** Must return an observable that never errors (service-level catchError). */
  fetchFn: (slug: string, range: HealthMetricsRange) => Observable<T>;
  destroyRef: DestroyRef;
}

export function initializeRangeDataFetching<T>(options: RangeDataFetchingOptions<T>): void {
  const slug$ = toObservable(options.projectContextService.selectedFoundation).pipe(
    map((foundation) => foundation?.slug || ''),
    filter((slug): slug is string => !!slug)
  );
  const range$ = toObservable(options.range);

  combineLatest([slug$, range$])
    .pipe(
      tap(() => {
        options.loading.set(true);
        options.data.set(options.defaultValue);
      }),
      switchMap(([slug, range]) => options.fetchFn(slug, range)),
      takeUntilDestroyed(options.destroyRef)
    )
    .subscribe({
      next: (result) => {
        options.data.set(result);
        options.loading.set(false);
      },
      error: () => {
        options.loading.set(false);
      },
    });
}
