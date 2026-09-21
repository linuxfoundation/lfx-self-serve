// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, output, Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { OrgLensEmptyStateComponent } from '@components/org-lens-empty-state/org-lens-empty-state.component';
import { StatCardGridComponent } from '@components/stat-card-grid/stat-card-grid.component';
import { ORG_MEETINGS_DEFAULT_TIME_RANGE, ORG_MEETINGS_KPI_ICON_CLASS, ORG_MEETINGS_TIME_RANGE_LABELS } from '@lfx-one/shared/constants';
import type { OrgMeetingsKpiSummary, OrgMeetingsSupportedTimeRange, StatCardItem } from '@lfx-one/shared/interfaces';
import { OrgLensSectionOutcome } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensMeetingsService } from '@services/org-lens-meetings.service';
import { classifySectionError, sectionEmptyState } from '@shared/utils/org-lens-empty-state.utils';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, filter, map, of, switchMap, tap } from 'rxjs';

/** Zeroed strip shown before the first response and after a failed one, so the layout never jumps. */
const EMPTY_SUMMARY: OrgMeetingsKpiSummary = {
  employeesActive: 0,
  employeesActiveDeltaLabel: '',
  employeesActiveDeltaDirection: 'flat',
  meetingsAttended: 0,
  meetingsAttendedDeltaLabel: '',
  meetingsAttendedDeltaDirection: 'flat',
  projectsSupported: 0,
  projectsSupportedDeltaLabel: '',
  projectsSupportedDeltaDirection: 'flat',
  foundationsSupported: 0,
  foundationsSupportedDeltaLabel: '',
  foundationsSupportedDeltaDirection: 'flat',
};

@Component({
  selector: 'lfx-org-meetings-kpi-cards',
  imports: [OrgLensEmptyStateComponent, StatCardGridComponent, SkeletonModule],
  templateUrl: './org-meetings-kpi-cards.component.html',
})
export class OrgMeetingsKpiCardsComponent {
  // Private injections
  private readonly accountContext = inject(AccountContextService);
  private readonly meetingsService = inject(OrgLensMeetingsService);

  // Public fields from inputs
  public readonly timeRange = input.required<OrgMeetingsSupportedTimeRange>();

  /** Spec 053 FR-013 — the page owns the time-range filter, so "Reset filters" is delegated to it. */
  public readonly resetFilters = output<void>();

  // Configuration
  protected readonly loading = signal(true);
  /** How the last request ended (spec 053 FR-014/FR-015); emptiness is judged on the totals in hand, below. */
  private readonly loadOutcome = signal<Exclude<OrgLensSectionOutcome, 'empty'>>('records');
  /** Bumped by Retry; part of the request key so the same organization and window re-issue the read. */
  private readonly attempt = signal(0);

  // Complex computed
  private readonly summary: Signal<OrgMeetingsKpiSummary> = this.initSummary();
  protected readonly cards: Signal<StatCardItem[]> = this.initCards();

  protected readonly orgName: Signal<string> = computed(() => this.accountContext.selectedAccount()?.accountName ?? '');
  /** "the past 90 days" — reads naturally after "recorded for". */
  protected readonly periodLabel: Signal<string> = computed(() => `the ${ORG_MEETINGS_TIME_RANGE_LABELS[this.timeRange()].toLowerCase()}`);
  /** Only a window the viewer changed can be reset; on the default the state renders reason-only. */
  protected readonly filterActive: Signal<boolean> = computed(() => this.timeRange() !== ORG_MEETINGS_DEFAULT_TIME_RANGE);

  /** A strip of four zeros says nothing happened in this window; any non-zero total is worth showing. */
  private readonly hasActivity: Signal<boolean> = computed(() => {
    const { employeesActive, meetingsAttended, projectsSupported, foundationsSupported } = this.summary();
    return employeesActive + meetingsAttended + projectsSupported + foundationsSupported > 0;
  });

  /** The shared state to render instead of the cards, or `null` while there is activity to show. */
  protected readonly emptyState = computed(() => {
    const outcome = this.loadOutcome();
    return sectionEmptyState(outcome === 'records' && !this.hasActivity() ? 'empty' : outcome);
  });

  public retry(): void {
    this.attempt.update((n) => n + 1);
  }

  // Private initializers
  private initSummary(): Signal<OrgMeetingsKpiSummary> {
    // A string key, not an object: `selectedAccount` is rewritten in place by Snowflake enrichment
    // and the canonical-record patch, and a fresh object with identical contents would dirty the
    // computed and retrigger the fetch, flashing the loading state for no new data.
    const requestKey$ = toObservable(computed(() => `${this.accountContext.selectedAccount()?.accountId ?? ''}|${this.timeRange()}|${this.attempt()}`));

    return toSignal(
      requestKey$.pipe(
        map((key) => key.split('|') as [string, OrgMeetingsSupportedTimeRange, string]),
        // A cookie-restored account stub can carry a uid with the accountId still pending; fetching
        // then would query the wrong org, so wait for the analytics id to arrive.
        filter(([orgUid]) => !!orgUid),
        tap(() => {
          this.loading.set(true);
          this.loadOutcome.set('records');
        }),
        switchMap(([orgUid, range]) =>
          this.meetingsService.getKpiSummary(orgUid, range).pipe(
            tap(() => this.loading.set(false)),
            catchError((error: unknown) => {
              console.error('Failed to load meeting KPI summary', error);
              this.loading.set(false);
              this.loadOutcome.set(classifySectionError(error));
              return of(EMPTY_SUMMARY);
            })
          )
        )
      ),
      { initialValue: EMPTY_SUMMARY }
    );
  }

  private initCards(): Signal<StatCardItem[]> {
    return computed(() => {
      const summary = this.summary();
      return [
        {
          label: 'Employees Active',
          value: summary.employeesActive,
          icon: 'fa-light fa-users',
          iconContainerClass: ORG_MEETINGS_KPI_ICON_CLASS.employeesActive,
          delta: { label: summary.employeesActiveDeltaLabel, direction: summary.employeesActiveDeltaDirection },
        },
        {
          label: 'Meetings Attended',
          value: summary.meetingsAttended,
          icon: 'fa-light fa-video',
          iconContainerClass: ORG_MEETINGS_KPI_ICON_CLASS.meetingsAttended,
          delta: { label: summary.meetingsAttendedDeltaLabel, direction: summary.meetingsAttendedDeltaDirection },
        },
        {
          label: 'Projects Supported',
          value: summary.projectsSupported,
          icon: 'fa-light fa-diagram-project',
          iconContainerClass: ORG_MEETINGS_KPI_ICON_CLASS.projectsSupported,
          delta: { label: summary.projectsSupportedDeltaLabel, direction: summary.projectsSupportedDeltaDirection },
        },
        {
          label: 'Foundations Supported',
          value: summary.foundationsSupported,
          icon: 'fa-light fa-building-columns',
          iconContainerClass: ORG_MEETINGS_KPI_ICON_CLASS.foundationsSupported,
          delta: { label: summary.foundationsSupportedDeltaLabel, direction: summary.foundationsSupportedDeltaDirection },
        },
      ];
    });
  }
}
