// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, Signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { SelectComponent } from '@app/shared/components/select/select.component';
import { AnalyticsService } from '@app/shared/services/analytics.service';
import { ProjectContextService } from '@app/shared/services/project-context.service';
import { catchError, of } from 'rxjs';

import { MyMeetingsComponent } from '../components/my-meetings/my-meetings.component';
import { MyProjectsComponent } from '../components/my-projects/my-projects.component';
import { PendingActionsComponent } from '../components/pending-actions/pending-actions.component';
import { RecentProgressComponent } from '../components/recent-progress/recent-progress.component';

@Component({
  selector: 'lfx-maintainer-dashboard',
  standalone: true,
  imports: [RecentProgressComponent, PendingActionsComponent, MyMeetingsComponent, MyProjectsComponent, SelectComponent, ReactiveFormsModule],
  templateUrl: './maintainer-dashboard.component.html',
  styleUrl: './maintainer-dashboard.component.scss',
})
export class MaintainerDashboardComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectContextService = inject(ProjectContextService);

  public readonly form = new FormGroup({
    selectedProjectId: new FormControl<string>(this.projectContextService.getProjectId() || ''),
  });

  // Fetch projects from Snowflake
  private readonly projectsData = toSignal(
    this.analyticsService.getProjects().pipe(
      catchError((error) => {
        console.error('Failed to load projects:', error);
        return of({ projects: [] });
      })
    ),
    { initialValue: { projects: [] } }
  );

  // Available projects for dropdown
  public readonly availableProjects: Signal<Array<{ projectId: string; name: string; slug: string }>> = computed(() => this.projectsData().projects);

  public constructor() {
    this.form
      .get('selectedProjectId')
      ?.valueChanges.pipe(takeUntilDestroyed())
      .subscribe((value) => {
        const selectedProject = this.availableProjects().find((p) => p.projectId === value);
        if (selectedProject) {
          this.projectContextService.setProject(selectedProject);
        }
      });
  }
}
