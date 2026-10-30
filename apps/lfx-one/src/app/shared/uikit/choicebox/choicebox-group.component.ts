// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { _IdGenerator } from '@angular/cdk/a11y';
import { booleanAttribute, ChangeDetectionStrategy, Component, computed, inject, input, model, signal, Signal } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { UiChoiceboxColumns, UiChoiceboxType } from '@lfx-one/shared/interfaces';

/**
 * Group of `lfx-ui-choicebox` tiles: large, tappable radios (pick one) or checkboxes (pick any). Renders a `<fieldset>` with a `<legend>`;
 * a radio group is a `role="radiogroup"`. The tiles hold native inputs, so Tab, the arrow keys (radio) and Space (checkbox) are the browser's.
 * Use `[(value)]` for `type="radio"`, `[(values)]` for `type="checkbox"`, or a reactive-forms control (`formControlName`, `[formControl]`):
 * the control holds a string or `null` for radio and a `string[]` for checkbox.
 */
@Component({
  selector: 'lfx-ui-choicebox-group',
  templateUrl: './choicebox-group.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: UiChoiceboxGroupComponent, multi: true }],
  host: {
    class: 'block',
    'data-testid': 'ui-choicebox-group',
  },
})
export class UiChoiceboxGroupComponent implements ControlValueAccessor {
  /** Visible group label, rendered as the `<legend>`. Leave empty and set `ariaLabel` when the surrounding UI already names the group. */
  public readonly label = input<string>('');
  /** Accessible name. Required when `label` is empty, or the group is announced without a name. Ignored when `label` is set. */
  public readonly ariaLabel = input<string>('');
  /** `radio` picks one tile; `checkbox` picks any number. Do not change it while the group is on screen. */
  public readonly type = input<UiChoiceboxType>('radio');
  /** Equal-width columns of tiles. */
  public readonly columns = input<UiChoiceboxColumns>(1);
  /** Native `name` shared by the radio tiles. Defaults to a unique generated name, so several groups on a page stay independent. */
  public readonly name = input<string>('');
  /** Disables every tile. With reactive forms, disable the control instead (Angular warns when `[disabled]` sits next to `formControl`). */
  public readonly disabled = input<boolean, unknown>(false, { transform: booleanAttribute });
  /** The chosen tile's `value` for `type="radio"`, or `null` when none is chosen. Supports two-way binding with `[(value)]`. */
  public readonly value = model<string | null>(null);
  /** The chosen tiles' `value`s for `type="checkbox"`. Supports two-way binding with `[(values)]`. */
  public readonly values = model<string[]>([]);

  protected readonly formDisabled = signal(false);
  protected readonly gridClasses: Signal<string> = this.initGridClasses();

  /** True for `type="radio"`. Read by `lfx-ui-choicebox`. */
  public readonly isRadio: Signal<boolean> = this.initIsRadio();
  /** Name the radio tiles put on their native input. Read by `lfx-ui-choicebox`. */
  public readonly groupName: Signal<string> = this.initGroupName();
  /** True when the group is disabled by input or by its form control. Read by `lfx-ui-choicebox`. */
  public readonly isDisabled: Signal<boolean> = this.initIsDisabled();

  // Per-app generator: a module-level counter would drift between SSR requests and the client.
  private readonly generatedName = inject(_IdGenerator).getId('lfx-ui-choicebox-group-');
  private onChangeFn?: (value: string | string[] | null) => void;
  private onTouchedFn?: () => void;

  public writeValue(value: string | string[] | null): void {
    if (this.type() === 'checkbox') {
      this.values.set(Array.isArray(value) ? value : []);
      return;
    }
    this.value.set(typeof value === 'string' ? value : null);
  }

  public registerOnChange(fn: (value: string | string[] | null) => void): void {
    this.onChangeFn = fn;
  }

  public registerOnTouched(fn: () => void): void {
    this.onTouchedFn = fn;
  }

  public setDisabledState(isDisabled: boolean): void {
    this.formDisabled.set(isDisabled);
  }

  /** Whether the tile with this `value` is chosen. Read by `lfx-ui-choicebox`. */
  public isChecked(value: string): boolean {
    return this.type() === 'checkbox' ? this.values().includes(value) : this.value() === value;
  }

  /** Called by `lfx-ui-choicebox` when the user chooses or clears a tile. */
  public choose(value: string, checked: boolean): void {
    if (this.type() === 'checkbox') {
      const next = checked ? [...this.values().filter((item) => item !== value), value] : this.values().filter((item) => item !== value);
      this.values.set(next);
      this.onChangeFn?.(next);
      return;
    }
    this.value.set(value);
    this.onChangeFn?.(value);
  }

  /** Marks the control touched only when focus leaves the whole group, not when arrow keys move between tiles. */
  protected onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget as Node | null;
    if (!next || !(event.currentTarget as Node).contains(next)) this.onTouchedFn?.();
  }

  private initIsRadio(): Signal<boolean> {
    return computed(() => this.type() === 'radio');
  }

  private initGroupName(): Signal<string> {
    return computed(() => this.name() || this.generatedName);
  }

  private initIsDisabled(): Signal<boolean> {
    return computed(() => this.disabled() || this.formDisabled());
  }

  private initGridClasses(): Signal<string> {
    return computed(() => {
      // Exact px, not rem: 14px root. 12px between tiles (library spacing-3); minmax(0, 1fr) is what `grid-cols-*` emits.
      const columns = { 1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3' };
      return `grid gap-[12px] ${columns[this.columns()]}`;
    });
  }
}
