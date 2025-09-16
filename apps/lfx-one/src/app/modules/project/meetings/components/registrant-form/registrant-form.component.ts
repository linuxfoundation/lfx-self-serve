// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, input } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { CheckboxComponent } from '@components/checkbox/checkbox.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { MeetingRegistrant } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-registrant-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, InputTextComponent, CheckboxComponent],
  templateUrl: './registrant-form.component.html',
})
export class RegistrantFormComponent {
  // Inputs
  public form = input.required<FormGroup>();
  public registrant = input<MeetingRegistrant | null>(null);
}
