// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { afterNextRender, computed, inject, Injectable, PLATFORM_ID, signal } from '@angular/core';
import { PUBLIC_PROFILE_THEME_STORAGE_KEY } from '@lfx-one/shared/constants';
import { PublicProfileTheme } from '@lfx-one/shared/interfaces';

/**
 * A visitor's light or dark theme for the redesigned public profile (#6091), kept in `localStorage` so it holds across visits.
 * It starts light, as the server renders, and reads the stored choice once the browser has rendered, so SSR and hydration agree.
 * Provided by the page.
 */
@Injectable()
export class PublicProfileThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private readonly themeState = signal<PublicProfileTheme>('light');

  /** The visitor's theme. */
  public readonly theme = this.themeState.asReadonly();
  public readonly dark = computed(() => this.themeState() === 'dark');

  public constructor() {
    if (this.isBrowser) afterNextRender(() => this.themeState.set(this.readPreference()));
  }

  /** Switches the theme and remembers the choice. */
  public setTheme(theme: PublicProfileTheme): void {
    this.themeState.set(theme);
    try {
      this.document.defaultView?.localStorage.setItem(PUBLIC_PROFILE_THEME_STORAGE_KEY, theme);
    } catch {
      // Storage blocked (private mode, policy): the choice still holds for this visit.
    }
  }

  /** Flips between light and dark. */
  public toggle(): void {
    this.setTheme(this.dark() ? 'light' : 'dark');
  }

  private readPreference(): PublicProfileTheme {
    try {
      return this.document.defaultView?.localStorage.getItem(PUBLIC_PROFILE_THEME_STORAGE_KEY) === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  }
}
