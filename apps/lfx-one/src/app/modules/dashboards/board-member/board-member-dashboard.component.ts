// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { PendingActionItem } from '@lfx-one/shared/interfaces';
import { LensService } from '@services/lens.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { SkeletonModule } from 'primeng/skeleton';
import { BehaviorSubject, catchError, combineLatest, of, switchMap } from 'rxjs';

import { DashboardCastDrawerHostComponent } from '../components/dashboard-cast-drawer-host/dashboard-cast-drawer-host.component';
import { DashboardSidebarComponent } from '../components/dashboard-sidebar/dashboard-sidebar.component';
import { FoundationHealthComponent } from '../components/foundation-health/foundation-health.component';
import { MyMeetingsComponent } from '../components/my-meetings/my-meetings.component';
import { OrganizationInvolvementComponent } from '../components/organization-involvement/organization-involvement.component';
import { PendingActionsComponent } from '../components/pending-actions/pending-actions.component';
import { MarketingOverviewComponent } from '../executive-director/components/marketing-overview/marketing-overview.component';

@Component({
  selector: 'lfx-board-member-dashboard',
  imports: [
    OrganizationInvolvementComponent,
    PendingActionsComponent,
    MyMeetingsComponent,
    FoundationHealthComponent,
    MarketingOverviewComponent,
    SkeletonModule,
    DashboardSidebarComponent,
    DashboardCastDrawerHostComponent,
  ],
  templateUrl: './board-member-dashboard.component.html',
  styleUrl: './board-member-dashboard.component.scss',
})
export class BoardMemberDashboardComponent {
  private readonly projectContextService = inject(ProjectContextService);
  private readonly projectService = inject(ProjectService);
  private readonly lensService = inject(LensService);
  private readonly personaService = inject(PersonaService);

  protected readonly showMeetings = computed(() => this.lensService.activeLens() !== 'org');
  protected readonly showOrgInvolvement = computed(() => this.lensService.activeLens() !== 'me');
  // Read-only Marketing Overview for non-ED Marketing Ops users (who land on this dashboard on the
  // foundation lens). Gated on `campaign_manager` for the active context so board members and other
  // non-marketing users never see it.
  protected readonly canManageCampaigns = this.projectContextService.canManageCampaigns;
  /**
   * Marketing-only foundation mode: ROOT marketing grant without board/root-writer product access.
   * Hides Foundation Health, pending actions, meetings, org involvement, and staff sidebar so
   * granting the foundation lens for marketing (SC-008) does not widen other product UI (FR-017).
   */
  protected readonly isMarketingOnlyFoundation = this.personaService.isMarketingOnlyFoundationUser;

  public readonly selectedFoundation = computed(() => this.projectContextService.selectedFoundation());
  public readonly selectedProject = computed(() => this.projectContextService.activeContext());
  protected readonly staffHeading = 'Foundation Staff';
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

  protected handleVoteSubmitted(): void {
    this.refresh$.next();
  }

  private initializeBoardMemberActions(): Signal<PendingActionItem[]> {
    // Convert project signal to observable to react to changes (handles both project and foundation)
    const project$ = toObservable(this.selectedProject);
    const marketingOnly$ = toObservable(this.isMarketingOnlyFoundation);

    return toSignal(
      combineLatest([this.refresh$, project$, marketingOnly$]).pipe(
        takeUntilDestroyed(),
        switchMap(([, project, marketingOnly]) => {
          // Marketing-only foundation mode never renders pending actions — skip the expensive
          // aggregator so newly admitted marketing users don't pay for non-marketing dashboard data.
          if (marketingOnly || !project?.slug || !project?.uid) {
            return of([]);
          }

          return this.projectService.getPendingActions(project.slug, project.uid, 'board-member').pipe(catchError(() => of([])));
        })
      ),
      { initialValue: [] }
    );
  }
}
