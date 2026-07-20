// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, Signal } from '@angular/core';
import { StatCardGridComponent } from '@components/stat-card-grid/stat-card-grid.component';
import { DEMO_ORG_MEETINGS_KPI_SUMMARY } from '@lfx-one/shared/constants';
import type { OrgMeetingsTimeRange, StatCardItem } from '@lfx-one/shared/interfaces';

// Per-card semantic icon-tile colors, matching the /events and /org/overview stat-strip convention
// (varied tints rather than a single uniform blue).
const EMPLOYEES_ICON_CLASS = 'bg-blue-100 text-blue-600';
const MEETINGS_ICON_CLASS = 'bg-emerald-100 text-emerald-600';
const PROJECTS_ICON_CLASS = 'bg-violet-100 text-violet-600';
const FOUNDATIONS_ICON_CLASS = 'bg-amber-100 text-amber-600';

@Component({
  selector: 'lfx-org-meetings-kpi-cards',
  imports: [StatCardGridComponent],
  templateUrl: './org-meetings-kpi-cards.component.html',
})
export class OrgMeetingsKpiCardsComponent {
  // Public fields from inputs
  public readonly timeRange = input.required<OrgMeetingsTimeRange>();

  // Complex computed
  protected readonly cards: Signal<StatCardItem[]> = this.initCards();

  // Private initializers
  private initCards(): Signal<StatCardItem[]> {
    return computed(() => {
      const summary = DEMO_ORG_MEETINGS_KPI_SUMMARY;
      return [
        {
          label: 'Employees Active',
          value: summary.employeesActive,
          icon: 'fa-light fa-users',
          iconContainerClass: EMPLOYEES_ICON_CLASS,
          delta: { label: summary.employeesActiveDeltaLabel, direction: summary.employeesActiveDeltaDirection },
        },
        {
          label: 'Meetings Attended',
          value: summary.meetingsAttended,
          icon: 'fa-light fa-video',
          iconContainerClass: MEETINGS_ICON_CLASS,
          delta: { label: summary.meetingsAttendedDeltaLabel, direction: summary.meetingsAttendedDeltaDirection },
        },
        {
          label: 'Projects Supported',
          value: summary.projectsSupported,
          icon: 'fa-light fa-diagram-project',
          iconContainerClass: PROJECTS_ICON_CLASS,
          delta: { label: summary.projectsSupportedDeltaLabel, direction: summary.projectsSupportedDeltaDirection },
        },
        {
          label: 'Foundations Supported',
          value: summary.foundationsSupported,
          icon: 'fa-light fa-building-columns',
          iconContainerClass: FOUNDATIONS_ICON_CLASS,
          delta: { label: summary.foundationsSupportedDeltaLabel, direction: summary.foundationsSupportedDeltaDirection },
        },
      ];
    });
  }
}
