// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MultiSelectModule } from 'primeng/multiselect';

@Component({
  selector: 'lfx-multi-select',
  imports: [MultiSelectModule, ReactiveFormsModule],
  templateUrl: './multi-select.component.html',
  styleUrl: './multi-select.component.scss',
})
export class MultiSelectComponent {
  public readonly form = input.required<FormGroup>();
  public readonly control = input.required<string>();
  public readonly options = input.required<any[]>();
  public readonly optionLabel = input<string>('label');
  public readonly optionValue = input<string>('value');
  // Optional secondary label shown beneath the main label in the dropdown
  // list. Selected chips still show only optionLabel. When undefined the
  // dropdown renders default p-multiSelect items.
  public readonly optionSubLabel = input<string | undefined>(undefined);
  public readonly placeholder = input<string>('Select');
  public readonly showToggleAll = input<boolean>(true);
  public readonly appendTo = input<any>('body');
  public readonly filter = input<boolean>(true);
  public readonly filterPlaceHolder = input<string>('Search');
  public readonly size = input<'small' | 'large'>('small');
  public readonly styleClass = input<string>('w-full');
}
