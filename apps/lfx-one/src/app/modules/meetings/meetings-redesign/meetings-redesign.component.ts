// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Overlay } from '@angular/cdk/overlay';
import { isPlatformBrowser, Location, NgTemplateOutlet } from '@angular/common';
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
import {
  IMPERSONATION_BANNER_HEIGHT_PX,
  MEETINGS_HOME_DAY_HEADING_GAP_PX,
  MEETINGS_HOME_DAY_SCROLL_DELAY_MS,
  MEETINGS_HOME_DAY_SCROLL_OFFSET_PX,
  PHONE_MEDIA_QUERY,
} from '@lfx-one/shared/constants';
import { MeetingCalendarDialogData, MeetingDashboardView, MeetingHomeRow, MeetingMiniCalendarDay, UiTabItem } from '@lfx-one/shared/interfaces';
import { countAppliedMeetingFilters } from '@lfx-one/shared/utils';
import { AppFooterComponent } from '@components/app-footer/app-footer.component';
import { AppService } from '@services/app.service';
import { CreateArtifactDialogService } from '@services/create-artifact-dialog.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiChipGroupComponent } from '@shared/uikit/chip/chip-group.component';
import { UiChipComponent } from '@shared/uikit/chip/chip.component';
import { UiEmptyStateComponent } from '@shared/uikit/empty-state/empty-state.component';
import { UiModalService } from '@shared/uikit/modal/modal.service';
import { UiSearchInputComponent } from '@shared/uikit/search-input/search-input.component';
import { UiSkeletonComponent } from '@shared/uikit/skeleton/skeleton.component';
import { UiTabsComponent } from '@shared/uikit/tabs/tabs.component';
import { injectIsMobileViewport } from '@shared/utils/mobile-viewport.util';
import { debounceTime, EMPTY, filter, Observable, skip, switchMap, take } from 'rxjs';

