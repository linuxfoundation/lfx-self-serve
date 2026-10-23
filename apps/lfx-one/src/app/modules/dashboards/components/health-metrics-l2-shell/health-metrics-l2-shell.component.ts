// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser, NgTemplateOutlet, ViewportScroller } from '@angular/common';
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
import {
  ActivatedRoute,
  NavigationCancel,
  NavigationError,
  NavigationSkipped,
  NavigationSkippedCode,
  NavigationStart,
  Router,
  Scroll,
  UrlTree,
} from '@angular/router';
import { HEALTH_METRICS_L2_PENDING_SECTION_TTL_MS, HEALTH_METRICS_L2_SCROLL_KEYS } from '@lfx-one/shared/constants';
import { buildHealthMetricsL2SectionId, buildHealthMetricsL2SectionViews, isHealthMetricsL2SectionKey } from '@lfx-one/shared/utils';
import { debounceTime, filter, Subject } from 'rxjs';

import { HealthMetricsChromeService } from '../../health-metrics-gate/health-metrics-chrome.service';
import { HealthMetricsFootnoteComponent } from '../health-metrics-footnote/health-metrics-footnote.component';
import { HealthMetricsL2SubNavComponent } from '../health-metrics-l2-sub-nav/health-metrics-l2-sub-nav.component';
import { HealthMetricsL2SectionDirective } from './health-metrics-l2-section.directive';

import type { HealthMetricsL2Section, HealthMetricsL2SectionView, HealthMetricsL2SubNavItem } from '@lfx-one/shared/interfaces';

/**
 * Level 2 tab shell — anchored sections the page scrolls, beside a sticky section nav on their right that
 * tracks scroll position, per the design's `.hm-row`. The tab projects each section's body
 * through a keyed `lfxHealthMetricsL2Section` template and reports its reads back through
 * `sectionReading` / `sectionSettled`, so a fragment deep link lands once the page stops reflowing.
 *
 * Every in-section pill, search and pager writes the query string, and the app-wide router scrolls
 * each such navigation to the top; the shell keeps the reader's place instead.
 */
