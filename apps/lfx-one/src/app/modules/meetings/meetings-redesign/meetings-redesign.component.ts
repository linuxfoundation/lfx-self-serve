// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser, NgTemplateOutlet } from '@angular/common';
import {
  afterNextRender,
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  PLATFORM_ID,
  Signal,
  signal,
  untracked,
  viewChild,
  WritableSignal,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { MeetingComposerService } from '@app/modules/meetings/meeting-composer/meeting-composer.service';
import { IMPERSONATION_BANNER_HEIGHT_PX, MEETINGS_HOME_DAY_HEADING_GAP_PX } from '@lfx-one/shared/constants';
import { MeetingDashboardView, MeetingHomeRow, UiTabItem } from '@lfx-one/shared/interfaces';
import { countAppliedMeetingFilters } from '@lfx-one/shared/utils';
import { AppFooterComponent } from '@components/app-footer/app-footer.component';
import { AppService } from '@services/app.service';
import { CreateArtifactDialogService } from '@services/create-artifact-dialog.service';
import { PersonaService } from '@services/persona.service';
import { UserService } from '@services/user.service';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiChipGroupComponent } from '@shared/uikit/chip/chip-group.component';
import { UiChipComponent } from '@shared/uikit/chip/chip.component';
import { UiEmptyStateComponent } from '@shared/uikit/empty-state/empty-state.component';
import { UiSearchInputComponent } from '@shared/uikit/search-input/search-input.component';
import { UiSkeletonComponent } from '@shared/uikit/skeleton/skeleton.component';
import { UiTabsComponent } from '@shared/uikit/tabs/tabs.component';
import { EMPTY, Observable, skip, switchMap } from 'rxjs';

import { LastMeetingCardComponent } from './components/last-meeting-card/last-meeting-card.component';
import { MeetingHomeActionsComponent } from './components/meeting-home-actions/meeting-home-actions.component';
import { MeetingsDayGroupComponent } from './components/meetings-day-group/meetings-day-group.component';
import { MeetingsFiltersComponent } from './components/meetings-filters/meetings-filters.component';
import { NextMeetingCardComponent } from './components/next-meeting-card/next-meeting-card.component';
import { PendingRsvpsComponent } from './components/pending-rsvps/pending-rsvps.component';
import { MeetingsHomeDeleteService } from './services/meetings-home-delete.service';
import { MeetingsHomeDetailsService } from './services/meetings-home-details.service';
import { MeetingsHomeEditService } from './services/meetings-home-edit.service';
import { MeetingsHomeStore } from './services/meetings-home.store';

/**
 * Redesigned Home / Me lens meetings page (epic #4468).
 * @description Header with the Pending RSVPs and Create Meeting buttons, tabs bar and the day-grouped meetings list in the centre; Next meeting and Last meeting
 * in a fixed 360px right column. At 1024px and below the right column folds into the centre,
 * above the tabs, and the window scrolls instead of the columns. Rendered by `MeetingsEntryComponent`
 * behind `MEETINGS_REDESIGN_FLAG`.
 *
 * The host cancels `main-layout`'s content padding (`-mx-5 md:-mx-8 -my-6` are the exact negatives of its
 * `px-5 md:px-8 py-6`, same rem scale) so the design's gutters start at the page edge. The page renders the
 * app footer at the end of the centre column in place of the layout's. On desktop the page height is measured
 * (viewport minus its own top) so the columns scroll on their own without the window scrolling too; below that
 * the same value is the page's minimum height, so the footer reaches the bottom of a short page.
 */
