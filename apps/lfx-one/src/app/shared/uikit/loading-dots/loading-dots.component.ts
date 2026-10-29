// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, input, Signal } from '@angular/core';
import { UiLoadingDotsSize } from '@lfx-one/shared/interfaces';

/**
 * Three pulsing dots for background work described in words, such as "Generating attendance report".
 *
 * Inline next to visible text ("Saving"), leave `label` empty: the dots are `aria-hidden` and add no role, so the
 * surrounding element owns the `aria-live` region. Standalone, with no visible text, set `label` to name the task:
 * the host becomes `role="status"` with that text hidden visually for screen readers.
 */
@Component({
  selector: 'lfx-ui-loading-dots',
  templateUrl: './loading-dots.component.html',
  styleUrl: './loading-dots.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': 'hostClasses()',
    '[attr.role]': 'label() ? "status" : null',
    '[attr.aria-hidden]': 'label() ? null : "true"',
    'data-testid': 'ui-loading-dots',
  },
})
export class UiLoadingDotsComponent {
  /** Dot diameter: `sm` 4px, `md` 5px, `lg` 7px. */
  public readonly size = input<UiLoadingDotsSize>('md');
  /** Standalone use only: screen-reader text in a status region, announced when the dots appear. Name the task, not the animation. Leave empty next to visible text. */
  public readonly label = input<string>('');

  /** One entry per dot; each dot fades in turn. */
  protected readonly dots: number[] = [0, 1, 2];
  protected readonly hostClasses: Signal<string> = this.initHostClasses();
  protected readonly dotClasses: Signal<string> = this.initDotClasses();

  private initHostClasses(): Signal<string> {
    return computed(() => {
      // Library gap is 0.8 of the dot diameter.
      const gaps = { sm: 'gap-[3.2px]', md: 'gap-[4px]', lg: 'gap-[5.6px]' };
      return `inline-flex items-center align-middle ${gaps[this.size()]}`;
    });
  }

  private initDotClasses(): Signal<string> {
    return computed(() => {
      const sizes = { sm: 'size-[4px]', md: 'size-[5px]', lg: 'size-[7px]' };
      return `dot block shrink-0 rounded-ui-full bg-current opacity-60 ${sizes[this.size()]}`;
    });
  }
}
