// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { formatNumber } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { finalize, of, switchMap } from 'rxjs';

import type { EventCountryReach, EventGeoReachResponse } from '@lfx-one/shared/interfaces';

const EMPTY_GEO: EventGeoReachResponse = { projectId: '', totalRegistrations: 0, totalCountries: 0, countries: [] };

@Component({
  selector: 'lfx-events-geo-section',
  templateUrl: './events-geo-section.component.html',
})
export class EventsGeoSectionComponent {
  private readonly analyticsService = inject(AnalyticsService);

  // === Inputs ===
  public readonly foundationSlug = input<string | undefined>();
  public readonly foundationName = input<string>('');

  // === WritableSignals ===
  protected readonly loading = signal(false);
  protected readonly skeletons: readonly number[] = [0, 1, 2, 3, 4, 5];

  // === Computed Signals ===
  protected readonly geo: Signal<EventGeoReachResponse> = this.initGeo();
  protected readonly hasData = computed(() => this.geo().countries.length > 0);
  protected readonly totalCountriesLabel = computed(() => formatNumber(this.geo().totalCountries));

  // Widen each bar relative to the top country so the leader fills the track.
  protected readonly rows: Signal<(EventCountryReach & { barPercent: number })[]> = computed(() => {
    const countries = this.geo().countries;
    const max = countries.length ? countries[0].registrations : 0;
    return countries.map((country) => ({
      ...country,
      barPercent: max > 0 ? Math.max(2, Math.round((country.registrations / max) * 100)) : 0,
    }));
  });

  // === Protected Helpers ===
  protected num(value: number): string {
    return formatNumber(value);
  }

  // === Private Initializers ===
  private initGeo(): Signal<EventGeoReachResponse> {
    const slug$ = toObservable(this.foundationSlug);
    return toSignal(
      slug$.pipe(
        switchMap((slug) => {
          if (!slug) {
            this.loading.set(false);
            return of(EMPTY_GEO);
          }
          this.loading.set(true);
          return this.analyticsService.getEventGeoReach(slug).pipe(finalize(() => this.loading.set(false)));
        })
      ),
      { initialValue: EMPTY_GEO }
    );
  }
}