import { LastMeetingCardComponent } from './components/last-meeting-card/last-meeting-card.component';
import { MeetingHomeActionsComponent } from './components/meeting-home-actions/meeting-home-actions.component';
import { MeetingsCalendarDialogComponent } from './components/meetings-calendar-dialog/meetings-calendar-dialog.component';
import { MeetingsDayGroupComponent } from './components/meetings-day-group/meetings-day-group.component';
import { MeetingsFiltersComponent } from './components/meetings-filters/meetings-filters.component';
import { MeetingsMiniCalendarComponent } from './components/meetings-mini-calendar/meetings-mini-calendar.component';
import { NextMeetingCardComponent } from './components/next-meeting-card/next-meeting-card.component';
import { PendingRsvpsComponent } from './components/pending-rsvps/pending-rsvps.component';
import { MeetingsHomeDeleteService } from './services/meetings-home-delete.service';
import { MeetingsHomeDetailsService } from './services/meetings-home-details.service';
import { MeetingsHomeEditService } from './services/meetings-home-edit.service';
import { MeetingsHomeFeed, provideMeetingsHomeFeed } from './services/meetings-home-feed';
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
    MeetingsMiniCalendarComponent,
    LastMeetingCardComponent,
    NextMeetingCardComponent,
    PendingRsvpsComponent,
    AppFooterComponent,
  ],
  templateUrl: './meetings-redesign.component.html',
  providers: [...provideMeetingsHomeFeed(), MeetingsHomeStore, MeetingsHomeEditService, MeetingsHomeDeleteService, MeetingsHomeDetailsService],
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
  private readonly location = inject(Location);
  private readonly route = inject(ActivatedRoute);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly createArtifactDialog = inject(CreateArtifactDialogService);
  private readonly composer = inject(MeetingComposerService);
  private readonly appService = inject(AppService);
  protected readonly store = inject(MeetingsHomeStore);
  private readonly projectContext = inject(ProjectContextService);
  private readonly modal = inject(UiModalService);
  private readonly overlay = inject(Overlay);
  private readonly details = inject(MeetingsHomeDetailsService);
  /** A project or foundation's list: no Next/Last cards or project labels, and its own copy. */
  protected readonly projectScope: boolean = inject(MeetingsHomeFeed).scope === 'project';
  /** The viewer and project the meetings come from. */
  protected readonly feedKey: Signal<string> = inject(MeetingsHomeFeed).key;

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
  // A literal here so Tailwind generates it; the rows get it from the DOM to restart the flash.
  private readonly rowFlashClass = 'motion-safe:animate-meetings-row-flash';

  protected readonly idPrefix = 'meetings-redesign';
  protected readonly skeletonRows = [0, 1, 2, 3, 4];
  /** Widths of the skeleton row's buttons: Yes / No / Maybe upcoming, Recording and AI Summary past. */
  protected readonly skeletonButtons: Record<MeetingDashboardView, string[]> = { upcoming: ['58px', '76px', '54px'], past: ['134px', '108px'] };
  protected readonly personaLoaded = this.personaService.personaLoaded;
  /** Below 640px, Create Meeting is an icon button. */
  protected readonly phone: Signal<boolean> = injectIsMobileViewport(PHONE_MEDIA_QUERY);
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
  /** Anyone can start from the Me lens picker; a project's list offers Create only to those who can write its meetings. */
  protected readonly canCreate: Signal<boolean> = computed(() => !this.projectScope || this.projectContext.canWriteMeetings());
  protected readonly description: Signal<string> = computed(() =>
    this.projectScope
      ? `Coordinate decisions, align stakeholders, and maintain transparent governance in ${this.projectContext.activeContext()?.name ?? 'this project'}.`
      : "Meetings you're invited to or organizing, across all your projects."
  );
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
  protected readonly tabEmpty: Signal<boolean> = computed(
    // A paged past feed searches on the server, so its empty rows under a query are no results, not an empty tab.
    () => !this.store.loading() && this.store.tabRows().length === 0 && !(this.store.pagedPast && this.store.tab() === 'past' && this.store.hasActiveQuery())
  );
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
    // A day picked on the calendar scrolls into view once its rows render; a later pick within the delay replaces it.
    toObservable(this.store.revealedDay)
      .pipe(filter(Boolean), debounceTime(MEETINGS_HOME_DAY_SCROLL_DELAY_MS), takeUntilDestroyed())
      .subscribe((day) => {
        // A tab, search or filter change in the meantime cancelled it.
        if (this.store.revealedDay() !== day) return;
        this.store.completeReveal();
        this.scrollToDay(day);
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
    this.syncTabParam(tab);
  }

  /** Lists every meeting of a day picked on the mini calendar, on its tab, with search and filters cleared. */
  protected showDay(day: MeetingMiniCalendarDay): void {
    this.store.showDay(day.key, day.tab);
    this.syncTabParam(day.tab);
  }

  /** Opens the full calendar on `month`; a meeting picked there opens its details drawer above it. */
  protected openCalendar(month: Date): void {
    const context = this.projectContext.activeContext();
    const data: MeetingCalendarDialogData = {
      upcomingRows: this.store.upcomingRows,
      pastRows: this.store.pastRows,
      now: this.store.now,
      name: context?.name ?? '',
      logoUrl: context?.logoUrl ?? '',
      openMeeting: (row) => this.details.open(row, 'calendar'),
      showPastFrom: (day) => this.store.showPastFrom(day),
      pastFailed: this.store.calendarPastFailed,
      retryPast: (day) => this.store.retryCalendarPast(day),
      upcomingFailed: this.store.upcomingFailed,
      retryUpcoming: () => this.store.retry(),
      month,
    };
    // Below an impersonation banner, as the drawers sit, so Stop impersonating stays reachable.
    const ref = this.modal.open(
      MeetingsCalendarDialogComponent,
      { data },
      {
        height: 'calc(100vh - 32px - var(--lfx-banner-height, 0px))',
        positionStrategy: this.overlay.position().global().top('calc(16px + var(--lfx-banner-height, 0px))').centerHorizontally(),
      }
    );
    ref.overlayRef.backdropElement?.style.setProperty('top', 'var(--lfx-banner-height, 0px)');
    // The modal service outlives the page, so leaving the page, for example from the drawer's project link, closes it.
    const unregister = this.destroyRef.onDestroy(() => ref.close());
    ref.closed.pipe(take(1)).subscribe(() => unregister());
  }

  protected createMeeting(): void {
    // The project lens already knows the project, so it skips the picker, as the legacy page's Advanced create did.
    if (this.projectScope) this.composer.open({ mode: 'create', projectUid: this.projectContext.activeContextUid() || undefined });
    else this.createArtifactDialog.open('meeting');
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
      this.tabItem('past', 'Past', this.store.pastLoading() || this.store.pastShowsError() || this.store.pastCountUnknown(), this.store.pastRows().length),
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

  /**
   * Rewrites `time` on the live address: the project selector moves `?project=` with `Location.replaceState`, so merging the
   * Router's own query params could put a previous project back.
   */
  private syncTabParam(tab: MeetingDashboardView): void {
    if (this.router.getCurrentNavigation()) return;
    const url = this.router.parseUrl(this.location.path(true));
    if (tab === 'past') url.queryParams['time'] = 'past';
    else delete url.queryParams['time'];
    this.location.replaceState(this.router.serializeUrl(url));
  }

  /** Scrolls the first row of `day` to just below the sticky tabs bar and flashes every row of that day. */
  private scrollToDay(day: string): void {
    const centre = this.centre()?.nativeElement;
    const rows = centre ? Array.from(centre.querySelectorAll<HTMLElement>(`[data-day="${day}"]`)) : [];
    if (!centre || !rows.length) return;

    const desktop = this.columnHeight() !== null;
    const stickyEdge = desktop ? centre.getBoundingClientRect().top : this.stickyTop();
    const top = rows[0].getBoundingClientRect().top - (stickyEdge + this.headerHeight() + this.tabsBarHeight() + MEETINGS_HOME_DAY_SCROLL_OFFSET_PX);
    if (desktop) centre.scrollBy({ top, behavior: 'smooth' });
    else window.scrollBy({ top, behavior: 'smooth' });
    for (const row of rows) {
      row.classList.remove(this.rowFlashClass);
      // Reading layout restarts the animation when the class comes back.
      void row.offsetWidth;
      row.classList.add(this.rowFlashClass);
    }
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
