// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { SelectComponent } from '@components/select/select.component';
import { Account, PendingActionItem } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { catchError, of, switchMap } from 'rxjs';

import { FoundationHealthComponent } from '../components/foundation-health/foundation-health.component';
import { MyMeetingsComponent } from '../components/my-meetings/my-meetings.component';
import { OrganizationInvolvementComponent } from '../components/organization-involvement/organization-involvement.component';
import { PendingActionsComponent } from '../components/pending-actions/pending-actions.component';

@Component({
  selector: 'lfx-board-member-dashboard',
  imports: [OrganizationInvolvementComponent, PendingActionsComponent, MyMeetingsComponent, FoundationHealthComponent, SelectComponent, ReactiveFormsModule],
  templateUrl: './board-member-dashboard.component.html',
  styleUrl: './board-member-dashboard.component.scss',
})
export class BoardMemberDashboardComponent {
  private readonly accountContextService = inject(AccountContextService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly projectService = inject(ProjectService);
  private readonly featureFlagService = inject(FeatureFlagService);

  public readonly form = new FormGroup({
    selectedAccountId: new FormControl<string>(this.accountContextService.selectedAccount().accountId),
  });

  public readonly availableAccounts: Signal<Account[]> = computed(() => this.accountContextService.availableAccounts);
  public readonly selectedFoundation = computed(() => this.projectContextService.selectedFoundation());
  public readonly selectedProject = computed(() => this.projectContextService.selectedProject() || this.projectContextService.selectedFoundation());
  public readonly boardMemberActions: Signal<PendingActionItem[]>;

  // Feature flags
  protected readonly showOrganizationSelector = this.featureFlagService.getBooleanFlag('organization-selector', true);

  public constructor() {
    // Handle account selection changes
    this.form
      .get('selectedAccountId')
      ?.valueChanges.pipe(takeUntilDestroyed())
      .subscribe((value) => {
        const selectedAccount = this.accountContextService.availableAccounts.find((acc) => acc.accountId === value);
        if (selectedAccount) {
          this.accountContextService.setAccount(selectedAccount as Account);
        }
      });

    // Initialize board member actions with reactive pattern
    this.boardMemberActions = this.initializeBoardMemberActions();
  }

  private initializeBoardMemberActions(): Signal<PendingActionItem[]> {
    // Convert project signal to observable to react to changes (handles both project and foundation)
    const project$ = toObservable(this.selectedProject);

    return toSignal(
      project$.pipe(
        switchMap((project) => {
          // If no project/foundation selected, return empty array
          if (!project?.slug) {
            return of([]);
          }

          // Fetch survey actions from API
          return this.projectService.getPendingActionSurveys(project.slug).pipe(
            catchError((error) => {
              console.error('Failed to fetch survey actions:', error);
              // Return empty array on error
              return of([]);
            })
          );
        })
      ),
      { initialValue: [] }
    );
  }
}
