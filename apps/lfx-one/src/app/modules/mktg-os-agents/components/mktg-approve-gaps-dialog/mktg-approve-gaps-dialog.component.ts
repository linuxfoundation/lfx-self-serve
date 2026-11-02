// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import type { MktgAssetReport } from '@lfx-one/shared/interfaces';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

@Component({
  selector: 'lfx-mktg-approve-gaps-dialog',
  imports: [ButtonComponent],
  templateUrl: './mktg-approve-gaps-dialog.component.html',
})
export class MktgApproveGapsDialogComponent {
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig<MktgAssetReport>);

  public readonly report = this.config.data;

  protected close(approve: boolean): void {
    this.ref.close(approve);
  }
}
