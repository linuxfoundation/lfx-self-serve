// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';

@Component({
  selector: 'lfx-input-text',
  imports: [InputTextModule, ReactiveFormsModule, IconFieldModule, InputIconModule],
  templateUrl: './input-text.component.html',
})
export class InputTextComponent {
  public form = input.required<FormGroup>();
  public control = input.required<string>();
  public type = input<string>();
  public id = input<string>();
  public size = input<'large' | 'small'>();
  public placeholder = input<string>();
  public class = input<string>();
  public autocomplete = input<string>();
  public dataTest = input<string>();
  public icon = input<string>();
  public styleClass = input<string>();
}
