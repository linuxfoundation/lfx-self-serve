// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, signal } from '@angular/core';
import {
  HEALTH_METRICS_MEMBERS_DATA_SECTIONS,
  HEALTH_METRICS_MEMBERS_SCOPE_NOTE,
  HEALTH_METRICS_MEMBERS_SECTION_ID_PREFIX,
  HEALTH_METRICS_MEMBERS_SECTIONS,
  HEALTH_METRICS_MEMBERS_SUB_NAV_CROSS_REFERENCE,
} from '@lfx-one/shared/constants';
import { buildHealthMetricsMembersSubNavItems } from '@lfx-one/shared/utils';

import { HealthMetricsL2SectionDirective } from '../components/health-metrics-l2-shell/health-metrics-l2-section.directive';
import { HealthMetricsL2ShellComponent } from '../components/health-metrics-l2-shell/health-metrics-l2-shell.component';
import { MembersAtRiskComponent } from './components/members-at-risk/members-at-risk.component';
import { MembersBridgeComponent } from './components/members-bridge/members-bridge.component';
import { MembersDirectoryComponent } from './components/members-directory/members-directory.component';
import { MembersTiersComponent } from './components/members-tiers/members-tiers.component';

import type { HealthMetricsMembersSubNavItem } from '@lfx-one/shared/interfaces';

/**
 * Members (Level 2) — seven anchored sections in the shared Level 2 shell; a section without a body
 * stays an "Awaiting data" placeholder until it lands. Rendered inside HealthMetricsGateComponent's outlet.
 */
@Component({
  selector: 'lfx-health-metrics-members',
  imports: [
    HealthMetricsL2SectionDirective,
    HealthMetricsL2ShellComponent,
    MembersAtRiskComponent,
    MembersBridgeComponent,
    MembersDirectoryComponent,
    MembersTiersComponent,
  ],
  templateUrl: './health-metrics-members.component.html',
})
export class HealthMetricsMembersComponent {
  protected readonly sections = HEALTH_METRICS_MEMBERS_SECTIONS;
  protected readonly idPrefix = HEALTH_METRICS_MEMBERS_SECTION_ID_PREFIX;
  protected readonly dataSections = HEALTH_METRICS_MEMBERS_DATA_SECTIONS;
  protected readonly crossReference = HEALTH_METRICS_MEMBERS_SUB_NAV_CROSS_REFERENCE;
  protected readonly scopeNote = HEALTH_METRICS_MEMBERS_SCOPE_NOTE;
  protected readonly listCount = signal<number | null>(null);
  protected readonly riskNote = signal<string>('');
  protected readonly subNavItems = computed<HealthMetricsMembersSubNavItem[]>(() =>
    buildHealthMetricsMembersSubNavItems({ list: this.listCount() }, { risk: this.riskNote() })
  );
}
