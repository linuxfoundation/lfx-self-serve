// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, Signal } from '@angular/core';
import { StatCardGridComponent } from '@components/stat-card-grid/stat-card-grid.component';
import { DEMO_ORG_MEETINGS_KPI_SUMMARY, ORG_MEETINGS_KPI_ICON_CLASS } from '@lfx-one/shared/constants';
import type { OrgMeetingsTimeRange, StatCardItem } from '@lfx-one/shared/interfaces';

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
          iconContainerClass: ORG_MEETINGS_KPI_ICON_CLASS.employeesActive,
          delta: { label: summary.employeesActiveDeltaLabel, direction: summary.employeesActiveDeltaDirection },
        },
        {
          label: 'Meetings Attended',
          value: summary.meetingsAttended,
          icon: 'fa-light fa-video',
          iconContainerClass: ORG_MEETINGS_KPI_ICON_CLASS.meetingsAttended,
          delta: { label: summary.meetingsAttendedDeltaLabel, direction: summary.meetingsAttendedDeltaDirection },
        },
        {
          label: 'Projects Supported',
          value: summary.projectsSupported,
          icon: 'fa-light fa-diagram-project',
          iconContainerClass: ORG_MEETINGS_KPI_ICON_CLASS.projectsSupported,
          delta: { label: summary.projectsSupportedDeltaLabel, direction: summary.projectsSupportedDeltaDirection },
        },
        {
          label: 'Foundations Supported',
          value: summary.foundationsSupported,
          icon: 'fa-light fa-building-columns',
          iconContainerClass: ORG_MEETINGS_KPI_ICON_CLASS.foundationsSupported,
          delta: { label: summary.foundationsSupportedDeltaLabel, direction: summary.foundationsSupportedDeltaDirection },
        },
      ];
    });
  }
}
