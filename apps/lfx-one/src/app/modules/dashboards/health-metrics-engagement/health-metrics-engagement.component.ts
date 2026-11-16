// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {
  HEALTH_METRICS_ENGAGEMENT_BLANK,
  HEALTH_METRICS_ENGAGEMENT_DATA_SECTIONS,
  HEALTH_METRICS_ENGAGEMENT_ORG_FILTERS,
  HEALTH_METRICS_ENGAGEMENT_QUERY_PARAMS,
  HEALTH_METRICS_ENGAGEMENT_REP_FILTERS,
  HEALTH_METRICS_ENGAGEMENT_SECTIONS,
  HEALTH_METRICS_ENGAGEMENT_SECTION_ID_PREFIX,
} from '@lfx-one/shared/constants';
import { buildHealthMetricsEngagementSubNavItems, parseHealthMetricsEngagementOrgFilter, parseHealthMetricsEngagementRepFilter } from '@lfx-one/shared/utils';
import { UiSwitchOptionComponent } from '@shared/uikit/switch/switch-option.component';
import { UiSwitchComponent } from '@shared/uikit/switch/switch.component';

import { HealthMetricsL2SectionControlsDirective } from '../components/health-metrics-l2-shell/health-metrics-l2-section-controls.directive';
import { HealthMetricsL2SectionDirective } from '../components/health-metrics-l2-shell/health-metrics-l2-section.directive';
import { HealthMetricsL2ShellComponent } from '../components/health-metrics-l2-shell/health-metrics-l2-shell.component';
import { EngagementAttendanceTrendComponent } from './components/engagement-attendance-trend/engagement-attendance-trend.component';
import { EngagementGroupAttendanceComponent } from './components/engagement-group-attendance/engagement-group-attendance.component';
import { EngagementMeetingParticipationComponent } from './components/engagement-meeting-participation/engagement-meeting-participation.component';
import { EngagementNewsletterPerformanceComponent } from './components/engagement-newsletter-performance/engagement-newsletter-performance.component';
import { EngagementNewsletterRecipientsComponent } from './components/engagement-newsletter-recipients/engagement-newsletter-recipients.component';
import { EngagementNonMemberParticipationComponent } from './components/engagement-non-member-participation/engagement-non-member-participation.component';
import { EngagementOrgParticipationComponent } from './components/engagement-org-participation/engagement-org-participation.component';
import { EngagementRepresentativesComponent } from './components/engagement-representatives/engagement-representatives.component';

import type {
  HealthMetricsEngagementGroupNoteCounts,
  HealthMetricsEngagementOrgFilter,
  HealthMetricsEngagementOrgNoteCounts,
  HealthMetricsEngagementRepFilter,
  HealthMetricsEngagementRepNoteCounts,
  HealthMetricsEngagementSubNavItem,
} from '@lfx-one/shared/interfaces';

/**
 * Engagement (Level 2) — anchored sections in the shared Level 2 shell, which owns the sub-nav,
 * scroll-spy and deep links. Rendered inside HealthMetricsGateComponent's outlet, so it only ever
 * mounts with `health-metrics-overview-enabled` on.
 */
@Component({
  selector: 'lfx-health-metrics-engagement',
  imports: [
    EngagementAttendanceTrendComponent,
    EngagementGroupAttendanceComponent,
    EngagementMeetingParticipationComponent,
    EngagementNewsletterPerformanceComponent,
    EngagementNewsletterRecipientsComponent,
    EngagementNonMemberParticipationComponent,
    EngagementOrgParticipationComponent,
    EngagementRepresentativesComponent,
    HealthMetricsL2SectionControlsDirective,
    HealthMetricsL2SectionDirective,
    HealthMetricsL2ShellComponent,
    UiSwitchComponent,
    UiSwitchOptionComponent,
  ],
  templateUrl: './health-metrics-engagement.component.html',
})
export class HealthMetricsEngagementComponent {
  private readonly route = inject(ActivatedRoute);

  protected readonly sections = HEALTH_METRICS_ENGAGEMENT_SECTIONS;
  protected readonly idPrefix = HEALTH_METRICS_ENGAGEMENT_SECTION_ID_PREFIX;
  protected readonly dataSections = HEALTH_METRICS_ENGAGEMENT_DATA_SECTIONS;
  protected readonly blank = HEALTH_METRICS_ENGAGEMENT_BLANK;
  protected readonly orgFilters = HEALTH_METRICS_ENGAGEMENT_ORG_FILTERS;
  protected readonly repFilters = HEALTH_METRICS_ENGAGEMENT_REP_FILTERS;

  // The header switches live in the sections' controls, so the page owns each cut; the section keeps it in the URL.
  protected readonly orgFilter = signal<HealthMetricsEngagementOrgFilter>(
    parseHealthMetricsEngagementOrgFilter(this.route.snapshot.queryParamMap.get(HEALTH_METRICS_ENGAGEMENT_QUERY_PARAMS.orgFilter))
  );
  protected readonly repFilter = signal<HealthMetricsEngagementRepFilter>(
    parseHealthMetricsEngagementRepFilter(this.route.snapshot.queryParamMap.get(HEALTH_METRICS_ENGAGEMENT_QUERY_PARAMS.repFilter))
  );

  // `null` until that section reports, which renders no note rather than a premature one.
  protected readonly groupCounts = signal<HealthMetricsEngagementGroupNoteCounts | null>(null);
  protected readonly orgCounts = signal<HealthMetricsEngagementOrgNoteCounts | null>(null);
  protected readonly repCounts = signal<HealthMetricsEngagementRepNoteCounts | null>(null);

  protected readonly subNavItems = computed<HealthMetricsEngagementSubNavItem[]>(() =>
    buildHealthMetricsEngagementSubNavItems({
      dormantGroups: this.groupCounts()?.dormantGroups ?? 0,
      lowAttendanceGroups: this.groupCounts()?.lowAttendanceGroups ?? 0,
      lapsedOrgs: this.orgCounts()?.lapsedOrgs ?? 0,
      neverAttendedReps: this.repCounts()?.neverAttendedReps ?? 0,
    })
  );

  protected onOrgFilterChange(value: string | null): void {
    this.orgFilter.set(parseHealthMetricsEngagementOrgFilter(value));
  }

  protected onRepFilterChange(value: string | null): void {
    this.repFilter.set(parseHealthMetricsEngagementRepFilter(value));
  }
}
