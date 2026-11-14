// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject, Injectable } from '@angular/core';
import { ShareDialogComponent } from '@components/share-dialog/share-dialog.component';
import { ShareDialogData } from '@lfx-one/shared/interfaces';
import { nameDynamicDialog } from '@shared/utils/name-dynamic-dialog';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';

/**
 * Opens the share dialog (social destinations + copy link) for any absolute URL.
 */
@Injectable({ providedIn: 'root' })
export class ShareDialogService {
  private readonly dialogService = inject(DialogService);

  public open(data: ShareDialogData): void {
    const dialogRef = this.dialogService.open(ShareDialogComponent, {
      // No PrimeNG header — the dialog body renders its own eyebrow, "Share" heading and close.
      showHeader: false,
      width: '480px',
      breakpoints: { '640px': '92vw' },
      contentStyle: { padding: '1.5rem' },
      modal: true,
      draggable: false,
      resizable: false,
      dismissableMask: true,
      data,
    }) as DynamicDialogRef;

    nameDynamicDialog(this.dialogService, dialogRef, ShareDialogComponent.headingId);
  }
}
