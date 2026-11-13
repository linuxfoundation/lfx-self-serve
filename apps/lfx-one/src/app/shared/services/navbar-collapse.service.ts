// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { computed, DestroyRef, inject, Injectable, PLATFORM_ID, signal } from '@angular/core';
import { NAVBAR_COLLAPSED_STORAGE_KEY, NAVBAR_LEFT_PAGE_STORAGE_KEY, NAVBAR_NARROW_MAX_WIDTH_PX, NAVBAR_PEEK_OUT_MS } from '@lfx-one/shared/constants';

/**
 * Collapse state of the desktop navbar: docked open (288px gutter), docked to its 56px rail, or peeking
 * open over the page from the rail. The layouts read it to size the page gutter; the desktop navbar
 * drives it (pointer, FLIP morph) and renders it.
 *
 * - `collapsed` is the viewer's docked preference, kept in `sessionStorage`. It is restored only when this tab itself left
 *   the page and came back: a reload, Back/Forward, or one of the app's own full-page redirects (sign-in, account linking,
 *   invites). Each page leaves a one-time mark on `pagehide` that the next load consumes (a back/forward-cache restore
 *   clears it, as the page resumes rather than loads). A reload with no mark, such as a tab the browser discarded to save
 *   memory or recovered after a crash, also restores it. A new tab or browser session
 *   always starts docked open, including a duplicated tab or one opened from a link: they inherit a copy of the opener's
 *   session storage, but the opener never left its page, so there is no mark to inherit.
 * - `narrow` (a non-touch viewport under {@link NAVBAR_NARROW_MAX_WIDTH_PX}) forces the rail without
 *   touching the preference, which returns once the viewport widens again.
 * - A non-touch device keeps the navbar (as the rail) at every width; the hamburger + drawer below `lg`
 *   are for touch devices only. Touch devices are never narrow, and pin the peeks they open.
 *
 * Browser-only state starts at its server defaults (docked open) and is read once the desktop navbar
 * has rendered ({@link init}), so SSR and the first client render agree.
 */
@Injectable({ providedIn: 'root' })
export class NavbarCollapseService {
  private readonly document = inject(DOCUMENT);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly destroyRef = inject(DestroyRef);

  private readonly collapsedPreference = signal(false);
  private readonly narrowViewport = signal(false);
  private readonly touchDevice = signal(false);
  private readonly peeking = signal(false);
  private readonly peekPinnedState = signal(false);
  private readonly peekClosing = signal(false);
  private readonly animatedState = signal(false);
  private readonly initializedState = signal(false);
  private peekOutTimer: ReturnType<typeof setTimeout> | null = null;
  private initialized = false;

  /** The viewer's docked-collapsed preference. */
  public readonly collapsed = this.collapsedPreference.asReadonly();
  /** Non-touch viewport too narrow to dock the navbar open. */
  public readonly narrow = this.narrowViewport.asReadonly();
  /** Coarse-pointer device without hover: no auto-collapse, and a peek is pinned (there is no pointer to leave it). */
  public readonly touch = this.touchDevice.asReadonly();
  /** The panel is open over the page from the rail. */
  public readonly peek = this.peeking.asReadonly();
  /** The peek is pinned (a touch device, which has no pointer to leave it): it ignores the pointer leaving. */
  public readonly peekPinned = this.peekPinnedState.asReadonly();
  /** The rail shrinks back from a peek: the panel keeps its overlay positioning until the morph ends. */
  public readonly peekOut = this.peekClosing.asReadonly();
  /** Width transitions are on — off until the stored preference has been applied, so a reload doesn't animate it in. */
  public readonly animated = this.animatedState.asReadonly();

  /**
   * The desktop navbar shows at every width (the rail below the narrow breakpoint) instead of handing over to the
   * hamburger and drawer below `lg`. Non-touch devices only, and only once known in the browser: SSR and the first
   * client render keep the `lg` switch.
   */
  public readonly railAtAnyWidth = computed(() => this.initializedState() && !this.touchDevice());

  /** Docked to the rail, by preference or because the viewport is narrow. The page gutter follows this. */
  public readonly effectiveCollapsed = computed(() => this.collapsedPreference() || this.narrowViewport());
  /** What the panel looks like: the rail, unless it is peeking open. */
  public readonly visualCollapsed = computed(() => this.effectiveCollapsed() && !this.peeking());
  /** The panel floats over the page (peeking, or shrinking back from a peek) instead of sitting in its gutter. */
  public readonly overlay = computed(() => this.effectiveCollapsed() && (this.peeking() || this.peekClosing()));

  /**
   * The page's left gutter under the desktop navbar: 288px docked open, 56px on the rail (a peek floats over it) — from
   * `lg` up, or at every width when {@link railAtAnyWidth}. Full class names, so Tailwind finds them here.
   */
  public readonly gutterClass = computed(() => {
    const collapsed = this.effectiveCollapsed();
    let gutter: string;
    if (this.railAtAnyWidth()) gutter = collapsed ? 'ml-[56px]' : 'ml-[288px]';
    else gutter = collapsed ? 'lg:ml-[56px]' : 'lg:ml-[288px]';
    return this.animatedState() ? `${gutter} transition-[margin-left] duration-[340ms] ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none` : gutter;
  });

