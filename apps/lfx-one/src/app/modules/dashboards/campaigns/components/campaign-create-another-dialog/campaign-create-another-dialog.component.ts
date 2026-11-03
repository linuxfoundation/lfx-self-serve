// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import type { CampaignCreateAnotherDialogData } from '@lfx-one/shared/interfaces';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

/**
 * The confirmation in front of every "create another campaign" (#4983, "ss-3").
 *
 * Opened through `DialogService` for each create that would add a campaign on a platform that already
 * has one, so the intent is confirmed again after every result: confirming once does not license the
 * next click. It lists the campaigns that already exist there and says plainly that the new one is a
 * separate, separately budgeted campaign. Closing it any way but Create another sends nothing.
 */
@Component({
  selector: 'lfx-campaign-create-another-dialog',
  imports: [ButtonComponent],
  templateUrl: './campaign-create-another-dialog.component.html',
})
export class CampaignCreateAnotherDialogComponent {
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly dialogConfig = inject(DynamicDialogConfig<CampaignCreateAnotherDialogData>);

  protected readonly data: CampaignCreateAnotherDialogData = this.dialogConfig.data as CampaignCreateAnotherDialogData;

  protected confirm(): void {
    this.dialogRef.close(true);
  }

  protected cancel(): void {
    this.dialogRef.close(false);
  }
}
