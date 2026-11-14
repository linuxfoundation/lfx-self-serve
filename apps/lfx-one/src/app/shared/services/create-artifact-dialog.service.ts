// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject, Injectable } from '@angular/core';
import { CreateArtifactDialogComponent } from '@components/create-artifact-dialog/create-artifact-dialog.component';
import { CreatableArtifactType } from '@lfx-one/shared/interfaces';
import { nameDynamicDialog } from '@shared/utils/name-dynamic-dialog';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';

/**
 * Opens the "Create <Type>" target picker dialog, so any surface can start a create flow without its own dialog host.
 */
@Injectable({ providedIn: 'root' })
export class CreateArtifactDialogService {
  private readonly dialogService = inject(DialogService);

  public open(type: CreatableArtifactType): void {
    const dialogRef = this.dialogService.open(CreateArtifactDialogComponent, {
      // No PrimeNG header — the dialog body renders its own "Create <Type>" header.
      showHeader: false,
      width: '480px',
      contentStyle: { padding: '1.5rem' },
      modal: true,
      draggable: false,
      resizable: false,
      dismissableMask: true,
      data: { type },
    }) as DynamicDialogRef;

    nameDynamicDialog(this.dialogService, dialogRef, CreateArtifactDialogComponent.headingId);
  }
}