  /** Reads the stored preference and starts tracking the viewport. Browser-only; later calls are no-ops. */
  public init(): void {
    if (!this.isBrowser || this.initialized) return;
    this.initialized = true;
    this.clearLegacyPreference();
    // Both run: the mark is consumed even on a reload, so a tab duplicated later can't inherit it.
    const leftPage = this.consumeLeftPageMark();
    if (leftPage || this.reloadedWithoutMark()) this.collapsedPreference.set(this.readPreference());
    else this.writePreference(false);
    this.initializedState.set(true);

    const view = this.document.defaultView;
    const onPageHide = (): void => this.markLeftPage();
    // A back/forward-cache restore resumes this page without a new init(): drop the mark it left on the way out.
    const onPageShow = (event: PageTransitionEvent): void => {
      if (event.persisted) this.consumeLeftPageMark();
    };
    view?.addEventListener('pagehide', onPageHide);
    view?.addEventListener('pageshow', onPageShow);
    this.destroyRef.onDestroy(() => {
      view?.removeEventListener('pagehide', onPageHide);
      view?.removeEventListener('pageshow', onPageShow);
    });
    if (view?.matchMedia) {
      const narrowQuery = view.matchMedia(`(max-width: ${NAVBAR_NARROW_MAX_WIDTH_PX - 0.02}px)`);
      const touchQuery = view.matchMedia('(hover: none) and (pointer: coarse)');
      const update = (): void => {
        const narrow = narrowQuery.matches && !touchQuery.matches;
        this.touchDevice.set(touchQuery.matches);
        if (narrow !== this.narrowViewport()) {
          this.resetPeek();
          this.narrowViewport.set(narrow);
        }
      };
      update();
      narrowQuery.addEventListener('change', update);
      touchQuery.addEventListener('change', update);
    }

    // Two frames: the restored state paints first, so the transitions only apply to later changes. A restored rail
    // narrows the gutter the server rendered at 288px, so width-measuring pages are told, as after any collapse.
    const restoredRail = this.effectiveCollapsed();
    view?.requestAnimationFrame(() =>
      view.requestAnimationFrame(() => {
        this.animatedState.set(true);
        if (restoredRail) view.dispatchEvent(new Event('resize'));
      })
    );
  }

  /** Docks the navbar open or to its rail, and remembers the choice. Closes any peek. */
  public setCollapsed(collapsed: boolean): void {
    this.resetPeek();
    this.collapsedPreference.set(collapsed);
    this.writePreference(collapsed);
  }

  /** Opens the panel over the page from the rail; `pinned` keeps it open as the pointer leaves (see {@link peekPinned}). */
  public openPeek(pinned = false): void {
    if (!this.effectiveCollapsed()) return;
    this.clearPeekOut();
    this.peeking.set(true);
    this.peekPinnedState.set(pinned);
  }

  /** Shrinks a peek back to the rail, keeping the overlay positioning while the panel morphs. */
  public closePeek(): void {
    if (!this.peeking()) return;
    this.peeking.set(false);
    this.peekPinnedState.set(false);
    this.clearPeekOut();
    this.peekClosing.set(true);
    this.peekOutTimer = setTimeout(() => {
      this.peekOutTimer = null;
      this.peekClosing.set(false);
    }, NAVBAR_PEEK_OUT_MS);
  }

  /** Drops every peek state at once, without the closing phase. */
  public resetPeek(): void {
    this.clearPeekOut();
    this.peekClosing.set(false);
    this.peeking.set(false);
    this.peekPinnedState.set(false);
  }

  private clearPeekOut(): void {
    if (this.peekOutTimer) clearTimeout(this.peekOutTimer);
    this.peekOutTimer = null;
  }

  private readPreference(): boolean {
    try {
      return this.document.defaultView?.sessionStorage.getItem(NAVBAR_COLLAPSED_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  }

  private writePreference(collapsed: boolean): void {
    try {
      this.document.defaultView?.sessionStorage.setItem(NAVBAR_COLLAPSED_STORAGE_KEY, String(collapsed));
    } catch {
      // Storage blocked (private mode, policy): the choice still holds for this page.
    }
  }

  /**
   * This tab is leaving the page (reload, redirect, Back/Forward): the next load in it restores the preference.
   *
   * Accepted edge case: a tab that leaves for another site and never returns keeps the mark until it closes. If a tab is
   * then duplicated, or opened with an opener from that site, and the browser copies this origin's session storage, the
   * new tab starts on the rail. It takes a specific sequence and only costs a collapsed sidebar, so the mark has no expiry,
   * which would also break slow sign-in or account-linking round trips.
   */
  private markLeftPage(): void {
    try {
      this.document.defaultView?.sessionStorage.setItem(NAVBAR_LEFT_PAGE_STORAGE_KEY, 'true');
    } catch {
      // Storage blocked: the next load starts docked open.
    }
  }

  /**
   * A reload that left no mark: the browser discarded the tab to save memory, or recovered it after a crash, without a
   * `pagehide`. A duplicated tab reports a back/forward navigation, not a reload, so it still starts docked open.
   */
  private reloadedWithoutMark(): boolean {
    try {
      const doc = this.document as Document & { wasDiscarded?: boolean };
      if (doc.wasDiscarded) return true;
      const entry = this.document.defaultView?.performance?.getEntriesByType?.('navigation')[0] as PerformanceNavigationTiming | undefined;
      return entry?.type === 'reload';
    } catch {
      return false;
    }
  }

  /** Whether this tab left the page and came back. The mark is removed, so a tab duplicated later can't inherit it. */
  private consumeLeftPageMark(): boolean {
    try {
      const storage = this.document.defaultView?.sessionStorage;
      const marked = storage?.getItem(NAVBAR_LEFT_PAGE_STORAGE_KEY) === 'true';
      storage?.removeItem(NAVBAR_LEFT_PAGE_STORAGE_KEY);
      return marked;
    } catch {
      return false;
    }
  }

  /** The preference used to live in `localStorage`, where it kept every later visit collapsed; drop that stale copy. */
  private clearLegacyPreference(): void {
    try {
      this.document.defaultView?.localStorage.removeItem(NAVBAR_COLLAPSED_STORAGE_KEY);
    } catch {
      // Storage blocked: nothing was stored there either.
    }
  }
}
