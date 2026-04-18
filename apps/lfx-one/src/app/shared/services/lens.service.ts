// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, inject, Injectable, signal, Signal, WritableSignal } from '@angular/core';
import { ALL_LENSES, DEFAULT_LENS, LENS_COOKIE_KEY } from '@lfx-one/shared/constants';
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

  /** Active lens clamped to the current persona's allowed set; falls back to default if disallowed. */
  public readonly activeLens: Signal<Lens> = this.initActiveLens();
  public readonly availableLenses: Signal<LensOption[]> = this.initAvailableLenses();

  public constructor() {
    const stored = this.loadFromCookie();
    this.selectedLens = signal<Lens>(stored ?? DEFAULT_LENS);
  }

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
    const isRootWriter = this.personaService.isRootWriter();

    // Root writers bypass persona filtering and see both foundation + project lenses.
    const showFoundation = hasBoardRole || isRootWriter;
    const showProject = hasProjectRole || isRootWriter;

    const lenses: Lens[] = ['me'];
    if (showFoundation) {
      lenses.push('foundation');
    }
    if (showProject) {
      lenses.push('project');
    }
    lenses.push('org');
    return lenses;
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
      /* invalid cookie data */
    }
    return null;
  }
}
