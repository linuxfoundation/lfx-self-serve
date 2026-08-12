// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, computed, inject, input, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { CRITICAL_ATTENTION_PERCENT_THRESHOLD, MAX_ATTENTION_ITEMS } from '@lfx-one/shared/constants';
import { eventRegistrationPercent, formatNumber, isEventAtRisk } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { catchError, finalize, of, switchMap } from 'rxjs';

import type { AttentionSeverity, EventAttentionItem, EventRosterResponse, EventRosterRow } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-events-attention-section',
  imports: [NgClass],
  templateUrl: './events-attention-section.component.html',
  // The host is a child of the overview tab's flex column, so it takes a gap slot even when the
  // template renders nothing. `display: none` when there is nothing to show drops it out of flex
  // layout entirely; `contents` otherwise keeps the card's own box intact.
  // Hidden while loading as well as when empty: toSignal holds the previous roster until the new
  // request emits, so on a foundation switch the prior foundation's at-risk events would stay
  // visible and clickable under the new foundation's name.
  host: { '[style.display]': "showStrip() ? 'contents' : 'none'" },
})
export class EventsAttentionSectionComponent {
  private readonly analyticsService = inject(AnalyticsService);

  // === Inputs ===
  public readonly foundationSlug = input<string | undefined>();

  // === WritableSignals ===
  protected readonly loading = signal(false);

  // === Computed Signals ===
  private readonly roster: Signal<EventRosterResponse> = this.initRoster();
  protected readonly items: Signal<EventAttentionItem[]> = this.initItems();
  protected readonly hasItems = computed(() => this.items().length > 0);
  /**
   * The strip is a supplementary alert, not primary content, so it shows nothing rather than a
   * skeleton while loading — but it must not keep showing the outgoing foundation's events either.
   */
  protected readonly showStrip = computed(() => !this.loading() && this.hasItems());

  // === Private Initializers ===
  private initRoster(): Signal<EventRosterResponse> {
    const slug$ = toObservable(this.foundationSlug);
    return toSignal(
      slug$.pipe(
        switchMap((slug) => {
          if (!slug) {
            this.loading.set(false);
            return of({ projectId: '', events: [] });
          }
          this.loading.set(true);
          // Upcoming only — attention is about events we can still influence.
          //
          // catchError inside the switchMap, not outside: getEventRoster rethrows by design (a
          // roster outage must not read as "no events"), and an error reaching toSignal would
          // poison the signal permanently — every later read from items()/showStrip() and the host
          // display binding would throw during change detection, and switching foundations could
          // not recover because the outer stream is already dead. This strip is supplementary, so
          // a failure omits it rather than taking the Overview tab down with it.
          return this.analyticsService.getEventRoster(slug, false).pipe(
            catchError(() => of({ projectId: '', events: [] })),
            finalize(() => this.loading.set(false))
          );
        })
      ),
      { initialValue: { projectId: '', events: [] } }
    );
  }

  private initItems(): Signal<EventAttentionItem[]> {
    return computed(() => {
      return (
        this.roster()
          .events.map((event) => ({ event, percent: eventRegistrationPercent(event.registrations) }))
          // isEventAtRisk is the one definition of at-risk, shared with the roster's row flag so
          // the two views can never disagree about the same event. The predicate narrows percent
          // to a number, so the mapping below needs no cast.
          .filter((row): row is { event: EventRosterRow; percent: number } => isEventAtRisk(row.percent, row.event.compScore))
          // Furthest behind first.
          .sort((a, b) => a.percent - b.percent)
          .slice(0, MAX_ATTENTION_ITEMS)
          .map(({ event, percent }) => this.toItem(event, percent))
      );
    });
  }

  // === Private Helpers ===
  private toItem(event: EventRosterRow, percent: number): EventAttentionItem {
    const severity: AttentionSeverity = percent < CRITICAL_ATTENTION_PERCENT_THRESHOLD ? 'critical' : 'warning';
    const vsLy = event.vsLastYear !== null ? ` · pacing ${Math.round((event.vsLastYear - 1) * 100)}% vs last year` : '';
    return {
      id: event.eventId,
      // The tag text states the severity so it is not conveyed by colour alone — the red vs
      // amber accent is a redundant cue, not the only one.
      tag: severity === 'critical' ? 'CRITICALLY BEHIND GOAL' : 'BEHIND GOAL',
      severity,
      title: `${event.eventName} is ${percent}% to its registration goal`,
      detail: `${formatNumber(event.registrations.actual)} / ${formatNumber(event.registrations.goal)} registrations${vsLy}. Email and paid are the fastest levers.`,
      actionUrl: event.eventUrl,
    };
  }
}
