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
  public maxlength = input<number>();
  /** Id of the element describing this input (e.g. its error message) — wired to `aria-describedby`. */
  public describedBy = input<string>();
  /** Marks the control invalid for assistive tech; the visible error text is the caller's. */
  public invalid = input<boolean>(false);

  /**
   * Combobox wiring, for the typeahead pickers that put a results list under this field.
   *
   * These belong on the `<input>` and nowhere else. `aria-activedescendant` in particular is read
   * from the element that holds focus, and focus stays in the text box while the arrow keys move
   * a highlight through the list — so the same attribute placed on the list container, which is
   * never focused, announces nothing at all. That is a silent failure: the highlight looks right
   * on screen and a screen reader hears none of it.
   *
   * All optional and null by default, so a field that is not a combobox emits no ARIA it has no
   * business claiming.
   */
  public role = input<string>();
  public ariaControls = input<string>();
  public ariaActivedescendant = input<string | null>();
  public ariaExpanded = input<boolean>();
  public ariaAutocomplete = input<string>();
}
