// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import type { OrgMeetingsSpendBreakdown, OrgMeetingsSupportedTimeRange } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensMeetingsService } from '@services/org-lens-meetings.service';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, filter, map, of, switchMap, tap } from 'rxjs';

import { OrgSpendBarComponent } from './org-spend-bar.component';

const EMPTY_SPEND: OrgMeetingsSpendBreakdown = { byFoundation: [], byProject: [], byMeetingType: [], byRole: [] };

@Component({
  selector: 'lfx-org-meetings-spend-breakdown',
  imports: [OrgSpendBarComponent, SkeletonModule],
  templateUrl: './org-meetings-spend-breakdown.component.html',
})
export class OrgMeetingsSpendBreakdownComponent {
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
  protected readonly spend: Signal<OrgMeetingsSpendBreakdown> = this.initSpend();

  // The meeting-type and role distributions are withheld for organizations with too few active
  // employees to aggregate safely, and that suppression arrives as an empty array rather than a
  // missing key. Rendering an empty card would imply the org attends no typed meetings, so the
  // cards are hidden instead.
  // Applied uniformly to all four: an empty card reads as "none of this happened" wherever it
  // appears, so any breakdown that comes back empty is hidden rather than rendered blank.
  protected readonly showFoundation: Signal<boolean> = computed(() => this.spend().byFoundation.length > 0);
  protected readonly showProject: Signal<boolean> = computed(() => this.spend().byProject.length > 0);
  protected readonly showMeetingType: Signal<boolean> = computed(() => this.spend().byMeetingType.length > 0);
  protected readonly showRole: Signal<boolean> = computed(() => this.spend().byRole.length > 0);
  protected readonly hasAnyBreakdown: Signal<boolean> = computed(
    () => this.showFoundation() || this.showProject() || this.showMeetingType() || this.showRole()
  );

  // Private initializers
  private initSpend(): Signal<OrgMeetingsSpendBreakdown> {
    // A string key, not an object: `selectedAccount` is rewritten in place by Snowflake enrichment
    // and the canonical-record patch, and a fresh object with identical contents would dirty the
    // computed and retrigger the fetch, flashing the loading state for no new data.
    const requestKey$ = toObservable(computed(() => `${this.accountContext.selectedAccount()?.accountId ?? ''}|${this.timeRange()}`));

    return toSignal(
      requestKey$.pipe(
        map((key) => key.split('|') as [string, OrgMeetingsSupportedTimeRange]),
        filter(([orgUid]) => !!orgUid),
        tap(() => {
          this.loading.set(true);
          this.failed.set(false);
          this.forbidden.set(false);
        }),
        switchMap(([orgUid, range]) =>
          this.meetingsService.getSpendBreakdown(orgUid, range).pipe(
            tap(() => this.loading.set(false)),
            catchError((error: unknown) => {
              console.error('Failed to load meeting spend breakdown', error);
              this.loading.set(false);
              if ((error as { status?: number })?.status === 403) this.forbidden.set(true);
              else this.failed.set(true);
              return of(EMPTY_SPEND);
            })
          )
        )
      ),
      { initialValue: EMPTY_SPEND }
    );
  }
}
