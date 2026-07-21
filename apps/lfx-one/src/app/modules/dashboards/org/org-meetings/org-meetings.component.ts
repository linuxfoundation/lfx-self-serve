// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, Signal, signal } from '@angular/core';
import type { OrgMeetingsTimeRange } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';

import { EmptyStateComponent } from '@components/empty-state/empty-state.component';

import { OrgMeetingsInfluenceComponent } from './components/org-meetings-influence/org-meetings-influence.component';
import { OrgMeetingsKpiCardsComponent } from './components/org-meetings-kpi-cards/org-meetings-kpi-cards.component';
import { OrgMeetingsSpendBreakdownComponent } from './components/org-meetings-spend-breakdown/org-meetings-spend-breakdown.component';
import { OrgMeetingsTimeRangeComponent } from './components/org-meetings-time-range/org-meetings-time-range.component';
import { OrgMeetingsTrendsComponent } from './components/org-meetings-trends/org-meetings-trends.component';

// Employee leaderboard component intentionally not imported/rendered here — deferred to a
// future PR (LFXV2-2735 follow-up). Its files remain in ./components/org-meetings-leaderboard.

// This page was previously retired to a "coming soon" placeholder (LFXV2-1902 / ADR-0038) after the
// legacy implementation served per-invitee PII from the analytics lane without an operational-plane
// check. This redesign (LFXV2-2735) is demo-data only — no real Snowflake/analytics-lane query is
// wired up, so that concern does not apply to this pass; real data wiring is a separate future task.
@Component({
  selector: 'lfx-org-meetings',
  imports: [
    OrgMeetingsTimeRangeComponent,
    OrgMeetingsKpiCardsComponent,
    OrgMeetingsSpendBreakdownComponent,
    OrgMeetingsTrendsComponent,
    OrgMeetingsInfluenceComponent,
    EmptyStateComponent,
  ],
  templateUrl: './org-meetings.component.html',
})
export class OrgMeetingsComponent {
  private readonly accountContext = inject(AccountContextService);

  // Simple WritableSignals
  protected readonly timeRange = signal<OrgMeetingsTimeRange>('past365d');

  // Complex computed
  // `accountId` (not `uid`) is the canonical presence check: it's always populated as soon as a
  // real account is selected, while `uid` can still be pending Snowflake enrichment on a fresh
  // persona seed — checking `uid` would leave a validly-selected company on the empty state.
  protected readonly hasCompany: Signal<boolean> = computed(() => !!this.accountContext.selectedAccount().accountId);
}
