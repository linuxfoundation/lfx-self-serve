// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { afterNextRender, Component, computed, DestroyRef, ElementRef, inject, Injector, PLATFORM_ID, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import {
  HEALTH_METRICS_ENGAGEMENT_PANES_BOTTOM_GUTTER_PX,
  HEALTH_METRICS_ENGAGEMENT_PANES_MIN_HEIGHT_PX,
  HEALTH_METRICS_ENGAGEMENT_PENDING_SECTION_TTL_MS,
  HEALTH_METRICS_ENGAGEMENT_SCROLL_KEYS,
  HEALTH_METRICS_ENGAGEMENT_SECTIONS,
} from '@lfx-one/shared/constants';
import { buildHealthMetricsEngagementSectionId, buildHealthMetricsEngagementSubNavItems, isHealthMetricsEngagementSectionKey } from '@lfx-one/shared/utils';
import { debounceTime, filter, Subject } from 'rxjs';

import { EngagementGroupAttendanceComponent } from './components/engagement-group-attendance/engagement-group-attendance.component';
import { EngagementMeetingParticipationComponent } from './components/engagement-meeting-participation/engagement-meeting-participation.component';
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
  imports: [EngagementGroupAttendanceComponent, EngagementMeetingParticipationComponent, EngagementSubNavComponent],
  templateUrl: './health-metrics-engagement.component.html',
})
export class HealthMetricsEngagementComponent {
  protected readonly chrome = inject(HealthMetricsChromeService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly injector = inject(Injector);

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

  // `null` until that section reports, which renders no badge rather than a misleading zero. The
  // badge-bearing sections other than `committees` land in PRs 3-4 on #2802.
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
  private pendingSectionTimer?: ReturnType<typeof setTimeout>;
  /** Set while the reader-intent listeners are registered; nulled by the removal it performs. */
  private removeIntentListeners: (() => void) | null = null;
  private scrollSpyObserver?: IntersectionObserver;
  private scrollEndObserver?: IntersectionObserver;
  // Two of the observers' inputs, so a content change that moves neither costs nothing. The sticky
  // offset is a third, rebuilt from its own subscription rather than compared here.
  private spyRootIsPane?: boolean;
  private spyAreaScrolls?: boolean;

  public constructor() {
    this.destroyRef.onDestroy(() => {
      this.teardownScrollSpy();
      clearTimeout(this.pendingSectionTimer);
      // The destroy hook lives here, not in `observeReaderIntent`: the listeners register per arm,
      // and one hook per arm would pile up over the page's life.
      this.removeIntentListeners?.();
    });
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
      // Only a link arriving before the section data settles needs the second scroll. Once counts
      // are in, the anchors are stable and a held key would yank the pane back on the next filter change.
      if (this.groupCounts() === null) this.armPendingSection(key);
      this.scrollToSection(key);
    });
  }

  /**
   * A section reporting its totals also changes the pane's height, so a deep link that was waiting
   * on that data gets its second and final scroll here — deferred a paint, because the rows those
   * totals describe have not been laid out yet at the moment of this emission.
   */
  protected onGroupCounts(counts: HealthMetricsEngagementGroupCounts | null): void {
    this.groupCounts.set(counts);
    if (!counts) {
      // The section emits `null` as each read starts, so a follow-up read — a page clamp, a filter
      // change — restarts the deadline against that read rather than the fragment that armed it.
      const pending = this.pendingSection();
      if (pending) this.armPendingSection(pending);
      return;
    }

    afterNextRender(
      () => {
        this.measurePanesHeight();
        // The area may only now overflow, and whether it does decides if the end sentinel is
        // observed at all — the first pass ran against five short placeholder sections. Counts
        // re-emit on every filter and page change, so nothing is rebuilt unless that decision moved.
        const container = this.scrollingPane();
        if (!!container !== this.spyRootIsPane || this.areaScrolls(container) !== this.spyAreaScrolls) this.setupScrollSpy();
        this.settlePendingSection();
        // Consumed: a still-pending key would scroll the pane back to the anchor on every re-emission.
        this.clearPendingSection();
      },
      { injector: this.injector }
    );
  }

  /**
   * Participation sits above every other section, so its read landing moves each anchor below it.
   * The pending key is left armed — group attendance owns clearing it, and may still be loading.
   */
  protected onParticipationSettled(): void {
    afterNextRender(
      () => {
        this.measurePanesHeight();
        this.settlePendingSection();
      },
      { injector: this.injector }
    );
  }

  /** An explicit pick supersedes a deep link still waiting on data, which would scroll back over it. */
  protected onSectionPicked(key: HealthMetricsEngagementSectionKey): void {
    this.clearPendingSection();
    this.scrollToSection(key);
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

  /**
   * A deep link waiting on data would scroll back over wherever the reader has moved to, and a failed
   * read leaves it waiting indefinitely — so their own first scroll or keypress supersedes it.
   * Idempotent: every arm calls this, and only the first one that finds no listeners registers them.
   */
  private observeReaderIntent(): void {
    if (!isPlatformBrowser(this.platformId) || this.removeIntentListeners) return;

    // Only a key that scrolls counts: every keystroke in the app shell bubbles to the window, so an
    // unfiltered handler would drop the deep link on a Tab press.
    const onIntent = (event: Event) => {
      // A row's own `keydown.space` handler has already called `preventDefault()` by the time this
      // runs — that key opened a drawer, it did not move the pane.
      if (event.defaultPrevented) return;
      if (event.type === 'keydown' && !this.isScrollIntent(event as KeyboardEvent)) return;
      this.clearPendingSection();
    };
    // Bound to the window rather than the pane: keyboard scrolling with the body focused never
    // dispatches to the pane at all. A scrollbar drag reaches neither, which is what the TTL is for.
    const events = ['wheel', 'touchmove', 'keydown'];
    for (const event of events) window.addEventListener(event, onIntent, { passive: true });
    // Dead weight on the browser's hottest event streams once no key is armed; the next arm
    // registers them again.
    this.removeIntentListeners = () => {
      for (const event of events) window.removeEventListener(event, onIntent);
      this.removeIntentListeners = null;
    };
  }

  /** Bounds the pending key's life, so a read that never settles cannot leave the deep link armed. */
  private armPendingSection(key: HealthMetricsEngagementSectionKey): void {
    this.pendingSection.set(key);
    if (!isPlatformBrowser(this.platformId)) return;

    // Every arm, not just the first: the previous key's teardown unregistered them.
    this.observeReaderIntent();
    clearTimeout(this.pendingSectionTimer);
    this.pendingSectionTimer = setTimeout(() => this.clearPendingSection(), HEALTH_METRICS_ENGAGEMENT_PENDING_SECTION_TTL_MS);
  }

  /**
   * Nulls the key and its deadline together, so a live timer always implies an armed key, and
   * unregisters the reader-intent listeners the next arm re-registers.
   */
  private clearPendingSection(): void {
    this.pendingSection.set(null);
    clearTimeout(this.pendingSectionTimer);
    this.removeIntentListeners?.();
  }

  /**
   * True only for a key that scrolls the document, pressed outside a control that consumes it —
   * typing in an editable element, or Space activating a button, moves nothing. Every other scroll
   * key still counts on a focused button: activating a filter is exactly when a reader scrolls on.
   */
  private isScrollIntent(event: KeyboardEvent): boolean {
    const target = event.target as HTMLElement | null;
    if (target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '')) return false;
    // A native button swallows Space without marking the event defaultPrevented.
    if (event.key === ' ' && target?.closest?.('button, [role="button"]')) return false;

    return HEALTH_METRICS_ENGAGEMENT_SCROLL_KEYS.includes(event.key);
  }

  /** Replays the deep link. Runs only until the section data settles and clears the pending key. */
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
    return !!container || document.documentElement.scrollHeight > window.innerHeight + 1;
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
    this.spyRootIsPane = !!container;
    this.spyAreaScrolls = this.areaScrolls(container);

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
    this.spyRootIsPane = undefined;
    this.spyAreaScrolls = undefined;
  }
}
