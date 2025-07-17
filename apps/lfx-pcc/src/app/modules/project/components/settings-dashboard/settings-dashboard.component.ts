import { Component, inject } from '@angular/core';
import { ProjectLayoutComponent } from '@app/layouts/project-layout/project-layout.component';
import { CardComponent } from '@app/shared/components/card/card.component';
import { MenuComponent } from '@app/shared/components/menu/menu.component';
import { ProjectService } from '@app/shared/services/project.service';
import { MenuItem } from 'primeng/api';

@Component({
  selector: 'lfx-settings-dashboard',
  imports: [ProjectLayoutComponent, CardComponent, MenuComponent],
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
