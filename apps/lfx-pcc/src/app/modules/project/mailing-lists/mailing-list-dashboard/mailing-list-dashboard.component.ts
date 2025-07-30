// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject } from '@angular/core';
import { CardComponent } from '@components/card/card.component';
import { MenuComponent } from '@components/menu/menu.component';
import { ProjectService } from '@services/project.service';
import { MenuItem } from 'primeng/api';

@Component({
  selector: 'lfx-mailing-list-dashboard',
  imports: [CardComponent, MenuComponent],
  templateUrl: './mailing-list-dashboard.component.html',
  styleUrl: './mailing-list-dashboard.component.scss',
})
export class MailingListDashboardComponent {
  private readonly projectService = inject(ProjectService);

  public project = this.projectService.project;

  protected readonly menuItems: MenuItem[] = [
    {
      label: 'Create Mailing List',
      icon: 'fa-light fa-envelope-circle-check text-sm',
    },
  ];
}
