// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';
import { DashboardQuicklinksComponent } from '../dashboard-quicklinks/dashboard-quicklinks.component';
import { ProjectStaffCardComponent } from '../project-staff-card/project-staff-card.component';

@Component({
  selector: 'lfx-dashboard-sidebar',
  host: { class: 'block w-full shrink-0 xl:w-44' },
  imports: [DashboardQuicklinksComponent, ProjectStaffCardComponent],
  templateUrl: './dashboard-sidebar.component.html',
})
export class DashboardSidebarComponent {
  public readonly projectUid = input.required<string>();
  public readonly staffHeading = input.required<string>();
}
