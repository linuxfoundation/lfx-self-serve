// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject } from '@angular/core';
import { ProjectContextService } from '@services/project-context.service';
import { SkeletonModule } from 'primeng/skeleton';

import { DashboardQuicklinksComponent } from '../components/dashboard-quicklinks/dashboard-quicklinks.component';
import { MyMeetingsComponent } from '../components/my-meetings/my-meetings.component';
import { MyProjectsComponent } from '../components/my-projects/my-projects.component';
import { RecentProgressComponent } from '../components/recent-progress/recent-progress.component';

@Component({
  selector: 'lfx-project-dashboard',
  imports: [RecentProgressComponent, MyMeetingsComponent, MyProjectsComponent, SkeletonModule, DashboardQuicklinksComponent],
  templateUrl: './project-dashboard.component.html',
  styleUrl: './project-dashboard.component.scss',
})
export class ProjectDashboardComponent {
  private readonly projectContextService = inject(ProjectContextService);

  public readonly selectedProject = computed(() => this.projectContextService.activeContext());
}
