// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { afterNextRender, Component, computed, DestroyRef, ElementRef, inject, PLATFORM_ID, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import {
  HEALTH_METRICS_ENGAGEMENT_PANES_BOTTOM_GUTTER_PX,
  HEALTH_METRICS_ENGAGEMENT_PANES_MIN_HEIGHT_PX,
  HEALTH_METRICS_ENGAGEMENT_SECTIONS,
} from '@lfx-one/shared/constants';
import { buildHealthMetricsEngagementSectionId, buildHealthMetricsEngagementSubNavItems, isHealthMetricsEngagementSectionKey } from '@lfx-one/shared/utils';
import { debounceTime, filter, Subject } from 'rxjs';

import { EngagementGroupAttendanceComponent } from './components/engagement-group-attendance/engagement-group-attendance.component';
import { EngagementSubNavComponent } from './components/engagement-sub-nav/engagement-sub-nav.component';
import { HealthMetricsChromeService } from '../health-metrics-gate/health-metrics-chrome.service';

import type {
  HealthMetricsEngagementGroupCounts,
  HealthMetricsEngagementSectionKey,
  HealthMetricsEngagementSectionView,
  HealthMetricsEngagementSubNavItem,
} from '@lfx-one/shared/interfaces';

/**
 * Engagement (Level 2) — six anchored sections inside their own scrolling pane, beside a sub-nav
 * that stays put and tracks scroll position, per the design's `l2Shell`. Rendered inside HealthMetricsGateComponent's outlet, so it only ever
 * mounts with `health-metrics-overview-enabled` on.
 */
@Component({
  selector: 'lfx-health-metrics-engagement',
  imports: [EngagementGroupAttendanceComponent, EngagementSubNavComponent],
  templateUrl: './health-metrics-engagement.component.html',
})
export class HealthMetricsEngagementComponent {
  protected readonly chrome = inject(HealthMetricsChromeService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);

  protected readonly panes = viewChild<ElementRef<HTMLElement>>('panes');

  // Ids resolved once here rather than per render — the template only reads fields.
  protected readonly sections: HealthMetricsEngagementSectionView[] = HEALTH_METRICS_ENGAGEMENT_SECTIONS.map((section) => ({
    ...section,
    id: buildHealthMetricsEngagementSectionId(section.key),
    headingId: `${buildHealthMetricsEngagementSectionId(section.key)}-heading`,
  }));
  // `null` until measured client-side; the CSS variable then bounds the pane so only it scrolls.
  protected readonly panesHeight = signal<string | null>(null);
  protected readonly activeSection = signal<HealthMetricsEngagementSectionKey>(HEALTH_METRICS_ENGAGEMENT_SECTIONS[0].key);

  // `null` until that section reports, which renders no badge rather than a misleading zero. Only
  // `committees` has a data path in PR 1; the rest land in PRs 2-4 on #2802.
  protected readonly groupCounts = signal<HealthMetricsEngagementGroupCounts | null>(null);

  protected readonly subNavItems = computed<HealthMetricsEngagementSubNavItem[]>(() =>
    buildHealthMetricsEngagementSubNavItems({
      groups: this.groupCounts()?.groups ?? null,
      dormantGroups: this.groupCounts()?.dormantGroups ?? 0,
      orgs: null,
      lapsedOrgs: 0,
      reps: null,
      neverAttendedReps: 0,
      nonMemberOrgs: null,
    })
  );

  // Held until the sections exist, then again until the async section data settles: a deep link
  // scrolls twice because the group table changes the anchor offsets under the first scroll.
  private readonly pendingSection = signal<HealthMetricsEngagementSectionKey | null>(null);
  private readonly resize$ = new Subject<void>();
  private scrollSpyObserver?: IntersectionObserver;
  private scrollEndObserver?: IntersectionObserver;

  public constructor() {
    this.destroyRef.onDestroy(() => this.teardownScrollSpy());
    afterNextRender(() => {
      this.measurePanesHeight();
      this.setupScrollSpy();
      this.observeWindowResize();
      // `route.fragment` has already emitted by now, before the section ids existed, so the deep
      // link is replayed here rather than scrolling against an empty document.
      this.settlePendingSection();
    });
    // The activation band hangs off the sticky header, which the gate measures after first paint —
    // rebuild the observer whenever that height settles rather than hard-coding a pixel offset.
    toObservable(this.chrome.stickyTopPx)
      .pipe(takeUntilDestroyed())
      .subscribe((offset) => {
        if (!this.scrollSpyObserver) return;
        // A taller header pushes the pane down, so the measured height moves with it.
        this.measurePanesHeight();
        this.setupScrollSpy(offset);
      });

    // Resize fires per animation frame while dragging; rebuilding two observers each time is wasteful.
    this.resize$.pipe(debounceTime(150), takeUntilDestroyed()).subscribe(() => {
      this.measurePanesHeight();
      // The pane may have just gained or lost its scrollbar, which changes the spy's root.
      this.setupScrollSpy();
    });

    // Router `anchorScrolling` cannot serve these links: the fragment is the bare section key while
    // the DOM id carries the `sec-eng-` prefix.
    this.route.fragment.pipe(filter(isHealthMetricsEngagementSectionKey), takeUntilDestroyed()).subscribe((key) => {
      this.pendingSection.set(key);
      this.scrollToSection(key);
    });
  }

  /**
   * A section reporting its totals also changes the pane's height, so a deep link that was waiting
   * on that data gets its second and final scroll here.
   */
  protected onGroupCounts(counts: HealthMetricsEngagementGroupCounts | null): void {
    this.groupCounts.set(counts);
    if (counts) this.settlePendingSection();
  }

