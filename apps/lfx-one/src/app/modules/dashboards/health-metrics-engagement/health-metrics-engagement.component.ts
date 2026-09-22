// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { afterNextRender, Component, computed, DestroyRef, effect, ElementRef, HostListener, inject, PLATFORM_ID, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import {
  HEALTH_METRICS_ENGAGEMENT_PANES_BOTTOM_GUTTER_PX,
  HEALTH_METRICS_ENGAGEMENT_PANES_MIN_HEIGHT_PX,
  HEALTH_METRICS_ENGAGEMENT_SECTIONS,
} from '@lfx-one/shared/constants';
import { buildHealthMetricsEngagementSectionId, buildHealthMetricsEngagementSubNavItems, isHealthMetricsEngagementSectionKey } from '@lfx-one/shared/utils';
import { filter } from 'rxjs';

import { EngagementGroupAttendanceComponent } from './components/engagement-group-attendance/engagement-group-attendance.component';
import { EngagementSubNavComponent } from './components/engagement-sub-nav/engagement-sub-nav.component';
import { HealthMetricsChromeService } from '../health-metrics-gate/health-metrics-chrome.service';

import type { HealthMetricsEngagementGroupCounts, HealthMetricsEngagementSectionKey, HealthMetricsEngagementSubNavItem } from '@lfx-one/shared/interfaces';

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

  protected readonly sections = HEALTH_METRICS_ENGAGEMENT_SECTIONS;
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
      lowAttendanceGroups: this.groupCounts()?.lowAttendanceGroups ?? 0,
      orgs: null,
      lapsedOrgs: 0,
      reps: null,
      neverAttendedReps: 0,
      nonMemberOrgs: null,
    })
  );

  private scrollSpyObserver?: IntersectionObserver;
  private scrollEndObserver?: IntersectionObserver;

  public constructor() {
    this.destroyRef.onDestroy(() => this.teardownScrollSpy());
    afterNextRender(() => {
      this.measurePanesHeight();
      this.setupScrollSpy();
    });
    // The activation band hangs off the sticky header, which the gate measures after first paint —
    // rebuild the observer whenever that height settles rather than hard-coding a pixel offset.
    effect(() => {
      const offset = this.chrome.stickyTopPx();
      if (!this.scrollSpyObserver) return;
      // A taller header pushes the pane down, so the measured height moves with it.
      this.measurePanesHeight();
      this.setupScrollSpy(offset);
    });

    // Router anchorScrolling already scrolls on navigation; re-settle after paint because async
    // section data shifts the anchor out from under that first scroll.
    this.route.fragment.pipe(filter(isHealthMetricsEngagementSectionKey), takeUntilDestroyed()).subscribe((key) => this.scrollToSection(key));
  }

  @HostListener('window:resize')
  protected onWindowResize(): void {
    this.measurePanesHeight();
    // The pane may have just gained or lost its scrollbar, which changes the spy's root.
    this.setupScrollSpy();
  }

  protected sectionId(key: HealthMetricsEngagementSectionKey): string {
    return buildHealthMetricsEngagementSectionId(key);
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

    // The last section is short enough that its heading never reaches the activation band; an
    // invisible end sentinel snaps to it without a scroll listener or magic pixel values.
    const sentinel = document.getElementById('engagement-scroll-end-sentinel');
    const lastKey = keys[keys.length - 1];
    const lastHeading = document.getElementById(`${buildHealthMetricsEngagementSectionId(lastKey)}-heading`);
    const endObserver = new IntersectionObserver(
      ([entry]) => {
        // On a pane tall enough to show everything the sentinel intersects from first paint — only
        // take over once the last heading has actually cleared the top of the scrolling area.
        const topEdge = container ? container.getBoundingClientRect().top : offsetPx;
        if (entry.isIntersecting && lastHeading && lastHeading.getBoundingClientRect().bottom <= topEdge) {
          this.activeSection.set(lastKey);
        }
      },
      container ? { root: container, threshold: 0 } : { threshold: 0 }
    );
    if (sentinel) endObserver.observe(sentinel);
    this.scrollEndObserver = endObserver;
  }

  private teardownScrollSpy(): void {
    this.scrollSpyObserver?.disconnect();
    this.scrollEndObserver?.disconnect();
    this.scrollSpyObserver = undefined;
    this.scrollEndObserver = undefined;
  }
}
