// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { Component, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ACCOUNT_DEVELOPER_SETTINGS_COPY } from '@lfx-one/shared/constants';
import { AccountRevokeInsightsTokenDialogData, InsightsToken } from '@lfx-one/shared/interfaces';
import { AccountCardComponent } from '@shared/components/account-card/account-card.component';
import { OpenIntercomDirective } from '@shared/directives/open-intercom.directive';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiEmptyStateComponent } from '@shared/uikit/empty-state/empty-state.component';
import { UiModalService } from '@shared/uikit/modal/modal.service';
import { UiNoteComponent } from '@shared/uikit/note/note.component';
import { UiSkeletonComponent } from '@shared/uikit/skeleton/skeleton.component';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { take } from 'rxjs';

import { InsightsTokensComponent } from '../../../settings/components/insights-tokens/insights-tokens.component';
import { AccountRevokeTokenDialogComponent } from './revoke-dialog/account-revoke-token-dialog.component';
import { AccountInsightsTokenDialogComponent } from './token-dialog/account-insights-token-dialog.component';
import { AccountInsightsTokenDialogRef } from './token-dialog/account-insights-token-dialog-ref';

/**
 * The "LFX Insights API Tokens" card of Account & Settings › Developer settings (#6081). It keeps the group's eligibility,
 * list, remove and revoke by extending it; creating and revoking open uikit dialogs, and a new token's secret shows in the
 * create dialog itself.
 */
@Component({
  selector: 'lfx-account-insights-tokens',
  imports: [DatePipe, AccountCardComponent, OpenIntercomDirective, UiButtonComponent, UiEmptyStateComponent, UiNoteComponent, UiSkeletonComponent],
  // The group opens its PrimeNG dialogs through these; this card opens uikit ones instead.
  providers: [DialogService],
  templateUrl: './account-insights-tokens.component.html',
})
export class AccountInsightsTokensComponent extends InsightsTokensComponent {
  private readonly modal = inject(UiModalService);
  private readonly cardDestroyRef = inject(DestroyRef);

  protected readonly copy = ACCOUNT_DEVELOPER_SETTINGS_COPY;
  private creating = false;

  protected override openCreateDialog(): void {
    if (this.impersonating() || this.creating) return;
    this.creating = true;

    let steps: AccountInsightsTokenDialogRef | null = null;
    // Escape and the backdrop can't close it: the one-time secret would go with it.
    const dialogRef = this.modal.open(
      AccountInsightsTokenDialogComponent,
      { closeOnEscape: false, closeOnBackdropClick: false, autoFocus: '[data-autofocus] input' },
      {
        providers: (ref) => {
          steps = new AccountInsightsTokenDialogRef(ref);
          return [
            { provide: AccountInsightsTokenDialogRef, useValue: steps },
            { provide: DynamicDialogRef, useValue: steps },
          ];
        },
      }
    );
    // Not tied to this card: a flag change can remove it while the token is being created, and the token still lands.
    dialogRef.closed.pipe(take(1)).subscribe(() => {
      this.creating = false;
      const created = steps?.created();
      if (created) this.tokens.update((tokens) => [created.token, ...tokens]);
    });
  }

  protected override confirmRevoke(token: InsightsToken): void {
    if (this.impersonating()) return;
    const dialogRef = this.modal.open<boolean, AccountRevokeInsightsTokenDialogData>(AccountRevokeTokenDialogComponent, {
      data: { name: token.name },
      role: 'alertdialog',
      describedBy: true,
    });
    dialogRef.closed.pipe(take(1), takeUntilDestroyed(this.cardDestroyRef)).subscribe((confirmed) => {
      if (confirmed) this.revoke(token);
    });
    // The modal is root-owned: it closes with the card, which then revokes nothing.
    const stopClosingWithCard = this.cardDestroyRef.onDestroy(() => dialogRef.close());
    dialogRef.closed.pipe(take(1)).subscribe(() => stopClosingWithCard());
  }
}
