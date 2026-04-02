// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { SelectComponent } from '@components/select/select.component';
import { EditChairsDialogData } from '@lfx-one/shared/interfaces';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

@Component({
  selector: 'lfx-edit-chairs-dialog',
  standalone: true,
  imports: [ReactiveFormsModule, ButtonComponent, SelectComponent],
  templateUrl: './edit-chairs-dialog.component.html',
})
export class EditChairsDialogComponent {
  private readonly config = inject(DynamicDialogConfig<EditChairsDialogData>);
  private readonly ref = inject(DynamicDialogRef);

  public readonly memberOptions = this.config.data.members;

  public chairsForm = new FormGroup({
    chairUid: new FormControl<string | null>(this.config.data.currentChairUid),
    viceChairUid: new FormControl<string | null>(this.config.data.currentViceChairUid),
  });

  public cancel(): void {
    this.ref.close();
  }

  public save(): void {
    this.ref.close({
      chairUid: this.chairsForm.get('chairUid')?.value ?? null,
      viceChairUid: this.chairsForm.get('viceChairUid')?.value ?? null,
    });
  }
}
