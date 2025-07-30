// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject } from '@angular/core';
import { CardComponent } from '@components/card/card.component';
import { MenuComponent } from '@components/menu/menu.component';
import { ProjectService } from '@services/project.service';
import { MenuItem } from 'primeng/api';

import { UserPermissionsTableComponent } from '../components/user-permissions-table/user-permissions-table.component';

@Component({
  selector: 'lfx-settings-dashboard',
  imports: [CardComponent, UserPermissionsTableComponent, MenuComponent],
  templateUrl: './settings-dashboard.component.html',
  styleUrl: './settings-dashboard.component.scss',
})
export class SettingsDashboardComponent {
  private readonly projectService = inject(ProjectService);

  public project = this.projectService.project;

  protected readonly menuItems: MenuItem[] = [
    {
      label: 'Add User',
      icon: 'fa-light fa-user-plus text-sm',
    },
  ];
}
