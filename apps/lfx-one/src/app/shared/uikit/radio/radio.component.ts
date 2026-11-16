// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { booleanAttribute, ChangeDetectionStrategy, Component, computed, inject, input, Signal } from '@angular/core';

import { UiRadioGroupComponent } from './radio-group.component';

/**
 * One option of an `lfx-ui-radio-group`: a 16px native radio with a label after it.
 * It must sit inside the group, which owns the shared `name`, the chosen value and the arrow-key behaviour.
 */
@Component({
  selector: 'lfx-ui-radio',
  templateUrl: './radio.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'inline-flex',
    'data-testid': 'ui-radio',
  },
})
export class UiRadioComponent {
  /** What the group's value becomes when this option is chosen. */
  public readonly value = input.required<string>();
  /** Visible label, shown after the circle. */
  public readonly label = input.required<string>();
  /** Disables this option: it keeps its place in the list but cannot be chosen or focused. */
  public readonly disabled = input<boolean, unknown>(false, { transform: booleanAttribute });

  protected readonly group = inject(UiRadioGroupComponent);
  protected readonly isChecked: Signal<boolean> = this.initIsChecked();
  protected readonly isDisabled: Signal<boolean> = this.initIsDisabled();
  protected readonly circleClasses: Signal<string> = this.initCircleClasses();
  protected readonly dotClasses: Signal<string> = this.initDotClasses();
  protected readonly labelClasses: Signal<string> = this.initLabelClasses();

  protected onChange(): void {
    this.group.select(this.value());
  }

  private initIsChecked(): Signal<boolean> {
    return computed(() => this.group.value() === this.value());
  }

  private initIsDisabled(): Signal<boolean> {
    return computed(() => this.disabled() || this.group.isDisabled());
  }

  private initCircleClasses(): Signal<string> {
    return computed(() => {
      // Exact px, not rem: 14px root. 16px circle with a 1px ring.
      // forced-colors: the ring vanishes, so a real border keeps the circle visible (Highlight when chosen).
      const base =
        'm-0 h-[16px] w-[16px] shrink-0 appearance-none rounded-ui-full ring-1 transition-colors duration-ui-base ease-ui-standard motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-0 focus-visible:shadow-focus forced-colors:border';
      if (this.isDisabled()) {
        return `${base} bg-ui-neutral-50 ring-ui-neutral-alpha-300 cursor-not-allowed forced-colors:border-[color:GrayText]`;
      }
      const state = this.isChecked()
        ? 'bg-ui-background-100 ring-ui-accent-500 forced-colors:border-[color:Highlight]'
        : 'bg-ui-background-100 ring-ui-neutral-alpha-500 hover:bg-ui-neutral-alpha-50 forced-colors:border-[color:CanvasText]';
      return `${base} ${state} cursor-pointer`;
    });
  }

  private initDotClasses(): Signal<string> {
    // 7px dot centred in the circle.
    return computed(
      () =>
        `pointer-events-none absolute left-[4.5px] top-[4.5px] h-[7px] w-[7px] rounded-ui-full ${this.isDisabled() ? 'bg-ui-neutral-400 forced-colors:bg-[color:GrayText]' : 'bg-ui-accent-500 forced-colors:bg-[color:Highlight]'}`
    );
  }

  private initLabelClasses(): Signal<string> {
    return computed(() => {
      // 8px gap (library spacing-2).
      const base = 'relative inline-flex items-center gap-[8px] label-14';
      return this.isDisabled() ? `${base} cursor-not-allowed text-ui-neutral-500` : `${base} cursor-pointer text-ui-neutral-900`;
    });
  }
}
