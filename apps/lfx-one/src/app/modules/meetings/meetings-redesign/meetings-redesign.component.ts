// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgTemplateOutlet } from '@angular/common';
import { afterNextRender, ChangeDetectionStrategy, Component, DestroyRef, ElementRef, inject, signal, viewChild, WritableSignal } from '@angular/core';
import { IMPERSONATION_BANNER_HEIGHT_PX } from '@lfx-one/shared/constants';
import { UiTabItem } from '@lfx-one/shared/interfaces';
import { UserService } from '@services/user.service';
import { UiSearchInputComponent } from '@shared/uikit/search-input/search-input.component';
import { UiTabsComponent } from '@shared/uikit/tabs/tabs.component';

/**
 * Redesigned Home / Me lens meetings page — layout shell only, no data yet (epic #4468).
 * @description Header, tabs bar and a scrolling list area in the centre; Next meeting, Last meeting and
 * Pending RSVPs in a fixed 360px right column. At 1024px and below the right column folds into the centre,
 * above the tabs, and the window scrolls instead of the columns. Rendered by `MeetingsEntryComponent`
 * behind `MEETINGS_REDESIGN_FLAG`.
 *
 * The host cancels `main-layout`'s content padding (`-mx-5 md:-mx-8 -mt-6` are the exact negatives of its
 * `px-5 md:px-8 py-6`, same rem scale) so the design's gutters start at the page edge. On desktop the
 * page height is measured (viewport minus its own top, the layout's bottom padding and the footer) so the
 * columns scroll on their own without the window scrolling too.
 */
@Component({
  selector: 'lfx-meetings-redesign',
  imports: [NgTemplateOutlet, UiTabsComponent, UiSearchInputComponent],
  templateUrl: './meetings-redesign.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block -mx-5 -mt-6 md:-mx-8',
    '(window:resize)': 'measure()',
    '(window:scroll)': 'updateScroll()',
  },
})
export class MeetingsRedesignComponent {
  private readonly userService = inject(UserService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  private readonly centre = viewChild<ElementRef<HTMLElement>>('centre');
  private readonly header = viewChild<ElementRef<HTMLElement>>('header');
  private readonly tabsBar = viewChild<ElementRef<HTMLElement>>('tabsBar');

  protected readonly idPrefix = 'meetings-redesign';
  protected readonly tabs: UiTabItem[] = [
    { value: 'upcoming', label: 'Upcoming' },
    { value: 'past', label: 'Past' },
  ];
  protected readonly railBlocks: { key: string; label: string }[] = [
    { key: 'next-meeting', label: 'Next meeting' },
    { key: 'last-meeting', label: 'Last meeting' },
    { key: 'pending-rsvps', label: 'Pending RSVPs' },
  ];
  protected readonly activeTab = signal<string>('upcoming');
  protected readonly search = signal<string>('');
  /** Measured header height; the tabs bar sticks right below it. */
  protected readonly headerHeight: WritableSignal<number> = signal(0);
  /** Page height on desktop, where the columns scroll on their own; `null` when the window scrolls (1024px and below). */
  protected readonly columnHeight: WritableSignal<number | null> = signal(null);
  /** Where the sticky header stops: 0 inside the centre column, below the mobile menu bar and impersonation banner otherwise. */
  protected readonly stickyTop: WritableSignal<number> = signal(0);
  /** True once the page has scrolled past the top. */
  protected readonly scrolled: WritableSignal<boolean> = signal(false);
  /** True once the tabs bar has reached its sticky position; the fade then sits under it instead of the header. */
  protected readonly tabsStuck: WritableSignal<boolean> = signal(false);

  public constructor() {
    afterNextRender(() => {
      const observer = new ResizeObserver(() => this.measure());
      const header = this.header()?.nativeElement;
      const footer = this.footer();
      if (header) observer.observe(header);
      if (footer) observer.observe(footer);
      this.destroyRef.onDestroy(() => observer.disconnect());
      this.measure();
    });
  }

  protected measure(): void {
    const header = this.header()?.nativeElement;
    if (header) this.headerHeight.set(header.offsetHeight);

    if (window.matchMedia('(min-width: 1025px)').matches) {
      const host = this.host.nativeElement;
      const layoutPadding = host.parentElement ? parseFloat(getComputedStyle(host.parentElement).paddingBottom) || 0 : 0;
      const top = host.getBoundingClientRect().top + window.scrollY;
      this.columnHeight.set(Math.max(Math.floor(window.innerHeight - top - layoutPadding - (this.footer()?.offsetHeight ?? 0)), 0));
      this.stickyTop.set(0);
    } else {
      // The layout's mobile menu bar is `sticky top-0` (below the banner while impersonating) and is absent on non-touch devices.
      const menuBar = document.querySelector<HTMLElement>('[data-testid="mobile-menu-button"]')?.parentElement;
      this.columnHeight.set(null);
      this.stickyTop.set((this.userService.impersonating() ? IMPERSONATION_BANNER_HEIGHT_PX : 0) + (menuBar?.offsetHeight ?? 0));
    }

    this.updateScroll();
  }

  protected updateScroll(): void {
    const centre = this.centre()?.nativeElement;
    const tabsBar = this.tabsBar()?.nativeElement;
    if (!centre || !tabsBar) return;

    const desktop = this.columnHeight() !== null;
    const scrolled = (desktop ? centre.scrollTop : window.scrollY) > 2;
    const stickyEdge = desktop ? centre.getBoundingClientRect().top : this.stickyTop();
    this.scrolled.set(scrolled);
    this.tabsStuck.set(scrolled && tabsBar.getBoundingClientRect().top - stickyEdge <= this.headerHeight() + 1);
  }

  private footer(): HTMLElement | null {
    return this.host.nativeElement.closest('main')?.querySelector<HTMLElement>('lfx-app-footer') ?? null;
  }
}
