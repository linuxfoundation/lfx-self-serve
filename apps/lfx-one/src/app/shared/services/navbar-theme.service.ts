// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { computed, inject, Injectable, PLATFORM_ID, signal } from '@angular/core';
import { NAVBAR_THEME_STORAGE_KEY } from '@lfx-one/shared/constants';
import { NavbarTheme } from '@lfx-one/shared/interfaces';

/**
 * The desktop sidebar's colour theme: `dark` (the default) or `light`, picked in the account menu.
 *
 * The choice is kept in `localStorage`, so it survives a reload and holds in every tab; a change made in another tab is
 * picked up through the `storage` event. The mobile drawer ignores it and always stays dark.
 *
 * Like {@link NavbarCollapseService}, the browser-only state starts at the server default (`dark`) and the stored choice
 * is read once the desktop navbar has rendered ({@link init}), so SSR and the first client render agree.
 */
@Injectable({ providedIn: 'root' })
export class NavbarThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private readonly themeState = signal<NavbarTheme>('dark');
  private initialized = false;

  /** The viewer's sidebar theme. */
  public readonly theme = this.themeState.asReadonly();
  /** The light theme is chosen. */
  public readonly light = computed(() => this.themeState() === 'light');

  /** Reads the stored choice and follows changes made in other tabs. Browser-only; later calls are no-ops. */
  public init(): void {
    if (!this.isBrowser || this.initialized) return;
    this.initialized = true;
    this.themeState.set(this.readPreference());

    this.document.defaultView?.addEventListener('storage', (event: StorageEvent) => {
      if (event.key === NAVBAR_THEME_STORAGE_KEY || event.key === null) this.themeState.set(this.readPreference());
    });
  }

  /** Switches the sidebar theme and remembers the choice. */
  public setTheme(theme: NavbarTheme): void {
    this.themeState.set(theme);
    this.writePreference(theme);
  }

  private readPreference(): NavbarTheme {
    try {
      return this.document.defaultView?.localStorage.getItem(NAVBAR_THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  }

  private writePreference(theme: NavbarTheme): void {
    try {
      this.document.defaultView?.localStorage.setItem(NAVBAR_THEME_STORAGE_KEY, theme);
    } catch {
      // Storage blocked (private mode, policy): the choice still holds for this session.
    }
  }
}
