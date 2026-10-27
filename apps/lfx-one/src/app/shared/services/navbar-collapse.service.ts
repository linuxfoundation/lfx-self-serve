// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { computed, inject, Injectable, PLATFORM_ID, signal } from '@angular/core';
import { NAVBAR_COLLAPSED_STORAGE_KEY, NAVBAR_NARROW_MAX_WIDTH_PX, NAVBAR_PEEK_OUT_MS } from '@lfx-one/shared/constants';

/**
 * Collapse state of the desktop navbar: docked open (288px gutter), docked to its 56px rail, or peeking
 * open over the page from the rail. The layouts read it to size the page gutter; the desktop navbar
 * drives it (pointer, FLIP morph) and renders it.
 *
 * - `collapsed` is the viewer's docked preference, kept in `localStorage`.
 * - `narrow` (a non-touch viewport under {@link NAVBAR_NARROW_MAX_WIDTH_PX}) forces the rail without
 *   touching the preference, which returns once the viewport widens again.
 * - Touch devices are never narrow and never peek on hover: their sidebar behaves as before.
 *
 * Browser-only state starts at its server defaults (docked open) and is read once the desktop navbar
 * has rendered ({@link init}), so SSR and the first client render agree.
 */
@Injectable({ providedIn: 'root' })
export class NavbarCollapseService {
  private readonly document = inject(DOCUMENT);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private readonly collapsedPreference = signal(false);
  private readonly narrowViewport = signal(false);
  private readonly touchDevice = signal(false);
  private readonly peeking = signal(false);
  private readonly peekPinnedState = signal(false);
  private readonly peekClosing = signal(false);
  private readonly animatedState = signal(false);
  private peekOutTimer: ReturnType<typeof setTimeout> | null = null;
  private initialized = false;

  /** The viewer's docked-collapsed preference. */
  public readonly collapsed = this.collapsedPreference.asReadonly();
  /** Non-touch viewport too narrow to dock the navbar open. */
  public readonly narrow = this.narrowViewport.asReadonly();
  /** Coarse-pointer device without hover: no auto-collapse, no hover peek. */
  public readonly touch = this.touchDevice.asReadonly();
  /** The panel is open over the page from the rail. */
  public readonly peek = this.peeking.asReadonly();
  /** The peek was opened by a click (narrow viewports): it ignores the pointer leaving and closes on an outside click. */
  public readonly peekPinned = this.peekPinnedState.asReadonly();
  /** The rail shrinks back from a peek: the panel keeps its overlay positioning until the morph ends. */
  public readonly peekOut = this.peekClosing.asReadonly();
  /** Width transitions are on — off until the stored preference has been applied, so a reload doesn't animate it in. */
  public readonly animated = this.animatedState.asReadonly();

  /** Docked to the rail, by preference or because the viewport is narrow. The page gutter follows this. */
  public readonly effectiveCollapsed = computed(() => this.collapsedPreference() || this.narrowViewport());
  /** What the panel looks like: the rail, unless it is peeking open. */
  public readonly visualCollapsed = computed(() => this.effectiveCollapsed() && !this.peeking());
  /** The panel floats over the page (peeking, or shrinking back from a peek) instead of sitting in its gutter. */
  public readonly overlay = computed(() => this.effectiveCollapsed() && (this.peeking() || this.peekClosing()));

  /** Reads the stored preference and starts tracking the viewport. Browser-only; later calls are no-ops. */
  public init(): void {
    if (!this.isBrowser || this.initialized) return;
    this.initialized = true;
    this.collapsedPreference.set(this.readPreference());

    const view = this.document.defaultView;
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

    // Two frames: the restored state paints first, so the transitions only apply to later changes.
    view?.requestAnimationFrame(() => view.requestAnimationFrame(() => this.animatedState.set(true)));
  }

  /** Docks the navbar open or to its rail, and remembers the choice. Closes any peek. */
  public setCollapsed(collapsed: boolean): void {
    this.resetPeek();
    this.collapsedPreference.set(collapsed);
    this.writePreference(collapsed);
  }

  /** Opens the panel over the page from the rail; `pinned` when a click (not hover) opened it. */
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
      return this.document.defaultView?.localStorage.getItem(NAVBAR_COLLAPSED_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  }

  private writePreference(collapsed: boolean): void {
    try {
      this.document.defaultView?.localStorage.setItem(NAVBAR_COLLAPSED_STORAGE_KEY, String(collapsed));
    } catch {
      // Storage blocked (private mode, policy): the choice still holds for this session.
    }
  }
}
