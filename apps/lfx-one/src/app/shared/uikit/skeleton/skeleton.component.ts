// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, input, Signal } from '@angular/core';

/** Placeholder block in the shape of the content that is loading. Put `aria-busy="true"` on the loading region, not on the skeleton. */
@Component({
  selector: 'lfx-ui-skeleton',
  templateUrl: './skeleton.component.html',
  styleUrl: './skeleton.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': 'classes()',
    '[style.width]': 'width() || null',
    '[style.height]': 'height()',
    'aria-hidden': 'true',
    'data-testid': 'ui-skeleton',
  },
})
export class UiSkeletonComponent {
  /** `line` is a text line with a 6px radius; `pill` is fully rounded, for chips and buttons; `circle` is for avatars. */
  public readonly shape = input<'line' | 'pill' | 'circle'>('line');
  /** Any CSS width, such as `46%` or `72px`. Empty fills the container, so vary it across lines. */
  public readonly width = input<string>('');
  /** Any CSS height. Match the real element, such as `14px` for body text or `24px` for a pill. */
  public readonly height = input<string>('20px');

  protected readonly classes: Signal<string> = this.initClasses();

  private initClasses(): Signal<string> {
    return computed(() => {
      // Neutral 50 to neutral 100 shimmer; the stops match the library's 25% / 37% / 63% gradient.
      const base =
        'block bg-gradient-to-r from-ui-neutral-50 from-25% via-ui-neutral-100 via-[37%] to-ui-neutral-50 to-[63%] bg-[length:400%_100%] bg-[position:100%_50%]';
      const shapes = { line: 'rounded-ui-xs', pill: 'rounded-ui-full', circle: 'rounded-ui-full' };
      return `${base} ${shapes[this.shape()]}`;
    });
  }
}
