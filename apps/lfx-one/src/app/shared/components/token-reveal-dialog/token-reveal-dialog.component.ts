// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Clipboard } from '@angular/cdk/clipboard';
import { Component, inject } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

/**
 * Reveal popup for a developer API token. Opened via DialogService.open() with the full
 * token passed as dialog data; displays it on a single horizontally-scrollable line with
 * Copy and Close. The dialog title is set by the opener via the DialogService config header.
 */
@Component({
  selector: 'lfx-token-reveal-dialog',
  imports: [ButtonComponent],
  templateUrl: './token-reveal-dialog.component.html',
})
export class TokenRevealDialogComponent {
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly dialogConfig = inject(DynamicDialogConfig);
  private readonly clipboard = inject(Clipboard);
  private readonly messageService = inject(MessageService);

  // Guard against a missing/non-string token in the dialog data so we never render the literal
  // string "undefined"; the single in-app opener always passes a string, this is defense in depth.
  public readonly token = typeof this.dialogConfig.data?.token === 'string' ? this.dialogConfig.data.token : '';

  public copy(): void {
    if (!this.token) {
      this.messageService.add({
        severity: 'warn',
        summary: 'No Token',
        detail: 'No API token available to copy.',
      });
      return;
    }

    const success = this.clipboard.copy(this.token);
    if (success) {
      this.messageService.add({
        severity: 'success',
        summary: 'Copied',
        detail: 'API token copied to clipboard successfully.',
      });
    } else {
      this.messageService.add({
        severity: 'error',
        summary: 'Copy Failed',
        detail: 'Failed to copy token to clipboard. Please try again.',
      });
    }
  }

  public close(): void {
    this.dialogRef.close();
  }
}
