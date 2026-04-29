// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { PendingActionItem } from '@lfx-one/shared/interfaces';
import { LensService } from '@services/lens.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { SkeletonModule } from 'primeng/skeleton';
import { BehaviorSubject, catchError, combineLatest, of, switchMap } from 'rxjs';

import { DashboardQuicklinksComponent } from '../components/dashboard-quicklinks/dashboard-quicklinks.component';
import { FoundationHealthComponent } from '../components/foundation-health/foundation-health.component';
import { MyMeetingsComponent } from '../components/my-meetings/my-meetings.component';
import { OrganizationInvolvementComponent } from '../components/organization-involvement/organization-involvement.component';
import { PendingActionsComponent } from '../components/pending-actions/pending-actions.component';

import { MarketingOverviewComponent } from './components/marketing-overview/marketing-overview.component';

@Component({
  selector: 'lfx-executive-director-dashboard',
  imports: [
    PendingActionsComponent,
    MyMeetingsComponent,
    MarketingOverviewComponent,
    FoundationHealthComponent,
    OrganizationInvolvementComponent,
    SkeletonModule,
    DashboardQuicklinksComponent,
  ],
  templateUrl: './executive-director-dashboard.component.html',
})
export class ExecutiveDirectorDashboardComponent {
  // === Services ===
  private readonly projectContextService = inject(ProjectContextService);
  private readonly projectService = inject(ProjectService);
  private readonly lensService = inject(LensService);

  protected readonly showMeetings = computed(() => this.lensService.activeLens() !== 'org');
  protected readonly showOrgInvolvement = computed(() => this.lensService.activeLens() !== 'me');

  // === Configuration ===
  private readonly refresh$ = new BehaviorSubject<void>(undefined);

  // === Computed Signals ===
  protected readonly selectedFoundation = this.projectContextService.selectedFoundation;
  protected readonly selectedProject = computed(() => this.projectContextService.activeContext());
  // Windowing (dismiss filtering + display cap) is owned by PendingActionsComponent.
  // Pass the raw list and let the child render the top N unhidden items.
  public readonly pendingActions: Signal<PendingActionItem[]>;

  public constructor() {
    this.pendingActions = this.initializePendingActions();
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

          return this.projectService.getPendingActions(project.slug, project.uid, 'executive-director').pipe(catchError(() => of([])));
        })
      ),
      { initialValue: [] }
    );
  }
}
