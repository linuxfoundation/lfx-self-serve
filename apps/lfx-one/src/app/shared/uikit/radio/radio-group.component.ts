// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { _IdGenerator } from '@angular/cdk/a11y';
import { booleanAttribute, ChangeDetectionStrategy, Component, computed, inject, input, model, signal, Signal } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

/**
 * Group of `lfx-ui-radio` options where exactly one can be chosen. Renders a `<fieldset role="radiogroup">` with a `<legend>`.
 * The options are native radios sharing one `name`, so Tab enters the group once and the arrow keys move and select the choice, as in the
 * WAI-ARIA radio group pattern. Use `[(value)]` or a reactive-forms control (`formControlName`, `[formControl]`).
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
  /** Visible group label, rendered as the `<legend>`. Leave empty and set `ariaLabel` when the surrounding UI already names the group. */
  public readonly label = input<string>('');
  /** Accessible name. Required when `label` is empty, or the radiogroup is announced without a name. Ignored when `label` is set. */
  public readonly ariaLabel = input<string>('');
  /** Native `name` shared by every option. Defaults to a unique generated name, so several groups on a page stay independent. */
  public readonly name = input<string>('');
  /** Disables every option. With reactive forms, disable the control instead (Angular warns when `[disabled]` sits next to `formControl`). */
  public readonly disabled = input<boolean, unknown>(false, { transform: booleanAttribute });
  /** The chosen option's `value`, or `null` when nothing is chosen. Supports two-way binding with `[(value)]`. */
  public readonly value = model<string | null>(null);

  protected readonly formDisabled = signal(false);

  /** Name the options put on their native input. Read by `lfx-ui-radio`. */
  public readonly groupName: Signal<string> = this.initGroupName();
  /** True when the group is disabled by input or by its form control. Read by `lfx-ui-radio`. */
  public readonly isDisabled: Signal<boolean> = this.initIsDisabled();

  // Per-app generator: a module-level counter would drift between SSR requests and the client.
  private readonly generatedName = inject(_IdGenerator).getId('lfx-ui-radio-group-');
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

  /** Marks the control touched only when focus leaves the whole group, not when arrow keys move between options. */
  protected onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget as Node | null;
    if (!next || !(event.currentTarget as Node).contains(next)) this.onTouchedFn?.();
  }

  private initGroupName(): Signal<string> {
    return computed(() => this.name() || this.generatedName);
  }

  private initIsDisabled(): Signal<boolean> {
    return computed(() => this.disabled() || this.formDisabled());
  }
}
