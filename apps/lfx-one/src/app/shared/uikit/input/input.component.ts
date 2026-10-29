// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { _IdGenerator } from '@angular/cdk/a11y';
import { booleanAttribute, ChangeDetectionStrategy, Component, computed, inject, input, model, PLATFORM_ID, Signal, signal } from '@angular/core';
import { COMPOSITION_BUFFER_MODE, ControlValueAccessor, NgControl } from '@angular/forms';
import { UiInputMode, UiInputSize, UiInputType } from '@lfx-one/shared/interfaces';

import { UiErrorComponent } from '../error/error.component';

/**
 * Single-line text field with an optional label, hint, error and prefix or suffix (icon or text).
 * Works with `[(value)]` and with Angular forms (`formControlName`, `formControl`). An error replaces the hint
 * and is linked to the field with `aria-describedby`. Validate on blur, not on every keystroke.
 */
@Component({
  selector: 'lfx-ui-input',
  imports: [UiErrorComponent],
  templateUrl: './input.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block min-w-0' },
})
export class UiInputComponent implements ControlValueAccessor {
  private readonly baseId = inject(_IdGenerator).getId('lfx-ui-input-');
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
  /** Native input type. */
  public readonly type = input<UiInputType>('text');
  /** Virtual keyboard hint for a `text` field, for example `numeric` or `decimal`. Empty leaves the browser default. */
  public readonly inputmode = input<UiInputMode | ''>('');
  /** `tiny` 24px, `small` 32px, `medium` 40px. Pair with a button of the same size. */
  public readonly size = input<UiInputSize>('medium');
  /** Pill-shaped corners and 16px side padding. */
  public readonly rounded = input<boolean, unknown>(false, { transform: booleanAttribute });
  /** Disables the field. Forms can also disable it. */
  public readonly disabled = input<boolean, unknown>(false, { transform: booleanAttribute });
  /** Marks the field as required for assistive technology. */
  public readonly required = input<boolean, unknown>(false, { transform: booleanAttribute });
  /** Native `autocomplete` token, for example `email`. Empty leaves the browser default, so autofill and password managers keep working. */
  public readonly autocomplete = input<string>('');
  /** Font Awesome class string for a leading icon, e.g. `fa-light fa-link`. */
  public readonly prefixIcon = input<string>('');
  /** Leading text such as `https://`. Shown after the icon when both are set. */
  public readonly prefixText = input<string>('');
  /** Font Awesome class string for a trailing icon. */
  public readonly suffixIcon = input<string>('');
  /** Trailing text such as a unit. */
  public readonly suffixText = input<string>('');
  /** Gives the prefix and suffix a grey well with a divider. */
  public readonly affixStyled = input<boolean, unknown>(false, { transform: booleanAttribute });
  /** The current text. Supports two-way binding with `[(value)]`. */
  public readonly value = model<string>('');

