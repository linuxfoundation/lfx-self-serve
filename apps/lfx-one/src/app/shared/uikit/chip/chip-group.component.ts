// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, ElementRef, inject, input } from '@angular/core';

/**
 * A wrapping row of `lfx-ui-chip`s, such as the filters applied to a list. It is a `role="list"` of chips, named by `ariaLabel`.
 * When a chip's × is used, focus moves to the next chip's ×, or the previous one's when it was the last, so keyboard users do not
 * lose their place while the parent removes the chip. With no chip left it goes to `fallbackFocus`, or to the row itself. If the
 * parent hides the row once it is empty, pass an element that stays, such as the button that opens the filters.
 */
@Component({
  selector: 'lfx-ui-chip-group',
  templateUrl: './chip-group.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    // Exact px, not rem; 14px root. Chips wrap with an 8px gap.
    class: 'flex flex-wrap items-center gap-[8px] outline-none',
    role: 'list',
    tabindex: '-1',
    '[attr.aria-label]': 'ariaLabel() || null',
    'data-testid': 'ui-chip-group',
  },
})
export class UiChipGroupComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  /** Accessible name of the list, such as "Applied filters". */
  public readonly ariaLabel = input<string>('');
  /** Where focus goes when the last chip is removed. Without it the row itself takes focus, which is lost if the parent then hides the row. */
  public readonly fallbackFocus = input<HTMLElement | null>(null);

  /** Called by a chip as its × is used: moves focus to a neighbouring chip's × before the parent removes the chip. */
  public focusNeighbour(dismissButton: HTMLElement): void {
    const buttons = Array.from(this.host.querySelectorAll<HTMLElement>('[data-testid="ui-chip-dismiss"]'));
    const index = buttons.indexOf(dismissButton);
    (buttons[index + 1] ?? buttons[index - 1] ?? this.fallbackFocus() ?? this.host).focus();
  }
}
