// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, signal } from '@angular/core';
import {
  HEALTH_METRICS_ENGAGEMENT_DATA_SECTIONS,
  HEALTH_METRICS_ENGAGEMENT_SECTION_ID_PREFIX,
  HEALTH_METRICS_ENGAGEMENT_SECTIONS,
  HEALTH_METRICS_ENGAGEMENT_SUB_NAV_CROSS_REFERENCE_NOTE,
} from '@lfx-one/shared/constants';
import { buildHealthMetricsEngagementSubNavItems } from '@lfx-one/shared/utils';

import { HealthMetricsL2SectionDirective } from '../components/health-metrics-l2-shell/health-metrics-l2-section.directive';
import { HealthMetricsL2ShellComponent } from '../components/health-metrics-l2-shell/health-metrics-l2-shell.component';
import { EngagementGroupAttendanceComponent } from './components/engagement-group-attendance/engagement-group-attendance.component';
import { EngagementMeetingParticipationComponent } from './components/engagement-meeting-participation/engagement-meeting-participation.component';
import { EngagementNonMemberParticipationComponent } from './components/engagement-non-member-participation/engagement-non-member-participation.component';
import { EngagementOrgParticipationComponent } from './components/engagement-org-participation/engagement-org-participation.component';
import { EngagementRepresentativesComponent } from './components/engagement-representatives/engagement-representatives.component';

import type {
  HealthMetricsEngagementGroupCounts,
  HealthMetricsEngagementNonMemberCounts,
  HealthMetricsEngagementOrgCounts,
  HealthMetricsEngagementRepPeriodCounts,
  HealthMetricsEngagementSubNavItem,
} from '@lfx-one/shared/interfaces';

/**
 * Engagement (Level 2) — six anchored sections in the shared Level 2 shell, which owns the sub-nav,
 * scroll-spy and deep links. Rendered inside HealthMetricsGateComponent's outlet, so it only ever
 * mounts with `health-metrics-overview-enabled` on.
 */
@Component({
  selector: 'lfx-health-metrics-engagement',
  imports: [
    EngagementGroupAttendanceComponent,
    EngagementMeetingParticipationComponent,
    EngagementNonMemberParticipationComponent,
    EngagementOrgParticipationComponent,
    EngagementRepresentativesComponent,
    HealthMetricsL2SectionDirective,
    HealthMetricsL2ShellComponent,
  ],
  templateUrl: './health-metrics-engagement.component.html',
})
export class HealthMetricsEngagementComponent {
  protected readonly sections = HEALTH_METRICS_ENGAGEMENT_SECTIONS;
  protected readonly idPrefix = HEALTH_METRICS_ENGAGEMENT_SECTION_ID_PREFIX;
  protected readonly dataSections = HEALTH_METRICS_ENGAGEMENT_DATA_SECTIONS;
  protected readonly crossReferenceNote = HEALTH_METRICS_ENGAGEMENT_SUB_NAV_CROSS_REFERENCE_NOTE;

  // `null` until that section reports, which renders no badge rather than a misleading zero.
  protected readonly groupCounts = signal<HealthMetricsEngagementGroupCounts | null>(null);
  protected readonly orgCounts = signal<HealthMetricsEngagementOrgCounts | null>(null);
  protected readonly repCounts = signal<HealthMetricsEngagementRepPeriodCounts | null>(null);
  protected readonly nonMemberCounts = signal<HealthMetricsEngagementNonMemberCounts | null>(null);

  protected readonly subNavItems = computed<HealthMetricsEngagementSubNavItem[]>(() =>
    buildHealthMetricsEngagementSubNavItems({
      groups: this.groupCounts()?.groups ?? null,
      dormantGroups: this.groupCounts()?.dormantGroups ?? 0,
      orgs: this.orgCounts()?.orgs ?? null,
      lapsedOrgs: this.orgCounts()?.lapsedOrgs ?? 0,
      reps: this.repCounts()?.reps ?? null,
      neverAttendedReps: this.repCounts()?.neverAttendedReps ?? 0,
      nonMemberOrgs: this.nonMemberCounts()?.orgs ?? null,
    })
  );
}
