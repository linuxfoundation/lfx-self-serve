// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, inject, output, PLATFORM_ID, signal, viewChild } from '@angular/core';
import { MenuComponent } from '@components/menu/menu.component';
import { VOTE_METHOD_OPTIONS } from '@lfx-one/shared/constants';
import { PollType } from '@lfx-one/shared/enums';
import { VoteCreateMenuRow } from '@lfx-one/shared/interfaces';
import { MenuItem } from 'primeng/api';

/**
 * The Create Vote dropdown: one row per voting method.
 * @description Mirrors `lfx-meeting-create-menu` — a popup PrimeNG teleports to `body`, so the owner
 * renders this once next to its trigger and calls {@link toggle} from that trigger's click. Unlike the
 * meeting menu it doesn't open anything itself: it only emits the chosen method, because the group
 * Votes tab re-checks write access before navigating and the dashboard doesn't.
 */
@Component({
  selector: 'lfx-vote-create-menu',
  imports: [MenuComponent],
  templateUrl: './vote-create-menu.component.html',
})
export class VoteCreateMenuComponent {
  private readonly platformId = inject(PLATFORM_ID);

  /** Emitted with the voting method of the row the user picked. */
  public readonly methodSelected = output<PollType>();

  /**
   * One row per method in {@link VOTE_METHOD_OPTIONS}, under a single "Vote type" heading.
   * @description Built once: the rows depend on nothing reactive. The description is shared with the
   * form's Voting Method select so both explain each method the same way.
   */
  protected readonly menuItems: MenuItem[] = [
    {
      label: 'Vote type',
      items: VOTE_METHOD_OPTIONS.map((option): MenuItem & VoteCreateMenuRow => ({
        // "Plurality vote" reads as a thing to create; "Condorcet IRV" already names one.
        label: option.value === PollType.GENERIC ? `${option.label} vote` : option.label,
        icon: option.icon,
        description: option.description,
        tileClass: 'bg-gray-50 text-gray-700',
        testId: `vote-create-method-${option.value}`,
        command: () => this.methodSelected.emit(option.value),
      })),
    },
  ];

  /** Whether the panel is showing, for the trigger's bound `aria-expanded`. */
  private readonly _isOpen = signal(false);
  public readonly isOpen = this._isOpen.asReadonly();

  /** Smallest gap left between the popup and either viewport edge, in px. */
  private readonly viewportGutter = 8;

  private readonly menu = viewChild<MenuComponent>('menu');

  /** The control the panel is aligned against, captured while its click is still being dispatched. */
  private trigger: HTMLElement | null = null;

  /**
   * Opens or closes the dropdown against the control that was clicked.
   * @description Call this synchronously from the click handler: `event.currentTarget` is cleared once
   * the dispatch ends.
   */
  public toggle(event: Event): void {
    this.trigger = (event.currentTarget ?? event.target) as HTMLElement | null;
    this.menu()?.toggle(event);
  }

  /**
   * Lines the panel's right edge up with the trigger's.
   * @description PrimeNG only left-aligns a popup, which throws this panel off the page for a trigger
   * on the right — every Create Vote trigger is. Runs next frame so it doesn't race PrimeNG's own
   * `left` write (see `MeetingCreateMenuComponent.onShow`).
   */
  protected onShow(): void {
    this._isOpen.set(true);

    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    const trigger = this.trigger;
    requestAnimationFrame(() => {
      const panel = this.menu()?.overlayElement() ?? null;
      if (!trigger || !panel) {
        return;
      }

      panel.style.left = `${window.scrollX + this.alignedLeft(trigger.getBoundingClientRect(), panel.offsetWidth)}px`;
    });
  }

  /** Mirrors every way the panel can close — an outside click, Escape, or a row's command. */
  protected onHide(): void {
    this._isOpen.set(false);
  }

  /** Viewport-relative `left` for a right-aligned panel, clamped inside the gutter on both sides. */
  private alignedLeft(triggerRect: DOMRect, panelWidth: number): number {
    const furthestLeft = document.documentElement.clientWidth - panelWidth - this.viewportGutter;
    return Math.max(Math.min(triggerRect.right - panelWidth, furthestLeft), this.viewportGutter);
  }
}
