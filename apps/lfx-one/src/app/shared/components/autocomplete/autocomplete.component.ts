// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, ContentChild, input, output, Signal, TemplateRef } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { AutoCompleteCompleteEvent, AutoCompleteModule, AutoCompleteSelectEvent } from 'primeng/autocomplete';

@Component({
  selector: 'lfx-autocomplete',
  imports: [NgTemplateOutlet, AutoCompleteModule, ReactiveFormsModule],
  templateUrl: './autocomplete.component.html',
  styleUrl: './autocomplete.component.scss',
})
export class AutocompleteComponent {
  // Template reference for content projection
  @ContentChild('empty', { static: false, descendants: false }) public emptyTemplate?: TemplateRef<any>;
  @ContentChild('item', { static: false, descendants: false }) public itemTemplate?: TemplateRef<any>;
  @ContentChild('footer', { static: false, descendants: false }) public footerTemplate?: TemplateRef<any>;

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
  public appendTo = input<any>(undefined);
  public dropdown = input<boolean>(false);
  public dropdownMode = input<'blank' | 'current'>('blank');
  public dataKey = input<string>();
  public showClear = input<boolean>(false);
  public forceSelection = input<boolean>(false);

  public readonly completeMethod = output<AutoCompleteCompleteEvent>();
  public readonly onSelect = output<AutoCompleteSelectEvent>();
  public readonly onClear = output<void>();

  // Computed style class that includes dropdown-mode and has-clear when applicable
  public readonly computedStyleClass: Signal<string> = this.initComputedStyleClass();

  public searchCompleted(event: AutoCompleteCompleteEvent): void {
    this.completeMethod.emit(event);
  }

  public optionSelected(event: AutoCompleteSelectEvent): void {
    this.onSelect.emit(event);
  }

  private initComputedStyleClass(): Signal<string> {
    return computed(() => {
      const classes: string[] = [];

      if (this.styleClass()) {
        classes.push(this.styleClass()!);
      }

      if (this.dropdown()) {
        classes.push('dropdown-mode');
      }

      if (this.showClear()) {
        classes.push('has-clear');
      }

      return classes.join(' ');
    });
  }
}
