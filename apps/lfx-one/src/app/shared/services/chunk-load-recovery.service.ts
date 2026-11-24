// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { DestroyRef, inject, Injectable, PLATFORM_ID, signal } from '@angular/core';
import { CHUNK_LOAD_RELOAD_STORAGE_KEY, CHUNK_LOAD_RELOAD_WATCHDOG_MS, CHUNK_LOAD_RELOAD_WINDOW_MS } from '@lfx-one/shared/constants';
import { isChunkLoadError, isDeferredLoadError } from '@lfx-one/shared/utils';

/** Early error recovery: deliberately independent of Router, HTTP, dialogs, and user state. */
@Injectable({ providedIn: 'root' })
export class ChunkLoadRecoveryService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly needsReloadState = signal(false);
  private readonly reloadingState = signal(false);
  private reloadWatchdog: ReturnType<typeof setTimeout> | undefined;

  public readonly needsReload = this.needsReloadState.asReadonly();
  public readonly reloading = this.reloadingState.asReadonly();

  public constructor() {
    this.destroyRef.onDestroy(() => this.clearReloadWatchdog());
  }

  public handleError(error: unknown): boolean {
    if (!isPlatformBrowser(this.platformId)) return false;
    const importFailure = isChunkLoadError(error);
    if (!importFailure && !isDeferredLoadError(error)) return false;
    if (this.reloadingState() || this.needsReloadState()) return true;

    // A defer dependency may have failed during evaluation, not download. Offer explicit recovery.
    if (!importFailure || !this.canAutomaticallyReload()) {
      this.needsReloadState.set(true);
      return true;
    }

    this.performReload();
    return true;
  }

  /** Refresh only the current address; never navigate using an error message or failed URL. */
  public reload(): void {
    if (!isPlatformBrowser(this.platformId) || this.reloadingState()) return;
    const browser = this.document.defaultView;
    if (!browser) {
      this.needsReloadState.set(true);
      return;
    }

    // Manual recovery remains available when storage is blocked; automatic recovery fails closed.
    try {
      browser.sessionStorage.setItem(CHUNK_LOAD_RELOAD_STORAGE_KEY, String(Date.now()));
    } catch {
      // canAutomaticallyReload refuses to initiate a reload without a persistent loop guard.
    }
    this.performReload();
  }

  private performReload(): void {
    const browser = this.document.defaultView;
    if (!browser) {
      this.needsReloadState.set(true);
      return;
    }
    this.reloadingState.set(true);
    // reload() can return normally when a beforeunload prompt is cancelled. If this document
    // survives, restore usable actions without initiating another automatic navigation.
    this.clearReloadWatchdog();
    this.reloadWatchdog = setTimeout(() => {
      this.reloadWatchdog = undefined;
      this.reloadingState.set(false);
      this.needsReloadState.set(true);
    }, CHUNK_LOAD_RELOAD_WATCHDOG_MS);
    try {
      browser.location.reload();
    } catch {
      this.clearReloadWatchdog();
      this.reloadingState.set(false);
      this.needsReloadState.set(true);
    }
  }

  private clearReloadWatchdog(): void {
    if (this.reloadWatchdog !== undefined) {
      clearTimeout(this.reloadWatchdog);
      this.reloadWatchdog = undefined;
    }
  }

  private canAutomaticallyReload(): boolean {
    try {
      const storage = this.document.defaultView?.sessionStorage;
      if (!storage) return false;
      const now = Date.now();
      const stored = storage.getItem(CHUNK_LOAD_RELOAD_STORAGE_KEY);
      if (stored !== null) {
        const lastReload = Number(stored);
        // Corrupt/future markers require a manual retry, which replaces the marker with now.
        if (!Number.isFinite(lastReload) || lastReload <= 0 || lastReload > now || now - lastReload < CHUNK_LOAD_RELOAD_WINDOW_MS) return false;
      }
      storage.setItem(CHUNK_LOAD_RELOAD_STORAGE_KEY, String(now));
      return true;
    } catch {
      return false;
    }
  }
}
