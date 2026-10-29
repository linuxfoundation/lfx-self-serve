// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, input, Signal } from '@angular/core';

/** Small pill for a count or short label, such as the number of active filters. */
@Component({
  selector: 'lfx-ui-badge',
  templateUrl: './badge.component.html',
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
      // Exact px, not rem: the app root font is 14px, so rem utilities undershoot the design.
      const base = 'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-[6px] text-[11px] font-semibold leading-none';
      const tones = { neutral: 'bg-gray-100 text-gray-600', accent: 'bg-blue-100 text-blue-700' };
      return `${base} ${tones[this.tone()]}`;
    });
  }
}
