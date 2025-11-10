// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { RadioButtonComponent } from '@components/radio-button/radio-button.component';
import { RsvpScope } from '@lfx-one/shared';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

@Component({
  selector: 'lfx-rsvp-scope-modal',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ButtonComponent, RadioButtonComponent],
  templateUrl: './rsvp-scope-modal.component.html',
})
export class RsvpScopeModalComponent {
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);

  public readonly response: string = this.config.data.response;
  public readonly scopeForm = new FormGroup({
    scope: new FormControl<RsvpScope>('all'),
  });

  public readonly scopeOptions = [
    {
      value: 'all' as RsvpScope,
      label: 'All occurrences',
      description: 'RSVP applies to all occurrences of this recurring meeting',
    },
    {
      value: 'single' as RsvpScope,
      label: 'This occurrence only',
      description: 'RSVP applies only to this specific meeting occurrence',
    },
    {
      value: 'this_and_following' as RsvpScope,
      label: 'This and following occurrences',
      description: 'RSVP applies to this occurrence and all future occurrences',
    },
  ];

  public onCancel(): void {
    this.dialogRef.close({ confirmed: false });
  }

  public onConfirm(): void {
    this.dialogRef.close({ confirmed: true, scope: this.scopeForm.controls.scope.value });
  }
}
