// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, output, Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { OrgLensEmptyStateComponent } from '@components/org-lens-empty-state/org-lens-empty-state.component';
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
  ORG_MEETINGS_DEFAULT_TIME_RANGE,
  ORG_MEETINGS_TIME_RANGE_LABELS,
  PD_BAND_TAG,
} from '@lfx-one/shared/constants';
import type { OrgInfluenceBandBar, OrgInfluenceDisplayRow, OrgInfluenceRow, OrgMeetingsSupportedTimeRange } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensMeetingsService } from '@services/org-lens-meetings.service';
import { OrgLensNavigationService } from '@services/org-lens-navigation.service';
import { classifySectionError, OrgLensSectionOutcome, sectionEmptyState } from '@shared/utils/org-lens-empty-state.utils';
import { catchError, filter, map, of, switchMap, tap } from 'rxjs';

/** Display row plus its project-page router commands, so the template binds a value instead of calling a method. */
type OrgInfluenceLinkedRow = OrgInfluenceDisplayRow & { projectLink: string[] };

@Component({
  selector: 'lfx-org-meetings-influence',
  imports: [RouterLink, TooltipModule, SkeletonModule, OrgLensEmptyStateComponent],
  templateUrl: './org-meetings-influence.component.html',
})
export class OrgMeetingsInfluenceComponent {
  // Private injections
  private readonly accountContext = inject(AccountContextService);
  private readonly orgLens = inject(OrgLensNavigationService);
  private readonly meetingsService = inject(OrgLensMeetingsService);

  // Public fields from inputs
  public readonly timeRange = input.required<OrgMeetingsSupportedTimeRange>();

  /** Spec 053 FR-013 — the page owns the time-range filter, so "Reset filters" is delegated to it. */
  public readonly resetFilters = output<void>();

  // Configuration
  protected readonly deltaTextClass = DELTA_DIRECTION_TEXT_CLASS;
  protected readonly deltaIcon = DELTA_DIRECTION_ICON;
  protected readonly bandBarWidth = ORG_INFLUENCE_SIGNAL_BAR_WIDTH;
  protected readonly loading = signal(true);
  /** How the last request ended (spec 053 FR-014/FR-015); emptiness is judged on the rows in hand, below. */
  private readonly loadOutcome = signal<Exclude<OrgLensSectionOutcome, 'empty'>>('records');
  /** Bumped by Retry; part of the request key so the same organization and window re-issue the read. */
  private readonly attempt = signal(0);

  // Expansion state is owned here as a slug -> boolean map, mirroring the /org/overview
  // foundations table pattern. All rows are collapsed by default.
  protected readonly expansionState = signal<Record<string, boolean>>({});

  // Selected organization's display name, used in the attendance-contribution explanatory sentence
  // and interpolated into the genuine-empty state (the caller holds this organization, FR-019).
  protected readonly orgName = computed(() => this.accountContext.selectedAccount()?.accountName || 'Your organization');

  /** "the past 90 days" — reads naturally after "recorded for". */
  protected readonly periodLabel: Signal<string> = computed(() => `the ${ORG_MEETINGS_TIME_RANGE_LABELS[this.timeRange()].toLowerCase()}`);
  /** Only a window the viewer changed can be reset; on the default the state renders reason-only. */
  protected readonly filterActive: Signal<boolean> = computed(() => this.timeRange() !== ORG_MEETINGS_DEFAULT_TIME_RANGE);

  // Rows enriched with the qualitative band chip (label + signal-bar icon) and a breakdown of
  // ecosystem-influence measures sorted descending, with meeting attendance highlighted so the
  // section's subject stays visually dominant even when it isn't the largest measure.
  private readonly fetchedRows: Signal<OrgInfluenceRow[]> = this.initFetchedRows();
  protected readonly rows: Signal<OrgInfluenceLinkedRow[]> = this.initRows();

  /** The shared state to render instead of the table, or `null` while there are rows to show. */
  protected readonly emptyState = computed(() => {
    const outcome = this.loadOutcome();
    return sectionEmptyState(outcome === 'records' && this.fetchedRows().length === 0 ? 'empty' : outcome);
  });

  // Between roughly half and two-thirds of orgs with meeting activity render the genuine-empty
  // state depending on the window, so the score-availability note has to accompany it as well as
  // the table — without it, "no influence scores" reads as "no project influence at all".
  protected readonly showsCoverageNote: Signal<boolean> = computed(() => !this.loading() && this.loadOutcome() === 'records');

  public retry(): void {
    this.attempt.update((n) => n + 1);
  }

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

  private initRows(): Signal<OrgInfluenceLinkedRow[]> {
    return computed(() =>
      this.fetchedRows().map((row) => ({
        ...row,
        // Hoisted from the template: a method call there allocates a new command array per row on every change-detection pass (frontend-checklist §4).
        projectLink: this.orgLens.orgLensLink('projects', row.projectSlug),
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
    const requestKey$ = toObservable(computed(() => `${this.accountContext.selectedAccount()?.accountId ?? ''}|${this.timeRange()}|${this.attempt()}`));

    return toSignal(
      requestKey$.pipe(
        map((key) => key.split('|') as [string, OrgMeetingsSupportedTimeRange, string]),
        filter(([orgUid]) => !!orgUid),
        tap(() => {
          this.loading.set(true);
          this.loadOutcome.set('records');
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
              this.loadOutcome.set(classifySectionError(error));
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
