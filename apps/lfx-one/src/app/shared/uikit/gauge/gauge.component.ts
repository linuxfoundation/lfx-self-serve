// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, input, Signal } from '@angular/core';

/** Circular percentage for health scores, coverage or completion, read at a glance in cards and tables. */
@Component({
  selector: 'lfx-ui-gauge',
  templateUrl: './gauge.component.html',
  styleUrl: './gauge.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'relative inline-grid shrink-0 place-items-center',
    '[style.width.px]': 'px()',
    '[style.height.px]': 'px()',
    '[style.--size]': 'sizeVar()',
    role: 'progressbar',
    '[attr.aria-label]': 'label()',
    '[attr.aria-valuenow]': 'indeterminate() ? null : clampedValue()',
    '[attr.aria-valuemin]': 'indeterminate() ? null : 0',
    '[attr.aria-valuemax]': 'indeterminate() ? null : 100',
    '[attr.aria-valuetext]': 'indeterminate() ? null : clampedValue() + " percent"',
    'data-testid': 'ui-gauge',
  },
})
export class UiGaugeComponent {
  /** Percentage from 0 to 100. Clamped. Ignored while `indeterminate`. */
  public readonly value = input<number>(0);
  /** Accessible name. Pair the gauge with a visible label such as "Health score". */
  public readonly label = input.required<string>();
  /** `tiny` 20px, `small` 32px, `default` 64px, `large` 128px. The number inside only shows at `default` and `large`. */
  public readonly size = input<'tiny' | 'small' | 'default' | 'large'>('default');
  /** `level` colours the arc by value: high 67 and up is green, mid 34 to 66 is amber, low below 34 is red. `accent` is blue, for values with no good or bad meaning. */
  public readonly tone = input<'level' | 'accent'>('level');
  /** Shows the number, without a % sign, inside the ring. */
  public readonly showValue = input<boolean>(true);
  /** Spins a partial arc while the value loads. Drops the progressbar value attributes. */
  public readonly indeterminate = input<boolean>(false);

  /** Ring geometry in the 100-unit viewBox; the arc length is the circumference times the fraction. */
  protected readonly radius = 42;
  protected readonly circumference = 2 * Math.PI * this.radius;
  /** Share of the ring drawn while `indeterminate`. */
  protected readonly indeterminateFraction = 0.28;
  protected readonly px: Signal<number> = this.initPx();
  protected readonly sizeVar: Signal<string> = this.initSizeVar();
  protected readonly clampedValue: Signal<number> = this.initClampedValue();
  protected readonly dashOffset: Signal<number> = this.initDashOffset();
  protected readonly valueVisible: Signal<boolean> = this.initValueVisible();
  protected readonly arcClasses: Signal<string> = this.initArcClasses();

  private initPx(): Signal<number> {
    return computed(() => {
      const sizes = { tiny: 20, small: 32, default: 64, large: 128 };
      return sizes[this.size()];
    });
  }

  private initSizeVar(): Signal<string> {
    return computed(() => `${this.px()}px`);
  }

  private initClampedValue(): Signal<number> {
    return computed(() => Math.min(Math.max(this.value(), 0), 100));
  }

  private initDashOffset(): Signal<number> {
    return computed(() => this.circumference * (1 - (this.indeterminate() ? this.indeterminateFraction : this.clampedValue() / 100)));
  }

  private initValueVisible(): Signal<boolean> {
    return computed(() => this.showValue() && !this.indeterminate() && (this.size() === 'default' || this.size() === 'large'));
  }

  private initArcClasses(): Signal<string> {
    return computed(() => {
      const base = 'gauge-arc fill-none';
      if (this.tone() === 'accent' || this.indeterminate()) {
        return `${base} stroke-ui-accent-500`;
      }
      const value = this.clampedValue();
      if (value >= 67) {
        return `${base} stroke-ui-success-600`;
      }
      return `${base} ${value >= 34 ? 'stroke-ui-warning-500' : 'stroke-ui-danger-600'}`;
    });
  }
}
