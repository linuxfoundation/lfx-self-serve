// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject } from '@angular/core';
import type { WhyCantEditDialogData } from '@lfx-one/shared/interfaces';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

const DEFAULT_REASON = "This seat is controlled by the foundation and cannot be edited from your organization's view.";

@Component({
  selector: 'lfx-why-cant-edit-modal',
  standalone: true,
  templateUrl: './why-cant-edit-modal.component.html',
})
export class WhyCantEditModalComponent {
  private readonly dialogConfig = inject<DynamicDialogConfig<WhyCantEditDialogData>>(DynamicDialogConfig);
  private readonly dialogRef = inject(DynamicDialogRef);

  protected readonly seatId = this.dialogConfig.data?.seatId ?? '';
  private readonly reason = this.dialogConfig.data?.reason ?? null;

  /** FR-012a — render `reason` if non-null/non-empty, otherwise the generic fallback. */
  protected readonly displayedReason = computed(() => {
    const r = this.reason;
    return r && r.trim().length > 0 ? r : DEFAULT_REASON;
  });

  protected onGotIt(): void {
    this.dialogRef.close({ contactFoundation: false });
  }

  protected onContactFoundation(): void {
    this.dialogRef.close({ contactFoundation: true });
  }
}
