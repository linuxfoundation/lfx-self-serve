// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { booleanAttribute, ChangeDetectionStrategy, Component, computed, input, model, signal, Signal } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

/**
 * Group of `lfx-ui-radio` options where exactly one can be chosen. Renders a `<fieldset role="radiogroup">` with a `<legend>`.
 * The options are native radios sharing one `name`, so Tab enters the group once and the arrow keys move and select the choice, as in the
 * WAI-ARIA radio group pattern. Use `[(value)]` or a reactive-forms control (`formControlName`, `[formControl]`, `ngModel`).
 */
@Component({
  selector: 'lfx-ui-radio-group',
  templateUrl: './radio-group.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: UiRadioGroupComponent, multi: true }],
  host: {
    class: 'block',
    'data-testid': 'ui-radio-group',
  },
})
export class UiRadioGroupComponent implements ControlValueAccessor {
  private static nextId = 0;

  /** Visible group label, rendered as the `<legend>`. Leave empty and set `ariaLabel` when the surrounding UI already names the group. */
  public readonly label = input<string>('');
  /** Accessible name when there is no visible `label`. Ignored when `label` is set. */
  public readonly ariaLabel = input<string>('');
  /** Native `name` shared by every option. Defaults to a unique generated name, so several groups on a page stay independent. */
  public readonly name = input<string>('');
  /** Disables every option. A form control's disabled state is applied as well. */
  public readonly disabled = input<boolean, unknown>(false, { transform: booleanAttribute });
  /** The chosen option's `value`, or `null` when nothing is chosen. Supports two-way binding with `[(value)]`. */
  public readonly value = model<string | null>(null);

  /** Name the options put on their native input. Read by `lfx-ui-radio`. */
  public readonly groupName: Signal<string> = this.initGroupName();
  /** True when the group is disabled by input or by its form control. Read by `lfx-ui-radio`. */
  public readonly isDisabled: Signal<boolean> = this.initIsDisabled();

  protected readonly formDisabled = signal(false);

  private readonly generatedName = `lfx-ui-radio-group-${UiRadioGroupComponent.nextId++}`;
  private onChangeFn?: (value: string | null) => void;
  private onTouchedFn?: () => void;

  public writeValue(value: string | null): void {
    this.value.set(value ?? null);
  }

  public registerOnChange(fn: (value: string | null) => void): void {
    this.onChangeFn = fn;
  }

  public registerOnTouched(fn: () => void): void {
    this.onTouchedFn = fn;
  }

  public setDisabledState(isDisabled: boolean): void {
    this.formDisabled.set(isDisabled);
  }

  /** Called by `lfx-ui-radio` when the user chooses it. */
  public select(value: string): void {
    this.value.set(value);
    this.onChangeFn?.(value);
  }

  /** Called by `lfx-ui-radio` when one of its inputs loses focus. */
  public markTouched(): void {
    this.onTouchedFn?.();
  }

  private initGroupName(): Signal<string> {
    return computed(() => this.name() || this.generatedName);
  }

  private initIsDisabled(): Signal<boolean> {
    return computed(() => this.disabled() || this.formDisabled());
  }
}