  protected scrollToSection(key: HealthMetricsEngagementSectionKey): void {
    this.activeSection.set(key);
    if (!isPlatformBrowser(this.platformId)) return;

    const section = document.getElementById(buildHealthMetricsEngagementSectionId(key));
    if (!section) return;

    // Inside the pane, scroll the pane itself — `scrollIntoView` would also drag the page under it.
    const container = this.scrollingPane();
    if (!container) {
      section.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const top = container.scrollTop + section.getBoundingClientRect().top - container.getBoundingClientRect().top;
    container.scrollTo({ top, behavior: 'smooth' });
  }

  /**
   * Registered outside Angular's event system: a `@HostListener` would notify the zoneless scheduler
   * on every raw resize event, which the downstream debounce cannot undo.
   */
  private observeWindowResize(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    const onResize = () => this.resize$.next();
    window.addEventListener('resize', onResize, { passive: true });
    this.destroyRef.onDestroy(() => window.removeEventListener('resize', onResize));
  }

  /** Replays the deep link. Only the two callers below run it, so it can never fight a user scroll. */
  private settlePendingSection(): void {
    const key = this.pendingSection();
    if (!key) return;

    this.scrollToSection(key);
  }

  /** Bounds the pane to what is left of the viewport below it, so the page itself has nothing to scroll. */
  private measurePanesHeight(): void {
    const pane = this.panes()?.nativeElement;
    if (!isPlatformBrowser(this.platformId) || !pane) return;

    // Document-relative, so a page that is already scrolled measures the same as one at the top.
    const documentTop = pane.getBoundingClientRect().top + window.scrollY;
    const available = window.innerHeight - documentTop - HEALTH_METRICS_ENGAGEMENT_PANES_BOTTOM_GUTTER_PX;
    this.panesHeight.set(`${Math.max(Math.round(available), HEALTH_METRICS_ENGAGEMENT_PANES_MIN_HEIGHT_PX)}px`);
  }

  /**
   * The pane, but only while it is genuinely a scroll container (the design's `scrollParent`) — below
   * `lg` its height is unbounded and the page scrolls instead, so the spy falls back to the viewport.
   */
  private scrollingPane(): HTMLElement | null {
    const pane = this.panes()?.nativeElement;
    if (!pane) return null;

    const overflowY = getComputedStyle(pane).overflowY;
    const scrolls = (overflowY === 'auto' || overflowY === 'scroll') && pane.scrollHeight > pane.clientHeight + 1;

    return scrolls ? pane : null;
  }

  /**
   * True when the sentinel can only be reached by scrolling. `scrollingPane()` already proves it for
   * the pane; below `lg` the page scrolls instead, and a page that fits needs no sentinel.
   */
  private areaScrolls(container: HTMLElement | null): boolean {
    return container ? true : document.documentElement.scrollHeight > window.innerHeight + 1;
  }

  /**
   * Observes each section's heading rather than the whole section: a heading is short enough that at
   * most one sits in the activation band, so exactly one sub-nav item is ever lit.
   */
  private setupScrollSpy(offsetPx = this.chrome.stickyTopPx()): void {
    if (!isPlatformBrowser(this.platformId) || typeof IntersectionObserver === 'undefined') return;

    this.teardownScrollSpy();

    const keys = HEALTH_METRICS_ENGAGEMENT_SECTIONS.map((section) => section.key);
    const keyByHeading = new Map<Element, HealthMetricsEngagementSectionKey>();
    for (const key of keys) {
      const heading = document.getElementById(`${buildHealthMetricsEngagementSectionId(key)}-heading`);
      if (heading) keyByHeading.set(heading, key);
    }
    if (keyByHeading.size === 0) return;

    const container = this.scrollingPane();
    const intersecting = new Set<HealthMetricsEngagementSectionKey>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const key = keyByHeading.get(entry.target);
          if (!key) continue;
          if (entry.isIntersecting) intersecting.add(key);
          else intersecting.delete(key);
        }
        const activeKey = keys.find((key) => intersecting.has(key));
        if (activeKey) this.activeSection.set(activeKey);
      },
      // Against the pane the band starts at its own top edge; against the viewport it has to clear
      // the sticky page header first.
      container ? { root: container, rootMargin: '0px 0px -70% 0px', threshold: 0 } : { rootMargin: `-${Math.round(offsetPx)}px 0px -70% 0px`, threshold: 0 }
    );
    keyByHeading.forEach((_, heading) => observer.observe(heading));
    this.scrollSpyObserver = observer;

    // The last section is short enough that its heading never reaches the activation band, so an
    // invisible end sentinel snaps to it. Guarding on the heading's position instead would be dead
    // code: a heading that clears the band's top edge has already activated itself above.
    const sentinel = document.getElementById('engagement-scroll-end-sentinel');
    if (!sentinel || !this.areaScrolls(container)) return;

    const lastKey = keys[keys.length - 1];
    const endObserver = new IntersectionObserver(
      // Reaching a sentinel that sits below a full screen of content means the user scrolled there —
      // the area is only observed at all once it genuinely overflows.
      ([entry]) => {
        if (entry.isIntersecting) this.activeSection.set(lastKey);
      },
      container ? { root: container, threshold: 0 } : { threshold: 0 }
    );
    endObserver.observe(sentinel);
    this.scrollEndObserver = endObserver;
  }

  private teardownScrollSpy(): void {
    this.scrollSpyObserver?.disconnect();
    this.scrollEndObserver?.disconnect();
    this.scrollSpyObserver = undefined;
    this.scrollEndObserver = undefined;
  }
}
