// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser, NgTemplateOutlet } from '@angular/common';
import {
  afterNextRender,
  Component,
  computed,
  contentChildren,
  DestroyRef,
  ElementRef,
  inject,
  Injector,
  input,
  linkedSignal,
  OnInit,
  PLATFORM_ID,
  signal,
  TemplateRef,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import {
  HEALTH_METRICS_L2_PANES_BOTTOM_GUTTER_PX,
  HEALTH_METRICS_L2_PANES_MIN_HEIGHT_PX,
  HEALTH_METRICS_L2_PENDING_SECTION_TTL_MS,
  HEALTH_METRICS_L2_SCROLL_KEYS,
} from '@lfx-one/shared/constants';
import { buildHealthMetricsL2SectionId, buildHealthMetricsL2SectionViews, isHealthMetricsL2SectionKey } from '@lfx-one/shared/utils';
import { debounceTime, filter, Subject } from 'rxjs';

import { HealthMetricsChromeService } from '../../health-metrics-gate/health-metrics-chrome.service';
import { HealthMetricsL2SubNavComponent } from '../health-metrics-l2-sub-nav/health-metrics-l2-sub-nav.component';
import { HealthMetricsL2SectionDirective } from './health-metrics-l2-section.directive';

import type { HealthMetricsL2Section, HealthMetricsL2SectionView, HealthMetricsL2SubNavItem } from '@lfx-one/shared/interfaces';

/**
 * Level 2 tab shell — anchored sections inside their own scrolling pane, beside a sub-nav that stays
 * put and tracks scroll position, per the design's `l2Shell`. The tab projects each section's body
 * through a keyed `lfxHealthMetricsL2Section` template and reports its reads back through
 * `sectionReading` / `sectionSettled`, so a fragment deep link lands once the pane stops reflowing.
 */
@Component({
  selector: 'lfx-health-metrics-l2-shell',
  imports: [HealthMetricsL2SubNavComponent, NgTemplateOutlet],
  templateUrl: './health-metrics-l2-shell.component.html',
})
export class HealthMetricsL2ShellComponent implements OnInit {
  protected readonly chrome = inject(HealthMetricsChromeService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly injector = inject(Injector);

  public readonly sections = input.required<readonly HealthMetricsL2Section[]>();
  /** Prefixes each section's DOM id; the URL fragment stays the bare key. */
  public readonly idPrefix = input.required<string>();
  /**
   * Sections whose read can still change the pane's height, so a deep link is released only once
   * every one has settled. Each must emit `reading`/`settled` through the shell's methods.
   */
  public readonly dataSections = input.required<readonly string[]>();
  public readonly subNavItems = input.required<readonly HealthMetricsL2SubNavItem[]>();
  public readonly navLabel = input.required<string>();
  /** Prefixes every `data-testid`, so each tab keeps its own test ids. */
  public readonly testIdPrefix = input.required<string>();
  public readonly crossReferenceNote = input('');

  protected readonly panes = viewChild<ElementRef<HTMLElement>>('panes');
  private readonly endSentinel = viewChild<ElementRef<HTMLElement>>('endSentinel');
  private readonly bodies = contentChildren(HealthMetricsL2SectionDirective);

  // `null` until measured client-side; the CSS variable then bounds the pane so only it scrolls.
  protected readonly panesHeight = signal<string | null>(null);
  // Held until the sections exist, then again until every async section has settled: a deep link
  // re-scrolls once per read that lands, because each one moves the anchors below it.
  private readonly pendingSection = signal<string | null>(null);
  protected readonly activeSection = linkedSignal(() => this.sections()[0]?.key ?? '');

  // Ids resolved once per input rather than per render — the template only reads fields.
  protected readonly sectionViews = computed<HealthMetricsL2SectionView[]>(() => buildHealthMetricsL2SectionViews(this.sections(), this.idPrefix()));
  protected readonly bodyByKey = computed(() => new Map<string, TemplateRef<unknown>>(this.bodies().map((body) => [body.key(), body.template])));

  /**
   * The data sections that have not reported yet. Whichever settles first must not release the
   * pending key: another one reflowing afterwards would move the anchor out from under it.
   */
  private readonly unsettledSections = new Set<string>();
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
  }

  /** Reads the inputs, so it waits for them here rather than running in the constructor. */
  public ngOnInit(): void {
    for (const key of this.dataSections()) this.unsettledSections.add(key);

    // Router `anchorScrolling` cannot serve these links: the fragment is the bare section key while
    // the DOM id carries the tab's prefix.
    this.route.fragment
      .pipe(
        filter((fragment) => isHealthMetricsL2SectionKey(this.sections(), fragment)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((key) => {
        // Only a link arriving before the data settles needs the second scroll; once every section
        // has reported, the anchors are stable and a held key would yank the pane back.
        if (this.unsettledSections.size > 0) this.armPendingSection(key);
        this.scrollTo(key);
      });
  }

  /**
   * A starting read puts the section back among those a deep link waits on, and restarts the
   * deadline against that read rather than leaving it to expire on the fragment that armed it.
   */
  public sectionReading(key: string): void {
    this.unsettledSections.add(key);

    const pending = this.pendingSection();
    if (pending) this.armPendingSection(pending);
  }

  /**
   * A read landing changes the pane's height, so a waiting deep link re-scrolls here, a paint later
   * than the emission. The key is released only once every data section has settled.
   */
  public sectionSettled(key: string): void {
    this.unsettledSections.delete(key);
    afterNextRender(
      () => {
        this.measurePanesHeight();
        this.rebuildScrollSpyIfRootMoved();
        this.settlePendingSection();
        // A still-pending key would scroll the pane back to the anchor on every later re-emission.
        if (this.unsettledSections.size === 0) this.clearPendingSection();
      },
      { injector: this.injector }
    );
  }

  /** An explicit pick supersedes a deep link still waiting on data, which would scroll back over it. */
  public scrollToSection(key: string): void {
    this.clearPendingSection();
    this.scrollTo(key);
  }

  private scrollTo(key: string): void {
    this.activeSection.set(key);
    if (!isPlatformBrowser(this.platformId)) return;

    const section = document.getElementById(buildHealthMetricsL2SectionId(this.idPrefix(), key));
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

  /**
   * Whether the area overflows decides if the end sentinel is observed at all, and a read can flip
   * it. Sections re-emit constantly, so nothing is rebuilt unless that decision moved.
   */
  private rebuildScrollSpyIfRootMoved(): void {
    const container = this.scrollingPane();
    if (!!container !== this.spyRootIsPane || this.areaScrolls(container) !== this.spyAreaScrolls) this.setupScrollSpy();
  }

  /** Bounds the pending key's life, so a read that never settles cannot leave the deep link armed. */
  private armPendingSection(key: string): void {
    this.pendingSection.set(key);
    if (!isPlatformBrowser(this.platformId)) return;

    // Every arm, not just the first: the previous key's teardown unregistered them.
    this.observeReaderIntent();
    clearTimeout(this.pendingSectionTimer);
    this.pendingSectionTimer = setTimeout(() => this.clearPendingSection(), HEALTH_METRICS_L2_PENDING_SECTION_TTL_MS);
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

    return HEALTH_METRICS_L2_SCROLL_KEYS.includes(event.key);
  }

  /** Replays the deep link. Runs on every settle until the last one releases the pending key. */
  private settlePendingSection(): void {
    const key = this.pendingSection();
    if (!key) return;

    this.scrollTo(key);
  }

  /** Bounds the pane to what is left of the viewport below it, so the page itself has nothing to scroll. */
  private measurePanesHeight(): void {
    const pane = this.panes()?.nativeElement;
    if (!isPlatformBrowser(this.platformId) || !pane) return;

    // Document-relative, so a page that is already scrolled measures the same as one at the top.
    const documentTop = pane.getBoundingClientRect().top + window.scrollY;
    const available = window.innerHeight - documentTop - HEALTH_METRICS_L2_PANES_BOTTOM_GUTTER_PX;
    this.panesHeight.set(`${Math.max(Math.round(available), HEALTH_METRICS_L2_PANES_MIN_HEIGHT_PX)}px`);
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

    const views = this.sectionViews();
    const keys = views.map((section) => section.key);
    const keyByHeading = new Map<Element, string>();
    for (const section of views) {
      const heading = document.getElementById(section.headingId);
      if (heading) keyByHeading.set(heading, section.key);
    }
    if (keyByHeading.size === 0) return;

    const container = this.scrollingPane();
    const intersecting = new Set<string>();
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
    const sentinel = this.endSentinel()?.nativeElement;
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
