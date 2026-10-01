// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, signal } from '@angular/core';
import {
  HEALTH_METRICS_NON_MEMBERS_DATA_SECTIONS,
  HEALTH_METRICS_NON_MEMBERS_SCOPE_NOTE,
  HEALTH_METRICS_NON_MEMBERS_SECTION_ID_PREFIX,
  HEALTH_METRICS_NON_MEMBERS_SECTIONS,
  HEALTH_METRICS_NON_MEMBERS_SUB_NAV_CROSS_REFERENCE,
} from '@lfx-one/shared/constants';
import { buildHealthMetricsNonMembersSubNavItems } from '@lfx-one/shared/utils';

import { HealthMetricsL2SectionDirective } from '../components/health-metrics-l2-shell/health-metrics-l2-section.directive';
import { HealthMetricsL2ShellComponent } from '../components/health-metrics-l2-shell/health-metrics-l2-shell.component';
import { NonMembersOrgsComponent } from './components/non-members-orgs/non-members-orgs.component';
import { NonMembersPeopleComponent } from './components/non-members-people/non-members-people.component';

import type { HealthMetricsNonMembersSubNavItem } from '@lfx-one/shared/interfaces';

/**
 * Non-Members (Level 2) — three anchored sections in the shared Level 2 shell; a section without a
 * body yet shows "Awaiting data". Rendered inside HealthMetricsGateComponent's outlet.
 */
@Component({
  selector: 'lfx-health-metrics-non-members',
  imports: [HealthMetricsL2SectionDirective, HealthMetricsL2ShellComponent, NonMembersOrgsComponent, NonMembersPeopleComponent],
  templateUrl: './health-metrics-non-members.component.html',
})
export class HealthMetricsNonMembersComponent {
  protected readonly sections = HEALTH_METRICS_NON_MEMBERS_SECTIONS;
  protected readonly idPrefix = HEALTH_METRICS_NON_MEMBERS_SECTION_ID_PREFIX;
  protected readonly dataSections = HEALTH_METRICS_NON_MEMBERS_DATA_SECTIONS;
  protected readonly crossReference = HEALTH_METRICS_NON_MEMBERS_SUB_NAV_CROSS_REFERENCE;
  protected readonly scopeNote = HEALTH_METRICS_NON_MEMBERS_SCOPE_NOTE;
  protected readonly orgsCount = signal<number | null>(null);
  protected readonly peopleCount = signal<number | null>(null);
  protected readonly subNavItems = computed<HealthMetricsNonMembersSubNavItem[]>(() =>
    buildHealthMetricsNonMembersSubNavItems({ orgs: this.orgsCount(), people: this.peopleCount() })
  );
}
