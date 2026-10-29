// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { booleanAttribute, ChangeDetectionStrategy, Component, computed, input, model, signal, Signal } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { UiToggleSize, UiToggleTone } from '@lfx-one/shared/interfaces';

/**
 * On/off control for settings that apply at once (options saved with a form use a checkbox). A native checkbox with `role="switch"`
 * sits under the visual, so Space and focus are the browser's. Use `[(checked)]` or a reactive-forms control (`formControlName`, `[formControl]`).
 */
@Component({
  selector: 'lfx-ui-toggle',
  templateUrl: './toggle.component.html',
  styleUrl: './toggle.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: UiToggleComponent, multi: true }],
  host: {
    class: 'inline-flex',
    'data-testid': 'ui-toggle',
  },
})
export class UiToggleComponent implements ControlValueAccessor {
  /** Visible label, shown after the control. Leave empty for a bare switch and set `ariaLabel`. */
  public readonly label = input<string>('');
  /** Accessible name when there is no visible `label`. Ignored when `label` is set. */
  public readonly ariaLabel = input<string>('');
  /** Native `name`, used when the toggle is inside a plain HTML form. */
  public readonly name = input<string>('');
  /** `default` is 28x16, `medium` 36x20, `large` 44x24. */
  public readonly size = input<UiToggleSize>('default');
  /** Track colour when on. `warning` and `danger` are for settings with consequences, such as maintenance mode. */
  public readonly tone = input<UiToggleTone>('accent');
  /** Disables the toggle. A form control's disabled state is applied as well. */
  public readonly disabled = input<boolean, unknown>(false, { transform: booleanAttribute });
  /** Whether the toggle is on. Supports two-way binding with `[(checked)]`. */
  public readonly checked = model<boolean>(false);

  protected readonly formDisabled = signal(false);
  protected readonly isDisabled: Signal<boolean> = this.initIsDisabled();
  protected readonly trackClasses: Signal<string> = this.initTrackClasses();
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
    this.onChangeFn?.(value);
  }

  protected onBlur(): void {
    this.onTouchedFn?.();
  }

  private initIsDisabled(): Signal<boolean> {
    return computed(() => this.disabled() || this.formDisabled());
  }

  private initTrackClasses(): Signal<string> {
    return computed(() => {
      const sizes = { default: 'ui-toggle-default', medium: 'ui-toggle-medium', large: 'ui-toggle-large' };
      const tones = { accent: 'bg-ui-accent-500', warning: 'bg-ui-warning-600', danger: 'bg-ui-danger-600' };
      // forced-colors: a real border keeps the track visible; Highlight marks on (the SCSS recolours the thumb).
      const state = this.checked()
        ? `${tones[this.tone()]} ring-0 forced-colors:border-[color:Highlight] forced-colors:bg-[color:Highlight]`
        : 'bg-ui-neutral-100 ring-1 ring-inset ring-ui-neutral-alpha-200 forced-colors:border-[color:CanvasText] forced-colors:bg-[color:Canvas]';
      // opacity-50 matches the library's disabled opacity token (0.5).
      const cursor = this.isDisabled() ? 'cursor-not-allowed opacity-50' : 'cursor-pointer';
      return `ui-toggle ${sizes[this.size()]} relative m-0 shrink-0 appearance-none rounded-ui-full transition-colors duration-ui-base ease-ui-standard motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-0 focus-visible:shadow-focus forced-colors:border ${state} ${cursor}`;
    });
  }

  private initLabelClasses(): Signal<string> {
    return computed(() => {
      // 8px gap (library spacing-2); 14px root, so no rem.
      const base = 'inline-flex items-center gap-[8px] label-14';
      return this.isDisabled() ? `${base} cursor-not-allowed text-ui-neutral-500` : `${base} cursor-pointer text-ui-neutral-900`;
    });
  }
}
