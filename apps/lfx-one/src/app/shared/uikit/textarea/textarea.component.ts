// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { _IdGenerator } from '@angular/cdk/a11y';
import { isPlatformBrowser } from '@angular/common';
import {
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  model,
  numberAttribute,
  PLATFORM_ID,
  Signal,
  signal,
} from '@angular/core';
import { COMPOSITION_BUFFER_MODE, ControlValueAccessor, NgControl } from '@angular/forms';

import { UiErrorComponent } from '../error/error.component';

/**
 * Multi-line text field with an optional label, hint and error, using the same ring, focus halo and error look as `lfx-ui-input`.
 * Works with `[(value)]` and with Angular forms (`formControlName`, `formControl`). An error replaces the hint
 * and is linked to the field with `aria-describedby`. Put a limit such as "280 characters left" in the `hint`.
 */
@Component({
  selector: 'lfx-ui-textarea',
  imports: [UiErrorComponent],
  templateUrl: './textarea.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block min-w-0' },
})
export class UiTextareaComponent implements ControlValueAccessor {
  private readonly baseId = inject(_IdGenerator).getId('lfx-ui-textarea-');
  private readonly ngControl = inject(NgControl, { self: true, optional: true });
  private readonly platformId = inject(PLATFORM_ID);
  // Same default as Angular's DefaultValueAccessor: Android keyboards wrap ordinary typing in composition events, so buffering would lag a word behind.
  private readonly bufferComposition: boolean =
    inject(COMPOSITION_BUFFER_MODE, { optional: true }) ?? !(isPlatformBrowser(this.platformId) && /android (\d+)/.test(navigator.userAgent.toLowerCase()));

  /** Visible label above the field. Without one, set `ariaLabel`. */
  public readonly label = input<string>('');
  /** Accessible name when there is no visible label. */
  public readonly ariaLabel = input<string>('');
  /** Helper text under the field. Hidden while an error shows. */
  public readonly hint = input<string>('');
  /** Error message under the field, phrased as how to fix the value. Marks the field invalid. */
  public readonly error = input<string>('');
  /** Placeholder text. */
  public readonly placeholder = input<string>('');
  /** Disables the field. Forms can also disable it. */
  public readonly disabled = input<boolean, unknown>(false, { transform: booleanAttribute });
  /** Marks the field as required for assistive technology. */
  public readonly required = input<boolean, unknown>(false, { transform: booleanAttribute });
  /** Native `maxlength`: the browser stops typing at this many characters. Leave unset for no limit, and say the limit in `hint`. */
  public readonly maxlength = input<number | null, unknown>(null, { transform: (v: unknown) => numberAttribute(v, -1) });
  /** Native `autocomplete` token. Empty leaves the browser default. */
  public readonly autocomplete = input<string>('');
  /** The current text. Supports two-way binding with `[(value)]`. */
  public readonly value = model<string>('');

  protected readonly textareaId = this.baseId;
  protected readonly hintId = `${this.textareaId}-hint`;
  protected readonly errorId = `${this.textareaId}-error`;
  protected readonly formDisabled = signal(false);
  protected readonly isDisabled: Signal<boolean> = computed(() => this.disabled() || this.formDisabled());
  protected readonly limit: Signal<number | null> = computed(() => {
    const max = this.maxlength();
    return max !== null && max >= 0 ? max : null;
  });
  protected readonly describedBy: Signal<string | null> = computed(() => {
    if (this.error()) return this.errorId;
    return this.hint() ? this.hintId : null;
  });
  protected readonly textareaClasses: Signal<string> = this.initTextareaClasses();

  private onChange: ((value: string) => void) | null = null;
  private onTouched: (() => void) | null = null;
  private composing = false;

  public constructor() {
    if (this.ngControl) this.ngControl.valueAccessor = this;
  }

  public writeValue(value: string | null): void {
    this.value.set(value ?? '');
  }

  public registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  public registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  public setDisabledState(isDisabled: boolean): void {
    this.formDisabled.set(isDisabled);
  }

  protected onInput(event: Event): void {
    // Hold back uncommitted IME text; compositionend emits the final value.
    if (this.composing) return;
    this.emit((event.target as HTMLTextAreaElement).value);
  }

  protected onCompositionStart(): void {
    this.composing = this.bufferComposition;
  }

  protected onCompositionEnd(event: Event): void {
    const buffered = this.composing;
    this.composing = false;
    // Only a buffered composition has anything left to emit; otherwise every input event already did.
    if (buffered) this.emit((event.target as HTMLTextAreaElement).value);
  }

  protected onBlur(): void {
    this.onTouched?.();
  }

  private emit(next: string): void {
    this.value.set(next);
    this.onChange?.(next);
  }

  private initTextareaClasses(): Signal<string> {
    return computed(() => {
      // Library recipe (same as Input): 1px ring at rest, stronger ring plus a 4px halo on focus (accent) or error (danger).
      const dangerHalo = 'shadow-[0_0_0_1px_theme(colors.ui.danger.700),0_0_0_4px_theme(colors.ui.danger.200)]';
      const interactive = '[&:hover:not(:focus)]:edge-hover focus:shadow-[0_0_0_1px_theme(colors.ui.accent.500),0_0_0_4px_theme(colors.ui.accent.100)]';
      // A disabled field keeps the resting ring only, so it does not look interactive on hover.
      const rest = this.isDisabled() ? 'edge' : `edge ${interactive}`;
      // Library keeps one danger look focused or not, so no focus variant on an invalid field.
      const ring = this.error() ? dangerHalo : rest;
      const fill = this.isDisabled() ? 'bg-ui-neutral-50 text-ui-neutral-500 cursor-not-allowed' : 'bg-ui-background-100 text-ui-neutral-900';
      // forced-colors: shadows vanish, so a real border keeps the field visible and an outline marks focus.
      const border = this.isDisabled() ? 'forced-colors:border-[color:GrayText]' : 'forced-colors:border-[color:CanvasText]';
      const forced = `forced-colors:border ${border} forced-colors:focus:outline forced-colors:focus:outline-2 forced-colors:focus:outline-offset-2 forced-colors:focus:outline-[color:Highlight]`;
      // Exact px (14px root): 80px minimum height, 10px by 12px padding.
      return `block w-full min-h-[80px] resize-y rounded-ui-sm px-[12px] py-[10px] copy-14 outline-none placeholder:text-ui-neutral-500 transition-shadow duration-ui-base ease-ui-standard motion-reduce:transition-none ${fill} ${ring} ${forced}`;
    });
  }
}
