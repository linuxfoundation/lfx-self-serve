// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { booleanAttribute, ChangeDetectionStrategy, Component, computed, input, Signal } from '@angular/core';
import { UiGaugeGeometry } from '@lfx-one/shared/interfaces';

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
    '[attr.role]': 'empty() ? "img" : "progressbar"',
    '[attr.aria-label]': 'label()',
    '[attr.aria-valuenow]': 'hasValue() ? clampedValue() : null',
    '[attr.aria-valuemin]': 'hasValue() ? 0 : null',
    '[attr.aria-valuemax]': 'hasValue() ? 100 : null',
    '[attr.aria-valuetext]': 'valueText()',
    'data-testid': 'ui-gauge',
  },
})
export class UiGaugeComponent {
  /** Percentage from 0 to 100. Clamped and rounded to a whole number; a non-finite value counts as 0. Ignored while `indeterminate`. */
  public readonly value = input<number>(0);
  /** Accessible name. Pair the gauge with a visible label such as "Health score". */
  public readonly label = input.required<string>();
  /** `tiny` 20px, `small` 32px, `default` 64px, `large` 128px, or a number of px for a size the scale lacks, such as a 52px table cell. The number inside only shows from 64px up. */
  public readonly size = input<'tiny' | 'small' | 'default' | 'large' | number>('default');
  /** `level` colours the arc by value: high 67 and up is green, mid 34 to 66 is amber, low below 34 is red. `accent` is blue, for values with no good or bad meaning. */
  public readonly tone = input<'level' | 'accent'>('level');
  /** Sets the level colour directly, for a caller whose own rule decides good and bad, such as pacing against a goal. Overrides the value thresholds of the `level` tone. */
  public readonly level = input<'high' | 'mid' | 'low' | null>(null);
  /** `default` is a 10-unit ring with round ends. `thin` is an 8-unit ring with square ends, for dense rows of gauges. */
  public readonly weight = input<'default' | 'thin'>('default');
  /**
   * Shows an outlined ring with no arc and no value, for a measure that has nothing to measure against, such as an event with no goal.
   * The ring's inside is painted in the page background, as the design draws it, so place it on the page background. It is an image named by `label`, not a progressbar.
   */
  public readonly empty = input<boolean, unknown>(false, { transform: booleanAttribute });
  /** Shows the number, without a % sign, inside the ring. */
  public readonly showValue = input<boolean, unknown>(true, { transform: booleanAttribute });
  /** Spins a partial arc while the value loads. Drops the progressbar value attributes. */
  public readonly indeterminate = input<boolean, unknown>(false, { transform: booleanAttribute });

  protected readonly geometry: Signal<UiGaugeGeometry> = this.initGeometry();
  /** Share of the ring drawn while `indeterminate`. */
  protected readonly indeterminateFraction = 0.28;
  protected readonly px: Signal<number> = this.initPx();
  protected readonly sizeVar: Signal<string> = this.initSizeVar();
  protected readonly clampedValue: Signal<number> = this.initClampedValue();
  /** False while indeterminate or empty, which drops the progressbar value attributes. */
  protected readonly hasValue: Signal<boolean> = computed(() => !this.indeterminate() && !this.empty());
  protected readonly valueText: Signal<string | null> = computed(() => (this.hasValue() ? `${this.clampedValue()} percent` : null));
  protected readonly dashOffset: Signal<number> = this.initDashOffset();
  protected readonly valueVisible: Signal<boolean> = this.initValueVisible();
  protected readonly arcClasses: Signal<string> = this.initArcClasses();

  private initPx(): Signal<number> {
    return computed(() => {
      const size = this.size();
      // A size that cannot draw a ring falls back to the default 64px.
      if (typeof size === 'number') return Number.isFinite(size) && size > 0 ? size : 64;
      const sizes = { tiny: 20, small: 32, default: 64, large: 128 };
      return sizes[size];
    });
  }

  /** Ring geometry in the 100-unit viewBox: the ring sits inside it, and the arc length is the circumference times the fraction. */
  private initGeometry(): Signal<UiGaugeGeometry> {
    return computed(() => {
      const thin = this.weight() === 'thin';
      const radius = thin ? 45 : 42;
      return { radius, stroke: thin ? 8 : 10, circumference: 2 * Math.PI * radius, linecap: thin ? 'butt' : 'round' };
    });
  }

  private initSizeVar(): Signal<string> {
    return computed(() => `${this.px()}px`);
  }

  private initClampedValue(): Signal<number> {
    return computed(() => {
      const value = Number.isFinite(this.value()) ? this.value() : 0;
      return Math.round(Math.min(Math.max(value, 0), 100));
    });
  }

  private initDashOffset(): Signal<number> {
    return computed(() => this.geometry().circumference * (1 - (this.indeterminate() ? this.indeterminateFraction : this.clampedValue() / 100)));
  }

  private initValueVisible(): Signal<boolean> {
    return computed(() => this.showValue() && this.hasValue() && this.px() >= 64);
  }

  private initArcClasses(): Signal<string> {
    return computed(() => {
      const base = 'gauge-arc fill-none';
      if (this.tone() === 'accent' || this.indeterminate()) {
        return `${base} stroke-ui-accent-500`;
      }
      const levels = { high: 'stroke-ui-success-600', mid: 'stroke-ui-warning-500', low: 'stroke-ui-danger-600' };
      const level = this.level();
      if (level) return `${base} ${levels[level]}`;
      const value = this.clampedValue();
      if (value >= 67) {
        return `${base} stroke-ui-success-600`;
      }
      return `${base} ${value >= 34 ? 'stroke-ui-warning-500' : 'stroke-ui-danger-600'}`;
    });
  }
}
