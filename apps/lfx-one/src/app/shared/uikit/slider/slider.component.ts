// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { booleanAttribute, ChangeDetectionStrategy, Component, computed, inject, input, model, numberAttribute, Signal, signal } from '@angular/core';
import { ControlValueAccessor, NgControl } from '@angular/forms';

/**
 * Picks one number from a continuous range. Built on a native range input, so the browser supplies the
 * slider role, the value attributes, arrow keys (step), Page Up and Page Down (larger step), Home and End,
 * and pointer drag. The current value is always shown next to the label. Works with `[(value)]` and Angular forms.
 */
@Component({
  selector: 'lfx-ui-slider',
  templateUrl: './slider.component.html',
  styleUrl: './slider.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block min-w-0' },
})
export class UiSliderComponent implements ControlValueAccessor {
  private static nextId = 0;

  /** Visible label. It names the slider for assistive technology. */
  public readonly label = input.required<string>();
  /** Smallest value. */
  public readonly min = input<number, unknown>(0, { transform: numberAttribute });
  /** Largest value. */
  public readonly max = input<number, unknown>(100, { transform: numberAttribute });
  /** Distance between allowed values. */
  public readonly step = input<number, unknown>(1, { transform: numberAttribute });
  /** Text for the value when it has a unit, such as `60%` or `5 GB`. Also sets `aria-valuetext`. Defaults to the number. */
  public readonly valueText = input<string>('');
  /** Disables the slider. Forms can also disable it. */
  public readonly disabled = input<boolean, unknown>(false, { transform: booleanAttribute });
  /** The current value. Supports two-way binding with `[(value)]`. */
  public readonly value = model<number>(0);

  protected readonly inputId = `lfx-ui-slider-${UiSliderComponent.nextId++}`;
  protected readonly formDisabled = signal(false);
  protected readonly isDisabled: Signal<boolean> = computed(() => this.disabled() || this.formDisabled());
  protected readonly clamped: Signal<number> = computed(() => Math.min(Math.max(this.value(), this.min()), this.max()));
  /** Share of the track to fill, 0 to 100. */
  protected readonly percent: Signal<number> = this.initPercent();
  protected readonly displayValue: Signal<string> = computed(() => this.valueText() || String(this.clamped()));

  private readonly ngControl = inject(NgControl, { self: true, optional: true });
  private onChange: ((value: number) => void) | null = null;
  private onTouched: (() => void) | null = null;

  public constructor() {
    if (this.ngControl) this.ngControl.valueAccessor = this;
  }

  public writeValue(value: number | null): void {
    this.value.set(value ?? this.min());
  }

  public registerOnChange(fn: (value: number) => void): void {
    this.onChange = fn;
  }

  public registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  public setDisabledState(isDisabled: boolean): void {
    this.formDisabled.set(isDisabled);
  }

  protected onInput(event: Event): void {
    const next = Number((event.target as HTMLInputElement).value);
    this.value.set(next);
    this.onChange?.(next);
  }

  protected onBlur(): void {
    this.onTouched?.();
  }

  private initPercent(): Signal<number> {
    return computed(() => {
      const span = this.max() - this.min();
      return span > 0 ? ((this.clamped() - this.min()) / span) * 100 : 0;
    });
  }
}
