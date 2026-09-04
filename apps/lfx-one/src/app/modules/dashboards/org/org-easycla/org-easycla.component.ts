// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { AccountContextService } from '@services/account-context.service';

@Component({
  selector: 'lfx-org-easycla',
  imports: [EmptyStateComponent],
  templateUrl: './org-easycla.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrgEasyclaComponent {
  private readonly accountContext = inject(AccountContextService);

  protected readonly companyName = computed(() => this.accountContext.selectedAccount()?.accountName ?? '');
}
