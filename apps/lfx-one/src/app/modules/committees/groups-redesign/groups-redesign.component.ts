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
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { BEHAVIORAL_CLASS_CONFIG, BEHAVIORAL_CLASS_TONE, GROUPS_HOME_PAGE_SIZE, IMPERSONATION_BANNER_HEIGHT_PX } from '@lfx-one/shared/constants';
import { GroupBehavioralClass, GroupsHomeTab, UiTabItem } from '@lfx-one/shared/interfaces';
import { CreateArtifactDialogService } from '@services/create-artifact-dialog.service';
import { UserService } from '@services/user.service';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiChipGroupComponent } from '@shared/uikit/chip/chip-group.component';
import { UiChipComponent } from '@shared/uikit/chip/chip.component';
import { UiEmptyStateComponent } from '@shared/uikit/empty-state/empty-state.component';
import { UiSearchInputComponent } from '@shared/uikit/search-input/search-input.component';
import { UiSkeletonComponent } from '@shared/uikit/skeleton/skeleton.component';
import { UiTabsComponent } from '@shared/uikit/tabs/tabs.component';
import { EMPTY, Observable, switchMap } from 'rxjs';

import { GroupCardComponent } from './components/group-card/group-card.component';
import { GroupsFiltersComponent } from './components/groups-filters/groups-filters.component';
import { GroupsHomeStore } from './services/groups-home.store';

/**
 * Redesigned Home / Me lens groups page (#5823).
 * @description Sticky header with Create Group, the metrics row, sticky type tabs and the group card grid, shown 20 at a
 * time as the page scrolls. Rendered by `GroupsEntryComponent` behind `GROUPS_REDESIGN_FLAG`. The host cancels
 * `main-layout`'s content padding so the design's gutters start at the page edge; the window scrolls.
 */
@Component({
  selector: 'lfx-groups-redesign',
  imports: [
    NgTemplateOutlet,
    UiButtonComponent,
    UiChipComponent,
    UiChipGroupComponent,
    UiEmptyStateComponent,
    UiSearchInputComponent,
    UiSkeletonComponent,
    UiTabsComponent,
    GroupCardComponent,
    GroupsFiltersComponent,
  ],
  templateUrl: './groups-redesign.component.html',
  providers: [GroupsHomeStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block -mx-5 -my-6 md:-mx-8',
    '(window:resize)': 'measure()',
    '(window:scroll)': 'updateScroll()',
  },
})
export class GroupsRedesignComponent {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly userService = inject(UserService);
  private readonly createArtifactDialog = inject(CreateArtifactDialogService);
  protected readonly store = inject(GroupsHomeStore);

  private readonly header = viewChild<ElementRef<HTMLElement>>('header');
  private readonly toolbar = viewChild<ElementRef<HTMLElement>>('toolbar');
  private readonly panels = viewChild<ElementRef<HTMLElement>>('panels');
  private readonly loadMoreTrigger = viewChild<ElementRef<HTMLElement>>('loadMoreTrigger');
  /** Takes focus when the last filter chip is removed. */
  protected readonly filtersControl = viewChild(GroupsFiltersComponent);

  protected readonly idPrefix = 'groups-redesign';
  protected readonly pageSize = GROUPS_HOME_PAGE_SIZE;
  protected readonly skeletonCards = [0, 1, 2];
  /** Measured header height; the toolbar sticks right below it. */
  protected readonly headerHeight = signal(0);
  /** Where the sticky header stops: below the mobile menu bar and impersonation banner. */
  protected readonly stickyTop = signal(0);
  /** True once the page has scrolled past the top. */
  protected readonly scrolled = signal(false);
  /** True once the toolbar has reached its sticky position; the fade then sits under it instead of the header. */
  protected readonly toolbarStuck = signal(false);
  protected readonly hasGroups: Signal<boolean> = computed(() => !this.store.loading() && this.store.groups().length > 0);
  protected readonly tabs: Signal<UiTabItem[]> = this.initTabs();
  protected readonly noResultsDescription: Signal<string> = this.initNoResultsDescription();

  public constructor() {
    this.initLoadMore();
    afterNextRender(() => {
      const observer = new ResizeObserver(() => this.measure());
      const header = this.header()?.nativeElement;
      if (header) observer.observe(header);
      this.destroyRef.onDestroy(() => observer.disconnect());
      this.measure();
    });
  }

  protected onTabChange(value: string): void {
    this.store.setTab(value as GroupsHomeTab);
    if (!isPlatformBrowser(this.platformId)) return;
    // A new tab starts at the top of the grid when the grid has scrolled under the toolbar.
    const panels = this.panels()?.nativeElement;
    const toolbar = this.toolbar()?.nativeElement;
    if (!panels || !toolbar) return;
    const offset = panels.getBoundingClientRect().top - toolbar.getBoundingClientRect().bottom;
    if (offset < 0) window.scrollBy({ top: offset });
  }

  protected createGroup(): void {
    this.createArtifactDialog.open('group');
  }

  protected measure(): void {
    const header = this.header()?.nativeElement;
    if (header) this.headerHeight.set(header.offsetHeight);
    // The layout's mobile menu bar is `sticky top-0` (below the banner while impersonating) and hidden on desktop.
    const menuBar = document.querySelector<HTMLElement>('[data-testid="mobile-menu-button"]')?.parentElement;
    this.stickyTop.set((this.userService.impersonating() ? IMPERSONATION_BANNER_HEIGHT_PX : 0) + (menuBar?.offsetHeight ?? 0));
    this.updateScroll();
  }

  protected updateScroll(): void {
    const scrolled = window.scrollY > 2;
    const toolbar = this.toolbar()?.nativeElement;
    this.scrolled.set(scrolled);
    this.toolbarStuck.set(scrolled && !!toolbar && toolbar.getBoundingClientRect().top - this.stickyTop() <= this.headerHeight() + 1);
  }

  private initTabs(): Signal<UiTabItem[]> {
    return computed(() => {
      const counts = this.store.classCounts();
      const types = (Object.keys(BEHAVIORAL_CLASS_CONFIG) as GroupBehavioralClass[])
        .filter((type) => counts[type] > 0)
        .map((type) => ({ value: type, label: BEHAVIORAL_CLASS_CONFIG[type].label, count: counts[type], dotTone: BEHAVIORAL_CLASS_TONE[type] }));
      return [{ value: 'all', label: 'All', count: this.store.groups().length }, ...types];
    });
  }

  private initNoResultsDescription(): Signal<string> {
    return computed(() => {
      const filtered = this.store.filterChips().length > 0;
      const searched = this.store.search().trim() !== '';
      if (filtered) return searched ? 'No groups match your filters' : 'Try adjusting your filter criteria';
      return searched ? 'No groups match your search' : 'No groups in this category';
    });
  }

  /** Shows the next batch once the skeletons below the grid come within 280px of the viewport; a new batch re-creates them. */
  private initLoadMore(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    toObservable(this.loadMoreTrigger)
      .pipe(
        switchMap((trigger) =>
          trigger
            ? new Observable<void>((subscriber) => {
                const observer = new IntersectionObserver(
                  (entries) => {
                    if (entries.some((entry) => entry.isIntersecting)) subscriber.next();
                  },
                  { rootMargin: '0px 0px 280px 0px' }
                );
                observer.observe(trigger.nativeElement);
                return () => observer.disconnect();
              })
            : EMPTY
        ),
        takeUntilDestroyed()
      )
      .subscribe(() => this.store.loadMore());
  }
}