  protected readonly inputId = this.baseId;
  protected readonly hintId = `${this.inputId}-hint`;
  protected readonly errorId = `${this.inputId}-error`;
  protected readonly prefixId = `${this.inputId}-prefix`;
  protected readonly suffixId = `${this.inputId}-suffix`;
  protected readonly formDisabled = signal(false);
  protected readonly isDisabled: Signal<boolean> = computed(() => this.disabled() || this.formDisabled());
  protected readonly hasPrefix: Signal<boolean> = computed(() => !!(this.prefixIcon() || this.prefixText()));
  protected readonly hasSuffix: Signal<boolean> = computed(() => !!(this.suffixIcon() || this.suffixText()));
  protected readonly describedBy: Signal<string | null> = this.initDescribedBy();
  protected readonly wrapperClasses: Signal<string> = this.initWrapperClasses();
  protected readonly inputClasses: Signal<string> = this.initInputClasses();
  protected readonly prefixClasses: Signal<string> = this.initAffixClasses('prefix');
  protected readonly suffixClasses: Signal<string> = this.initAffixClasses('suffix');

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
    this.emit((event.target as HTMLInputElement).value);
  }

  protected onCompositionStart(): void {
    this.composing = this.bufferComposition;
  }

  protected onCompositionEnd(event: Event): void {
    this.composing = false;
    this.emit((event.target as HTMLInputElement).value);
  }

  protected onBlur(): void {
    this.onTouched?.();
  }

  private emit(next: string): void {
    this.value.set(next);
    this.onChange?.(next);
  }

  private initDescribedBy(): Signal<string | null> {
    return computed(() => {
      // Affix text is part of what the value means (https://, USD), so it is read with the message.
      const hintId = this.hint() ? this.hintId : '';
      const message = this.error() ? this.errorId : hintId;
      const ids = [this.prefixText() ? this.prefixId : '', this.suffixText() ? this.suffixId : '', message].filter(Boolean);
      return ids.length ? ids.join(' ') : null;
    });
  }

  private initWrapperClasses(): Signal<string> {
    return computed(() => {
      // Library recipe: 1px ring at rest, stronger ring plus a 4px halo on focus (accent) or error (danger).
      const dangerHalo = 'shadow-[0_0_0_1px_theme(colors.ui.danger.700),0_0_0_4px_theme(colors.ui.danger.200)]';
      const rest =
        'edge [&:hover:not(:focus-within)]:edge-hover focus-within:shadow-[0_0_0_1px_theme(colors.ui.accent.500),0_0_0_4px_theme(colors.ui.accent.100)]';
      const ring = this.error() ? dangerHalo : rest;
      // forced-colors: shadows vanish, so a real border keeps the field visible and an outline on the wrapper (not clipped by it) marks focus.
      const forced = `forced-colors:border ${this.isDisabled() ? 'forced-colors:border-[color:GrayText]' : 'forced-colors:border-[color:CanvasText]'} forced-colors:focus-within:outline forced-colors:focus-within:outline-2 forced-colors:focus-within:outline-offset-2 forced-colors:focus-within:outline-[color:Highlight]`;
      const heights = { tiny: 'h-ui-tiny', small: 'h-ui-small', medium: 'h-ui-medium' };
      // Exact px radii (8 and 10px have no token); 14px root.
      const radii = { tiny: 'rounded-[8px]', small: 'rounded-[10px]', medium: 'rounded-ui-sm' };
      const shape = `${heights[this.size()]} ${this.rounded() ? 'rounded-ui-full' : radii[this.size()]}`;
      const fill = this.isDisabled() ? 'bg-ui-neutral-50 cursor-not-allowed' : 'bg-ui-background-100';
      return `flex w-full items-stretch overflow-hidden text-ui-neutral-900 transition-shadow duration-ui-base ease-ui-standard motion-reduce:transition-none ${shape} ${fill} ${ring} ${forced}`;
    });
  }

  private initInputClasses(): Signal<string> {
    return computed(() => {
      // Exact px side padding per size, 16px when rounded; zero on the side next to an unstyled affix, which carries the gap.
      const sides = { tiny: 'px-[8px]', small: 'px-[10px]', medium: 'px-[12px]' };
      const pad = this.rounded() ? 'px-[16px]' : sides[this.size()];
      const left = this.hasPrefix() && !this.affixStyled() ? 'pl-0' : '';
      const right = this.hasSuffix() && !this.affixStyled() ? 'pr-0' : '';
      const text = this.size() === 'tiny' ? 'label-12' : 'label-14';
      return `min-w-0 flex-1 bg-transparent outline-none text-ui-neutral-900 placeholder:text-ui-neutral-500 disabled:cursor-not-allowed disabled:text-ui-neutral-500 ${text} ${pad} ${left} ${right}`;
    });
  }

  private initAffixClasses(side: 'prefix' | 'suffix'): Signal<string> {
    return computed(() => {
      // Exact px gaps per size; 14px root.
      const pad = { tiny: 'px-[8px]', small: 'px-[10px]', medium: 'px-[12px]' }[this.size()];
      const edge = {
        prefix: { tiny: 'pr-[4px]', small: 'pr-[6px]', medium: 'pr-[8px]' },
        suffix: { tiny: 'pl-[6px]', small: 'pl-[8px]', medium: 'pl-[8px]' },
      }[side][this.size()];
      const text = this.size() === 'tiny' ? 'label-12' : 'label-14';
      const styled = this.affixStyled();
      const tone = styled ? 'bg-ui-background-200 text-ui-neutral-600' : 'text-ui-neutral-500';
      const dividers = {
        prefix: 'shadow-[inset_-1px_0_0_theme(colors.ui.neutral-alpha.200)]',
        suffix: 'shadow-[inset_1px_0_0_theme(colors.ui.neutral-alpha.200)]',
      };
      const divider = styled ? dividers[side] : '';
      // A styled prefix keeps full padding; an unstyled one trades its right padding for the gap to the text.
      const spacing = styled && side === 'prefix' ? pad : `${pad} ${edge}`;
      return `flex shrink-0 items-center gap-[6px] whitespace-nowrap ${text} ${tone} ${divider} ${spacing}`;
    });
  }
}
