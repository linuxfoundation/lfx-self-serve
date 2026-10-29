// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, input, Signal } from '@angular/core';

/** The floating tooltip surface. Rendered by `lfxUiTooltip` inside a CDK overlay; not meant to be used directly. */
@Component({
  selector: 'lfx-ui-tooltip-panel',
  templateUrl: './tooltip-panel.component.html',
  styleUrl: './tooltip-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'tooltip',
    '[class]': 'hostClasses()',
    'data-testid': 'ui-tooltip',
  },
})
export class UiTooltipPanelComponent {
  /** The tooltip text; with a heading it becomes the smaller description line. */
  public readonly text = input<string>('');
  /** Bold first line. Setting it switches to the rich layout. */
  public readonly heading = input<string>('');
  /** Keys shown as small key caps after the text, such as `['⌘', 'C']`. */
  public readonly shortcut = input<string[]>([]);

  protected readonly hostClasses: Signal<string> = this.initHostClasses();

  private initHostClasses(): Signal<string> {
    return computed(() => {
      // Exact px, not rem; 14px root. 8px radius has no rounded-ui-* step.
      const base = 'max-w-[240px] rounded-[8px] bg-ui-neutral-900 text-ui-background-100 shadow-tooltip label-12 font-medium';
      return this.heading() ? `${base} flex flex-col items-start gap-[2px] px-[10px] py-[6px]` : `${base} inline-flex items-center gap-[6px] px-[8px] py-[4px]`;
    });
  }
}
