// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component } from '@angular/core';
import {
  HEALTH_METRICS_NON_MEMBERS_DATA_SECTIONS,
  HEALTH_METRICS_NON_MEMBERS_SCOPE_NOTE,
  HEALTH_METRICS_NON_MEMBERS_SECTION_ID_PREFIX,
  HEALTH_METRICS_NON_MEMBERS_SECTIONS,
  HEALTH_METRICS_NON_MEMBERS_SUB_NAV_CROSS_REFERENCE,
} from '@lfx-one/shared/constants';
import { buildHealthMetricsNonMembersSubNavItems } from '@lfx-one/shared/utils';

import { HealthMetricsL2ShellComponent } from '../components/health-metrics-l2-shell/health-metrics-l2-shell.component';

import type { HealthMetricsNonMembersSubNavItem } from '@lfx-one/shared/interfaces';

/**
 * Non-Members (Level 2) — three anchored sections in the shared Level 2 shell, each an "Awaiting data"
 * placeholder until its section lands. Rendered inside HealthMetricsGateComponent's outlet.
 */
@Component({
  selector: 'lfx-health-metrics-non-members',
  imports: [HealthMetricsL2ShellComponent],
  templateUrl: './health-metrics-non-members.component.html',
})
export class HealthMetricsNonMembersComponent {
  protected readonly sections = HEALTH_METRICS_NON_MEMBERS_SECTIONS;
  protected readonly idPrefix = HEALTH_METRICS_NON_MEMBERS_SECTION_ID_PREFIX;
  protected readonly dataSections = HEALTH_METRICS_NON_MEMBERS_DATA_SECTIONS;
  protected readonly crossReference = HEALTH_METRICS_NON_MEMBERS_SUB_NAV_CROSS_REFERENCE;
  protected readonly scopeNote = HEALTH_METRICS_NON_MEMBERS_SCOPE_NOTE;
  protected readonly subNavItems: HealthMetricsNonMembersSubNavItem[] = buildHealthMetricsNonMembersSubNavItems();
}
