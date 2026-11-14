// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { RadioButtonComponent } from '@components/radio-button/radio-button.component';
import { RsvpScope } from '@lfx-one/shared';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

@Component({
  selector: 'lfx-rsvp-scope-modal',
  imports: [NgClass, ReactiveFormsModule, ButtonComponent, RadioButtonComponent],
  templateUrl: './rsvp-scope-modal.component.html',
})
export class RsvpScopeModalComponent {
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);

  public readonly response: string = this.config.data.response;
  public readonly occurrenceLabel: string | null = this.config.data.occurrenceLabel ?? null;
  public readonly canSelectOccurrence: boolean = !!this.config.data.canSelectOccurrence && !!this.occurrenceLabel;
  public readonly scopeForm = new FormGroup({
    scope: new FormControl<RsvpScope>(this.canSelectOccurrence ? 'single' : 'all', { nonNullable: true }),
  });

  public readonly scopeOptions = [
    ...(this.canSelectOccurrence
      ? [{ value: 'single' as RsvpScope, label: 'This date only', description: `${this.occurrenceLabel} only. Other dates keep their current response.` }]
      : []),
    {
      value: 'all' as RsvpScope,
      label: 'All dates',
      description: 'Apply this response to every date in this recurring meeting.',
    },
    ...(this.canSelectOccurrence
      ? [
          {
            value: 'this_and_following' as RsvpScope,
            label: 'This date and all following dates',
            description: `From ${this.occurrenceLabel} onward. Earlier dates keep their current response.`,
          },
        ]
      : []),
  ];

  public onCancel(): void {
    this.dialogRef.close({ confirmed: false });
  }

  public onConfirm(): void {
    const scope = this.scopeForm.controls.scope.value;
    if (scope !== 'all' && !this.canSelectOccurrence) {
      return;
    }
    this.dialogRef.close({ confirmed: true, scope });
  }
}
