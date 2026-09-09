// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, input, PLATFORM_ID, Signal, viewChild } from '@angular/core';
import { MenuComponent } from '@components/menu/menu.component';
import { MeetingType } from '@lfx-one/shared/enums';
import { MeetingCreateMenuAlign, MeetingCreateMenuRow } from '@lfx-one/shared/interfaces';
import { getSelectableMeetingTypeOptions } from '@lfx-one/shared/utils';
import { PersonaService } from '@services/persona.service';
import { MenuItem } from 'primeng/api';

import { MeetingComposerService } from './meeting-composer.service';

/**
 * The Create Meeting dropdown: a quick start per meeting type, then the full drawer.
 * @description Every entry point that offers to create a meeting shows this, so the choice reads the
 * same wherever it's made — the meetings dashboard's Create Meeting button and the project
 * dashboard's Quick links both mount one and toggle it from their own trigger.
 *
 * The panel is a popup with no trigger of its own: PrimeNG teleports it to `body`, so the owner
 * renders this once next to whichever control opens it and calls {@link toggle} from that control's
 * click. It renders nothing at all until then.
 */
@Component({
  selector: 'lfx-meeting-create-menu',
  imports: [MenuComponent],
  templateUrl: './meeting-create-menu.component.html',
})
export class MeetingCreateMenuComponent {
  private readonly personaService = inject(PersonaService);
  private readonly composer = inject(MeetingComposerService);
  private readonly platformId = inject(PLATFORM_ID);

  /**
   * Project the new meeting belongs to, for a trigger that already knows it.
   * @description Passed on to the composer, which documents an explicit project as taking precedence
   * over the ambient project context — that context resolves asynchronously, so a composer opened
   * straight after a project switch can otherwise open against the previous one. Omitted (or
   * `undefined`) leaves the composer on the ambient context, which is what a page that only ever
   * shows one project's meetings wants.
   */
  public readonly projectUid = input<string | undefined>(undefined);

  /**
   * Quick start per meeting type, then the full drawer.
   * @description The trigger has no default action of its own — creating a meeting always starts by
   * choosing one of these rows, so this model is the only entry point into either composer surface.
   * A type row opens the quick dialog pre-selected, so its template prefill runs immediately.
   * Types come from the same persona filter the composer's type select uses — otherwise a maintainer
   * could seed a type here that the select then hides, leaving it set but uneditable.
   */
  protected readonly createMenuItems: Signal<MenuItem[]> = this.initCreateMenuItems();

  /**
   * Which of the trigger's edges the panel lines up with.
   * @description Defaults to `'right'`, for a trigger that is itself the right edge of its layout —
   * the case that made the dropdown position itself in the first place.
   */
  public readonly align = input<MeetingCreateMenuAlign>('right');

  /** Smallest gap left between the popup and either viewport edge, in px. */
  private readonly viewportGutter = 8;

  private readonly menu = viewChild<MenuComponent>('menu');

  /**
   * The control the panel is aligned against, captured while its click is still being dispatched.
   * @description `currentTarget` is only set for the duration of the dispatch, so it can't be read
   * back in the `onShow` that follows.
   */
  private trigger: HTMLElement | null = null;

  /**
   * Opens or closes the dropdown against the control that was clicked.
   * @description Call this synchronously from the click handler: both this and PrimeNG's own
   * positioning read `event.currentTarget`, which is cleared once the dispatch ends.
   */
  public toggle(event: Event): void {
    this.trigger = (event.currentTarget ?? event.target) as HTMLElement | null;
    this.menu()?.toggle(event);
  }

  /**
   * Lines the dropdown up with its trigger, on the edge {@link align} asks for.
   * @description PrimeNG appends the popup to `body` and only ever lines its *left* edge up with the
   * trigger, which throws a 22rem panel out past the page edge for a trigger sitting on the right.
   * `p-menu` has no alignment input, so nudge the inline `left` PrimeNG just wrote, on every show,
   * since the trigger can move with the layout. Body-appended popups are positioned in page
   * coordinates, hence the scroll offset.
   */
  protected onShow(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    const trigger = this.trigger;

    // Next frame, not this one: PrimeNG emits `onShow` from the same handler that aligns the overlay,
    // so writing `left` here races its own write (and the panel is still mid-animation, so it hasn't
    // settled at its final width yet).
    requestAnimationFrame(() => {
      const panel = this.menu()?.overlayElement() ?? null;
      if (!trigger || !panel) {
        return;
      }

      panel.style.left = `${window.scrollX + this.alignedLeft(trigger.getBoundingClientRect(), panel.offsetWidth)}px`;
    });
  }

  /**
   * Viewport-relative `left` for the panel, clamped inside the gutter on both sides.
   * @description Clamping the far edge as well as the near one matters for `'center'`: half a 22rem
   * panel reaches past a narrow column's trigger in both directions, so an uncorrected centre can
   * overflow either side depending on where the column sits.
   */
  private alignedLeft(triggerRect: DOMRect, panelWidth: number): number {
    const anchored = this.align() === 'center' ? triggerRect.left + (triggerRect.width - panelWidth) / 2 : triggerRect.right - panelWidth;
    const furthestLeft = document.documentElement.clientWidth - panelWidth - this.viewportGutter;

    // `Math.max` last, so a panel wider than the viewport still starts at the gutter rather than
    // being pushed off the left edge by a negative `furthestLeft`.
    return Math.max(Math.min(anchored, furthestLeft), this.viewportGutter);
  }

  private initCreateMenuItems(): Signal<MenuItem[]> {
    return computed(() => {
      const typeRows: (MenuItem & MeetingCreateMenuRow)[] = getSelectableMeetingTypeOptions(this.personaService.currentPersona()).map((option) => ({
        // Suffixed here rather than in the shared option: `option.label` is the bare noun ("Board")
        // the type tag and the Details & Access select render, and only this dropdown reads as a
        // list of things to create — so only this dropdown says "Board meeting". `Other` is the
        // exception: it names the absence of a type rather than a kind of meeting, so "Other
        // meeting" would read as a category of its own.
        label: option.value === MeetingType.OTHER ? option.label : `${option.label} meeting`,
        icon: option.info.icon,
        // Reuses the type's composer description so the dropdown and the Details & Access select
        // never explain the same meeting type two different ways.
        description: option.info.description,
        tileClass: 'bg-gray-50 text-gray-700',
        testId: `meeting-create-quick-${option.value.toLowerCase()}`,
        command: () => this.openQuickCreate(option.value),
      }));
      const advancedRow: MenuItem & MeetingCreateMenuRow = {
        label: 'Advanced',
        icon: 'fa-light fa-sliders',
        description: 'Configure every aspect of your meeting',
        // Tinted rather than neutral: this row leaves the quick path for the full composer, so it
        // shouldn't read as a seventh meeting type.
        tileClass: 'bg-blue-100 text-blue-600',
        testId: 'meeting-create-advanced',
        command: () => this.openAdvancedCreate(),
      };

      // One group, not two: PrimeNG renders every *top-level* entry as a submenu label once any entry
      // has children, so a top-level Advanced would come out as a second section heading. Keeping it
      // inside the group behind an item separator also matches the prototype, which shows a single
      // "Quick start" heading and a divider above Advanced.
      return [{ label: 'Quick start', items: [...typeRows, { separator: true }, advancedRow] }];
    });
  }

  private openQuickCreate(meetingType: MeetingType): void {
    this.composer.open({ mode: 'create', variant: 'quick', meetingType, projectUid: this.projectUid() });
  }

  private openAdvancedCreate(): void {
    this.composer.open({ mode: 'create', projectUid: this.projectUid() });
  }
}
