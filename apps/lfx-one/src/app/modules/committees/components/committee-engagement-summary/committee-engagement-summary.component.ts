// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, output, Signal } from '@angular/core';
import { CardComponent } from '@components/card/card.component';
import { FilterPillsComponent } from '@components/filter-pills/filter-pills.component';
import { TagComponent } from '@components/tag/tag.component';
import { COMMITTEE_ENGAGEMENT_DEFAULT_WINDOW, COMMITTEE_ENGAGEMENT_WINDOW_OPTIONS } from '@lfx-one/shared/constants';
import { CommitteeEngagementResponse, CommitteeEngagementWindow } from '@lfx-one/shared/interfaces';
import { formatCommitteeEngagementFreshness, formatCommitteeEngagementRatePercent, toCommitteeEngagementWindow } from '@lfx-one/shared/utils';
import { SkeletonModule } from 'primeng/skeleton';
import { TooltipModule } from 'primeng/tooltip';

/**
 * Overview-tab engagement summary card (LFXV2-1705, behind wg-engagement-metrics): attendance
 * rate, active members, and at-risk count for the selected window, sharing window state with the
 * Members tab via the page-level parent. Renders calm non-error states when the rollup is degraded
 * (`data_available: false` — the dbt model not deployed yet) or the fetch failed entirely (403 for
 * non-auditors, network) — the rest of the overview is unaffected either way.
 */
@Component({
  selector: 'lfx-committee-engagement-summary',
  imports: [CardComponent, FilterPillsComponent, SkeletonModule, TagComponent, TooltipModule],
  templateUrl: './committee-engagement-summary.component.html',
})
export class CommitteeEngagementSummaryComponent {
  // Inputs
  public engagement = input<CommitteeEngagementResponse | null>(null);
  public loading = input<boolean>(false);
  // Named to avoid shadowing the global `window` in class/template scope.
  public engagementWindow = input<CommitteeEngagementWindow>(COMMITTEE_ENGAGEMENT_DEFAULT_WINDOW);

  // Outputs
  public readonly windowChange = output<CommitteeEngagementWindow>();

  public readonly windowOptions = COMMITTEE_ENGAGEMENT_WINDOW_OPTIONS;

  // Computed signals — inline per component-organization.md (all simple projections)
  public readonly dataAvailable: Signal<boolean> = computed(() => this.engagement()?.data_available === true);
  public readonly isMock: Signal<boolean> = computed(() => this.engagement()?.data_source === 'mock');
  public readonly freshnessLabel: Signal<string> = computed(() => formatCommitteeEngagementFreshness(this.engagement()?.computed_at ?? null));
  public readonly windowLabel: Signal<string> = computed(() => {
    const option = COMMITTEE_ENGAGEMENT_WINDOW_OPTIONS.find((o) => o.id === this.engagementWindow());
    return option?.fullLabel ?? option?.label ?? this.engagementWindow();
  });
  public readonly attendanceRateLabel: Signal<string> = computed(() => {
    const summary = this.engagement()?.summary;
    return summary ? formatCommitteeEngagementRatePercent(summary.attendance_rate) : '—';
  });
  public readonly activeMembersLabel: Signal<string> = computed(() => {
    const summary = this.engagement()?.summary;
    return summary ? `${summary.active_count}/${summary.total_count}` : '—';
  });
  public readonly atRiskCount: Signal<number> = computed(() => this.engagement()?.summary?.at_risk_count ?? 0);
  // Explicit aria-labels below embed the displayed value/window — a screen-reader user focusing
  // the tooltip host must hear the metric itself, not just its explanation (LFXV2-1705 review).
  public readonly attendanceRateAriaLabel: Signal<string> = computed(
    () => `Attendance Rate: ${this.attendanceRateLabel()} — personal attendance across all invited roster members, including Emeritus seats`
  );
  public readonly activeMembersAriaLabel: Signal<string> = computed(
    () =>
      `Active Members (${this.windowLabel()}): ${this.activeMembersLabel()} — members with attendance this window or who joined within it; Emeritus seats excluded`
  );

  public onWindowChange(windowId: string): void {
    // filter-pills emits a plain string id — only forward values the endpoint actually accepts.
    const window = toCommitteeEngagementWindow(windowId);
    if (window) {
      this.windowChange.emit(window);
    }
  }
}
