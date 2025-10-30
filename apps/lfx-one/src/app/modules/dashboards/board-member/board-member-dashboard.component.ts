// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, Signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Account } from '@lfx-one/shared/interfaces';
import { SelectComponent } from '../../../shared/components/select/select.component';
import { AccountContextService } from '../../../shared/services/account-context.service';
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

  protected readonly accountForm = new FormGroup({
    selectedAccountId: new FormControl<string>(this.accountContextService.selectedAccount().accountId),
  });

  protected readonly availableAccounts: Signal<Account[]> = computed(() => this.accountContextService.availableAccounts);

  /**
   * Handle account selection change
   */
  protected handleAccountChange(event: any): void {
    const selectedAccountId = event.value as string;
    const selectedAccount = this.accountContextService.availableAccounts.find((acc) => acc.accountId === selectedAccountId);
    if (selectedAccount) {
      this.accountContextService.setAccount(selectedAccount);
    }
  }
}
