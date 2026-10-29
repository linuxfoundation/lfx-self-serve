// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';

/** Pill-shaped search field, 34px tall, with a leading search icon. Use `[(value)]` for two-way binding. */
@Component({
  selector: 'lfx-ui-search-input',
  templateUrl: './search-input.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // min() keeps the 300px default from overflowing a narrow container.
  host: { class: 'block min-w-[min(300px,100%)]' },
})
export class UiSearchInputComponent {
  /** Placeholder text. */
  public readonly placeholder = input<string>('Search');
  /** Accessible name for the field. */
  public readonly ariaLabel = input<string>('Search');
  /** Disables the field. */
  public readonly disabled = input<boolean>(false);
  /** The current text. Supports two-way binding with `[(value)]`. */
  public readonly value = model<string>('');

  protected onInput(event: Event): void {
    this.value.set((event.target as HTMLInputElement).value);
  }
}