@Component({
  selector: 'lfx-meetings-redesign',
  imports: [
    NgTemplateOutlet,
    UiTabsComponent,
    UiSearchInputComponent,
    UiSkeletonComponent,
    UiEmptyStateComponent,
    UiButtonComponent,
    UiChipGroupComponent,
    UiChipComponent,
    MeetingsDayGroupComponent,
    MeetingHomeActionsComponent,
    MeetingsFiltersComponent,
    LastMeetingCardComponent,
    NextMeetingCardComponent,
    PendingRsvpsComponent,
    AppFooterComponent,
  ],
  templateUrl: './meetings-redesign.component.html',
  providers: [MeetingsHomeStore, MeetingsHomeEditService, MeetingsHomeDeleteService, MeetingsHomeDetailsService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block -mx-5 -my-6 md:-mx-8',
    '(window:resize)': 'measure()',
    '(window:scroll)': 'updateScroll()',
  },
})
export class MeetingsRedesignComponent {
  private readonly userService = inject(UserService);
  private readonly personaService = inject(PersonaService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly createArtifactDialog = inject(CreateArtifactDialogService);
  private readonly composer = inject(MeetingComposerService);
  private readonly appService = inject(AppService);
  protected readonly store = inject(MeetingsHomeStore);

  private readonly centre = viewChild<ElementRef<HTMLElement>>('centre');
  private readonly header = viewChild<ElementRef<HTMLElement>>('header');
  private readonly tabsBar = viewChild<ElementRef<HTMLElement>>('tabsBar');
  private readonly list = viewChild<ElementRef<HTMLElement>>('list');
  private readonly loadMoreTrigger = viewChild<ElementRef<HTMLElement>>('loadMoreTrigger');
  private readonly chips = viewChild(UiChipGroupComponent, { read: ElementRef });
  /** Takes focus when the last pending RSVP is answered. */
  protected readonly createButton = viewChild<UiButtonComponent>('createButton');
  /** Takes focus when the last filter chip is removed. */
  protected readonly filtersControl = viewChild(MeetingsFiltersComponent);

  protected readonly idPrefix = 'meetings-redesign';
  protected readonly skeletonRows = [0, 1, 2, 3, 4];
  /** Widths of the skeleton row's buttons: Yes / No / Maybe upcoming, Recording and AI Summary past. */
  protected readonly skeletonButtons: Record<MeetingDashboardView, string[]> = { upcoming: ['58px', '76px', '54px'], past: ['134px', '108px'] };
  protected readonly personaLoaded = this.personaService.personaLoaded;
  /** Measured header height; the tabs bar sticks right below it. */
  protected readonly headerHeight: WritableSignal<number> = signal(0);
  /** Measured tabs bar height; the day headings stick right below it. */
  protected readonly tabsBarHeight: WritableSignal<number> = signal(0);
  /** Page height on desktop, where the columns scroll on their own; `null` when the window scrolls (1024px and below). */
  protected readonly columnHeight: WritableSignal<number | null> = signal(null);
  /** Page minimum height at 1024px and below, so the footer sits at the bottom of a short page; `null` on desktop. */
  protected readonly pageMinHeight: WritableSignal<number | null> = signal(null);
  /** Where the sticky header stops: 0 inside the centre column, below the mobile menu bar and impersonation banner otherwise. */
  protected readonly stickyTop: WritableSignal<number> = signal(0);
  /** True once the page has scrolled past the top. */
  protected readonly scrolled: WritableSignal<boolean> = signal(false);
  /** True once the tabs bar has reached its sticky position; the fade then sits under it instead of the header. */
  protected readonly tabsStuck: WritableSignal<boolean> = signal(false);
  /** True while the list runs under the tabs bar, so a day heading is stuck there; the fade then sits under the heading. */
  protected readonly dayHeadingStuck: WritableSignal<boolean> = signal(false);
  /** Where the day headings stick: below the sticky header and tabs bar. */
  protected readonly dayHeadingTop: Signal<number> = computed(() => this.stickyTop() + this.headerHeight() + this.tabsBarHeight());
  protected readonly tabs: Signal<UiTabItem[]> = this.initTabs();
  /** The Next meeting card's date as a one-item list, so its menu is keyed by row. */
  protected readonly nextRows: Signal<MeetingHomeRow[]> = computed(() => {
    const row = this.store.nextCardRow();
    return row ? [row] : [];
  });
  /** The Last meeting as a one-item list, so its menu is keyed by row. */
  protected readonly lastRows: Signal<MeetingHomeRow[]> = computed(() => {
    const row = this.store.lastMeeting();
    return row ? [row] : [];
  });
  /** The active tab has no meetings at all. */
  protected readonly tabEmpty: Signal<boolean> = computed(() => !this.store.loading() && this.store.tabRows().length === 0);
  /** The active tab has meetings, but none match the search and filters. */
  protected readonly noResults: Signal<boolean> = computed(() => !this.store.loading() && !this.tabEmpty() && this.store.filteredRows().length === 0);
  /** No-results copy: search only, filters only, or both. */
  protected readonly noResultsDescription: Signal<string> = computed(() => {
    if (countAppliedMeetingFilters(this.store.filters()) === 0) return 'No meetings match your search';
    return this.store.search().trim() ? 'No meetings match your filters' : 'Try adjusting your filter criteria';
  });

  public constructor() {
    this.destroyRef.onDestroy(this.appService.claimFooter());
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => this.store.setTab(params.get('time') === 'past' ? 'past' : 'upcoming'));
    this.initLoadMore();
    // The list comes and goes with the tab's state without a scroll, so re-check the stuck day heading then.
    afterRenderEffect(() => {
      this.list();
      untracked(() => this.updateScroll());
    });
    // A new tab, search or filters starts at the list's first row, so a trigger left in view does not load a page.
    afterRenderEffect(() => {
      this.store.tab();
      this.store.search();
      this.store.filters();
      untracked(() => this.scrollToListStart());
    });
    // The composer saves in place, so refetch to show the new or edited meeting; skip(1) drops the replayed count.
    toObservable(this.composer.saveCount)
      .pipe(skip(1), takeUntilDestroyed())
      .subscribe(() => {
        this.userService.refreshUserMeetings();
        this.userService.refreshUserPastMeetings();
      });

    afterNextRender(() => {
      const observer = new ResizeObserver(() => this.measure());
      const header = this.header()?.nativeElement;
      const tabsBar = this.tabsBar()?.nativeElement;
      if (header) observer.observe(header);
      if (tabsBar) observer.observe(tabsBar);
      this.destroyRef.onDestroy(() => observer.disconnect());
      this.measure();
    });
  }

