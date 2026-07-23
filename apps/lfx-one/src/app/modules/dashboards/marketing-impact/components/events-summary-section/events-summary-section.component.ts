// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, computed, inject, input, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { formatCurrency, formatNumber } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { combineLatest, finalize, map, of, switchMap } from 'rxjs';

import type { EventsOverviewSummary, EventsSummaryStat } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-events-summary-section',
  imports: [NgClass],
  templateUrl: './events-summary-section.component.html',
})
export class EventsSummarySectionComponent {
  // Ordered tile definitions. `key` maps to EventsOverviewSummary; a null value
  // renders a dash so metrics without a confirmed data source stay honest.
  // `format` defaults to a plain count; 'currency' formats the value as dollars.
  private static readonly tiles: readonly {
    id: string;
    key: keyof EventsOverviewSummary;
    label: string;
    icon: string;
    iconClass: string;
    format?: 'currency';
  }[] = [
    { id: 'events', key: 'events', label: 'Total Events', icon: 'fa-light fa-calendar-star', iconClass: 'bg-blue-100 text-blue-600' },
    { id: 'registrations', key: 'registrations', label: 'Total Registrations', icon: 'fa-light fa-user-plus', iconClass: 'bg-violet-100 text-violet-600' },
    { id: 'attendees', key: 'attendees', label: 'Total Attendees', icon: 'fa-light fa-users', iconClass: 'bg-green-100 text-green-600' },
    { id: 'speakers', key: 'speakers', label: 'Total Speakers', icon: 'fa-light fa-microphone-lines', iconClass: 'bg-amber-100 text-amber-600' },
    { id: 'organizations', key: 'organizations', label: 'Total Organizations', icon: 'fa-light fa-building', iconClass: 'bg-blue-100 text-blue-600' },
    {
      id: 'sponsorship',
      key: 'sponsorship',
      label: 'Sponsorship',
      icon: 'fa-light fa-handshake',
      iconClass: 'bg-green-100 text-green-600',
      format: 'currency',
    },
    { id: 'countries', key: 'countries', label: 'Total Countries', icon: 'fa-light fa-earth-americas', iconClass: 'bg-violet-100 text-violet-600' },
  ];

  // === Services ===
  private readonly analyticsService = inject(AnalyticsService);

  // === Inputs ===
  public readonly foundationSlug = input<string | undefined>();
  public readonly foundationName = input<string>('');
  public readonly selectedPeriod = input<string>('');

  // === WritableSignals ===
  protected readonly loading = signal(false);

  // === Computed Signals ===
  protected readonly summary: Signal<EventsOverviewSummary | null> = this.initSummary();
  protected readonly stats: Signal<EventsSummaryStat[]> = this.initStats();
  protected readonly skeletons: readonly number[] = EventsSummarySectionComponent.tiles.map((_, i) => i);

  // === Private Initializers ===
  private initSummary(): Signal<EventsOverviewSummary | null> {
    const slug$ = toObservable(this.foundationSlug);
    const period$ = toObservable(this.selectedPeriod);

    return toSignal(
      combineLatest([slug$, period$]).pipe(
        switchMap(([slug]) => {
          if (!slug) {
            this.loading.set(false);
            return of(null);
          }
          this.loading.set(true);
          // All 7 tiles come from a single YTD-scoped endpoint over
          // PLATINUM_LFX_ONE.MARKETING_EVENT_OVERVIEW + MARKETING_EVENT_SPONSORSHIPS. Each
          // metric carries its value and a YoY change fraction (null when no prior baseline);
          // a null response falls the whole block back to dashes.
          return this.analyticsService.getEventsOverviewSummary(slug).pipe(
            map((data) =>
              data === null
                ? null
                : ({
                    registrations: data.registrations,
                    attendees: data.attendees,
                    events: data.events,
                    speakers: data.speakers,
                    organizations: data.organizations,
                    countries: data.countries,
                    sponsorship: data.sponsorship,
                  } satisfies EventsOverviewSummary)
            ),
            finalize(() => this.loading.set(false))
          );
        })
      ),
      { initialValue: null }
    );
  }

  private initStats(): Signal<EventsSummaryStat[]> {
    return computed(() => {
      const data = this.summary();
      return EventsSummarySectionComponent.tiles.map((tile) => {
        const metric = data ? data[tile.key] : null;
        let value = '—';
        if (metric) {
          value = tile.format === 'currency' ? formatCurrency(metric.value) : formatNumber(metric.value);
        }

        // YoY delta from the change fraction (0.52 = +52%). Sponsorship has no modeled YoY
        // (changeFraction null) so its tile shows no delta.
        let delta: string | null = null;
        let deltaTrend: 'up' | 'down' | 'neutral' = 'neutral';
        const change = metric?.changeFraction;
        if (change !== null && change !== undefined) {
          const pct = Math.round(change * 100);
          if (pct > 0) {
            delta = `▲ ${pct}% YoY`;
            deltaTrend = 'up';
          } else if (pct < 0) {
            delta = `▼ ${Math.abs(pct)}% YoY`;
            deltaTrend = 'down';
          } else {
            delta = '— vs LY';
          }
        }

        return {
          id: tile.id,
          label: tile.label,
          icon: tile.icon,
          iconClass: tile.iconClass,
          value,
          delta,
          deltaTrend,
        };
      });
    });
  }
}
