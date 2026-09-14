// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { CheckboxModule } from 'primeng/checkbox';

@Component({
  selector: 'lfx-checkbox',
  imports: [CheckboxModule, ReactiveFormsModule],
  templateUrl: './checkbox.component.html',
})
export class CheckboxComponent {
  public readonly form = input.required<FormGroup>();
  public readonly control = input.required<string>();
  public readonly inputId = input<string>();
  /** Id of the element naming this checkbox — use when the consent text is richer than `label` allows. */
  public readonly ariaLabelledBy = input<string>();
  /**
   * Id of the element carrying the terms this checkbox affirms, for a label that does not stand
   * alone. `p-checkbox` has no `ariaDescribedBy` of its own, so this is applied to the rendered
   * input through `pt`.
   */
  public readonly ariaDescribedBy = input<string>();
  public readonly label = input<string>('');
  public readonly binary = input<boolean>(true);
  public readonly disabled = input<boolean>(false);
  public readonly styleClass = input<string>('');
  public readonly labelClass = input<string>('');
}
