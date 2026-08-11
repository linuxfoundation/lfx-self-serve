// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, computed, inject, input, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { formatNumber } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { finalize, of, switchMap } from 'rxjs';

import type { AttentionSeverity, EventAttentionItem, EventRosterResponse, EventRosterRow } from '@lfx-one/shared/interfaces';

/** How many at-risk events to surface at most. */
const MAX_ATTENTION_ITEMS = 3;
/** Below this registration-to-goal percentage an event is considered behind. */
const BEHIND_GOAL_THRESHOLD = 50;

@Component({
  selector: 'lfx-events-attention-section',
  imports: [NgClass],
  templateUrl: './events-attention-section.component.html',
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
      const atRisk = this.roster()
        .events.map((event) => ({ event, percent: this.regPercent(event) }))
        .filter((row) => row.percent !== null && (row.percent as number) < BEHIND_GOAL_THRESHOLD && row.event.compScore === 'low')
        // Furthest behind first.
        .sort((a, b) => (a.percent as number) - (b.percent as number))
        .slice(0, MAX_ATTENTION_ITEMS);

      return atRisk.map(({ event, percent }) => this.toItem(event, percent as number));
    });
  }

  // === Private Helpers ===
  private regPercent(event: EventRosterRow): number | null {
    const goal = event.registrations.goal;
    if (!goal || goal <= 0) return null;
    return Math.round((event.registrations.actual / goal) * 100);
  }

  private toItem(event: EventRosterRow, percent: number): EventAttentionItem {
    const severity: AttentionSeverity = percent < 25 ? 'critical' : 'warning';
    const vsLy = event.vsLastYear !== null ? ` · pacing ${Math.round((event.vsLastYear - 1) * 100)}% vs last year` : '';
    return {
      id: event.eventId,
      tag: 'BEHIND GOAL',
      severity,
      title: `${event.eventName} is ${percent}% to its registration goal`,
      detail: `${formatNumber(event.registrations.actual)} / ${formatNumber(event.registrations.goal)} registrations${vsLy}. Email and paid are the fastest levers.`,
      actionUrl: event.eventUrl,
    };
  }
}
