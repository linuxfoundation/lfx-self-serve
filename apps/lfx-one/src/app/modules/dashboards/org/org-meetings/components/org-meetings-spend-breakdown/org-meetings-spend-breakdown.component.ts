// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, output, Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { OrgLensEmptyStateComponent } from '@components/org-lens-empty-state/org-lens-empty-state.component';
import { ORG_MEETINGS_DEFAULT_TIME_RANGE, ORG_MEETINGS_TIME_RANGE_LABELS } from '@lfx-one/shared/constants';
import type { OrgLensSectionOutcome, OrgMeetingsSpendBreakdown, OrgMeetingsSupportedTimeRange } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensMeetingsService } from '@services/org-lens-meetings.service';
import { classifySectionError, sectionEmptyState } from '@shared/utils/org-lens-empty-state.utils';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, filter, map, of, switchMap, tap } from 'rxjs';

import { OrgSpendBarComponent } from './org-spend-bar.component';

const EMPTY_SPEND: OrgMeetingsSpendBreakdown = { byFoundation: [], byProject: [], byMeetingType: [], byRole: [] };

@Component({
  selector: 'lfx-org-meetings-spend-breakdown',
  imports: [OrgLensEmptyStateComponent, OrgSpendBarComponent, SkeletonModule],
  templateUrl: './org-meetings-spend-breakdown.component.html',
})
export class OrgMeetingsSpendBreakdownComponent {
  // Private injections
  private readonly accountContext = inject(AccountContextService);
  private readonly meetingsService = inject(OrgLensMeetingsService);

  // Public fields from inputs
  public readonly timeRange = input.required<OrgMeetingsSupportedTimeRange>();

  /** Spec 053 FR-013 — the page owns the time-range filter, so "Reset filters" is delegated to it. */
  public readonly resetFilters = output<void>();

  // Configuration
  protected readonly loading = signal(true);
  /** How the last request ended (spec 053 FR-014/FR-015); emptiness is judged on the breakdowns in hand, below. */
  private readonly loadOutcome = signal<Exclude<OrgLensSectionOutcome, 'empty'>>('records');
  /** Bumped by Retry; part of the request key so the same organization and window re-issue the read. */
  private readonly attempt = signal(0);

  // Complex computed
  protected readonly spend: Signal<OrgMeetingsSpendBreakdown> = this.initSpend();

  protected readonly orgName: Signal<string> = computed(() => this.accountContext.selectedAccount()?.accountName ?? '');
  /** "the past 90 days" — reads naturally after "recorded for". */
  protected readonly periodLabel: Signal<string> = computed(() => `the ${ORG_MEETINGS_TIME_RANGE_LABELS[this.timeRange()].toLowerCase()}`);
  /** Only a window the viewer changed can be reset; on the default the state renders reason-only. */
  protected readonly filterActive: Signal<boolean> = computed(() => this.timeRange() !== ORG_MEETINGS_DEFAULT_TIME_RANGE);

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
  private readonly hasAnyBreakdown: Signal<boolean> = computed(() => this.showFoundation() || this.showProject() || this.showMeetingType() || this.showRole());

  /** The shared state to render instead of the cards, or `null` while there is a breakdown to show. */
  protected readonly emptyState = computed(() => {
    const outcome = this.loadOutcome();
    return sectionEmptyState(outcome === 'records' && !this.hasAnyBreakdown() ? 'empty' : outcome);
  });

  public retry(): void {
    this.attempt.update((n) => n + 1);
  }

  // Private initializers
  private initSpend(): Signal<OrgMeetingsSpendBreakdown> {
    // A string key, not an object: `selectedAccount` is rewritten in place by Snowflake enrichment
    // and the canonical-record patch, and a fresh object with identical contents would dirty the
    // computed and retrigger the fetch, flashing the loading state for no new data.
    const requestKey$ = toObservable(computed(() => `${this.accountContext.selectedAccount()?.accountId ?? ''}|${this.timeRange()}|${this.attempt()}`));

    return toSignal(
      requestKey$.pipe(
        map((key) => key.split('|') as [string, OrgMeetingsSupportedTimeRange, string]),
        filter(([orgUid]) => !!orgUid),
        tap(() => {
          this.loading.set(true);
          this.loadOutcome.set('records');
        }),
        switchMap(([orgUid, range]) =>
          this.meetingsService.getSpendBreakdown(orgUid, range).pipe(
            tap(() => this.loading.set(false)),
            catchError((error: unknown) => {
              console.error('Failed to load meeting spend breakdown', error);
              this.loading.set(false);
              this.loadOutcome.set(classifySectionError(error));
              return of(EMPTY_SPEND);
            })
          )
        )
      ),
      { initialValue: EMPTY_SPEND }
    );
  }
}