  protected onTabChange(value: string): void {
    const tab: MeetingDashboardView = value === 'past' ? 'past' : 'upcoming';
    if (tab === this.store.tab()) return;
    this.store.setTab(tab);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { time: tab === 'past' ? 'past' : null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected createMeeting(): void {
    this.createArtifactDialog.open('meeting');
  }

  protected measure(): void {
    const header = this.header()?.nativeElement;
    const tabsBar = this.tabsBar()?.nativeElement;
    if (header) this.headerHeight.set(header.offsetHeight);
    if (tabsBar) this.tabsBarHeight.set(tabsBar.offsetHeight);

    const top = this.host.nativeElement.getBoundingClientRect().top + window.scrollY;
    const available = Math.max(Math.floor(window.innerHeight - top), 0);
    if (window.matchMedia('(min-width: 1025px)').matches) {
      this.columnHeight.set(available);
      this.pageMinHeight.set(null);
      this.stickyTop.set(0);
    } else {
      // The layout's mobile menu bar is `sticky top-0` (below the banner while impersonating) and is absent on non-touch devices.
      const menuBar = document.querySelector<HTMLElement>('[data-testid="mobile-menu-button"]')?.parentElement;
      this.columnHeight.set(null);
      this.pageMinHeight.set(available);
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
    const list = this.list()?.nativeElement.getBoundingClientRect();
    const headingTop = stickyEdge + this.headerHeight() + this.tabsBarHeight();
    // The heading's padded box starts above the list by the gap, so it sticks that much sooner.
    this.dayHeadingStuck.set(!!list && list.top - MEETINGS_HOME_DAY_HEADING_GAP_PX <= headingTop && list.bottom > headingTop);
  }

  private initTabs(): Signal<UiTabItem[]> {
    return computed(() => [
      this.tabItem('upcoming', 'Upcoming', this.store.upcomingLoading() || this.store.upcomingFailed(), this.store.upcomingRows().length),
      this.tabItem('past', 'Past', this.store.pastLoading() || this.store.pastFailed(), this.store.pastRows().length),
    ]);
  }

  /** Shows the next page once the trigger, the list's last 280px, scrolls into view; a new page re-creates it. */
  private initLoadMore(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    toObservable(this.loadMoreTrigger)
      .pipe(
        switchMap((trigger) =>
          trigger
            ? new Observable<void>((subscriber) => {
                const observer = new IntersectionObserver((entries) => {
                  if (entries.some((entry) => entry.isIntersecting)) subscriber.next();
                });
                observer.observe(trigger.nativeElement);
                return () => observer.disconnect();
              })
            : EMPTY
        ),
        takeUntilDestroyed()
      )
      .subscribe(() => this.store.loadMore());
  }

  private tabItem(value: MeetingDashboardView, label: string, unknown: boolean, count: number): UiTabItem {
    return unknown ? { value, label } : { value, label, count, countLabel: `${count} ${count === 1 ? 'meeting' : 'meetings'}` };
  }

  /** Scrolls the chips or list back up to just below the sticky tabs bar when they have scrolled under it. */
  private scrollToListStart(): void {
    const centre = this.centre()?.nativeElement;
    const start: HTMLElement | undefined = this.chips()?.nativeElement ?? this.list()?.nativeElement;
    if (!centre || !start) return;

    const desktop = this.columnHeight() !== null;
    const stickyEdge = desktop ? centre.getBoundingClientRect().top : this.stickyTop();
    const offset = start.getBoundingClientRect().top - (stickyEdge + this.headerHeight() + this.tabsBarHeight());
    if (offset >= 0) return;
    if (desktop) centre.scrollBy({ top: offset });
    else window.scrollBy({ top: offset });
  }
}
