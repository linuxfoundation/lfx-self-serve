// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { SkeletonModule } from 'primeng/skeleton';
import { TooltipModule } from 'primeng/tooltip';
import {
  BAND_CHIP_CLASS,
  BAND_SIGNAL_FILL,
  BAND_SIGNAL_FILL_LIGHT,
  BAND_SIGNAL_RANK,
  DELTA_DIRECTION_ICON,
  DELTA_DIRECTION_TEXT_CLASS,
  ORG_INFLUENCE_CUMULATIVE_MEASURE_LABELS,
  ORG_INFLUENCE_CUMULATIVE_MEASURE_SUFFIX,
  ORG_INFLUENCE_MEASURE_LABEL_MEETING_ATTENDANCE,
  ORG_INFLUENCE_REFERENCE_WINDOW_LABEL,
  ORG_INFLUENCE_SIGNAL_BAR_GAP,
  ORG_INFLUENCE_SIGNAL_BAR_HEIGHTS,
  ORG_INFLUENCE_SIGNAL_BAR_WIDTH,
  ORG_MEETINGS_ATTENDANCE_BAR_SCALE,
  ORG_MEETINGS_TIME_RANGE_LABELS,
  PD_BAND_TAG,
} from '@lfx-one/shared/constants';
import type { OrgInfluenceBandBar, OrgInfluenceDisplayRow, OrgInfluenceRow, OrgMeetingsSupportedTimeRange } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensMeetingsService } from '@services/org-lens-meetings.service';
import { catchError, filter, map, of, switchMap, tap } from 'rxjs';

@Component({
  selector: 'lfx-org-meetings-influence',
  imports: [RouterLink, TooltipModule, SkeletonModule],
  templateUrl: './org-meetings-influence.component.html',
})
export class OrgMeetingsInfluenceComponent {
  // Private injections
  private readonly accountContext = inject(AccountContextService);
  private readonly meetingsService = inject(OrgLensMeetingsService);

  // Public fields from inputs
  public readonly timeRange = input.required<OrgMeetingsSupportedTimeRange>();

  // Configuration
  protected readonly deltaTextClass = DELTA_DIRECTION_TEXT_CLASS;
  protected readonly deltaIcon = DELTA_DIRECTION_ICON;
  protected readonly bandBarWidth = ORG_INFLUENCE_SIGNAL_BAR_WIDTH;
  protected readonly loading = signal(true);
  protected readonly failed = signal(false);
  // A 403 means the caller holds no Org Lens grant on this org. The org selector admits
  // persona-seeded organizations that carry no such grant, so this is reachable by simply
  // picking one -- and "couldn't be loaded" would misdescribe it as a transient failure.
  protected readonly forbidden = signal(false);

  // Expansion state is owned here as a slug -> boolean map, mirroring the /org/overview
  // foundations table pattern. All rows are collapsed by default.
  protected readonly expansionState = signal<Record<string, boolean>>({});

  // Selected organization's display name, used in the attendance-contribution explanatory sentence.
  protected readonly orgName = computed(() => this.accountContext.selectedAccount()?.accountName || 'Your organization');

  // Narrow windows make the empty state common — roughly half of orgs with meeting activity at the
  // default window, and nearly two-thirds at a quarter — so the copy has to name the window as well
  // as the score-availability limit, or it reads as "you have no influence at all".
  protected readonly windowLabel = computed(() => ORG_MEETINGS_TIME_RANGE_LABELS[this.timeRange()].toLowerCase());

  // Rows enriched with the qualitative band chip (label + signal-bar icon) and a breakdown of
  // ecosystem-influence measures sorted descending, with meeting attendance highlighted so the
  // section's subject stays visually dominant even when it isn't the largest measure.
  private readonly fetchedRows: Signal<OrgInfluenceRow[]> = this.initFetchedRows();
  protected readonly rows: Signal<OrgInfluenceDisplayRow[]> = this.initRows();

  protected toggleExpansion(projectSlug: string): void {
    this.expansionState.update((state) => {
      const next = { ...state };
      if (next[projectSlug]) {
        delete next[projectSlug];
      } else {
        next[projectSlug] = true;
      }
      return next;
    });
  }

