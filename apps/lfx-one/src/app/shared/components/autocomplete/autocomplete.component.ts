// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, output } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { AutoCompleteCompleteEvent, AutoCompleteModule, AutoCompleteSelectEvent } from 'primeng/autocomplete';

@Component({
  selector: 'lfx-autocomplete',
  imports: [AutoCompleteModule, ReactiveFormsModule],
  templateUrl: './autocomplete.component.html',
})
export class AutocompleteComponent {
  public form = input.required<FormGroup>();
  public control = input.required<string>();
  public placeholder = input<string>();
  public suggestions = input<any[]>([]);
  public styleClass = input<string>();
  public inputStyleClass = input<string>();
  public panelStyleClass = input<string>();
  public delay = input<number>(300);
  public minLength = input<number>(1);
  public dataTestId = input<string>();
  public optionLabel = input<string>();
  public optionValue = input<string>();
  public autoOptionFocus = input<boolean>(false);
  public completeOnFocus = input<boolean>(false);
  public autoHighlight = input<boolean>(false);

  public readonly completeMethod = output<AutoCompleteCompleteEvent>();
  public readonly onSelect = output<AutoCompleteSelectEvent>();
  public readonly onClear = output<void>();

  public searchCompleted(event: AutoCompleteCompleteEvent): void {
    this.completeMethod.emit(event);
  }

  public optionSelected(event: AutoCompleteSelectEvent): void {
    this.onSelect.emit(event);
  }
}
