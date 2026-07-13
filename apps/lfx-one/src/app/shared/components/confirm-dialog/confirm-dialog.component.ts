// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';
import { ConfirmDialogProps } from '@lfx-one/shared/interfaces';
import { ConfirmDialogModule } from 'primeng/confirmdialog';

@Component({
  selector: 'lfx-confirm-dialog',
  imports: [ConfirmDialogModule],
  templateUrl: './confirm-dialog.component.html',
})
export class ConfirmDialogComponent {
  public readonly key = input<ConfirmDialogProps['key']>();
}
