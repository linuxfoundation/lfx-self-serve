// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, Signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Account } from '@lfx-one/shared/interfaces';

import { SelectComponent } from '../../../shared/components/select/select.component';
import { AccountContextService } from '../../../shared/services/account-context.service';
import { FeatureFlagService } from '../../../shared/services/feature-flag.service';
import { ProjectContextService } from '../../../shared/services/project-context.service';
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
  private readonly featureFlagService = inject(FeatureFlagService);

  public readonly form = new FormGroup({
    selectedAccountId: new FormControl<string>(this.accountContextService.selectedAccount().accountId),
  });

  public readonly availableAccounts: Signal<Account[]> = computed(() => this.accountContextService.availableAccounts);
  public readonly selectedFoundation = computed(() => this.projectContextService.selectedFoundation());

  // Feature flags
  protected readonly showOrganizationSelector = this.featureFlagService.getBooleanFlag('organization-selector', true);

  public constructor() {
    this.form
      .get('selectedAccountId')
      ?.valueChanges.pipe(takeUntilDestroyed())
      .subscribe((value) => {
        const selectedAccount = this.accountContextService.availableAccounts.find((acc) => acc.accountId === value);
        if (selectedAccount) {
          this.accountContextService.setAccount(selectedAccount as Account);
        }
      });
  }
}
