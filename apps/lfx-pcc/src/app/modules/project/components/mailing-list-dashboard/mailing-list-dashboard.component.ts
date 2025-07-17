import { Component, inject } from '@angular/core';
import { ProjectLayoutComponent } from '@app/layouts/project-layout/project-layout.component';
import { CardComponent } from '@app/shared/components/card/card.component';
import { MenuComponent } from '@app/shared/components/menu/menu.component';
import { ProjectService } from '@app/shared/services/project.service';
import { MenuItem } from 'primeng/api';

@Component({
  selector: 'lfx-mailing-list-dashboard',
  imports: [ProjectLayoutComponent, CardComponent, MenuComponent],
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
