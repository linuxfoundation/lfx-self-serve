// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, contentChildren, ElementRef, inject, input } from '@angular/core';

import { UiChipHost } from './chip-host';
import { UiChipComponent } from './chip.component';

/**
 * A wrapping row of `lfx-ui-chip`s, such as the filters applied to a list. It is a `role="list"` of chips, named by `ariaLabel`.
 * When a chip's × held focus and the chip is removed, focus moves to the next chip's ×, or the previous one's when it was the last, so keyboard
 * users do not lose their place. It moves when the chip is actually destroyed, so a removal that waits on a request keeps focus where it is until
 * then, and one that is cancelled never moves it. With no chip left it goes to `fallbackFocus`, or to the row itself. If the parent hides the row
 * once it is empty, pass something that stays, such as the button that opens the filters.
 */
@Component({
  selector: 'lfx-ui-chip-group',
  providers: [{ provide: UiChipHost, useExisting: UiChipGroupComponent }],
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
export class UiChipGroupComponent extends UiChipHost {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly chips = contentChildren(UiChipComponent, { descendants: true });

  /** Accessible name of the list, such as "Applied filters". */
  public readonly ariaLabel = input<string>('');
  /** Where focus goes when the last chip is removed: an element or an `lfx-ui-button`, anything with `focus()`. Without it the row itself takes focus, which is lost if the parent then hides the row. */
  public readonly fallbackFocus = input<{ focus(): void } | null>(null);

  public successorOf(chip: UiChipComponent): UiChipComponent | null {
    const live = this.chips().filter((other) => other === chip || (other.dismissible() && !other.dismissing()));
    const index = live.indexOf(chip);
    return live[index + 1] ?? live[index - 1] ?? null;
  }

  public restoreFocus(preferred: UiChipComponent | null): void {
    for (const chip of [preferred, ...this.chips()]) {
      if (chip?.focusDismiss()) return;
    }
    (this.fallbackFocus() ?? this.host).focus();
  }
}
