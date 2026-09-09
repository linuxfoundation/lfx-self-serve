// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject } from '@angular/core';
import type { OrgClaCoverageDialogData, OrgClaGroup, OrgClaGroupProject } from '@lfx-one/shared/interfaces';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

import { ButtonComponent } from '@components/button/button.component';

/**
 * How this dialog is opened, owned here rather than by each caller.
 *
 * Two surfaces open it — a list card and the agreement detail header — and they must present the
 * same agreement identically. Left to the call sites, the header string and the width are two more
 * things that can drift apart, and the drift would only ever be visible to whoever opened both.
 */
export function orgClaCoverageDialogConfig(group: OrgClaGroup): DynamicDialogConfig<OrgClaCoverageDialogData> {
  return {
    header: `Projects covered by ${group.claGroupName}`,
    modal: true,
    width: '28rem',
    data: { claGroupName: group.claGroupName, foundationName: group.foundationName, projects: group.projects },
  };
}

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
