// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, Signal } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { TextareaModule } from 'primeng/textarea';

@Component({
  selector: 'lfx-textarea',
  imports: [TextareaModule, ReactiveFormsModule],
  templateUrl: './textarea.component.html',
  styleUrl: './textarea.component.scss',
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
  public autoResize = input<boolean>(false);
  /**
   * Native character cap on the `<textarea>`. Bound as `[attr.maxlength]`, not `[maxlength]`:
   * Angular's `MaxLengthValidator` has selector `[maxlength][formControlName]` and ships in the
   * `ReactiveFormsModule` this component imports, so a property binding here would silently attach
   * a validator to the caller's control and make the whole `FormGroup` invalid — invisible to a
   * caller that only wanted the browser to stop typing at the cap. Callers that want the value
   * gated declare `Validators.maxLength` on the control themselves — as the composer's agenda and
   * the settings description do. The rest rely on the native cap alone, which holds for typing and
   * pasting but not for a value written programmatically with `setValue`.
   */
  public maxlength = input<number>();
  public dataTest = input<string>();
}
