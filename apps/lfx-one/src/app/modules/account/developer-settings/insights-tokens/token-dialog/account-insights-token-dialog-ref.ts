// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DialogRef } from '@angular/cdk/dialog';
import { signal } from '@angular/core';
import { CreateInsightsTokenResponse } from '@lfx-one/shared/interfaces';

/**
 * Stands in for the create form's PrimeNG dialog ref in the Account & Settings token dialog (#6081): a created token moves the
 * dialog to its done step instead of closing it, and closing with nothing closes the uikit dialog.
 */
export class AccountInsightsTokenDialogRef {
  /** The token once created; its one-time secret lives here only while the dialog is open. */
  public readonly created = signal<CreateInsightsTokenResponse | null>(null);

  public constructor(private readonly dialogRef: Pick<DialogRef, 'close'>) {}

  public close(result?: CreateInsightsTokenResponse): void {
    if (result) {
      this.created.set(result);
      return;
    }
    this.dialogRef.close();
  }
}
