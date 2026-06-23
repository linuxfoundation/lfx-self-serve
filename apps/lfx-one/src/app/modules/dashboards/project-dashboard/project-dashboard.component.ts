// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { PendingActionItem } from '@lfx-one/shared/interfaces';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { SkeletonModule } from 'primeng/skeleton';
import { BehaviorSubject, catchError, combineLatest, of, switchMap } from 'rxjs';

import { DashboardCastDrawerHostComponent } from '../components/dashboard-cast-drawer-host/dashboard-cast-drawer-host.component';
import { DashboardSidebarComponent } from '../components/dashboard-sidebar/dashboard-sidebar.component';
import { MyMeetingsComponent } from '../components/my-meetings/my-meetings.component';
import { PendingActionsComponent } from '../components/pending-actions/pending-actions.component';
import { RecentProgressComponent } from '../components/recent-progress/recent-progress.component';

@Component({
  selector: 'lfx-project-dashboard',
  imports: [RecentProgressComponent, MyMeetingsComponent, PendingActionsComponent, SkeletonModule, DashboardSidebarComponent, DashboardCastDrawerHostComponent],
  templateUrl: './project-dashboard.component.html',
  styleUrl: './project-dashboard.component.scss',
})
export class ProjectDashboardComponent {
  private readonly projectContextService = inject(ProjectContextService);
  private readonly projectService = inject(ProjectService);

  private readonly refresh$ = new BehaviorSubject<void>(undefined);

  public readonly selectedProject = computed(() => this.projectContextService.activeContext());
  protected readonly staffHeading = 'Project Staff';

  public readonly pendingActions: Signal<PendingActionItem[]>;

  public constructor() {
    this.pendingActions = toSignal(
      combineLatest([this.refresh$, toObservable(this.selectedProject)]).pipe(
        switchMap(([, project]) => {
          if (!project?.slug || !project?.uid) {
            return of([]);
          }

          return this.projectService.getPendingActions(project.slug, project.uid).pipe(catchError(() => of([])));
        })
      ),
      { initialValue: [] }
    );
  }

  public handleActionClick(): void {
    this.refresh$.next();
  }

  protected handleVoteSubmitted(): void {
    this.refresh$.next();
  }
}
