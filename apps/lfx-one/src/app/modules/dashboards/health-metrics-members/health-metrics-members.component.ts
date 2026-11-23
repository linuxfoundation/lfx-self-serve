// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {
  HEALTH_METRICS_MEMBERS_AT_RISK_FILTER_OPTIONS,
  HEALTH_METRICS_MEMBERS_BLANK,
  HEALTH_METRICS_MEMBERS_BOARD_COHORT_OPTIONS,
  HEALTH_METRICS_MEMBERS_DATA_SECTIONS,
  HEALTH_METRICS_MEMBERS_QUERY_PARAMS,
  HEALTH_METRICS_MEMBERS_RENEWALS_WINDOW_OPTIONS,
  HEALTH_METRICS_MEMBERS_SECTION_ID_PREFIX,
  HEALTH_METRICS_MEMBERS_SECTIONS,
} from '@lfx-one/shared/constants';
import {
  buildHealthMetricsMembersSubNavItems,
  parseHealthMetricsMembersAtRiskFilter,
  parseHealthMetricsMembersBoardCohort,
  parseHealthMetricsMembersNpsAudience,
  parseHealthMetricsMembersRenewalsWindow,
} from '@lfx-one/shared/utils';
import { UiSwitchOptionComponent } from '@shared/uikit/switch/switch-option.component';
import { UiSwitchComponent } from '@shared/uikit/switch/switch.component';

import { HealthMetricsL2SectionControlsDirective } from '../components/health-metrics-l2-shell/health-metrics-l2-section-controls.directive';
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

import type {
  HealthMetricsMembersAtRiskFilter,
  HealthMetricsMembersBoardCohort,
  HealthMetricsMembersNpsAudienceSwitch,
  HealthMetricsMembersRenewalsWindow,
  HealthMetricsMembersSubNavItem,
} from '@lfx-one/shared/interfaces';

/**
 * Members (Level 2) — eight anchored sections in the shared Level 2 shell; a section without a body
 * stays an "Awaiting data" placeholder until it lands. Rendered inside HealthMetricsGateComponent's outlet.
 */
@Component({
  selector: 'lfx-health-metrics-members',
  imports: [
    HealthMetricsL2SectionControlsDirective,
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
    UiSwitchComponent,
    UiSwitchOptionComponent,
  ],
  templateUrl: './health-metrics-members.component.html',
})
export class HealthMetricsMembersComponent {
  private readonly route = inject(ActivatedRoute);

  protected readonly sections = HEALTH_METRICS_MEMBERS_SECTIONS;
  protected readonly idPrefix = HEALTH_METRICS_MEMBERS_SECTION_ID_PREFIX;
  protected readonly dataSections = HEALTH_METRICS_MEMBERS_DATA_SECTIONS;
  protected readonly blank = HEALTH_METRICS_MEMBERS_BLANK;
  protected readonly riskFilters = HEALTH_METRICS_MEMBERS_AT_RISK_FILTER_OPTIONS;
  protected readonly renewalsWindows = HEALTH_METRICS_MEMBERS_RENEWALS_WINDOW_OPTIONS;
  protected readonly boardCohorts = HEALTH_METRICS_MEMBERS_BOARD_COHORT_OPTIONS;
  // The header switches live in the sections' controls, so the page owns each cut; the section keeps it in the URL.
  protected readonly riskBucket = signal<HealthMetricsMembersAtRiskFilter>(
    parseHealthMetricsMembersAtRiskFilter(this.route.snapshot.queryParamMap.get(HEALTH_METRICS_MEMBERS_QUERY_PARAMS.atRiskBucket))
  );
  protected readonly renewalsWindow = signal<HealthMetricsMembersRenewalsWindow>(
    parseHealthMetricsMembersRenewalsWindow(this.route.snapshot.queryParamMap.get(HEALTH_METRICS_MEMBERS_QUERY_PARAMS.renewalsWindow))
  );
  protected readonly boardCohort = signal<HealthMetricsMembersBoardCohort>(
    parseHealthMetricsMembersBoardCohort(this.route.snapshot.queryParamMap.get(HEALTH_METRICS_MEMBERS_QUERY_PARAMS.boardCohort))
  );
  /** The requested audience; `null` lets the read pick "All" or the first surveyed. The section reports what it shows. */
  protected readonly npsAudience = signal<string | null>(
    parseHealthMetricsMembersNpsAudience(this.route.snapshot.queryParamMap.get(HEALTH_METRICS_MEMBERS_QUERY_PARAMS.npsAudience))
  );
  protected readonly npsSwitch = signal<HealthMetricsMembersNpsAudienceSwitch>({ options: [], selected: null });
  protected readonly riskNote = signal<string>('');
  protected readonly boardNote = signal<string>('');
  protected readonly subNavItems = computed<HealthMetricsMembersSubNavItem[]>(() =>
    buildHealthMetricsMembersSubNavItems({ risk: this.riskNote(), board: this.boardNote() })
  );

  protected onRiskBucketChange(value: string | null): void {
    this.riskBucket.set(parseHealthMetricsMembersAtRiskFilter(value));
  }

  protected onRenewalsWindowChange(value: string | null): void {
    this.renewalsWindow.set(parseHealthMetricsMembersRenewalsWindow(value));
  }

  protected onBoardCohortChange(value: string | null): void {
    this.boardCohort.set(parseHealthMetricsMembersBoardCohort(value));
  }

  /** Shows the pick at once, so the switch does not snap back to the last read's audience while the new one loads. */
  protected onNpsAudienceChange(value: string | null): void {
    this.npsAudience.set(value);
    this.npsSwitch.update((current) => ({ ...current, selected: value }));
  }
}
