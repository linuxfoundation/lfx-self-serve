// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { PendingActionItem } from '@lfx-one/shared/interfaces';
import { LensService } from '@services/lens.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { SkeletonModule } from 'primeng/skeleton';
import { BehaviorSubject, catchError, of, switchMap } from 'rxjs';

import { DashboardQuicklinksComponent } from '../components/dashboard-quicklinks/dashboard-quicklinks.component';
import { FoundationHealthComponent } from '../components/foundation-health/foundation-health.component';
import { MyMeetingsComponent } from '../components/my-meetings/my-meetings.component';
import { OrganizationInvolvementComponent } from '../components/organization-involvement/organization-involvement.component';
import { PendingActionsComponent } from '../components/pending-actions/pending-actions.component';

@Component({
  selector: 'lfx-board-member-dashboard',
  imports: [
    OrganizationInvolvementComponent,
    PendingActionsComponent,
    MyMeetingsComponent,
    FoundationHealthComponent,
    SkeletonModule,
    DashboardQuicklinksComponent,
  ],
  templateUrl: './board-member-dashboard.component.html',
  styleUrl: './board-member-dashboard.component.scss',
})
export class BoardMemberDashboardComponent {
  private readonly projectContextService = inject(ProjectContextService);
  private readonly projectService = inject(ProjectService);
  private readonly lensService = inject(LensService);

  protected readonly showMeetings = computed(() => this.lensService.activeLens() !== 'org');
  protected readonly showOrgInvolvement = computed(() => this.lensService.activeLens() !== 'me');

  public readonly selectedFoundation = computed(() => this.projectContextService.selectedFoundation());
  public readonly selectedProject = computed(() => this.projectContextService.activeContext());
  public readonly refresh$: BehaviorSubject<void> = new BehaviorSubject<void>(undefined);
  // Windowing (dismiss filtering + display cap) is owned by PendingActionsComponent.
  // Pass the raw list and let the child render the top N unhidden items.
  public readonly boardMemberActions: Signal<PendingActionItem[]>;

  public constructor() {
    this.boardMemberActions = this.initializeBoardMemberActions();
  }

  public handleActionClick(): void {
    this.refresh$.next();
  }

  private initializeBoardMemberActions(): Signal<PendingActionItem[]> {
    // Convert project signal to observable to react to changes (handles both project and foundation)
    const project$ = toObservable(this.selectedProject);

    return toSignal(
      this.refresh$.pipe(
        takeUntilDestroyed(),
        switchMap(() => {
          return project$.pipe(
            switchMap((project) => {
              // If no project/foundation selected, return empty array
              if (!project?.slug || !project?.uid) {
                return of([]);
              }

              // Fetch all pending actions from unified backend endpoint
              return this.projectService.getPendingActions(project.slug, project.uid, 'board-member').pipe(catchError(() => of([])));
            })
          );
        })
      ),
      { initialValue: [] }
    );
  }
}
