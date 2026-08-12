// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, computed, inject, input, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { formatCurrency, formatNumber, resolvePeriodRange } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { combineLatest, finalize, map, of, switchMap } from 'rxjs';

import type { EventsOverviewMetricKey, EventsOverviewSummary, EventsSplitView, EventsSummaryStat } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-events-summary-section',
  imports: [NgClass],
  templateUrl: './events-summary-section.component.html',
})
export class EventsSummarySectionComponent {
  // Ordered tile definitions. `key` maps to EventsOverviewSummary; a null value
  // renders a dash so metrics without a confirmed data source stay honest.
  // `format` defaults to a plain count; 'currency' formats the value as dollars.
  // `split` assigns the tile to a half of the Events attendance/sponsorship view; tiles are
  // tagged individually so a new tile has to declare which story it belongs to.
  private static readonly tiles: readonly {
    id: string;
    key: EventsOverviewMetricKey;
    label: string;
    icon: string;
    iconClass: string;
    format?: 'currency';
    split: EventsSplitView;
  }[] = [
    { id: 'events', key: 'events', label: 'Total Events', icon: 'fa-light fa-calendar-star', iconClass: 'bg-blue-100 text-blue-600', split: 'attendance' },
    {
      id: 'registrations',
      key: 'registrations',
      label: 'Total Registrations',
      icon: 'fa-light fa-user-plus',
      iconClass: 'bg-violet-100 text-violet-600',
      split: 'attendance',
    },
    { id: 'attendees', key: 'attendees', label: 'Total Attendees', icon: 'fa-light fa-users', iconClass: 'bg-green-100 text-green-600', split: 'attendance' },
    {
      id: 'speakers',
      key: 'speakers',
      label: 'Total Speakers',
      icon: 'fa-light fa-microphone-lines',
      iconClass: 'bg-amber-100 text-amber-600',
      split: 'attendance',
    },
    {
      id: 'organizations',
      key: 'organizations',
      // Sourced from COMPANIES_COUNT_YTD on MARKETING_EVENT_OVERVIEW, which counts the
      // organizations attendees work for — not the ones that sponsored. That makes it an
      // attendance metric despite the name.
      label: 'Total Organizations',
      icon: 'fa-light fa-building',
      iconClass: 'bg-blue-100 text-blue-600',
      split: 'attendance',
    },
    {
      id: 'sponsorship',
      key: 'sponsorship',
      label: 'Sponsorship',
      icon: 'fa-light fa-handshake',
      iconClass: 'bg-green-100 text-green-600',
      format: 'currency',
      split: 'sponsorship',
    },
    {
      id: 'countries',
      key: 'countries',
      label: 'Total Countries',
      icon: 'fa-light fa-earth-americas',
      iconClass: 'bg-violet-100 text-violet-600',
      split: 'attendance',
    },
  ];

  // === Services ===
  private readonly analyticsService = inject(AnalyticsService);

  // === Inputs ===
  public readonly foundationSlug = input<string | undefined>();
  public readonly foundationName = input<string>('');
  /**
   * Reinstated by the period plumbing: a month re-aggregates from the event-grained tables, so
   * the tiles are no longer fixed to year-to-date. The response reports the scope it actually
   * served and the heading reads that, so a trailing preset never renders under a month label.
   */
  public readonly selectedPeriod = input<string>('');
  /** Which half of the Events story to show; `null` shows every tile (the unsplit view). */
  public readonly eventsSplit = input<EventsSplitView | null>(null);

  // === WritableSignals ===
  protected readonly loading = signal(false);

  // === Computed Signals ===
  /**
   * Period label for the heading, taken from the scope the RESPONSE reports — not from the picker.
   *
   * The two disagree by design: only a month re-aggregates. YTD and the trailing presets are all
   * served the year-to-date rollups, because those columns have no date grain to narrow (see
   * getEventsOverviewSummary). Labelling from the picker would therefore print "Last 3 months"
   * over year-to-date figures — the exact misreport the server comment promises callers avoid.
   *
   * Sponsorship is YTD-only regardless of the picker, and the server reports that scope too, so
   * it needs no special case here.
   */
  private readonly periodLabel = computed(() => {
    if (this.summary()?.scope !== 'month') return 'YTD';
    const period = this.selectedPeriod();
    return (period && resolvePeriodRange(period)?.label) || 'YTD';
  });

  /** Card title — names the active half so the split views don't share one generic heading. */
  protected readonly heading = computed(() => {
    const label = this.periodLabel();
    switch (this.eventsSplit()) {
      case 'attendance':
        return `${label} Event attendance`;
      case 'sponsorship':
        return `${label} Event sponsorship`;
      default:
        return `${label} Events summary`;
    }
  });

  protected readonly subheading = computed(() => {
    switch (this.eventsSplit()) {
      case 'attendance':
        return 'Registrations, attendees, and the organizations they represent';
      case 'sponsorship':
        return 'Sponsorship revenue';
      default:
        return 'Event reach and engagement';
    }
  });

  protected readonly summary: Signal<EventsOverviewSummary | null> = this.initSummary();
  /**
   * Heading scope read from the response, not the picker: a trailing preset is served the YTD
   * rollup, so titling it "Last 3 months" would name a range the numbers do not cover.
   */
  protected readonly stats: Signal<EventsSummaryStat[]> = this.initStats();
  // Sized to the visible tiles so the placeholder count matches what resolves — otherwise the
  // split views flash seven skeletons and settle to four.
  protected readonly skeletons: Signal<readonly number[]> = computed(() => {
    const split = this.eventsSplit();
    return EventsSummarySectionComponent.tiles.filter((tile) => split === null || tile.split === split).map((_, i) => i);
  });

  /**
   * Number of tiles the current split renders. Drives one equal-width grid column per tile from
   * `lg` up, so a 5-tile or 2-tile split spans the card instead of leaving dead space where the
   * unused columns of a fixed 7-column grid would sit.
   */
  protected readonly tileCount: Signal<number> = computed(() => this.skeletons().length);

  // === Private Initializers ===
  private initSummary(): Signal<EventsOverviewSummary | null> {
    const slug$ = toObservable(this.foundationSlug);
    const period$ = toObservable(this.selectedPeriod);
    const split$ = toObservable(this.eventsSplit);

    return toSignal(
      combineLatest([slug$, period$, split$]).pipe(
        switchMap(([slug, period, split]) => {
          if (!slug) {
            this.loading.set(false);
            return of(null);
          }
          this.loading.set(true);
          // The default (YTD/trailing) period reads all 7 tiles from
          // PLATINUM_LFX_ONE.MARKETING_EVENT_OVERVIEW + MARKETING_EVENT_SPONSORSHIPS. A single
          // month re-aggregates events/registrations/speakers per event instead and returns null
          // for the four metrics that only exist as YTD rollups. Sponsorship data is only
          // available at YTD scope, so omit the period filter when viewing sponsorship.
          const queryPeriod = split === 'sponsorship' ? undefined : period || undefined;
          return this.analyticsService.getEventsOverviewSummary(slug, queryPeriod).pipe(
            map((data) =>
              data === null
                ? null
                : ({
                    scope: data.scope,
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
      const split = this.eventsSplit();
      return EventsSummarySectionComponent.tiles
        .filter((tile) => split === null || tile.split === split)
        .map((tile) => {
          const metric = data ? data[tile.key] : null;
          // A null value means the metric isn't derivable for the selected period (the YTD-only
          // rollups under a month filter), so it stays a dash rather than rendering as zero.
          let value = '—';
          if (metric && metric.value !== null) {
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
