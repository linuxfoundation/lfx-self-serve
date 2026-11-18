// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgTemplateOutlet } from '@angular/common';
import { afterNextRender, ChangeDetectionStrategy, Component, computed, DestroyRef, ElementRef, inject, Signal, signal, viewChild } from '@angular/core';
import { BEHAVIORAL_CLASS_CONFIG, BEHAVIORAL_CLASS_TONE, IMPERSONATION_BANNER_HEIGHT_PX } from '@lfx-one/shared/constants';
import { GroupBehavioralClass, GroupsHomeTab, UiTabItem } from '@lfx-one/shared/interfaces';
import { CreateArtifactDialogService } from '@services/create-artifact-dialog.service';
import { UserService } from '@services/user.service';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiEmptyStateComponent } from '@shared/uikit/empty-state/empty-state.component';
import { UiSkeletonComponent } from '@shared/uikit/skeleton/skeleton.component';
import { UiTabsComponent } from '@shared/uikit/tabs/tabs.component';

import { GroupsHomeStore } from './services/groups-home.store';

/**
 * Redesigned Home / Me lens groups page (#5823).
 * @description Sticky header with Create Group, the metrics row and sticky type tabs. Rendered by `GroupsEntryComponent`
 * behind `GROUPS_REDESIGN_FLAG`. The host cancels `main-layout`'s content padding so the design's gutters start at the
 * page edge; the window scrolls.
 */
@Component({
  selector: 'lfx-groups-redesign',
  imports: [NgTemplateOutlet, UiButtonComponent, UiEmptyStateComponent, UiSkeletonComponent, UiTabsComponent],
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
  private readonly destroyRef = inject(DestroyRef);
  private readonly userService = inject(UserService);
  private readonly createArtifactDialog = inject(CreateArtifactDialogService);
  protected readonly store = inject(GroupsHomeStore);

  private readonly header = viewChild<ElementRef<HTMLElement>>('header');
  private readonly toolbar = viewChild<ElementRef<HTMLElement>>('toolbar');

  protected readonly idPrefix = 'groups-redesign';
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

  public constructor() {
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
}
