// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { booleanAttribute, ChangeDetectionStrategy, Component, computed, input, model, signal, Signal } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

/**
 * 16px checkbox for independent options applied on save. A native checkbox sits under the visual, so Space,
 * focus and form behaviour are the browser's. Use `[(checked)]` or a reactive-forms control (`formControlName`, `[formControl]`).
 * Clicking an indeterminate checkbox clears `indeterminate` and toggles `checked`.
 */
@Component({
  selector: 'lfx-ui-checkbox',
  templateUrl: './checkbox.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: UiCheckboxComponent, multi: true }],
  host: {
    class: 'inline-flex',
    'data-testid': 'ui-checkbox',
  },
})
export class UiCheckboxComponent implements ControlValueAccessor {
  /** Visible label, shown after the box. Leave empty for a box with no text and set `ariaLabel`. */
  public readonly label = input<string>('');
  /** Accessible name when there is no visible `label`. Ignored when `label` is set. */
  public readonly ariaLabel = input<string>('');
  /** Native `name`, used when the checkbox is inside a plain HTML form. */
  public readonly name = input<string>('');
  /** Disables the checkbox. A form control's disabled state is applied as well. */
  public readonly disabled = input<boolean, unknown>(false, { transform: booleanAttribute });
  /** Whether the box is checked. Supports two-way binding with `[(checked)]`. */
  public readonly checked = model<boolean>(false);
  /** Shows the mixed dash, for a parent whose children are partly selected. Wins over `checked` visually. Supports `[(indeterminate)]`. */
  public readonly indeterminate = model<boolean>(false);

  protected readonly formDisabled = signal(false);
  protected readonly isDisabled: Signal<boolean> = this.initIsDisabled();
  protected readonly isOn: Signal<boolean> = this.initIsOn();
  protected readonly boxClasses: Signal<string> = this.initBoxClasses();
  protected readonly labelClasses: Signal<string> = this.initLabelClasses();

  private onChangeFn?: (value: boolean) => void;
  private onTouchedFn?: () => void;

  public writeValue(value: boolean | null): void {
    this.checked.set(!!value);
  }

  public registerOnChange(fn: (value: boolean) => void): void {
    this.onChangeFn = fn;
  }

  public registerOnTouched(fn: () => void): void {
    this.onTouchedFn = fn;
  }

  public setDisabledState(isDisabled: boolean): void {
    this.formDisabled.set(isDisabled);
  }

  protected onChange(event: Event): void {
    const value = (event.target as HTMLInputElement).checked;
    this.checked.set(value);
    this.indeterminate.set(false);
    this.onChangeFn?.(value);
  }

  protected onBlur(): void {
    this.onTouchedFn?.();
  }

  private initIsDisabled(): Signal<boolean> {
    return computed(() => this.disabled() || this.formDisabled());
  }

  private initIsOn(): Signal<boolean> {
    return computed(() => this.checked() || this.indeterminate());
  }

  private initBoxClasses(): Signal<string> {
    return computed(() => {
      // Exact px, not rem: 14px root. 16px box with a 5px radius (library radius-xs minus the 1px ring).
      // ring-0 on focus matches the library: its focus style replaces the ring with the focus shadow.
      // forced-colors: ring and fill vanish, so a real CanvasText border and a Highlight fill keep the box and its state visible.
      const base =
        'm-0 h-[16px] w-[16px] shrink-0 appearance-none rounded-[5px] ring-1 transition-colors duration-ui-base ease-ui-standard motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-0 focus-visible:shadow-focus forced-colors:border';
      if (this.isDisabled()) {
        const state = this.isOn()
          ? 'bg-ui-neutral-400 ring-ui-neutral-400 forced-colors:border-[color:GrayText] forced-colors:bg-[color:GrayText]'
          : 'bg-ui-neutral-50 ring-ui-neutral-alpha-300 forced-colors:border-[color:GrayText]';
        return `${base} ${state} cursor-not-allowed`;
      }
      const state = this.isOn()
        ? 'bg-ui-accent-500 ring-ui-accent-500 forced-colors:border-[color:CanvasText] forced-colors:bg-[color:Highlight]'
        : 'bg-ui-background-100 ring-ui-neutral-alpha-500 hover:bg-ui-neutral-alpha-50 forced-colors:border-[color:CanvasText] forced-colors:bg-[color:Canvas]';
      return `${base} ${state} cursor-pointer`;
    });
  }

  private initLabelClasses(): Signal<string> {
    return computed(() => {
      // 8px gap (library spacing-2).
      const base = 'relative inline-flex items-center gap-[8px] label-14';
      return this.isDisabled() ? `${base} cursor-not-allowed text-ui-neutral-500` : `${base} cursor-pointer text-ui-neutral-900`;
    });
  }
}
