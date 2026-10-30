// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { _IdGenerator } from '@angular/cdk/a11y';
import {
  afterRenderEffect,
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  model,
  numberAttribute,
  Signal,
  signal,
  viewChild,
} from '@angular/core';
import { ControlValueAccessor, NgControl } from '@angular/forms';

/**
 * Picks one number from a continuous range. Built on a native range input, so the browser supplies the
 * slider role, the value attributes, arrow keys (step), Page Up and Page Down (larger step), Home and End,
 * and pointer drag. The current value is always shown next to the label. Works with `[(value)]` and Angular forms.
 * Pass in-range values that sit on a step: the thumb, fill, output and `aria-valuenow` show the value clamped to the
 * range and snapped to the nearest step, and user input emits that snapped value. Setting a value from code never writes back.
 */
@Component({
  selector: 'lfx-ui-slider',
  templateUrl: './slider.component.html',
  styleUrl: './slider.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block min-w-0' },
})
export class UiSliderComponent implements ControlValueAccessor {
  protected readonly inputId = inject(_IdGenerator).getId('lfx-ui-slider-');
  private readonly ngControl = inject(NgControl, { self: true, optional: true });

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

  protected readonly formDisabled = signal(false);
  protected readonly isDisabled: Signal<boolean> = computed(() => this.disabled() || this.formDisabled());
  /** The value as shown: clamped to the range, then snapped to the nearest step from `min` without passing `max`. */
  protected readonly snapped: Signal<number> = this.initSnapped();
  /** Share of the track to fill, 0 to 100. */
  protected readonly percent: Signal<number> = this.initPercent();
  protected readonly displayValue: Signal<string> = computed(() => this.valueText() || String(this.snapped()));

  private readonly range = viewChild.required<ElementRef<HTMLInputElement>>('range');

  private onChange: ((value: number) => void) | null = null;
  private onTouched: (() => void) | null = null;

  public constructor() {
    if (this.ngControl) this.ngControl.valueAccessor = this;
    // The browser re-snaps the native value when min, max or step change, but `[value]` skips an unchanged snapped value; write it after render.
    afterRenderEffect(() => {
      this.min();
      this.max();
      this.step();
      this.range().nativeElement.value = String(this.snapped());
    });
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
    const next = this.snap(Number((event.target as HTMLInputElement).value));
    this.value.set(next);
    this.onChange?.(next);
  }

  protected onBlur(): void {
    this.onTouched?.();
  }

  private initSnapped(): Signal<number> {
    return computed(() => this.snap(this.value()));
  }

  private initPercent(): Signal<number> {
    return computed(() => {
      const span = this.max() - this.min();
      return span > 0 ? ((this.snapped() - this.min()) / span) * 100 : 0;
    });
  }

  /** Clamps to `[min, max]`, then rounds to the nearest step from `min` without passing `max`, trimming binary noise such as 0.30000000000000004. */
  private snap(raw: number): number {
    const { min, max } = { min: this.min(), max: this.max() };
    const step = this.step();
    const clamped = Math.min(Math.max(raw, min), max);
    if (!(step > 0)) return clamped;
    // toExponential keeps 1e-7 from reading as zero decimals, which String() would.
    const decimals = (n: number): number => {
      const [mantissa, exponent] = n.toExponential().split('e');
      return Math.max(0, (mantissa.split('.')[1] ?? '').length - Number(exponent));
    };
    const precision = Math.max(decimals(step), decimals(min));
    const at = (count: number): number => Number((count * step + min).toFixed(precision));
    const count = Math.round((clamped - min) / step);
    // Like the native range, an off-step `max` is not reachable: step back from a rounded-up value.
    return at(count) > max ? at(count - 1) : at(count);
  }
}
