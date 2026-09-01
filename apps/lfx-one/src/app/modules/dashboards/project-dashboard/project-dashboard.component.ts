// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FORMATION_ENABLED_FLAG } from '@lfx-one/shared/constants';
import { PendingActionItem } from '@lfx-one/shared/interfaces';
import { formatAnnouncementDateLabel, isFormationStage } from '@lfx-one/shared/utils';
import { FeatureFlagService } from '@services/feature-flag.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { TagComponent } from '@components/tag/tag.component';
import { SkeletonModule } from 'primeng/skeleton';
import { BehaviorSubject, combineLatest, of, switchMap } from 'rxjs';

import { DashboardCastDrawerHostComponent } from '../components/dashboard-cast-drawer-host/dashboard-cast-drawer-host.component';
import { DashboardSidebarComponent } from '../components/dashboard-sidebar/dashboard-sidebar.component';
import { MyMeetingsComponent } from '../components/my-meetings/my-meetings.component';
import { PendingActionsComponent } from '../components/pending-actions/pending-actions.component';
import { RecentProgressComponent } from '../components/recent-progress/recent-progress.component';
import { FormationChecklistSectionComponent } from '../components/formation-checklist-section/formation-checklist-section.component';

@Component({
  selector: 'lfx-project-dashboard',
  imports: [
    RecentProgressComponent,
    MyMeetingsComponent,
    PendingActionsComponent,
    SkeletonModule,
    DashboardSidebarComponent,
    DashboardCastDrawerHostComponent,
    TagComponent,
    FormationChecklistSectionComponent,
  ],
  templateUrl: './project-dashboard.component.html',
  styleUrl: './project-dashboard.component.scss',
})
export class ProjectDashboardComponent {
  private readonly featureFlagService = inject(FeatureFlagService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly projectService = inject(ProjectService);

  private readonly refresh$ = new BehaviorSubject<void>(undefined);

  public readonly selectedProject = computed(() => this.projectContextService.activeContext());
  private readonly formationEnabled = this.featureFlagService.getBooleanFlag(FORMATION_ENABLED_FLAG, false);
  /** GH-1958: the checklist section only renders for a project in a "Formation - *" stage, dark-launched behind `formation-enabled`. */
  protected readonly isFormationStageProject = computed(() => this.formationEnabled() && isFormationStage(this.projectService.project()?.stage));
  protected readonly staffHeading = 'Project Staff';

  /** GH-1955 — see `FORMATION_ENABLED_FLAG`'s doc comment for what this does and doesn't gate. */
  protected readonly formationFlagEnabled = this.featureFlagService.getBooleanFlag(FORMATION_ENABLED_FLAG, false);
  protected readonly isFormation = this.projectContextService.isActiveProjectInFormation;
  protected readonly formationSubStage = this.projectContextService.activeProjectFormationSubStage;
  protected readonly isConfidential = this.projectContextService.isActiveProjectConfidential;

  /** Shared with `FormationCardComponent` via `ProjectContextService` — no duplicate fetch. */
  protected readonly announcementDateLoading = this.projectContextService.activeProjectAnnouncementDateLoading;
  protected readonly announcementDateHasError = this.projectContextService.activeProjectAnnouncementDateHasError;
  protected readonly announcementDateLabel: Signal<string> = computed(() =>
    formatAnnouncementDateLabel(this.projectContextService.activeProjectAnnouncementDate())
  );

  public readonly pendingActions: Signal<PendingActionItem[]>;

  public constructor() {
    this.pendingActions = this.initPendingActions();
  }

  public handleActionClick(): void {
    this.refresh$.next();
  }

  protected handleVoteSubmitted(): void {
    this.refresh$.next();
  }

  private initPendingActions(): Signal<PendingActionItem[]> {
    return toSignal(
      combineLatest([this.refresh$, toObservable(this.selectedProject)]).pipe(
        switchMap(([, project]) => {
          if (!project?.slug || !project?.uid) {
            return of([]);
          }

          return this.projectService.getPendingActions(project.slug, project.uid);
        })
      ),
      { initialValue: [] }
    );
  }
}
