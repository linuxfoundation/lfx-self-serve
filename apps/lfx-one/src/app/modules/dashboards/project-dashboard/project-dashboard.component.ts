// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FORMATION_ENABLED_FLAG } from '@lfx-one/shared/constants';
import { PendingActionItem } from '@lfx-one/shared/interfaces';
import { formatAnnouncementDateLabel } from '@lfx-one/shared/utils';
import { FeatureFlagService } from '@services/feature-flag.service';
import { PermissionsService } from '@services/permissions.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { TagComponent } from '@components/tag/tag.component';
import { SkeletonModule } from 'primeng/skeleton';
import { BehaviorSubject, catchError, combineLatest, filter, map, of, switchMap, tap } from 'rxjs';

import { DashboardCastDrawerHostComponent } from '../components/dashboard-cast-drawer-host/dashboard-cast-drawer-host.component';
import { DashboardSidebarComponent } from '../components/dashboard-sidebar/dashboard-sidebar.component';
import { MyMeetingsComponent } from '../components/my-meetings/my-meetings.component';
import { PendingActionsComponent } from '../components/pending-actions/pending-actions.component';
import { RecentProgressComponent } from '../components/recent-progress/recent-progress.component';

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
  ],
  templateUrl: './project-dashboard.component.html',
  styleUrl: './project-dashboard.component.scss',
})
export class ProjectDashboardComponent {
  private readonly featureFlagService = inject(FeatureFlagService);
  private readonly permissionsService = inject(PermissionsService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly projectService = inject(ProjectService);

  private readonly refresh$ = new BehaviorSubject<void>(undefined);

  public readonly selectedProject = computed(() => this.projectContextService.activeContext());
  protected readonly staffHeading = 'Project Staff';

  /** GH-1955 — see `FORMATION_ENABLED_FLAG`'s doc comment for what this does and doesn't gate. */
  protected readonly formationFlagEnabled = this.featureFlagService.getBooleanFlag(FORMATION_ENABLED_FLAG, false);
  protected readonly isFormation = this.projectContextService.isActiveProjectInFormation;
  protected readonly formationSubStage = this.projectContextService.activeProjectFormationSubStage;

  public readonly pendingActions: Signal<PendingActionItem[]>;
  /** True until the announcement-date fetch for the current project settles — gates the subtitle's date clause so it never asserts "Not set" before the real value is known. */
  protected readonly announcementDateLoading = signal(true);
  private readonly announcementDate: Signal<string | null>;
  protected readonly announcementDateLabel: Signal<string>;

  public constructor() {
    this.pendingActions = this.initPendingActions();
    this.announcementDate = this.initAnnouncementDate();
    this.announcementDateLabel = this.initAnnouncementDateLabel();
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

  /** Shares `PermissionsService`'s per-uid cache with `FormationCardComponent` — no duplicate fetch. */
  private initAnnouncementDate(): Signal<string | null> {
    return toSignal(
      toObservable(this.selectedProject).pipe(
        filter((project): project is NonNullable<typeof project> => !!project?.uid),
        tap(() => this.announcementDateLoading.set(true)),
        switchMap((project) =>
          this.permissionsService.getProjectSettings(project.uid).pipe(
            map((settings) => settings.announcement_date || null),
            catchError((error) => {
              console.error('Project dashboard: failed to load announcement date', error);
              return of(null);
            }),
            tap(() => this.announcementDateLoading.set(false))
          )
        )
      ),
      { initialValue: null }
    );
  }

  private initAnnouncementDateLabel(): Signal<string> {
    return computed(() => formatAnnouncementDateLabel(this.announcementDate()));
  }
}
