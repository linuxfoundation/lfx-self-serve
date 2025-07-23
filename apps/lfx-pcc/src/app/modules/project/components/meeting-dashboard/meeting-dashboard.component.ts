// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject } from '@angular/core';
import { CardComponent } from '@app/shared/components/card/card.component';
import { MenuComponent } from '@app/shared/components/menu/menu.component';
import { ProjectService } from '@app/shared/services/project.service';
import { MenuItem } from 'primeng/api';

@Component({
  selector: 'lfx-meeting-dashboard',
  imports: [CardComponent, MenuComponent],
  templateUrl: './meeting-dashboard.component.html',
  styleUrl: './meeting-dashboard.component.scss',
})
export class MeetingDashboardComponent {
  private readonly projectService = inject(ProjectService);

  public project = this.projectService.project;

  protected readonly menuItems: MenuItem[] = [
    {
      label: 'Schedule Meeting',
      icon: 'fa-light fa-calendar-plus text-sm',
    },
    {
      label: 'Meeting History',
      icon: 'fa-light fa-calendar-days text-sm',
    },
    {
      label: 'Public Calendar',
      icon: 'fa-light fa-calendar-check text-sm',
    },
  ];
}
