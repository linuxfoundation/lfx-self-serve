// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser, NgTemplateOutlet } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  PLATFORM_ID,
  Signal,
  signal,
  viewChild,
  WritableSignal,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { MeetingComposerService } from '@app/modules/meetings/meeting-composer/meeting-composer.service';
import { IMPERSONATION_BANNER_HEIGHT_PX, MEETINGS_HOME_PAGE_SIZE } from '@lfx-one/shared/constants';
import { MeetingDashboardView, MeetingHomeRow, UiTabItem } from '@lfx-one/shared/interfaces';
import { CreateArtifactDialogService } from '@services/create-artifact-dialog.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
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
import { MeetingsHomeStore } from './services/meetings-home.store';

/**
 * Redesigned Home / Me lens meetings page (epic #4468).
 * @description Header with the Pending RSVPs and Create Meeting buttons, tabs bar and the day-grouped meetings list in the centre; Next meeting and Last meeting
 * in a fixed 360px right column. At 1024px and below the right column folds into the centre,
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
  ],
  templateUrl: './meetings-redesign.component.html',
  providers: [MeetingsHomeStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block -mx-5 -mt-6 md:-mx-8',
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
  protected readonly store = inject(MeetingsHomeStore);

  private readonly centre = viewChild<ElementRef<HTMLElement>>('centre');
  private readonly header = viewChild<ElementRef<HTMLElement>>('header');
  private readonly tabsBar = viewChild<ElementRef<HTMLElement>>('tabsBar');
  private readonly loadMoreTrigger = viewChild<ElementRef<HTMLElement>>('loadMoreTrigger');
  /** Takes focus when the last pending RSVP is answered. */
  protected readonly createButton = viewChild<UiButtonComponent>('createButton');
  /** Takes focus when the last pending RSVP is answered and there is no Create Meeting button. */
  protected readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  /** Takes focus when the last filter chip is removed. */
  protected readonly filtersControl = viewChild(MeetingsFiltersComponent);

  protected readonly idPrefix = 'meetings-redesign';
  protected readonly skeletonRows = [0, 1, 2, 3, 4];
  protected readonly personaLoaded = this.personaService.personaLoaded;
  /** Same gate as the legacy page's Create Meeting; the create dialog then picks the project and the v2 composer or the old route. */
  protected readonly canWriteMeetings: Signal<boolean> = inject(ProjectContextService).canWriteMeetings;
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
  protected readonly tabs: Signal<UiTabItem[]> = this.initTabs();
  /** The Next meeting as a one-item list, so its menu is keyed by row. */
  protected readonly nextRows: Signal<MeetingHomeRow[]> = computed(() => {
    const row = this.store.nextRow();
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
  protected readonly noResults: Signal<boolean> = computed(() => !this.store.loading() && !this.tabEmpty() && this.store.matchingRows().length === 0);
  /** "All N meetings loaded" once every row of a list longer than one page is shown. */
  protected readonly allLoaded: Signal<boolean> = computed(
    () => !this.store.loading() && !this.store.hasMore() && this.store.filteredRows().length > MEETINGS_HOME_PAGE_SIZE
  );

  public constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => this.store.setTab(params.get('time') === 'past' ? 'past' : 'upcoming'));
    this.initLoadMore();
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
      const footer = this.footer();
      if (header) observer.observe(header);
      if (footer) observer.observe(footer);
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
    if (header) this.headerHeight.set(header.offsetHeight);

    if (window.matchMedia('(min-width: 1025px)').matches) {
      const host = this.host.nativeElement;
      const top = host.getBoundingClientRect().top + window.scrollY;
      this.columnHeight.set(Math.max(Math.floor(window.innerHeight - top - this.ancestorPaddingBottom() - (this.footer()?.offsetHeight ?? 0)), 0));
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

  /** Bottom padding of every ancestor up to `main` — the layout's content wrapper sits above the route-entry host, not directly over this one. */
  private ancestorPaddingBottom(): number {
    let total = 0;
    for (let el = this.host.nativeElement.parentElement; el && el.tagName !== 'MAIN'; el = el.parentElement) {
      total += parseFloat(getComputedStyle(el).paddingBottom) || 0;
    }
    return total;
  }

  private footer(): HTMLElement | null {
    return this.host.nativeElement.closest('main')?.querySelector<HTMLElement>('lfx-app-footer') ?? null;
  }
}
