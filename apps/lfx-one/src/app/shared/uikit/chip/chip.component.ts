// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { booleanAttribute, ChangeDetectionStrategy, Component, computed, inject, input, output, Signal } from '@angular/core';
import { UiBadgeTone, UiChipVariant } from '@lfx-one/shared/interfaces';

import { UiBadgeComponent } from '../badge/badge.component';
import { UiChipGroupComponent } from './chip-group.component';

/**
 * A badge that can be removed, for an applied filter or a selected value: "Project: CNCF" with a × button. It looks exactly like `lfx-ui-badge`
 * (same sizes, pill radius, subtle and outline looks) and defaults to the accent subtle one. It only reports the dismissal: the parent owns
 * the list, so remove the chip from it in the `dismissed` handler. The × is a real button named "Remove" and the `label`, with a 24px hit area
 * on both sizes. Put chips in an `lfx-ui-chip-group` to get a list role, wrapping and focus that moves to a neighbouring chip on removal;
 * a chip on its own leaves focus handling to the parent. A chip that cannot be removed is a plain `lfx-ui-badge`; `dismissible` off keeps
 * the chip's look for a read-only copy of the same filter. A leading icon goes in as `<i slot="icon" class="fa-light fa-..."></i>`.
 */
@Component({
  selector: 'lfx-ui-chip',
  imports: [UiBadgeComponent],
  templateUrl: './chip.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'inline-flex max-w-full',
    '[attr.role]': 'group ? "listitem" : null',
    'data-testid': 'ui-chip',
  },
})
export class UiChipComponent {
  private readonly group = inject(UiChipGroupComponent, { optional: true });

  /** The text of the chip, such as "Project: CNCF". It also names the × button: "Remove Project: CNCF". */
  public readonly label = input.required<string>();
  /** Colour role of the `subtle` look; `accent` is the filter-chip default. Ignored by `outline`. */
  public readonly tone = input<UiBadgeTone>('accent');
  /** `subtle` is the role's 100 fill with 700 text; `outline` is a hairline ring on the page background for neutral metadata. */
  public readonly variant = input<UiChipVariant>('subtle');
  /** `sm` is 20px tall with 11px text; `md` is 24px tall with 12px text, the badge's default. */
  public readonly size = input<'sm' | 'md'>('md');
  /** Shows the × button. Turn it off for a read-only chip. */
  public readonly dismissible = input<boolean, unknown>(true, { transform: booleanAttribute });
  /** Emits when the × is activated by click, Enter or Space. The chip does not remove itself: drop it from the parent's list. */
  public readonly dismissed = output<void>();

  protected readonly removeLabel: Signal<string> = computed(() => `Remove ${this.label()}`);
  protected readonly dismissClasses: Signal<string> = this.initDismissClasses();

  protected onDismiss(button: HTMLElement): void {
    this.group?.focusNeighbour(button);
    this.dismissed.emit();
  }

  private initDismissClasses(): Signal<string> {
    return computed(() => {
      // Exact px, not rem; 14px root. The circle is the badge height minus 4px, tucked into the badge's side padding; the after element
      // widens the hit area to 24px on both sizes, as the library asks of every target.
      const sizes = { sm: 'h-[16px] w-[16px] -mr-[4px]', md: 'h-[20px] w-[20px] -mr-[8px]' };
      const hit = "after:absolute after:left-1/2 after:top-1/2 after:h-[24px] after:w-[24px] after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']";
      // forced-colors: shadows vanish, so an outline marks focus.
      const focus =
        'focus-visible:shadow-focus focus-visible:outline-none forced-colors:focus-visible:outline forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-[color:Highlight]';
      return `relative inline-flex shrink-0 cursor-pointer items-center justify-center rounded-ui-full text-current transition-colors duration-ui-fast ease-ui-standard hover:bg-ui-neutral-alpha-100 active:bg-ui-neutral-alpha-200 motion-reduce:transition-none ${sizes[this.size()]} ${hit} ${focus}`;
    });
  }
}
