// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, inject, Injectable, Signal, signal, WritableSignal } from '@angular/core';
import { ALL_LENSES, BOARD_SCOPED_LENSES, DEFAULT_LENS, DUAL_SCOPED_LENSES, LENS_COOKIE_KEY, PROJECT_SCOPED_LENSES } from '@lfx-one/shared/constants';
import { Lens, LensOption } from '@lfx-one/shared/interfaces';
import { SsrCookieService } from 'ngx-cookie-service-ssr';

import { CookieRegistryService } from './cookie-registry.service';
import { PersonaService } from './persona.service';

@Injectable({
  providedIn: 'root',
})
export class LensService {
  private readonly cookieService = inject(SsrCookieService);
  private readonly cookieRegistry = inject(CookieRegistryService);
  private readonly personaService = inject(PersonaService);

  private readonly selectedLens: WritableSignal<Lens>;

  /**
   * Active lens, clamped to the current persona's allowed set.
   * If the stored/selected lens is not allowed, falls back to the default.
   */
  public readonly activeLens: Signal<Lens> = this.initActiveLens();

  /**
   * Available lenses based on current persona.
   * Board-scoped personas see Me + Foundation + Org.
   * Project-scoped personas see Me + Project + Org.
   */
  public readonly availableLenses: Signal<LensOption[]> = this.initAvailableLenses();

  public constructor() {
    const stored = this.loadFromCookie();
    this.selectedLens = signal<Lens>(stored ?? DEFAULT_LENS);
  }

  /**
   * Set the active lens and persist to cookie.
   * Ignores the request if the lens is not in the current persona's allowed set.
   */
  public setLens(lens: Lens): void {
    const allowed = this.getAllowedLensIds();
    if (!allowed.includes(lens)) {
      return;
    }
    if (lens === this.selectedLens()) {
      return;
    }
    this.selectedLens.set(lens);
    this.persistToCookie(lens);
  }

  private initActiveLens(): Signal<Lens> {
    return computed(() => {
      const selected = this.selectedLens();
      const allowed = this.getAllowedLensIds();
      return allowed.includes(selected) ? selected : DEFAULT_LENS;
    });
  }

  private initAvailableLenses(): Signal<LensOption[]> {
    return computed(() => {
      const lensIds = this.getAllowedLensIds();
      return lensIds.map((id) => ALL_LENSES[id]);
    });
  }

  private getAllowedLensIds(): readonly Lens[] {
    const hasBoardRole = this.personaService.hasBoardRole();
    const hasProjectRole = this.personaService.hasProjectRole();

    if (hasBoardRole && hasProjectRole) {
      return DUAL_SCOPED_LENSES;
    }
    return hasBoardRole ? BOARD_SCOPED_LENSES : PROJECT_SCOPED_LENSES;
  }

  private persistToCookie(lens: Lens): void {
    this.cookieService.set(LENS_COOKIE_KEY, lens, {
      expires: 30,
      path: '/',
      sameSite: 'Lax',
      secure: typeof window !== 'undefined' && window.location.protocol === 'https:',
    });
    this.cookieRegistry.registerCookie(LENS_COOKIE_KEY);
  }

  private loadFromCookie(): Lens | null {
    try {
      const stored = this.cookieService.get(LENS_COOKIE_KEY);
      if (stored && stored in ALL_LENSES) {
        return stored as Lens;
      }
    } catch {
      // Invalid cookie data, ignore
    }
    return null;
  }
}
