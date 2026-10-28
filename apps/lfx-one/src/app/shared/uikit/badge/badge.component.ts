// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, input, Signal } from '@angular/core';

@Component({
  selector: 'lfx-ui-badge',
  template: '{{ value() }}',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': 'classes()',
  },
})
export class UiBadgeComponent {
  /** The count or short label to show. */
  public readonly value = input.required<number | string>();
  /** `neutral` is grey; `accent` is blue, for a badge on an active control. */
  public readonly tone = input<'neutral' | 'accent'>('neutral');

  protected readonly classes: Signal<string> = this.initClasses();

  private initClasses(): Signal<string> {
    return computed(() => {
      const base = 'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[11px] font-semibold leading-none';
      const tones = { neutral: 'bg-gray-100 text-gray-600', accent: 'bg-blue-100 text-blue-700' };
      return `${base} ${tones[this.tone()]}`;
    });
  }
}
