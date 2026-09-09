// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject } from '@angular/core';
import type { OrgClaCoverageDialogData, OrgClaGroupProject } from '@lfx-one/shared/interfaces';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

import { ButtonComponent } from '@components/button/button.component';

@Component({
  selector: 'lfx-org-easycla-coverage-dialog',
  imports: [ButtonComponent],
  templateUrl: './org-easycla-coverage-dialog.component.html',
})
export class OrgEasyclaCoverageDialogComponent {
  private readonly dialogConfig = inject<DynamicDialogConfig<OrgClaCoverageDialogData>>(DynamicDialogConfig);
  private readonly dialogRef = inject(DynamicDialogRef);

  protected readonly claGroupName = this.dialogConfig.data?.claGroupName ?? '';
  protected readonly projects: OrgClaGroupProject[] = this.dialogConfig.data?.projects ?? [];

  // Naming the foundation without this caveat invites the reading that the agreement covers
  // everything under it, which is the opposite of what the listed subset means.
  protected readonly coverageHint = this.dialogConfig.data?.foundationName
    ? `Part of ${this.dialogConfig.data.foundationName} — this CLA covers the projects below, not necessarily every project in the foundation.`
    : 'This CLA covers the projects below.';

  protected close(): void {
    this.dialogRef.close();
  }
}
