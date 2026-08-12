// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, computed, inject, input, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { CRITICAL_ATTENTION_PERCENT_THRESHOLD, MAX_ATTENTION_ITEMS } from '@lfx-one/shared/constants';
import { eventRegistrationPercent, formatNumber, isEventAtRisk } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { finalize, of, switchMap } from 'rxjs';

import type { AttentionSeverity, EventAttentionItem, EventRosterResponse, EventRosterRow } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-events-attention-section',
  imports: [NgClass],
  templateUrl: './events-attention-section.component.html',
  // The host is a child of the overview tab's flex column, so it takes a gap slot even when the
  // template renders nothing. `display: none` when there is nothing to show drops it out of flex
  // layout entirely; `contents` otherwise keeps the card's own box intact.
  host: { '[style.display]': "hasItems() ? 'contents' : 'none'" },
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
          return this.analyticsService.getEventRoster(slug, false).pipe(finalize(() => this.loading.set(false)));
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
