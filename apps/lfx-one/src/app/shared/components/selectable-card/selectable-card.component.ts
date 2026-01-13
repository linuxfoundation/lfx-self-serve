// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, computed, input, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { of, startWith, switchMap } from 'rxjs';

@Component({
  selector: 'lfx-selectable-card',
  imports: [NgClass, ReactiveFormsModule],
  templateUrl: './selectable-card.component.html',
})
export class SelectableCardComponent {
  // === Inputs ===
  public readonly form = input.required<FormGroup>();
  public readonly control = input.required<string>();
  public readonly value = input<string>();
  public readonly label = input.required<string>();
  public readonly toggle = input<boolean>(false);
  public readonly styleClass = input<string>('');
  public readonly testId = input<string>('');

  // === Computed Signals ===
  private readonly controlValue: Signal<unknown> = this.initControlValue();
  protected readonly isSelected: Signal<boolean> = this.initIsSelected();
  protected readonly isDisabled: Signal<boolean> = this.initIsDisabled();

  // === Protected Methods ===
  protected onCardClick(): void {
    if (this.isDisabled()) return;

    const formGroup = this.form();
    const controlName = this.control();
    const targetValue = this.value();
    const isToggle = this.toggle();
    const formControl = formGroup.get(controlName);

    if (!formControl) return;

    if (isToggle) {
      formControl.setValue(!formControl.value);
    } else if (targetValue !== undefined) {
      formControl.setValue(targetValue);
    }
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (!this.isDisabled() && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      this.onCardClick();
    }
  }

  // === Private Initializers ===
  private initControlValue(): Signal<unknown> {
    const formControl$ = toObservable(computed(() => this.form().get(this.control())));

    return toSignal(
      formControl$.pipe(
        switchMap((formControl) => {
          if (!formControl) {
            return of(null);
          }
          return formControl.valueChanges.pipe(startWith(formControl.value));
        })
      ),
      { initialValue: null }
    );
  }

  private initIsSelected(): Signal<boolean> {
    return computed(() => {
      const targetValue = this.value();
      const isToggle = this.toggle();
      const currentValue = this.controlValue();

      if (isToggle) {
        return currentValue === true;
      }
      return currentValue === targetValue;
    });
  }

  private initIsDisabled(): Signal<boolean> {
    return computed(() => {
      const formGroup = this.form();
      const controlName = this.control();
      return formGroup.get(controlName)?.disabled ?? false;
    });
  }
}
