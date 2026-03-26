// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { MaintainerConfirmationDialogData, MaintainerConfirmationResult } from '@lfx-one/shared/interfaces';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

@Component({
  selector: 'lfx-maintainer-confirmation-dialog',
  imports: [ButtonComponent],
  templateUrl: './maintainer-confirmation-dialog.component.html',
})
export class MaintainerConfirmationDialogComponent {
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);

  public readonly data: MaintainerConfirmationDialogData = this.config.data;

  public confirmMaintainer(): void {
    this.ref.close('maintainer' as MaintainerConfirmationResult);
  }

  public confirmContributor(): void {
    this.ref.close('contributor' as MaintainerConfirmationResult);
  }
}
