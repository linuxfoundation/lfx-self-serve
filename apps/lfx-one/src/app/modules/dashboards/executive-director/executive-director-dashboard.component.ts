// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { PendingActionItem } from '@lfx-one/shared/interfaces';
import { HiddenActionsService } from '@services/hidden-actions.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { SkeletonModule } from 'primeng/skeleton';
import { BehaviorSubject, catchError, combineLatest, of, switchMap } from 'rxjs';

import { MyMeetingsComponent } from '../components/my-meetings/my-meetings.component';
import { PendingActionsComponent } from '../components/pending-actions/pending-actions.component';

import { MarketingOverviewComponent } from './components/marketing-overview/marketing-overview.component';

@Component({
  selector: 'lfx-executive-director-dashboard',
  imports: [PendingActionsComponent, MyMeetingsComponent, MarketingOverviewComponent, SkeletonModule],
  templateUrl: './executive-director-dashboard.component.html',
})
export class ExecutiveDirectorDashboardComponent {
  // === Services ===
  private readonly projectContextService = inject(ProjectContextService);
  private readonly projectService = inject(ProjectService);
  private readonly hiddenActionsService = inject(HiddenActionsService);

  // === Configuration ===
  private readonly refresh$ = new BehaviorSubject<void>(undefined);

  // === Computed Signals ===
  protected readonly selectedFoundation = this.projectContextService.selectedFoundation;
  protected readonly selectedProject = computed(() => this.projectContextService.selectedProject() || this.projectContextService.selectedFoundation());
  private readonly rawPendingActions: Signal<PendingActionItem[]>;
  public readonly pendingActions: Signal<PendingActionItem[]>;

  public constructor() {
    this.rawPendingActions = this.initializePendingActions();

    this.pendingActions = computed(() => {
      return this.rawPendingActions()
        .filter((item) => !this.hiddenActionsService.isActionHidden(item))
        .slice(0, 2);
    });
  }

  // === Public Methods ===
  public handleActionClick(): void {
    this.refresh$.next();
  }

  // === Private Initializers ===
  private initializePendingActions(): Signal<PendingActionItem[]> {
    const project$ = toObservable(this.selectedProject);

    return toSignal(
      combineLatest([this.refresh$, project$]).pipe(
        switchMap(([, project]) => {
          if (!project?.slug || !project?.uid) {
            return of([]);
          }

          return this.projectService.getPendingActions(project.slug, project.uid, 'executive-director').pipe(
            catchError((error) => {
              console.error('Failed to fetch pending actions:', error);
              return of([]);
            })
          );
        })
      ),
      { initialValue: [] }
    );
  }
}
