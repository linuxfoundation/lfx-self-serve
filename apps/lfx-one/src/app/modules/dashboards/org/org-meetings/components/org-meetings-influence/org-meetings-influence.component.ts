// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, Signal, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TooltipModule } from 'primeng/tooltip';
import {
  BAND_CHIP_CLASS,
  BAND_SIGNAL_FILL,
  BAND_SIGNAL_FILL_LIGHT,
  BAND_SIGNAL_RANK,
  DELTA_DIRECTION_ICON,
  DELTA_DIRECTION_TEXT_CLASS,
  DEMO_ORG_INFLUENCE_ROWS,
  ORG_MEETINGS_ATTENDANCE_BAR_SCALE,
  PD_BAND_TAG,
} from '@lfx-one/shared/constants';
import type { OrgInfluenceBandBar, OrgInfluenceDisplayRow, OrgMeetingsTimeRange } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';

// Signal-bar geometry, matching the Org Lens Project Detail band chip (PR #1028): four ascending
// bars, filled up to the band's rank and greyed beyond it.
const SIGNAL_BAR_HEIGHTS = [5, 8.3, 11.6, 15];
const SIGNAL_BAR_WIDTH = 2.6;
const SIGNAL_BAR_GAP = 1.8;

const MEASURE_LABEL_MEETING_ATTENDANCE = 'Meeting Attendance';

@Component({
  selector: 'lfx-org-meetings-influence',
  imports: [RouterLink, TooltipModule],
  templateUrl: './org-meetings-influence.component.html',
})
export class OrgMeetingsInfluenceComponent {
  // Private injections
  private readonly accountContext = inject(AccountContextService);

  // Public fields from inputs
  public readonly timeRange = input.required<OrgMeetingsTimeRange>();

  // Configuration
  protected readonly deltaTextClass = DELTA_DIRECTION_TEXT_CLASS;
  protected readonly deltaIcon = DELTA_DIRECTION_ICON;
  protected readonly attendanceBarScale = ORG_MEETINGS_ATTENDANCE_BAR_SCALE;

  // Explanatory copy surfaced via the info-icon tooltip next to the section heading.
  protected readonly infoTooltip =
    "Meeting attendance is one of the signals behind each project's Ecosystem Influence Score. See the full breakdown on the Projects page, or review project health on the Governance page.";

  // Expansion state is owned here as a slug -> boolean map, mirroring the /org/overview
  // foundations table pattern. All rows are collapsed by default.
  private readonly expansionState = signal<Record<string, boolean>>({});

  // Selected organization's display name, used in the attendance-contribution explanatory sentence.
  protected readonly orgName = computed(() => this.accountContext.selectedAccount()?.accountName || 'Your organization');

  protected readonly expansionMap: Signal<Record<string, boolean>> = computed(() => this.expansionState());

  // Rows enriched with the qualitative band chip (label + signal-bar icon) and a breakdown of
  // ecosystem-influence measures sorted descending, with meeting attendance highlighted so the
  // section's subject stays visually dominant even when it isn't the largest measure.
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
      DEMO_ORG_INFLUENCE_ROWS.map((row) => ({
        ...row,
        bandChipClass: BAND_CHIP_CLASS[row.band],
        bandLabel: PD_BAND_TAG[row.band].label,
        bandBars: this.buildSignalBars(BAND_SIGNAL_RANK[row.band], BAND_SIGNAL_FILL[row.band], BAND_SIGNAL_FILL_LIGHT[row.band]),
        breakdown: [...row.breakdown]
          .sort((a, b) => b.pct - a.pct)
          .map((segment) => ({ ...segment, isAttendance: segment.label === MEASURE_LABEL_MEETING_ATTENDANCE })),
      }))
    );
  }

  private buildSignalBars(rank: number, fill: string, fillLight: string): OrgInfluenceBandBar[] {
    return SIGNAL_BAR_HEIGHTS.map((h, index) => ({
      x: index * (SIGNAL_BAR_WIDTH + SIGNAL_BAR_GAP),
      y: 15 - h,
      h,
      fillClass: index < rank ? fill : fillLight,
    }));
  }
}
