// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgTemplateOutlet } from '@angular/common';
import { afterRenderEffect, Component, computed, ContentChild, ElementRef, inject, input, output, Renderer2, Signal, TemplateRef } from '@angular/core';
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

  private readonly renderer = inject(Renderer2);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

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
  public inputId = input<string>();
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
  public readonly = input<boolean>(false);
  public forceSelection = input<boolean>(false);
  public showEmptyMessage = input<boolean>(true);
  public size = input<'small' | 'large'>('small');
  // Forwarded to p-autocomplete's [optionDisabled]: the name of a boolean field on each suggestion
  // (or a resolver), so a caller can list a row that is visible but not selectable — e.g. a pending
  // invitee in a scoped people picker (#2594).
  public optionDisabled = input<string | ((item: unknown) => string) | undefined>(undefined);
  // The id(s) of the message describing the field's current error, and whether it is in error —
  // the same pair `lfx-input-text` takes, so a form can wire an autocomplete's error message the
  // way it wires a text input's.
  public describedBy = input<string | undefined>();
  public invalid = input<boolean>(false);

  public readonly completeMethod = output<AutoCompleteCompleteEvent>();
  public readonly onSelect = output<AutoCompleteSelectEvent>();
  public readonly onClear = output<void>();
  public readonly onBlur = output<void>();

  // Computed style class that includes dropdown-mode and has-clear when applicable
  public readonly computedStyleClass: Signal<string> = this.initComputedStyleClass();

  public constructor() {
    // PrimeNG styles an invalid autocomplete (`[invalid]`, below) but sets neither aria attribute
    // on its native input and takes no described-by at all, so both land on that input here. An
    // after-render effect, not a component effect: PrimeNG's own input reference is a plain view
    // query that a component effect can visit before it exists and then never revisit. After
    // render the input is in the DOM, and the effect re-runs whenever either input changes.
    // Browser-only by construction (after-render hooks never run on the server), which is where
    // the attributes matter.
    afterRenderEffect(() => {
      const inputElement = this.host.nativeElement.querySelector('input');
      if (!inputElement) {
        return;
      }

      const describedBy = this.describedBy();
      if (describedBy) {
        this.renderer.setAttribute(inputElement, 'aria-describedby', describedBy);
      } else {
        this.renderer.removeAttribute(inputElement, 'aria-describedby');
      }

      if (this.invalid()) {
        this.renderer.setAttribute(inputElement, 'aria-invalid', 'true');
      } else {
        this.renderer.removeAttribute(inputElement, 'aria-invalid');
      }
    });
  }

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
