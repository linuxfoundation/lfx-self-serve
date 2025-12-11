// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, signal } from '@angular/core';
import { CORE_DEVELOPER_ACTION_ITEMS } from '@lfx-one/shared/constants';
import { HiddenActionsService } from '@services/hidden-actions.service';
import { ProjectContextService } from '@services/project-context.service';
import { BehaviorSubject } from 'rxjs';

import { MyMeetingsComponent } from '../components/my-meetings/my-meetings.component';
import { MyProjectsComponent } from '../components/my-projects/my-projects.component';
import { PendingActionsComponent } from '../components/pending-actions/pending-actions.component';
import { RecentProgressComponent } from '../components/recent-progress/recent-progress.component';

@Component({
  selector: 'lfx-core-developer-dashboard',
  imports: [RecentProgressComponent, PendingActionsComponent, MyMeetingsComponent, MyProjectsComponent],
  templateUrl: './core-developer-dashboard.component.html',
  styleUrl: './core-developer-dashboard.component.scss',
})
export class CoreDeveloperDashboardComponent {
  private readonly projectContextService = inject(ProjectContextService);
  private readonly hiddenActionsService = inject(HiddenActionsService);

  public readonly selectedFoundation = computed(() => this.projectContextService.selectedFoundation());
  public readonly refresh$: BehaviorSubject<void> = new BehaviorSubject<void>(undefined);
  private readonly rawCoreDevActions = signal(CORE_DEVELOPER_ACTION_ITEMS);
  public readonly coreDevActions = computed(() => {
    return this.rawCoreDevActions().filter((item) => !this.hiddenActionsService.isActionHidden(item));
  });

  public handleActionClick(): void {
    this.refresh$.next();
  }
}
