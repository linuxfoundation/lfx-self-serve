// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, computed, inject, input, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { BEHIND_GOAL_PERCENT_THRESHOLD, EVENTS_SPLIT_TO_DRAWER_FOCUS, ON_TRACK_PERCENT_THRESHOLD } from '@lfx-one/shared/constants';
import { eventRegistrationPercent, formatCurrency, formatIsoDateLabel, formatNumber, isEventAtRisk } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { catchError, combineLatest, finalize, of, startWith, switchMap } from 'rxjs';

import type { EventDrawerFocus, EventRosterBar, EventRosterResponse, EventRosterRow, EventRosterRowView, EventsSplitView } from '@lfx-one/shared/interfaces';

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
  public readonly selectedPeriod = input<string>('');
  /** Which half of the Events story to show; `null` shows both columns (the unsplit view). */
  public readonly eventsSplit = input<EventsSplitView | null>(null);

  // === Controls ===
  protected readonly search = new FormControl('', { nonNullable: true });

  // === WritableSignals ===
  protected readonly loading = signal(false);
  protected readonly includePast = signal(false);
  /**
   * Distinguishes "we couldn't load this" from "there are no events" — both leave the table
   * empty, but only one of them should tell the user something went wrong.
   */
  protected readonly failed = signal(false);
  protected readonly skeletons: readonly number[] = [0, 1, 2, 3, 4];
  protected readonly drawerVisible = signal(false);
  protected readonly selectedEventId = signal<string | null>(null);
  // Which story the open drawer tells: 'b2c' (registrations + campaigns) or 'b2b' (sponsorship).
  protected readonly drawerFocus = signal<EventDrawerFocus>('b2c');

  // === Computed Signals ===
  protected readonly roster: Signal<EventRosterResponse> = this.initRoster();
  protected readonly searchTerm: Signal<string> = toSignal(this.search.valueChanges.pipe(startWith('')), { initialValue: '' });
  protected readonly rows: Signal<EventRosterRowView[]> = this.initRows();
  protected readonly hasRows = computed(() => this.rows().length > 0);
  /**
   * The empty state fires whenever there are no rows, which includes an empty roster with no
   * search active — telling those users their search matched nothing would be wrong. Only claim
   * a search miss when a term is actually typed.
   */
  protected readonly emptyMessage = computed(() => {
    if (this.searchTerm().trim()) return 'No events match your search.';
    // includePast toggles Upcoming vs past-included — it is not a period filter, so the empty copy
    // must not claim a period the user never selected.
    return this.includePast() ? 'No events found.' : 'No upcoming events.';
  });
  /** Card subtitle, naming only the columns the current split renders. */
  protected readonly subtitle = computed(() => {
    switch (this.eventsSplit()) {
      case 'attendance':
        return 'Registrations vs goal';
      case 'sponsorship':
        return 'Sponsorship revenue vs goal';
      default:
        return 'Registrations and sponsorship vs goal';
    }
  });
  protected readonly showRegistrations = computed(() => this.eventsSplit() !== 'sponsorship');
  /** Sponsorship revenue column — hidden in the attendance view. */
  protected readonly showSponsorship = computed(() => this.eventsSplit() !== 'attendance');

  // === Protected Methods ===
  protected toggleIncludePast(includePast: boolean): void {
    this.includePast.set(includePast);
  }

  /**
   * Row-level click. Opens the story matching the active split so a row clicked in the
   * sponsorship view doesn't land on the registrations drawer; the unsplit view keeps its
   * long-standing B2C default.
   */
  protected openEvent(eventId: string): void {
    const split = this.eventsSplit();
    this.openFocused(eventId, split ? EVENTS_SPLIT_TO_DRAWER_FOCUS[split] : 'b2c');
  }

  /**
   * Open the detail drawer scoped to one story. Called from the individual
   * column cells so registrations open the B2C (campaigns) view and sponsorship
   * opens the B2B view. `event` is stopped so the row-level click doesn't also fire — the cell
   * buttons stop Enter and Space in the template for the same reason, since a native button
   * turns both into a click and the row has its own keydown handlers.
   */
  protected openFocused(eventId: string, focus: EventDrawerFocus, event?: Event): void {
    event?.stopPropagation();
    this.selectedEventId.set(eventId);
    this.drawerFocus.set(focus);
    this.drawerVisible.set(true);
  }

  // === Private Initializers ===
  private initRoster(): Signal<EventRosterResponse> {
    const slug$ = toObservable(this.foundationSlug);
    const past$ = toObservable(this.includePast);
    const period$ = toObservable(this.selectedPeriod);

    return toSignal(
      combineLatest([slug$, past$, period$]).pipe(
        switchMap(([slug, includePast, period]) => {
          if (!slug) {
            this.loading.set(false);
            return of({ projectId: '', events: [] });
          }
          this.loading.set(true);
          this.failed.set(false);
          // Caught here rather than in the service: a failure must render "couldn't load" rather
          // than the "no upcoming events" copy, which would report an outage as real data.
          return this.analyticsService.getEventRoster(slug, includePast, period || undefined).pipe(
            catchError(() => {
              this.failed.set(true);
              return of({ projectId: '', events: [] });
            }),
            finalize(() => this.loading.set(false))
          );
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
    // At-risk = a real registration goal the event is materially behind on, and a low pace vs last
    // year. Shared with the needs-attention strip so the two can't disagree about the same event.
    // A null percent means no goal, which is never "behind".
    const atRisk = isEventAtRisk(eventRegistrationPercent(event.registrations), event.compScore);

    return {
      eventId: event.eventId,
      eventName: event.eventName,
      dateLabel: formatIsoDateLabel(event.startDate),
      eventUrl: event.eventUrl,
      country: event.country,
      registrations,
      sponsorshipRevenue,
      atRisk,
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
    if (percent >= ON_TRACK_PERCENT_THRESHOLD) {
      tone = 'good';
    } else if (percent >= BEHIND_GOAL_PERCENT_THRESHOLD) {
      tone = 'warn';
    }
    return { actual: fmt(actual), goal: fmt(goal), percent, hasGoal: true, tone };
  }
}
