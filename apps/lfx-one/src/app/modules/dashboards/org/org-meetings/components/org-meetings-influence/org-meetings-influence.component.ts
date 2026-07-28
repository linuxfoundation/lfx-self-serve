// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, Signal, signal } from '@angular/core';
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
  ORG_INFLUENCE_MEASURE_LABEL_MEETING_ATTENDANCE,
  ORG_INFLUENCE_SIGNAL_BAR_GAP,
  ORG_INFLUENCE_SIGNAL_BAR_HEIGHTS,
  ORG_INFLUENCE_SIGNAL_BAR_WIDTH,
  ORG_MEETINGS_ATTENDANCE_BAR_SCALE,
  PD_BAND_TAG,
} from '@lfx-one/shared/constants';
import type { OrgInfluenceBandBar, OrgInfluenceDisplayRow, OrgInfluenceRow } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensMeetingsService } from '@services/org-lens-meetings.service';
import { catchError, filter, of, switchMap, tap } from 'rxjs';

@Component({
  selector: 'lfx-org-meetings-influence',
  imports: [RouterLink, TooltipModule, SkeletonModule],
  templateUrl: './org-meetings-influence.component.html',
})
export class OrgMeetingsInfluenceComponent {
  // Private injections
  private readonly accountContext = inject(AccountContextService);
  private readonly meetingsService = inject(OrgLensMeetingsService);

  // No `timeRange` input: influence is range-independent, so the surface deliberately takes no
  // window and the section does not refetch when the dropdown changes.

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

  // Explanatory copy surfaced via the info-icon tooltip next to the section heading.
  protected readonly infoTooltip =
    "Meeting attendance is one of the signals behind each project's Ecosystem Influence Score. See the full breakdown on the Projects page.";

  // Expansion state is owned here as a slug -> boolean map, mirroring the /org/overview
  // foundations table pattern. All rows are collapsed by default.
  protected readonly expansionState = signal<Record<string, boolean>>({});

  // Selected organization's display name, used in the attendance-contribution explanatory sentence.
  protected readonly orgName = computed(() => this.accountContext.selectedAccount()?.accountName || 'Your organization');

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
        breakdown: [...row.breakdown]
          .sort((a, b) => b.pct - a.pct)
          .map((segment) => ({ ...segment, isAttendance: segment.label === ORG_INFLUENCE_MEASURE_LABEL_MEETING_ATTENDANCE })),
      }))
    );
  }

  private initFetchedRows(): Signal<OrgInfluenceRow[]> {
    const orgUid$ = toObservable(computed(() => this.accountContext.selectedAccount()?.accountId ?? ''));

    return toSignal(
      orgUid$.pipe(
        filter((orgUid) => !!orgUid),
        tap(() => {
          this.loading.set(true);
          this.failed.set(false);
          this.forbidden.set(false);
          // Expansion is keyed by project slug, and two orgs can engage the same project — without
          // this reset, a row expanded on the previous org reopens on the new one.
          this.expansionState.set({});
        }),
        switchMap((orgUid) =>
          this.meetingsService.getInfluenceRows(orgUid).pipe(
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
