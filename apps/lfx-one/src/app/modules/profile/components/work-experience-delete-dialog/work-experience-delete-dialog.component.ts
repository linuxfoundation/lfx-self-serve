// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { WorkExperience } from '@lfx-one/shared/interfaces';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

@Component({
  selector: 'lfx-work-experience-delete-dialog',
  imports: [ButtonComponent],
  templateUrl: './work-experience-delete-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkExperienceDeleteDialogComponent {
  // Private injections
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);

  // Config data
  public readonly experience: WorkExperience = this.config.data.experience;

  // Public methods
  public onConfirm(): void {
    this.ref.close(true);
  }

  public onCancel(): void {
    this.ref.close(null);
  }
}
