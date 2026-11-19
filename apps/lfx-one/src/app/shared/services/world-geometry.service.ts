// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { HEALTH_METRICS_WORLD_GEOMETRY_URL } from '@lfx-one/shared/constants';
import { catchError, Observable, of, shareReplay } from 'rxjs';

import type { HealthMetricsWorldGeometry } from '@lfx-one/shared/interfaces';

/** The world map's country outlines, a static asset fetched once on first use and shared after that. */
@Injectable({ providedIn: 'root' })
export class WorldGeometryService {
  private readonly http = inject(HttpClient);
  private geometry$: Observable<HealthMetricsWorldGeometry | null> | null = null;

  /** The outlines, or `null` when the asset fails to load; a failure is not cached, so the next map tries again. */
  public getGeometry(): Observable<HealthMetricsWorldGeometry | null> {
    this.geometry$ ??= this.http.get<HealthMetricsWorldGeometry>(HEALTH_METRICS_WORLD_GEOMETRY_URL).pipe(
      catchError((error: unknown) => {
        console.error('[world-geometry] failed to load the world map outlines', { error });
        this.geometry$ = null;
        return of(null);
      }),
      shareReplay({ bufferSize: 1, refCount: false })
    );
    return this.geometry$;
  }
}
