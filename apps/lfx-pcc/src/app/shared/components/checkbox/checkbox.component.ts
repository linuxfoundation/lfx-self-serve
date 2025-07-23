// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, input } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { CheckboxModule } from 'primeng/checkbox';

@Component({
  selector: 'lfx-checkbox',
  standalone: true,
  imports: [CommonModule, CheckboxModule, ReactiveFormsModule],
  templateUrl: './checkbox.component.html',
})
export class CheckboxComponent {
  public readonly form = input.required<FormGroup>();
  public readonly control = input.required<string>();
  public readonly label = input<string>('');
  public readonly binary = input<boolean>(true);
  public readonly disabled = input<boolean>(false);
}
