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
  /** Id applied to the focusable input — pair with an external `<label for>`. Prefer this over `id` so the host does not get a duplicate id. */
  public inputId = input<string>();
  public size = input<'large' | 'small'>();
  public placeholder = input<string>();
  public class = input<string>();
  public autocomplete = input<string>();
  public dataTest = input<string>();
  public icon = input<string>();
  public styleClass = input<string>();
  public readonly = input<boolean>(false);
  /**
   * Native character cap on the input, or `null` for no cap.
   * @description Nullable so a caller can turn the cap on and off from a signal:
   * `[attr.maxlength]` drops the attribute for a nullish value, which is what lifting the cap
   * has to do. Leaving it out entirely means the same thing.
   */
  public maxlength = input<number | null>();
  /** Id of the element describing this input (e.g. its error message) — wired to `aria-describedby`. */
  public describedBy = input<string | null>();
  /** Marks the control invalid for assistive tech; the visible error text is the caller's. */
  public invalid = input<boolean>(false);
}
