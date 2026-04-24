// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DashboardQuickLink } from '@lfx-one/shared/interfaces';
import { ProjectContextService } from '@services/project-context.service';

@Component({
  selector: 'lfx-dashboard-quicklinks',
  imports: [RouterLink],
  templateUrl: './dashboard-quicklinks.component.html',
})
export class DashboardQuicklinksComponent {
  private readonly projectContextService = inject(ProjectContextService);

  protected readonly links: DashboardQuickLink[] = [
    { label: 'Create meeting', icon: 'fa-light fa-calendar', route: ['/meetings', 'create'], testId: 'create-meeting' },
    { label: 'Create group', icon: 'fa-light fa-users', route: ['/groups', 'create'], testId: 'create-group' },
    { label: 'Create mailing list', icon: 'fa-light fa-envelope', route: ['/mailing-lists', 'create'], testId: 'create-mailing-list' },
  ];

  protected readonly canWrite = this.projectContextService.canWrite;
}
