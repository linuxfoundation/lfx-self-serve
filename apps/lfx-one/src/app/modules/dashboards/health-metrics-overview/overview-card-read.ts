// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { computed, inject, PLATFORM_ID, Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ProjectContextService } from '@services/project-context.service';
import { catchError, EMPTY, Observable, of, startWith, switchMap, tap } from 'rxjs';

import type { HealthMetricsOverviewCardStatus } from '@lfx-one/shared/interfaces';

/** One card's read: the response once it lands, and where the read stands. */
export interface OverviewCardRead<T> {
  data: Signal<T | null>;
  status: Signal<HealthMetricsOverviewCardStatus>;
}

/**
 * Reads a card's data once per foundation, from an injection context. Every read carries all periods, so a
 * period change never re-reads. SSR stays loading, so the server's skeleton matches the client's first paint.
 */
export function injectOverviewCardRead<T>(read: (foundationSlug: string) => Observable<T>): OverviewCardRead<T> {
  const projectContext = inject(ProjectContextService);
  const status = signal<HealthMetricsOverviewCardStatus>('loading');

  if (!isPlatformBrowser(inject(PLATFORM_ID))) return { data: signal(null), status };

  const foundationSlug = computed(() => projectContext.selectedFoundation()?.slug ?? '');
  const data = toSignal(
    toObservable(foundationSlug).pipe(
      tap(() => status.set('loading')),
      // switchMap drops the last foundation's response, so a slow read never paints over the new foundation.
      switchMap((slug) =>
        slug
          ? read(slug).pipe(
              tap(() => status.set('ready')),
              catchError(() => {
                status.set('failed');
                return EMPTY;
              }),
              startWith(null)
            )
          : of(null)
      )
    ),
    { initialValue: null }
  );

  return { data, status: status.asReadonly() };
}
