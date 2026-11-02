// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, input, Signal } from '@angular/core';

/** Twelve-bar spinner for icon-sized waits: inside a button, next to a status line, in a small empty panel. */
@Component({
  selector: 'lfx-ui-spinner',
  templateUrl: './spinner.component.html',
  styleUrl: './spinner.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': 'classes()',
    '[style.width.px]': 'size()',
    '[style.height.px]': 'size()',
    '[style.--size]': 'sizeVar()',
    role: 'status',
    'data-testid': 'ui-spinner',
  },
})
export class UiSpinnerComponent {
  /** Width and height in px. The library uses 12 to 32. */
  public readonly size = input<number>(20);
  /** `neutral` is the secondary text colour; `current` follows the parent text colour, for use inside a button. */
  public readonly tone = input<'neutral' | 'current'>('neutral');
  /** Screen-reader text inside the status region, announced when the spinner appears. */
  public readonly label = input<string>('Loading');

  /** One entry per bar; each bar sets its own rotation and animation delay. */
  protected readonly bars: number[] = Array.from({ length: 12 }, (_, index) => index);
  protected readonly sizeVar: Signal<string> = this.initSizeVar();
  protected readonly classes: Signal<string> = this.initClasses();

  private initSizeVar(): Signal<string> {
    return computed(() => `${this.size()}px`);
  }

  private initClasses(): Signal<string> {
    return computed(() => {
      const base = 'relative inline-block shrink-0';
      const tones = { neutral: 'text-ui-neutral-600', current: 'text-current' };
      return `${base} ${tones[this.tone()]}`;
    });
  }
}
