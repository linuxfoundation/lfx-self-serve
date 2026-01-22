// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { PendingActionItem } from '@lfx-one/shared/interfaces';
import { HiddenActionsService } from '@services/hidden-actions.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { BehaviorSubject, catchError, of, switchMap } from 'rxjs';

import { FoundationHealthComponent } from '../components/foundation-health/foundation-health.component';
import { MyMeetingsComponent } from '../components/my-meetings/my-meetings.component';
import { OrganizationInvolvementComponent } from '../components/organization-involvement/organization-involvement.component';
import { PendingActionsComponent } from '../components/pending-actions/pending-actions.component';

@Component({
  selector: 'lfx-board-member-dashboard',
  imports: [OrganizationInvolvementComponent, PendingActionsComponent, MyMeetingsComponent, FoundationHealthComponent],
  templateUrl: './board-member-dashboard.component.html',
  styleUrl: './board-member-dashboard.component.scss',
})
export class BoardMemberDashboardComponent {
  private readonly projectContextService = inject(ProjectContextService);
  private readonly projectService = inject(ProjectService);
  private readonly hiddenActionsService = inject(HiddenActionsService);

  public readonly selectedFoundation = computed(() => this.projectContextService.selectedFoundation());
  public readonly selectedProject = computed(() => this.projectContextService.selectedProject() || this.projectContextService.selectedFoundation());
  public readonly refresh$: BehaviorSubject<void> = new BehaviorSubject<void>(undefined);
  private readonly rawBoardMemberActions: Signal<PendingActionItem[]>;
  public readonly boardMemberActions: Signal<PendingActionItem[]>;

  public constructor() {
    // Initialize board member actions with reactive pattern
    this.rawBoardMemberActions = this.initializeBoardMemberActions();

    // Create filtered signal that removes hidden actions
    this.boardMemberActions = computed(() => {
      return this.rawBoardMemberActions().filter((item) => !this.hiddenActionsService.isActionHidden(item));
    });
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
              return this.projectService.getPendingActions(project.slug, project.uid, 'board-member').pipe(
                catchError((error) => {
                  console.error('Failed to fetch pending actions:', error);
                  return of([]);
                })
              );
            })
          );
        })
      ),
      { initialValue: [] }
    );
  }
}
