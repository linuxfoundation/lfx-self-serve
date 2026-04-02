// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import { LinkifyPipe } from '@pipes/linkify.pipe';
import { DescriptionDialogData } from '@lfx-one/shared/interfaces';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

@Component({
  selector: 'lfx-description-dialog',
  standalone: true,
  imports: [ReactiveFormsModule, ButtonComponent, TextareaComponent, LinkifyPipe],
  templateUrl: './description-dialog.component.html',
})
export class DescriptionDialogComponent {
  private readonly config = inject(DynamicDialogConfig<DescriptionDialogData>);
  private readonly ref = inject(DynamicDialogRef);

  public readonly mode = this.config.data.mode;
  public readonly description = this.config.data.description;

  public descriptionForm = new FormGroup({
    description: new FormControl(this.description),
  });

  public cancel(): void {
    this.ref.close();
  }

  public save(): void {
    const newDescription = this.descriptionForm.get('description')?.value || '';
    this.ref.close(newDescription);
  }
}
