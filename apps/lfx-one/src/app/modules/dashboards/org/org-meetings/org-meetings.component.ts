// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, signal } from '@angular/core';
import type { OrgMeetingsTimeRange } from '@lfx-one/shared/interfaces';

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
  ],
  templateUrl: './org-meetings.component.html',
})
export class OrgMeetingsComponent {
  // Simple WritableSignals
  protected readonly timeRange = signal<OrgMeetingsTimeRange>('past365d');
}
