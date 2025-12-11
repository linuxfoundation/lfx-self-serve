// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';

@Component({
  selector: 'lfx-guest-form',
  imports: [ReactiveFormsModule, InputTextComponent, ButtonComponent],
  templateUrl: './guest-form.component.html',
})
export class GuestFormComponent {
  // Inputs
  public form = input.required<FormGroup>();
  public joinUrl = input<string | undefined>(undefined);
  public isLoading = input<boolean>(false);
  public showSubmitButton = input<boolean>(true);
  public submitButtonLabel = input<string>('Join Meeting');
}
