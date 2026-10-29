// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, input, Signal } from '@angular/core';

/** Bar for how much of a known total is done or used, such as seats, quota or an import. */
@Component({
  selector: 'lfx-ui-progress',
  templateUrl: './progress.component.html',
  styleUrl: './progress.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block w-full',
    'data-testid': 'ui-progress',
  },
})
export class UiProgressComponent {
  /** Amount done or used, in the same unit as `max`. Clamped to 0 to `max`. */
  public readonly value = input.required<number>();
  /** The real maximum; the fill is `value / max`, not a hard-coded 100. */
  public readonly max = input<number>(100);
  /** Name of what is measured. Always the accessible name; also shown above the bar when `showLabel` is on. */
  public readonly label = input.required<string>();
  /** Shows the label and the value text above the bar. Turn off when the surrounding UI already names the bar. */
  public readonly showLabel = input<boolean>(true);
  /** Text for the right of the label row, such as `32 of 50`. Defaults to the rounded percentage. */
  public readonly valueText = input<string>('');
  /** Fill colour. The product picks it at its own thresholds (for example warning at 80%, error at 95%). */
  public readonly tone = input<'accent' | 'success' | 'warning' | 'error' | 'secondary'>('accent');

  protected readonly clampedValue: Signal<number> = this.initClampedValue();
  protected readonly percent: Signal<number> = this.initPercent();
  protected readonly displayValue: Signal<string> = this.initDisplayValue();
  protected readonly fillClasses: Signal<string> = this.initFillClasses();

  private initClampedValue(): Signal<number> {
    return computed(() => (Number.isFinite(this.value()) && Number.isFinite(this.max()) ? Math.min(Math.max(this.value(), 0), this.max()) : 0));
  }

  private initPercent(): Signal<number> {
    return computed(() => (Number.isFinite(this.max()) && this.max() > 0 ? (this.clampedValue() / this.max()) * 100 : 0));
  }

  private initDisplayValue(): Signal<string> {
    return computed(() => this.valueText() || `${Math.round(this.percent())}%`);
  }

  private initFillClasses(): Signal<string> {
    return computed(() => {
      const tones = {
        accent: 'bg-ui-accent-500',
        success: 'bg-ui-success-600',
        warning: 'bg-ui-warning-500',
        error: 'bg-ui-danger-600',
        secondary: 'bg-ui-neutral-400',
      };
      return `progress-fill absolute inset-y-0 left-0 rounded-[inherit] ${tones[this.tone()]}`;
    });
  }
}
