// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, computed, inject, input, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { formatCurrency, formatNumber } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { combineLatest, finalize, of, startWith, switchMap } from 'rxjs';

import type { EventRosterBar, EventRosterResponse, EventRosterRow, EventRosterRowView } from '@lfx-one/shared/interfaces';

import { EventDetailDrawerComponent } from '../event-detail-drawer/event-detail-drawer.component';

@Component({
  selector: 'lfx-event-roster-section',
  imports: [NgClass, ReactiveFormsModule, EventDetailDrawerComponent],
  templateUrl: './event-roster-section.component.html',
})
export class EventRosterSectionComponent {
  // === Services ===
  private readonly analyticsService = inject(AnalyticsService);

  // === Inputs ===
  public readonly foundationSlug = input<string | undefined>();

  // === Controls ===
  protected readonly search = new FormControl('', { nonNullable: true });

  // === WritableSignals ===
  protected readonly loading = signal(false);
  protected readonly includePast = signal(false);
  protected readonly skeletons: readonly number[] = [0, 1, 2, 3, 4];
  protected readonly drawerVisible = signal(false);
  protected readonly selectedEventId = signal<string | null>(null);

  // === Computed Signals ===
  protected readonly roster: Signal<EventRosterResponse> = this.initRoster();
  protected readonly searchTerm: Signal<string> = toSignal(this.search.valueChanges.pipe(startWith('')), { initialValue: '' });
  protected readonly rows: Signal<EventRosterRowView[]> = this.initRows();
  protected readonly hasRows = computed(() => this.rows().length > 0);

  // === Protected Methods ===
  protected toggleIncludePast(includePast: boolean): void {
    this.includePast.set(includePast);
  }

  protected openEvent(eventId: string): void {
    this.selectedEventId.set(eventId);
    this.drawerVisible.set(true);
  }

  // === Private Initializers ===
  private initRoster(): Signal<EventRosterResponse> {
    const slug$ = toObservable(this.foundationSlug);
    const past$ = toObservable(this.includePast);

    return toSignal(
      combineLatest([slug$, past$]).pipe(
        switchMap(([slug, includePast]) => {
          if (!slug) {
            this.loading.set(false);
            return of({ projectId: '', events: [] });
          }
          this.loading.set(true);
          return this.analyticsService.getEventRoster(slug, includePast).pipe(finalize(() => this.loading.set(false)));
        })
      ),
      { initialValue: { projectId: '', events: [] } }
    );
  }

  private initRows(): Signal<EventRosterRowView[]> {
    return computed(() => {
      const term = this.searchTerm().trim().toLowerCase();
      const events = this.roster().events;
      const filtered = term ? events.filter((e) => e.eventName.toLowerCase().includes(term)) : events;
      return filtered.map((event) => this.toView(event));
    });
  }

  // === Private Helpers ===
  private toView(event: EventRosterRow): EventRosterRowView {
    const registrations = this.toBar(event.registrations.actual, event.registrations.goal, false);
    const sponsorshipRevenue = this.toBar(event.sponsorshipRevenue.actual, event.sponsorshipRevenue.goal, true);
    // At-risk = a real registration goal the event is materially behind on, and a low pace vs last year.
    const behindGoal = registrations.hasGoal && registrations.percent < 50;
    const atRisk = behindGoal && event.compScore === 'low';

    return {
      eventId: event.eventId,
      eventName: event.eventName,
      dateLabel: this.formatDate(event.startDate),
      eventUrl: event.eventUrl,
      country: event.country,
      registrations,
      sponsorshipRevenue,
      atRisk,
      cfpStatus: event.cfpStatus,
    };
  }

  private toBar(actual: number, goal: number, currency: boolean): EventRosterBar {
    const fmt = (value: number): string => (currency ? formatCurrency(value) : formatNumber(value));
    // Goal of 0/absent means "no goal required" — render no bar (matches PCC).
    if (!goal || goal <= 0) {
      return { actual: fmt(actual), goal: fmt(0), percent: 0, hasGoal: false, tone: 'none' };
    }
    const percent = Math.min(100, Math.round((actual / goal) * 100));
    let tone: EventRosterBar['tone'] = 'critical';
    if (percent >= 80) {
      tone = 'good';
    } else if (percent >= 50) {
      tone = 'warn';
    }
    return { actual: fmt(actual), goal: fmt(goal), percent, hasGoal: true, tone };
  }

  private formatDate(iso: string): string {
    const [year, month, day] = iso.split('-').map(Number);
    if (!year || !month || !day) return iso;
    return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    });
  }
}