@Component({
  selector: 'lfx-health-metrics-l2-shell',
  imports: [HealthMetricsFootnoteComponent, HealthMetricsL2SubNavComponent, NgTemplateOutlet],
  templateUrl: './health-metrics-l2-shell.component.html',
})
export class HealthMetricsL2ShellComponent implements OnInit {
  protected readonly chrome = inject(HealthMetricsChromeService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly viewportScroller = inject(ViewportScroller);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly injector = inject(Injector);

  /** Read once at init, like `dataSections`: the scroll-spy and deep-link wait set are not rebuilt later. */
  public readonly sections = input.required<readonly HealthMetricsL2Section[]>();
  /** Prefixes each section's DOM id; the URL fragment stays the bare key. */
  public readonly idPrefix = input.required<string>();
  /**
   * Sections whose read can still change the page's height, so a deep link is released only once
   * every one has settled. Each must emit `reading`/`settled` through the shell's methods. Read once
   * at init, so it must not change afterwards.
   */
  public readonly dataSections = input.required<readonly string[]>();
  public readonly subNavItems = input.required<readonly HealthMetricsL2SubNavItem[]>();
  public readonly navLabel = input.required<string>();
  /** Prefixes every `data-testid`, so each tab keeps its own test ids. */
  public readonly testIdPrefix = input.required<string>();

  private readonly startSentinel = viewChild<ElementRef<HTMLElement>>('startSentinel');
  private readonly endSentinel = viewChild<ElementRef<HTMLElement>>('endSentinel');
  private readonly bodies = contentChildren(HealthMetricsL2SectionDirective);

  // Held until the sections exist, then again until every async section has settled: a deep link
  // re-scrolls once per read that lands, because each one moves the anchors below it.
  private readonly pendingSection = signal<string | null>(null);
  protected readonly activeSection = linkedSignal(() => this.sections()[0]?.key ?? '');
  /** The design pins the nav 24px below the header, 8px lower than a section's scroll margin. */
  protected readonly subNavTopPx = computed(() => this.chrome.stickyTopPx() + 8);

  // Ids resolved once per input rather than per render — the template only reads fields.
  protected readonly sectionViews = computed<HealthMetricsL2SectionView[]>(() => buildHealthMetricsL2SectionViews(this.sections(), this.idPrefix()));
  protected readonly bodyByKey = computed(() => new Map<string, TemplateRef<unknown>>(this.bodies().map((body) => [body.key(), body.template])));

  /**
   * The data sections that have not reported yet. Whichever settles first must not release the
   * pending key: another one reflowing afterwards would move the anchor out from under it.
   */
  private readonly unsettledSections = new Set<string>();
  /** Read key → the section it renders in, for a section that holds more than one read. */
  private readonly readSections = new Map<string, string>();
  private readonly resize$ = new Subject<void>();
  private pendingSectionTimer?: ReturnType<typeof setTimeout>;
  /** Set while the reader-intent listeners are registered; nulled by the removal it performs. */
  private removeIntentListeners: (() => void) | null = null;
  // False until the first render, when the section anchors exist and a held fragment can land.
  private rendered = false;
  private scrollSpyObserver?: IntersectionObserver;
  private scrollEndObserver?: IntersectionObserver;
  private scrollStartObserver?: IntersectionObserver;
  // Two of the observers' inputs, so a content change that leaves both alone costs nothing. The sticky
  // offset is a third, rebuilt from its own subscription rather than compared here.
  private spyEndBelowFold?: boolean;
  private spyViewportHeight?: number;
  /** Navigation id → where the page stood when a query-only navigation began, put back after the router's scroll. */
  private readonly heldScrolls = new Map<number, [number, number]>();
  /** A section jumped to while a router scroll was still due, replayed after it since that scroll cuts it short. */
  private jumpAfterRouterScroll: string | null = null;

  public constructor() {
    this.destroyRef.onDestroy(() => {
      this.teardownScrollSpy();
      clearTimeout(this.pendingSectionTimer);
      // The destroy hook lives here, not in `observeReaderIntent`: the listeners register per arm,
      // and one hook per arm would pile up over the page's life.
      this.removeIntentListeners?.();
    });
    afterNextRender(() => {
      this.setupScrollSpy();
      this.observeWindowResize();
      this.observeDocumentResize();
      // `route.fragment` has already emitted by now, before the section ids existed, so the deep
      // link is replayed here rather than scrolling against an empty document.
      this.rendered = true;
      this.settlePendingSection();
      // With nothing left to settle there is no later reflow, so this replay is the only one needed.
      if (this.unsettledSections.size === 0) this.clearPendingSection();
    });
    // The activation band hangs off the sticky header, which the gate measures after first paint —
    // rebuild the observer whenever that height settles rather than hard-coding a pixel offset.
    toObservable(this.chrome.stickyTopPx)
      .pipe(takeUntilDestroyed())
      .subscribe((offset) => {
        if (!this.scrollSpyObserver) return;
        this.setupScrollSpy(offset);
      });

    // Resize fires per animation frame while dragging; rebuilding the observers each time is wasteful.
    // The band is sized off the viewport, and a reflow can move the end sentinel past the first screen.
    this.resize$.pipe(debounceTime(150), takeUntilDestroyed()).subscribe(() => this.rebuildScrollSpyIfGeometryChanged());
    this.initQueryScrollKeeping();
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
        // Held before first render, when no anchor exists yet, or while data can still move it; after
        // both, the anchors are stable and a held key would yank the page back.
        if (!this.rendered || this.unsettledSections.size > 0) this.armPendingSection(key);
        this.scrollTo(key);
      });
  }

  /**
   * A starting read puts the section back among those a deep link waits on, and restarts the
   * deadline against that read rather than leaving it to expire on the fragment that armed it.
   * `sectionKey` names the section the read renders in, when a section holds more than one read.
   */
  public sectionReading(key: string, sectionKey = key): void {
    this.unsettledSections.add(key);
    this.readSections.set(key, sectionKey);
    this.holdSectionHeight(sectionKey);

    const pending = this.pendingSection();
    if (pending) this.armPendingSection(pending);
  }

  /**
   * A read landing changes the page's height, so a waiting deep link re-scrolls here, a paint later
   * than the emission. The key is released only once every data section has settled.
   */
  public sectionSettled(key: string, sectionKey = key): void {
    this.unsettledSections.delete(key);
    afterNextRender(
      () => {
        // Released once every read in the section has painted, so neither a sibling still loading nor a
        // newer read that re-held it for its own skeleton loses the height.
        if (!this.hasUnsettledRead(sectionKey)) this.sectionElement(sectionKey)?.style.removeProperty('min-height');
        this.rebuildScrollSpyIfGeometryChanged();
        this.settlePendingSection();
        // A still-pending key would scroll the page back to the anchor on every later re-emission.
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

    const section = this.sectionElement(key);
    if (!section) return;

    if (this.heldScrolls.size > 0) this.jumpAfterRouterScroll = key;
    // The section's `scroll-margin-top` keeps it clear of the sticky page header.
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  private initQueryScrollKeeping(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    this.router.events.pipe(takeUntilDestroyed()).subscribe((event) => {
      if (event instanceof NavigationStart) {
        if (this.changesOnlyQuery(event.url)) this.heldScrolls.set(event.id, this.viewportScroller.getScrollPosition());
      } else if (event instanceof NavigationSkipped) {
        // A write that restates the current URL is skipped without a start, yet still scrolled to the top.
        if (event.code === NavigationSkippedCode.IgnoredSameUrlNavigation) this.heldScrolls.set(event.id, this.viewportScroller.getScrollPosition());
        else this.heldScrolls.delete(event.id);
      } else if (event instanceof NavigationCancel || event instanceof NavigationError) {
        this.heldScrolls.delete(event.id);
      } else if (event instanceof Scroll) {
        this.restoreHeldScroll(event.routerEvent.id);
      }
    });
  }

  private restoreHeldScroll(id: number): void {
    const position = this.heldScrolls.get(id);
    if (!position) return;

    this.heldScrolls.delete(id);
    const jump = this.jumpAfterRouterScroll;
    if (this.heldScrolls.size === 0) this.jumpAfterRouterScroll = null;
    // A microtask lands after the router's own scroll, whichever subscribed first, and before paint.
    queueMicrotask(() => {
      this.viewportScroller.scrollToPosition(position, { behavior: 'instant' });
      if (jump) this.scrollTo(jump);
    });
  }

  /** Same path and fragment as the current URL: only the query string moves. */
  private changesOnlyQuery(url: string): boolean {
    const withoutQuery = (tree: UrlTree) => this.router.serializeUrl(new UrlTree(tree.root, {}, tree.fragment));
    return withoutQuery(this.router.parseUrl(url)) === withoutQuery(this.router.parseUrl(this.router.url));
  }

  /** A reloading section shrinks to its skeleton, which would shorten the page under the reader. */
  private holdSectionHeight(key: string): void {
    if (!isPlatformBrowser(this.platformId)) return;

    const section = this.sectionElement(key);
    if (section) section.style.minHeight = `${section.offsetHeight}px`;
  }

  private hasUnsettledRead(sectionKey: string): boolean {
    return [...this.unsettledSections].some((key) => (this.readSections.get(key) ?? key) === sectionKey);
  }

  private sectionElement(key: string): HTMLElement | null {
    return document.getElementById(buildHealthMetricsL2SectionId(this.idPrefix(), key));
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
   * Sections and the footer render asynchronously and change the page's height after first paint — a
   * viewport resize alone would miss that, so the document's own height is watched too.
   */
  private observeDocumentResize(): void {
    if (!isPlatformBrowser(this.platformId) || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => this.resize$.next());
    observer.observe(document.documentElement);
    this.destroyRef.onDestroy(() => observer.disconnect());
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
      // runs — that key opened a drawer, it did not move the page.
      if (event.defaultPrevented) return;
      if (event.type === 'keydown' && !this.isScrollIntent(event as KeyboardEvent)) return;
      this.clearPendingSection();
    };
    // Bound to the window, where page scrolling is dispatched. A scrollbar drag fires none of these,
    // which is what the TTL is for.
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
   * The band is sized off the viewport height, and whether the end sentinel starts below the first
   * screen decides if the sentinels are observed. Sections re-emit constantly, so nothing is rebuilt
   * unless one of those moved.
   */
  private rebuildScrollSpyIfGeometryChanged(): void {
    if (this.endSentinelBelowFold() !== this.spyEndBelowFold || window.innerHeight !== this.spyViewportHeight) this.setupScrollSpy();
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

  /**
   * Whether the end of the sections sits below the first screen, measured against the page rather than
   * the current scroll. A page whose footer alone scrolls still shows both sentinels at rest.
   */
  private endSentinelBelowFold(): boolean {
    const sentinel = this.endSentinel()?.nativeElement;
    return !!sentinel && sentinel.getBoundingClientRect().top + window.scrollY > window.innerHeight;
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

    const below = Math.max(window.innerHeight - Math.round(offsetPx), 0);
    const bandBottomPx = Math.round(below * 0.7);
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
      // The band is the top 30% of the viewport left below the sticky header, in pixels: a percentage
      // bottom margin is of the whole viewport and closes the band on a short window.
      { rootMargin: `-${Math.round(offsetPx)}px 0px -${bandBottomPx}px 0px`, threshold: 0 }
    );
    keyByHeading.forEach((_, heading) => observer.observe(heading));
    this.scrollSpyObserver = observer;
    this.spyEndBelowFold = this.endSentinelBelowFold();
    this.spyViewportHeight = window.innerHeight;

    // The last section is short enough that its heading never reaches the activation band, so an
    // invisible end sentinel snaps to it. Guarding on the heading's position instead would be dead
    // code: a heading that clears the band's top edge has already activated itself above.
    if (!this.spyEndBelowFold) return;

    // A jump back to the top (Home, or an instant scroll) never sweeps the first heading through the
    // band, so a sentinel at the column's top edge re-entering below the header lights it instead.
    const start = this.startSentinel()?.nativeElement;
    if (start) {
      const firstKey = keys[0];
      const startObserver = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) this.activeSection.set(firstKey);
        },
        { rootMargin: `-${Math.round(offsetPx)}px 0px 0px 0px`, threshold: 0 }
      );
      startObserver.observe(start);
      this.scrollStartObserver = startObserver;
    }

    const sentinel = this.endSentinel()?.nativeElement;
    if (!sentinel) return;

    const lastKey = keys[keys.length - 1];
    const endObserver = new IntersectionObserver(
      // Reaching a sentinel that sits below a full screen of content means the user scrolled there —
      // it is only observed at all once it starts below the first screen.
      ([entry]) => {
        if (entry.isIntersecting) this.activeSection.set(lastKey);
      },
      { threshold: 0 }
    );
    endObserver.observe(sentinel);
    this.scrollEndObserver = endObserver;
  }

  private teardownScrollSpy(): void {
    this.scrollSpyObserver?.disconnect();
    this.scrollEndObserver?.disconnect();
    this.scrollStartObserver?.disconnect();
    this.scrollSpyObserver = undefined;
    this.scrollEndObserver = undefined;
    this.scrollStartObserver = undefined;
    this.spyEndBelowFold = undefined;
    this.spyViewportHeight = undefined;
  }
}
