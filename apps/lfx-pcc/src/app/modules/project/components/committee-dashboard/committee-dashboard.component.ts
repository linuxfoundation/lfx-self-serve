// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject } from '@angular/core';
import { ProjectLayoutComponent } from '@app/layouts/project-layout/project-layout.component';
import { CardComponent } from '@app/shared/components/card/card.component';
import { MenuComponent } from '@app/shared/components/menu/menu.component';
import { ProjectService } from '@app/shared/services/project.service';
import { MenuItem } from 'primeng/api';

@Component({
  selector: 'lfx-committee-dashboard',
  imports: [ProjectLayoutComponent, CardComponent, MenuComponent],
  templateUrl: './committee-dashboard.component.html',
  styleUrl: './committee-dashboard.component.scss',
})
export class CommitteeDashboardComponent {
  private readonly projectService = inject(ProjectService);

  public project = this.projectService.project;

  protected readonly menuItems: MenuItem[] = [
    {
      label: 'Create Committee',
      icon: 'fa-light fa-users-medical text-sm',
    },
  ];
}
