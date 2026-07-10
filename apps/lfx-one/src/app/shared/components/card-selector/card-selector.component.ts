// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, computed, ElementRef, input, output, QueryList, ViewChildren } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { CardSelectorOption } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-card-selector',
  imports: [NgClass, ReactiveFormsModule],
  templateUrl: './card-selector.component.html',
})
export class CardSelectorComponent<T = string> {
  @ViewChildren('radioOption')
  private readonly radioOptions!: QueryList<ElementRef<HTMLElement>>;

  // Inputs
  public readonly options = input.required<CardSelectorOption<T>[]>();
  public readonly form = input.required<FormGroup>();
  public readonly control = input.required<string>();
  public readonly label = input<string>('');
  public readonly required = input<boolean>(false);
  public readonly errorMessage = input<string>('Selection is required');
  public readonly testIdPrefix = input<string>('card-selector');
  public readonly gridColumns = input<number>(1);

  // Output
  public readonly selectionChange = output<T>();

  public readonly labelId = computed(() => `${this.testIdPrefix()}-label`);

  public isSelected(value: T): boolean {
    return this.form().get(this.control())?.value === value;
  }

  public hasSelection(): boolean {
    const value = this.form().get(this.control())?.value;
    return this.options().some((option) => option.value === value);
  }

  public getTabIndex(index: number, value: T): number {
    if (this.isSelected(value)) {
      return 0;
    }

    return !this.hasSelection() && index === 0 ? 0 : -1;
  }

  // Handle selection
  public onSelect(value: T): void {
    this.form().get(this.control())?.setValue(value);
    this.form().get(this.control())?.markAsTouched();
    this.selectionChange.emit(value);
  }

  public onKeydown(event: KeyboardEvent, value: T): void {
    const options = this.options();
    const currentIndex = options.findIndex((option) => option.value === this.form().get(this.control())?.value);

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.onSelect(value);
      return;
    }

    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % options.length;
      this.onSelect(options[nextIndex].value);
      this.focusOptionAt(nextIndex);
      return;
    }

    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      const nextIndex = currentIndex < 0 ? options.length - 1 : (currentIndex - 1 + options.length) % options.length;
      this.onSelect(options[nextIndex].value);
      this.focusOptionAt(nextIndex);
    }
  }

  private focusOptionAt(index: number): void {
    queueMicrotask(() => {
      this.radioOptions.get(index)?.nativeElement.focus();
    });
  }
}
