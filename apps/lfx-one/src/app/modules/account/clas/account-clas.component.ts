// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, Signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AccountCardComponent } from '@components/account-card/account-card.component';
import { ACCOUNT_CLAS_COPY, ACCOUNT_IDENTITIES_PATH } from '@lfx-one/shared/constants';
import {
  AccountClaRequestDialogData,
  AccountClaRow,
  ClaManagerRequestMode,
  ClaRow,
  ContactClaManagerDialogData,
  MyClaAgreement,
  UiBadgeTone,
} from '@lfx-one/shared/interfaces';
import { claRowActions } from '@lfx-one/shared/utils';
import { UiBadgeComponent } from '@shared/uikit/badge/badge.component';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiEmptyStateComponent } from '@shared/uikit/empty-state/empty-state.component';
import { UiMenuItemComponent } from '@shared/uikit/menu/menu-item.component';
import { UiMenuComponent } from '@shared/uikit/menu/menu.component';
import { UiModalService } from '@shared/uikit/modal/modal.service';
import { UiSkeletonComponent } from '@shared/uikit/skeleton/skeleton.component';
import { UiTableCellDirective } from '@shared/uikit/table/table-cell.directive';
import { UiTableComponent } from '@shared/uikit/table/table.component';
import { DialogService, DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

import { ProfileClasComponent } from '../../profile/clas/profile-clas.component';
import { AccountClaRequestDialogComponent } from './request-dialog/account-cla-request-dialog.component';
import { AccountSignDialogHostService } from './sign-dialog/account-sign-dialog-host.service';

/**
 * Account & Settings › CLAs (#6077, behind the profile redesign flag). It keeps the hub tab's loading, rows, downloads and signing
 * by extending it, shows the agreements in a uikit table with a ⋯ menu per row, and asks a CCLA's managers through a uikit
 * dialog. When the hub goes (#6094), that logic moves here.
 */
@Component({
  selector: 'lfx-account-clas',
  imports: [
    RouterLink,
    AccountCardComponent,
    UiBadgeComponent,
    UiButtonComponent,
    UiEmptyStateComponent,
    UiMenuComponent,
    UiMenuItemComponent,
    UiSkeletonComponent,
    UiTableComponent,
    UiTableCellDirective,
  ],
  // The hub's signing flow opens a PrimeNG dialog per step; here they all run in one "Sign a CLA" uikit dialog. Toasts go to the
  // app's own, as the account pages do.
  providers: [AccountSignDialogHostService, { provide: DialogService, useExisting: AccountSignDialogHostService }],
  templateUrl: './account-clas.component.html',
})
export class AccountClasComponent extends ProfileClasComponent {
  private readonly modal = inject(UiModalService);

  protected readonly copy = ACCOUNT_CLAS_COPY;
  protected readonly identitiesPath = ACCOUNT_IDENTITIES_PATH;
  protected readonly columns = [
    { key: 'project', header: 'Project' },
    { key: 'type', header: 'Type' },
    { key: 'status', header: 'Status' },
    { key: 'signed', header: 'Signed' },
    { key: 'actions', header: '' },
  ];
  protected readonly accountRows: Signal<AccountClaRow[]> = this.initAccountRows();
  /** The table's rows: the agreement id it keys on, and the prepared row the cells show. */
  protected readonly tableRows: Signal<Record<string, unknown>[]> = computed(() => this.accountRows().map((row) => ({ id: row.row.id, cla: row })));

  public constructor() {
    super();
    // While the flow looks up linked accounts between steps, the dialog stays open and says so.
    inject(AccountSignDialogHostService).holdOpenWhile(this.starting);
  }

  /** Opens the CCLA request dialog for a row: approval, removal, or a message to its managers. */
  protected openRequest(agreement: MyClaAgreement, mode: ClaManagerRequestMode): void {
    // Re-checked here, not only on the disabled menu items, as the hub does for signing.
    if (this.impersonating()) return;
    const legacy: ContactClaManagerDialogData = { signatureId: agreement.id, projectName: agreement.projectName || agreement.claGroupName, mode };
    this.modal.open<unknown>(
      AccountClaRequestDialogComponent,
      { data: { agreement, mode } satisfies AccountClaRequestDialogData, autoFocus: '[data-autofocus] button' },
      {
        // The dialog extends the hub's PrimeNG one, which closes through DynamicDialogRef and reads DynamicDialogConfig.
        providers: (ref) => [
          { provide: DynamicDialogRef, useValue: { close: (result?: unknown) => ref.close(result) } },
          { provide: DynamicDialogConfig, useValue: { data: legacy } },
        ],
      }
    );
  }

  private initAccountRows(): Signal<AccountClaRow[]> {
    return computed(() => this.rows().map((row) => this.toAccountRow(row)));
  }

  private toAccountRow(row: ClaRow): AccountClaRow {
    const agreement = row.agreement;
    const actions = claRowActions(agreement);
    return {
      row,
      statusTone: this.toneFor(row.status.severity),
      typeLabel: agreement.kind === 'ECLA' ? `CCLA${agreement.companyName ? ' · ' + agreement.companyName : ''}` : 'ICLA',
      actions,
      hasActions: actions.download || actions.requestApproval || actions.requestRemoval || actions.contact,
    };
  }

  private toneFor(severity: ClaRow['status']['severity']): UiBadgeTone {
    switch (severity) {
      case 'success':
        return 'success';
      case 'warn':
        return 'warning';
      case 'danger':
        return 'danger';
      default:
        return 'neutral';
    }
  }
}
