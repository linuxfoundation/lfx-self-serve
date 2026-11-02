// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { booleanAttribute, ChangeDetectionStrategy, Component, ElementRef, inject, input, model } from '@angular/core';

import { UiInputComponent } from '../input/input.component';

/**
 * Pill-shaped search field, 32px tall, built on `lfx-ui-input`: a search icon prefix, `type="search"` and a clear button
 * that shows while there is text. Use `[(value)]` for two-way binding.
 */
@Component({
  selector: 'lfx-ui-search-input',
  imports: [UiInputComponent],
  templateUrl: './search-input.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // min() keeps the 300px default from overflowing a narrow container.
  host: { class: 'block min-w-[min(300px,100%)]' },
})
export class UiSearchInputComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Placeholder text. */
  public readonly placeholder = input<string>('Search');
  /** Accessible name for the field. */
  public readonly ariaLabel = input<string>('Search');
  /** Disables the field. */
  public readonly disabled = input<boolean, unknown>(false, { transform: booleanAttribute });
  /** The current text. Supports two-way binding with `[(value)]`. */
  public readonly value = model<string>('');

  /** Esc clears the text and keeps the event from closing an enclosing dialog; with no text the event passes through. */
  protected onEscape(event: Event): void {
    // Esc during IME composition cancels the composition only; keep the committed text and the dialog.
    if ((event as KeyboardEvent).isComposing) {
      event.stopPropagation();
      return;
    }
    if (!this.value()) return;
    event.preventDefault();
    event.stopPropagation();
    this.clear();
  }

  protected clear(): void {
    this.value.set('');
    // The clear button leaves the page with the text, so hand focus back to the field.
    this.host.nativeElement.querySelector('input')?.focus();
  }
}
