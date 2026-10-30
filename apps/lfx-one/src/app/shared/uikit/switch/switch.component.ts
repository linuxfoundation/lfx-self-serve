// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { _IdGenerator } from '@angular/cdk/a11y';
import { booleanAttribute, ChangeDetectionStrategy, Component, computed, inject, input, model, signal, Signal } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { UiSwitchSize } from '@lfx-one/shared/interfaces';

/**
 * Segmented control for 2 to 4 mutually exclusive views of the same content (Source / Output, 24h / 7d / 30d). Not an on/off
 * switch: that is `lfx-ui-toggle`. It is a WAI-ARIA radio group: a `role="radiogroup"` of `lfx-ui-switch-option` options, each a
 * visually hidden native radio sharing one `name`, so Tab enters the group once and the arrow keys move and select the choice.
 * Use `[(value)]` or a reactive-forms control (`formControlName`, `[formControl]`).
 */
@Component({
  selector: 'lfx-ui-switch',
  templateUrl: './switch.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: UiSwitchComponent, multi: true }],
  host: {
    class: 'block',
    'data-testid': 'ui-switch',
  },
})
export class UiSwitchComponent implements ControlValueAccessor {
  // Per-app generator: a module-level counter would drift between SSR requests and the client.
  private readonly generatedName = inject(_IdGenerator).getId('lfx-ui-switch-');

  /** Accessible name of the radio group, such as `View`. Always required: the control has no visible legend. */
  public readonly ariaLabel = input.required<string>();
  /** `tiny` is 24px tall, `small` 32px and `medium` 40px, as for buttons. There is no large size. */
  public readonly size = input<UiSwitchSize>('medium');
  /** Native `name` shared by every option. Defaults to a unique generated name, so several switches on a page stay independent. */
  public readonly name = input<string>('');
  /** Disables every option. With reactive forms, disable the control instead (Angular warns when `[disabled]` sits next to `formControl`). */
  public readonly disabled = input<boolean, unknown>(false, { transform: booleanAttribute });
  /** The chosen option's `value`, or `null` when nothing is chosen. Supports two-way binding with `[(value)]`. */
  public readonly value = model<string | null>(null);

  protected readonly formDisabled = signal(false);
  protected readonly trackClasses: Signal<string> = this.initTrackClasses();

  /** Name the options put on their native input. Read by `lfx-ui-switch-option`. */
  public readonly groupName: Signal<string> = this.initGroupName();
  /** True when the switch is disabled by input or by its form control. Read by `lfx-ui-switch-option`. */
  public readonly isDisabled: Signal<boolean> = this.initIsDisabled();

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

  /** Called by `lfx-ui-switch-option` when the user chooses it. */
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

  private initTrackClasses(): Signal<string> {
    return computed(() => {
      // Exact px, not rem: 14px root. 2px gap; 3px padding (2px on tiny); 10px and 8px radii are library steps with no ui-* utility.
      const base = 'inline-flex w-fit max-w-full items-stretch gap-[2px] bg-ui-neutral-100';
      const sizes = {
        tiny: 'h-ui-tiny rounded-[8px] p-[2px]',
        small: 'h-ui-small rounded-[10px] p-[3px]',
        medium: 'h-ui-medium rounded-ui-sm p-[3px]',
      };
      return `${base} ${sizes[this.size()]}`;
    });
  }
}
