// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, output, Signal } from '@angular/core';
import { CardComponent } from '@components/card/card.component';
import { FilterPillsComponent } from '@components/filter-pills/filter-pills.component';
import { TagComponent } from '@components/tag/tag.component';
import { COMMITTEE_ENGAGEMENT_DEFAULT_WINDOW, COMMITTEE_ENGAGEMENT_WINDOW_OPTIONS } from '@lfx-one/shared/constants';
import { CommitteeEngagementResponse, CommitteeEngagementWindow } from '@lfx-one/shared/interfaces';
import {
  formatCommitteeEngagementFreshness,
  formatCommitteeEngagementRatePercent,
  isCommitteeMemberRateEligible,
  toCommitteeEngagementWindow,
} from '@lfx-one/shared/utils';
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

  // Computed signals — inline per component-organization.md
  public readonly dataAvailable: Signal<boolean> = computed(() => this.engagement()?.data_available === true);
  public readonly isMock: Signal<boolean> = computed(() => this.engagement()?.data_source === 'mock');
  public readonly freshnessLabel: Signal<string> = computed(() => formatCommitteeEngagementFreshness(this.engagement()?.computed_at ?? null));
  public readonly windowLabel: Signal<string> = computed(() => {
    const option = COMMITTEE_ENGAGEMENT_WINDOW_OPTIONS.find((o) => o.id === this.engagementWindow());
    return option?.fullLabel ?? option?.label ?? this.engagementWindow();
  });
  // `attendance_rate` sums only rate-eligible members' attended/invited (non-voting LF Staff
  // excluded, Emeritus included — see CommitteeEngagementSummary.attendance_rate's doc); the server
  // has no single "rate-eligible seat count" field to gate this the way `eligible_count` gates
  // active members below, but `members[]` carries every roster member's role/voting_status/invited,
  // so calling the same isCommitteeMemberRateEligible predicate the server sums with, plus an
  // `invited > 0` check, re-derives whether the sum has any real contributor client-side — a rate-
  // eligible member with zero invites this window contributes nothing either, reaching the same `0`
  // via `computeCommitteeEngagementRate`'s `invited <= 0` sentinel. Without this gate, either shape
  // (GH-1848: no rate-eligible member at all, or one that exists but was never invited) rendered a
  // literal `0%` — the same false "nobody shows up" signal the eligible_count guard below exists to
  // remove from active members, just affirmative instead of a 0/0 ratio.
  private readonly hasInvitedRateEligibleMember: Signal<boolean> = computed(() =>
    (this.engagement()?.members ?? []).some((m) => m.invited > 0 && isCommitteeMemberRateEligible({ role: m.role, votingStatus: m.voting_status }))
  );
  // `summary` is non-optional on CommitteeEngagementResponse, so `!summary` only fires when
  // `engagement()` itself is null — but attendanceRateLabel and attendanceRateAriaLabel both need
  // the same "is there a real rate to show" answer, so it's hoisted once rather than risking the
  // two checks drifting apart (a mismatch here would let the aria-label's 'not available' branch
  // miss, interpolating attendanceRateLabel()'s raw '—' next to the sentence's own em-dash — the
  // exact double-dash failure activeMembersAriaLabel's analogous guard, below, already avoids by
  // deriving hasEligibleMembers from `summary` directly).
  private readonly hasAttendanceRate: Signal<boolean> = computed(() => !!this.engagement()?.summary && this.hasInvitedRateEligibleMember());
  public readonly attendanceRateLabel: Signal<string> = computed(() => {
    const summary = this.engagement()?.summary;
    if (!summary || !this.hasAttendanceRate()) return '—';
    return formatCommitteeEngagementRatePercent(summary.attendance_rate);
  });
  // Denominator is eligible_count, NOT total_count (LFXV2-3101 review fix) — total_count includes
  // Emeritus/non-voting LF Staff seats that active_count's numerator always excludes, so
  // active_count/total_count could never reach 100% for a committee that seats either. See
  // CommitteeEngagementSummary.eligible_count's doc. `eligible_count === 0` (a roster made up
  // entirely of Emeritus/non-voting-LF-Staff seats, GH-1848) is the source-of-truth condition for
  // the '—' fallback below (both the display label and, via `hasEligibleMembers`, the aria-label) —
  // rather than the literal "0/0", which would read as a data failure on a real, populated
  // committee.
  private readonly hasEligibleMembers: Signal<boolean> = computed(() => (this.engagement()?.summary?.eligible_count ?? 0) > 0);
  public readonly activeMembersLabel: Signal<string> = computed(() => {
    const summary = this.engagement()?.summary;
    if (!summary || !this.hasEligibleMembers()) return '—';
    return `${summary.active_count}/${summary.eligible_count}`;
  });
  public readonly atRiskCount: Signal<number> = computed(() => this.engagement()?.summary?.at_risk_count ?? 0);
  // Explicit aria-labels below embed the displayed value/window — a screen-reader user focusing
  // the tooltip host must hear the metric itself, not just its explanation (LFXV2-1705 review).
  // Spells out "not available" rather than interpolating attendanceRateLabel()'s '—' glyph directly,
  // for the same reason activeMembersAriaLabel below does — a raw '—' next to the sentence's own
  // em-dash separator reads as two indistinguishable dashes to a screen reader.
  public readonly attendanceRateAriaLabel: Signal<string> = computed(() => {
    const spokenValue = this.hasAttendanceRate() ? this.attendanceRateLabel() : 'not available';
    return `Attendance Rate: ${spokenValue} — personal attendance across all invited roster members, including Emeritus seats but excluding non-voting LF Staff seats`;
  });
  // Spells out "not available" rather than interpolating activeMembersLabel()'s '—' glyph directly
  // — a raw '—' immediately followed by the sentence's own '—' separator reads as two consecutive
  // dashes with no spoken distinction between them. Branches on `hasEligibleMembers` (the source
  // condition), not on comparing the rendered label string against the '—' glyph, so a future
  // change to the placeholder glyph can't silently revert this without also changing the condition.
  public readonly activeMembersAriaLabel: Signal<string> = computed(() => {
    const spokenValue = this.hasEligibleMembers() ? this.activeMembersLabel() : 'not available';
    return `Active Members (${this.windowLabel()}): ${spokenValue} — both active count and the denominator exclude Emeritus and non-voting LF Staff seats; the full roster count is shown separately elsewhere on the page`;
  });

  public onWindowChange(windowId: string): void {
    // filter-pills emits a plain string id — only forward values the endpoint actually accepts.
    const window = toCommitteeEngagementWindow(windowId);
    if (window) {
      this.windowChange.emit(window);
    }
  }
}
