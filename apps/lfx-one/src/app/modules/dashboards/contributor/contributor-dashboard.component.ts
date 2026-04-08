// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, signal } from '@angular/core';
import { CONTRIBUTOR_ACTION_ITEMS } from '@lfx-one/shared/constants';
import { HiddenActionsService } from '@services/hidden-actions.service';
import { LensService } from '@services/lens.service';
import { ProjectContextService } from '@services/project-context.service';
import { SkeletonModule } from 'primeng/skeleton';
import { BehaviorSubject } from 'rxjs';

import { MyMeetingsComponent } from '../components/my-meetings/my-meetings.component';
import { MyProjectsComponent } from '../components/my-projects/my-projects.component';
import { PendingActionsComponent } from '../components/pending-actions/pending-actions.component';
import { RecentProgressComponent } from '../components/recent-progress/recent-progress.component';

@Component({
  selector: 'lfx-contributor-dashboard',
  imports: [RecentProgressComponent, PendingActionsComponent, MyMeetingsComponent, MyProjectsComponent, SkeletonModule],
  templateUrl: './contributor-dashboard.component.html',
  styleUrl: './contributor-dashboard.component.scss',
})
export class ContributorDashboardComponent {
  private readonly projectContextService = inject(ProjectContextService);
  private readonly hiddenActionsService = inject(HiddenActionsService);
  private readonly lensService = inject(LensService);

  protected readonly showMeetings = computed(() => this.lensService.activeLens() !== 'org');
  protected readonly showProjects = computed(() => this.lensService.activeLens() === 'project');

  public readonly selectedFoundation = computed(() => this.projectContextService.selectedFoundation());
  public readonly refresh$: BehaviorSubject<void> = new BehaviorSubject<void>(undefined);
  private readonly rawContributorActions = signal(CONTRIBUTOR_ACTION_ITEMS);
  public readonly contributorActions = computed(() => {
    return this.rawContributorActions()
      .filter((item) => !this.hiddenActionsService.isActionHidden(item))
      .slice(0, 2);
  });

  public handleActionClick(): void {
    this.refresh$.next();
  }
}