  private initRows(): Signal<OrgInfluenceDisplayRow[]> {
    return computed(() =>
      this.fetchedRows().map((row) => ({
        ...row,
        bandChipClass: BAND_CHIP_CLASS[row.band],
        bandLabel: PD_BAND_TAG[row.band].label,
        bandBars: this.buildSignalBars(BAND_SIGNAL_RANK[row.band], BAND_SIGNAL_FILL[row.band], BAND_SIGNAL_FILL_LIGHT[row.band]),
        // Emphasis-scaled width for the summary row's attendance bar — a distinct visual from the
        // expanded detail row's unscaled breakdown bars, which compare nine measures against each
        // other. Clamped so a high fromAttendancePct can't overflow past 100%. Precomputed here
        // rather than called from the template, which would re-run it on every change detection.
        attendanceBarWidth: Math.min(100, row.fromAttendancePct * ORG_MEETINGS_ATTENDANCE_BAR_SCALE),
        rankTooltip: this.buildRankTooltip(row),
        breakdown: [...row.breakdown]
          .sort((a, b) => b.pct - a.pct)
          .map((segment) => ({
            ...segment,
            isAttendance: segment.label === ORG_INFLUENCE_MEASURE_LABEL_MEETING_ATTENDANCE,
            displayLabel: ORG_INFLUENCE_CUMULATIVE_MEASURE_LABELS.includes(segment.label)
              ? `${segment.label}${ORG_INFLUENCE_CUMULATIVE_MEASURE_SUFFIX}`
              : segment.label,
          })),
      }))
    );
  }

  /**
   * The reference population is measured at a fixed window while the rank is not, so the copy names
   * the window for each. It also avoids framing the reference as a superset — the ranked population
   * exceeds it on most projects at wide windows, because the two count different things over
   * different periods. Where a project has no reference figure the clause is omitted entirely: "0
   * companies have any recorded influence" beside a live rank contradicts itself.
   */
  private buildRankTooltip(row: OrgInfluenceRow): string {
    const compared = `Ranked among the companies that contributed code or attended meetings on this project in the selected period.`;
    // Absence is tested by type, not against null. The contract says `number | null`, but this runs
    // on a payload that crossed HTTP and a cache, and during a rolling deploy a peer still on the
    // pre-range contract omits the field entirely. `undefined` would slip past a `=== null` check
    // and throw on toLocaleString inside a computed, taking the whole table down over a tooltip.
    if (typeof row.rankTotalAll !== 'number') {
      return compared;
    }
    return `${compared} Across ${ORG_INFLUENCE_REFERENCE_WINDOW_LABEL}, ${row.rankTotalAll.toLocaleString('en-US')} companies have any recorded influence on it.`;
  }

  private initFetchedRows(): Signal<OrgInfluenceRow[]> {
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
          // Expansion is keyed by project slug, and two orgs can engage the same project — without
          // this reset, a row expanded on the previous org reopens on the new one. Changing the
          // window collapses rows for the same reason: an expanded breakdown belongs to a window.
          this.expansionState.set({});
        }),
        switchMap(([orgUid, range]) =>
          this.meetingsService.getInfluenceRows(orgUid, range).pipe(
            tap(() => this.loading.set(false)),
            catchError((error: unknown) => {
              console.error('Failed to load meeting influence rows', error);
              this.loading.set(false);
              if ((error as { status?: number })?.status === 403) this.forbidden.set(true);
              else this.failed.set(true);
              return of([] as OrgInfluenceRow[]);
            })
          )
        )
      ),
      { initialValue: [] as OrgInfluenceRow[] }
    );
  }

  private buildSignalBars(rank: number, fill: string, fillLight: string): OrgInfluenceBandBar[] {
    return ORG_INFLUENCE_SIGNAL_BAR_HEIGHTS.map((h, index) => ({
      x: index * (ORG_INFLUENCE_SIGNAL_BAR_WIDTH + ORG_INFLUENCE_SIGNAL_BAR_GAP),
      y: 15 - h,
      h,
      fillClass: index < rank ? fill : fillLight,
    }));
  }
}
