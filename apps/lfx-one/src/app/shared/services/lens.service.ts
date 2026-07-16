// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, inject, Injectable, signal, Signal, WritableSignal } from '@angular/core';
import { Router } from '@angular/router';
import {
  ALL_LENSES,
  DEFAULT_LENS,
  DEFAULT_NAV_LENS,
  LENS_COOKIE_KEY,
  LENS_DEFAULT_ROUTES,
  NAV_LENS_COOKIE_KEY,
  ORG_LENS_ENABLED_FLAG,
} from '@lfx-one/shared/constants';
import { Lens, LensOption, NavLens } from '@lfx-one/shared/interfaces';
import { SsrCookieService } from 'ngx-cookie-service-ssr';

import { CookieRegistryService } from './cookie-registry.service';
import { FeatureFlagService } from './feature-flag.service';
import { PersonaService } from './persona.service';

@Injectable({
  providedIn: 'root',
})
export class LensService {
  private readonly cookieService = inject(SsrCookieService);
  private readonly cookieRegistry = inject(CookieRegistryService);
  private readonly personaService = inject(PersonaService);
  private readonly featureFlagService = inject(FeatureFlagService);
  private readonly router = inject(Router);

  /** Dark-launch gate; off by default until the LaunchDarkly flag is flipped. */
  private readonly isOrgLensEnabled = this.featureFlagService.getBooleanFlag(ORG_LENS_ENABLED_FLAG, false);

  private readonly selectedLens: WritableSignal<Lens>;

  /** Last foundation/project lens viewed — lets the merged 'Projects' entry (hybrid personas) return to a foundation. */
  private readonly navLensSelection: WritableSignal<NavLens>;
  public readonly lastNavLens: Signal<NavLens>;

  /** Active lens clamped to the current persona's allowed set; falls back to default if disallowed. */
  public readonly activeLens: Signal<Lens> = this.initActiveLens();
  /** Full set of lenses the current persona is authorised to use — drives routing and downstream visibility filters. */
  public readonly availableLenses: Signal<LensOption[]> = this.initAvailableLenses();
  /** Lenses shown in the sidebar switcher. Mirrors {@link availableLenses} except for hybrid personas, who get a merged project entry instead of separate foundation + project buttons. */
  public readonly displayLenses: Signal<LensOption[]> = this.initDisplayLenses();
  /** True when the user holds both a board role (ED/Board Member) AND a project role (Maintainer/Contributor). */
  public readonly isHybridPersona: Signal<boolean> = computed(() => this.personaService.hasBoardRole() && this.personaService.hasProjectRole());
  /** Lens to highlight in the switcher UI. Hybrid personas merge foundation + project into the 'project' entry, so a foundation-scoped active lens highlights 'project'. */
  public readonly displayActiveLens: Signal<Lens> = computed(() => {
    const active = this.activeLens();
    return this.isHybridPersona() && active === 'foundation' ? 'project' : active;
  });

  public constructor() {
    const stored = this.loadFromCookie();
    this.selectedLens = signal<Lens>(stored ?? DEFAULT_LENS);
    this.navLensSelection = signal<NavLens>(this.loadNavLensFromCookie() ?? DEFAULT_NAV_LENS);
    this.lastNavLens = this.navLensSelection.asReadonly();
  }

  /**
   * Switch the active lens from a UI control and navigate to its default route.
   * Hybrid personas merge foundation + project into the 'Projects' entry — clicking it returns to the
   * last viewed nav lens so a previously selected foundation isn't reset to the project lens.
   */
  public switchLens(lens: Lens): void {
    const target = this.isHybridPersona() && lens === 'project' ? this.lastNavLens() : lens;
    if (this.setLens(target)) {
      this.router.navigate([LENS_DEFAULT_ROUTES[target]]);
    }
  }

  /** Applies the lens if the current persona is allowed it. Returns whether the lens was allowed (callers gate navigation on this). */
  public setLens(lens: Lens): boolean {
    const allowed = this.getAllowedLensIds();
    if (!allowed.includes(lens)) {
      return false;
    }
    if ((lens === 'foundation' || lens === 'project') && lens !== this.navLensSelection()) {
      this.navLensSelection.set(lens);
      this.persistNavLensToCookie(lens);
    }
    if (lens !== this.selectedLens()) {
      this.selectedLens.set(lens);
      this.persistToCookie(lens);
    }
    return true;
  }

  private initActiveLens(): Signal<Lens> {
    return computed(() => {
      const selected = this.selectedLens();
      const allowed = this.getAllowedLensIds();
      return allowed.includes(selected) ? selected : DEFAULT_LENS;
    });
  }

  private initAvailableLenses(): Signal<LensOption[]> {
    return computed(() => this.getAllowedLensIds().map((id) => ALL_LENSES[id]));
  }

  private initDisplayLenses(): Signal<LensOption[]> {
    return computed(() => {
      const lenses = this.availableLenses();
      // For hybrid personas the 'project' button serves as the merged entry — hide the separate foundation button.
      return this.isHybridPersona() ? lenses.filter((option) => option.id !== 'foundation') : lenses;
    });
  }

  private getAllowedLensIds(): readonly Lens[] {
    const hasBoardRole = this.personaService.hasBoardRole();
    const hasProjectRole = this.personaService.hasProjectRole();
    const isRootWriter = this.personaService.isRootWriter();
    const isRootMarketingAuditor = this.personaService.isRootMarketingAuditor();

    // Root writers bypass persona filtering and see both foundation + project lenses.
    // Root marketing auditors (non-board marketing users) get the foundation lens so they can
    // reach the per-project Marketing surfaces, but not the project lens.
    const showFoundation = hasBoardRole || isRootWriter || isRootMarketingAuditor;
    const showProject = hasProjectRole || isRootWriter;

    const lenses: Lens[] = ['me'];
    if (showFoundation) {
      lenses.push('foundation');
    }
    if (showProject) {
      lenses.push('project');
    }
    if (this.isOrgLensEnabled()) {
      lenses.push('org');
    }
    return lenses;
  }

  private persistToCookie(lens: Lens): void {
    this.cookieService.set(LENS_COOKIE_KEY, lens, {
      expires: 30,
      path: '/',
      sameSite: 'Lax',
      secure: process.env['NODE_ENV'] === 'production',
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

  private persistNavLensToCookie(lens: NavLens): void {
    this.cookieService.set(NAV_LENS_COOKIE_KEY, lens, {
      expires: 30,
      path: '/',
      sameSite: 'Lax',
      secure: process.env['NODE_ENV'] === 'production',
    });
    this.cookieRegistry.registerCookie(NAV_LENS_COOKIE_KEY);
  }

  private loadNavLensFromCookie(): NavLens | null {
    try {
      const stored = this.cookieService.get(NAV_LENS_COOKIE_KEY);
      if (stored === 'foundation' || stored === 'project') {
        return stored;
      }
    } catch {
      /* invalid cookie data */
    }
    return null;
  }
}
