// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, signal } from '@angular/core';
import {
  getYearForRange,
  HEALTH_METRICS_MEMBERS_BLANK,
  HEALTH_METRICS_MEMBERS_DATA_SECTIONS,
  HEALTH_METRICS_MEMBERS_SECTION_ID_PREFIX,
} from '@lfx-one/shared/constants';
import { buildHealthMetricsMembersSections, buildHealthMetricsMembersSubNavItems } from '@lfx-one/shared/utils';

import { HealthMetricsL2SectionDirective } from '../components/health-metrics-l2-shell/health-metrics-l2-section.directive';
import { HealthMetricsL2ShellComponent } from '../components/health-metrics-l2-shell/health-metrics-l2-shell.component';
import { MembersAtRiskComponent } from './components/members-at-risk/members-at-risk.component';
import { MembersBoardAttendanceComponent } from './components/members-board-attendance/members-board-attendance.component';
import { MembersBreakdownComponent } from './components/members-breakdown/members-breakdown.component';
import { MembersChurnComponent } from './components/members-churn/members-churn.component';
import { MembersDirectoryComponent } from './components/members-directory/members-directory.component';
import { MembersGrowthComponent } from './components/members-growth/members-growth.component';
import { MembersNpsComponent } from './components/members-nps/members-nps.component';
import { MembersRenewalsComponent } from './components/members-renewals/members-renewals.component';

import type { HealthMetricsMembersSubNavItem } from '@lfx-one/shared/interfaces';

/**
 * Members (Level 2) — eight anchored sections in the shared Level 2 shell; a section without a body
 * stays an "Awaiting data" placeholder until it lands. Rendered inside HealthMetricsGateComponent's outlet.
 */
@Component({
  selector: 'lfx-health-metrics-members',
  imports: [
    HealthMetricsL2SectionDirective,
    HealthMetricsL2ShellComponent,
    MembersAtRiskComponent,
    MembersBoardAttendanceComponent,
    MembersBreakdownComponent,
    MembersChurnComponent,
    MembersDirectoryComponent,
    MembersGrowthComponent,
    MembersNpsComponent,
    MembersRenewalsComponent,
  ],
  templateUrl: './health-metrics-members.component.html',
})
export class HealthMetricsMembersComponent {
  protected readonly sections = buildHealthMetricsMembersSections(getYearForRange('YTD'));
  protected readonly idPrefix = HEALTH_METRICS_MEMBERS_SECTION_ID_PREFIX;
  protected readonly dataSections = HEALTH_METRICS_MEMBERS_DATA_SECTIONS;
  protected readonly blank = HEALTH_METRICS_MEMBERS_BLANK;
  protected readonly breakdownCount = signal<number | null>(null);
  protected readonly listCount = signal<number | null>(null);
  protected readonly riskNote = signal<string>('');
  protected readonly renewalsCount = signal<number | null>(null);
  protected readonly boardNote = signal<string>('');
  protected readonly subNavItems = computed<HealthMetricsMembersSubNavItem[]>(() =>
    buildHealthMetricsMembersSubNavItems(
      { breakdown: this.breakdownCount(), list: this.listCount(), renewals: this.renewalsCount() },
      { risk: this.riskNote(), board: this.boardNote() }
    )
  );
}
