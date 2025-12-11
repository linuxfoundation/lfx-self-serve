// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, signal } from '@angular/core';
import { HiddenActionsService } from '@services/hidden-actions.service';
import { ProjectContextService } from '@services/project-context.service';
import { BehaviorSubject } from 'rxjs';

import { MyMeetingsComponent } from '../components/my-meetings/my-meetings.component';
import { MyProjectsComponent } from '../components/my-projects/my-projects.component';
import { PendingActionsComponent } from '../components/pending-actions/pending-actions.component';
import { RecentProgressComponent } from '../components/recent-progress/recent-progress.component';

@Component({
  selector: 'lfx-maintainer-dashboard',
  imports: [RecentProgressComponent, PendingActionsComponent, MyMeetingsComponent, MyProjectsComponent],
  templateUrl: './maintainer-dashboard.component.html',
  styleUrl: './maintainer-dashboard.component.scss',
})
export class MaintainerDashboardComponent {
  private readonly projectContextService = inject(ProjectContextService);
  private readonly hiddenActionsService = inject(HiddenActionsService);

  public readonly selectedProject = computed(() => this.projectContextService.selectedFoundation() || this.projectContextService.selectedProject());
  public readonly refresh$: BehaviorSubject<void> = new BehaviorSubject<void>(undefined);
  private readonly rawMaintainerActions = signal([]);
  public readonly maintainerActions = computed(() => {
    return this.rawMaintainerActions().filter((item) => !this.hiddenActionsService.isActionHidden(item));
  });

  public handleActionClick(): void {
    this.refresh$.next();
  }
}
