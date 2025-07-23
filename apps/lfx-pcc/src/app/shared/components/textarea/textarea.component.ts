// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, Signal } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { TextareaModule } from 'primeng/textarea';

@Component({
  selector: 'lfx-textarea',
  standalone: true,
  imports: [TextareaModule, ReactiveFormsModule],
  templateUrl: './textarea.component.html',
})
export class TextareaComponent {
  public form = input.required<FormGroup>();
  public control = input.required<string>();
  public size: Signal<'small' | 'large'> = input<'large' | 'small'>('small');
  public rows = input<number>(3);
  public cols = input<number>();
  public placeholder = input<string>();
  public id = input<string>();
  public readonly = input<boolean>(false);
  public styleClass = input<string>();
  public autoResize = input<boolean>(true);
  public maxlength = input<number>();
  public dataTest = input<string>();
}
