// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, PLATFORM_ID, viewChildren } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { MENTORSHIP_MENTOR_PAGE_TABS } from '@lfx-one/shared/constants';
import { MentorshipMentorPageTab } from '@lfx-one/shared/interfaces';
import { filter, map } from 'rxjs';

/**
 * Shell for the mentor experience — owns the page H1 and the underline tab bar, and hands
 * the tab content off to `<router-outlet>`. Two children mount here:
 *
 * - `mentor/programs` → `MentorProgramsComponent` (My Programs list)
 * - `mentor/profile`  → `MentorProfileComponent`  (profile card + details + history)
 *
 * The active tab is derived from the current URL rather than an in-page signal, so every
 * tab has a real, deep-linkable route and the browser back/forward buttons behave the way
 * a mentor expects. Tab buttons are `role="tab"` for AT semantics; imperative router
 * navigation matches the rest of the module, which relies on click handlers rather than
 * `routerLink` on `role="tab"` elements.
 */
@Component({
  selector: 'lfx-mentorship-mentor-page',
  imports: [RouterOutlet],
  templateUrl: './mentor-page.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MentorPageComponent {
  private readonly router = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly tabBtns = viewChildren<ElementRef<HTMLButtonElement>>('tabBtn');

  protected readonly tabs = MENTORSHIP_MENTOR_PAGE_TABS;

  /**
   * Current URL as a signal, so `activeTab` recomputes on every navigation. The initial
   * value covers the first render before `NavigationEnd` fires — otherwise the shell would
   * paint on `programs` even when the deep link was `profile`.
   */
  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects)
    ),
    { initialValue: this.router.url }
  );

  protected readonly activeTab = computed<MentorshipMentorPageTab>(() => (this.currentUrl().includes('/mentor/profile') ? 'profile' : 'programs'));

  /**
   * Page H1 reflects the current tab, so the surface reads as one page whose title
   * changes when the mentor switches views — closer to the tab-based UX pattern than
   * a fixed "My Programs" heading paired with a tab that can hide the programs list.
   */
  protected readonly title = computed(() => this.tabs.find((tab) => tab.value === this.activeTab())?.label ?? this.tabs[0].label);

  protected onTabClick(tab: MentorshipMentorPageTab): void {
    void this.router.navigate(['/mentorship/mentor', tab]);
  }

  protected onTabKeydown(event: KeyboardEvent): void {
    const tabs = this.tabs.map((tab) => tab.value);
    const current = tabs.indexOf(this.activeTab());
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = (current + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (current - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    if (next === null) return;

    event.preventDefault();
    this.onTabClick(tabs[next]);
    if (isPlatformBrowser(this.platformId)) {
      this.tabBtns()[next]?.nativeElement.focus();
    }
  }
}
