// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { StatCardGridComponent } from '@components/stat-card-grid/stat-card-grid.component';
import { ORG_MEETINGS_KPI_ICON_CLASS } from '@lfx-one/shared/constants';
import type { OrgMeetingsKpiSummary, OrgMeetingsSupportedTimeRange, StatCardItem } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensMeetingsService } from '@services/org-lens-meetings.service';
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
  imports: [StatCardGridComponent, SkeletonModule],
  templateUrl: './org-meetings-kpi-cards.component.html',
})
export class OrgMeetingsKpiCardsComponent {
  // Private injections
  private readonly accountContext = inject(AccountContextService);
  private readonly meetingsService = inject(OrgLensMeetingsService);

  // Public fields from inputs
  public readonly timeRange = input.required<OrgMeetingsSupportedTimeRange>();

  // Configuration
  protected readonly loading = signal(true);
  protected readonly failed = signal(false);
  // A 403 means the caller holds no Org Lens grant on this org. The org selector admits
  // persona-seeded organizations that carry no such grant, so this is reachable by simply
  // picking one -- and "couldn't be loaded" would misdescribe it as a transient failure.
  protected readonly forbidden = signal(false);

  // Complex computed
  private readonly summary: Signal<OrgMeetingsKpiSummary> = this.initSummary();
  protected readonly cards: Signal<StatCardItem[]> = this.initCards();

  // Private initializers
  private initSummary(): Signal<OrgMeetingsKpiSummary> {
    // A string key, not an object: `selectedAccount` is rewritten in place by Snowflake enrichment
    // and the canonical-record patch, and a fresh object with identical contents would dirty the
    // computed and retrigger the fetch, flashing the loading state for no new data.
    const requestKey$ = toObservable(computed(() => `${this.accountContext.selectedAccount()?.accountId ?? ''}|${this.timeRange()}`));

    return toSignal(
      requestKey$.pipe(
        map((key) => key.split('|') as [string, OrgMeetingsSupportedTimeRange]),
        // A cookie-restored account stub can carry a uid with the accountId still pending; fetching
        // then would query the wrong org, so wait for the analytics id to arrive.
        filter(([orgUid]) => !!orgUid),
        tap(() => {
          this.loading.set(true);
          this.failed.set(false);
          this.forbidden.set(false);
        }),
        switchMap(([orgUid, range]) =>
          this.meetingsService.getKpiSummary(orgUid, range).pipe(
            tap(() => this.loading.set(false)),
            catchError((error: unknown) => {
              console.error('Failed to load meeting KPI summary', error);
              this.loading.set(false);
              if ((error as { status?: number })?.status === 403) this.forbidden.set(true);
              else this.failed.set(true);
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
