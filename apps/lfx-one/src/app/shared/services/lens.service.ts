// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, inject, Injectable, signal, Signal, WritableSignal } from '@angular/core';
import { NavigationCancel, NavigationEnd, NavigationError, NavigationSkipped, Router } from '@angular/router';
import {
  ALL_LENSES,
  DEFAULT_LENS,
  DEFAULT_NAV_LENS,
  LENS_COOKIE_KEY,
  LENS_DEFAULT_ROUTES,
  NAV_LENS_COOKIE_KEY,
  ORG_LENS_ENABLED_FLAG,
} from '@lfx-one/shared/constants';
import { Lens, LensGrantInputs, LensOption, NavLens } from '@lfx-one/shared/interfaces';
import { deriveAllowedLenses, isHybridLensUser } from '@lfx-one/shared/utils';
import { SsrCookieService } from 'ngx-cookie-service-ssr';
import { filter, take } from 'rxjs';

import { CookieRegistryService } from './cookie-registry.service';
import { FeatureFlagService } from './feature-flag.service';
import { PersonaService } from './persona.service';
import { WriterGrantsService } from './writer-grants.service';

@Injectable({
  providedIn: 'root',
})
export class LensService {
  private readonly cookieService = inject(SsrCookieService);
  private readonly cookieRegistry = inject(CookieRegistryService);
  private readonly personaService = inject(PersonaService);
  private readonly featureFlagService = inject(FeatureFlagService);
  private readonly writerGrantsService = inject(WriterGrantsService);
  private readonly router = inject(Router);

  /** Dark-launch gate; off by default until the LaunchDarkly flag is flipped. */
  private readonly isOrgLensEnabled = this.featureFlagService.getBooleanFlag(ORG_LENS_ENABLED_FLAG, false);

  private readonly selectedLens: WritableSignal<Lens>;
  /**
   * Set only by `setContextLens()`; makes `activeLens` bypass the persona-lens clamp for the
   * create flow. Cleared by any normal `setLens()`/`switchLens()` call, or automatically once the
   * navigation `setContextLens()` was called for concludes (see `setContextLens`) — it must not
   * outlive that one navigation, since a committee-only writer may hold no lens capable of
   * clearing it through the normal UI.
   */
  private readonly contextLensOverride: WritableSignal<Lens | null> = signal(null);

  /** Last foundation/project lens viewed — lets the merged 'Projects' entry (hybrid personas) return to a foundation. */
  private readonly navLensSelection: WritableSignal<NavLens>;
  public readonly lastNavLens: Signal<NavLens>;

  /** Active lens clamped to the current persona's allowed set; falls back to default if disallowed. */
  public readonly activeLens: Signal<Lens> = this.initActiveLens();
  /** Full set of lenses the current persona is authorised to use — drives routing and downstream visibility filters. */
  public readonly availableLenses: Signal<LensOption[]> = this.initAvailableLenses();
  /** Lenses shown in the sidebar switcher. Mirrors {@link availableLenses} except for hybrid personas, who get a merged project entry instead of separate foundation + project buttons. */
  public readonly displayLenses: Signal<LensOption[]> = this.initDisplayLenses();
  /** Single source of the persona/grant booleans, so lens visibility and the hybrid merge always agree. */
  private readonly lensGrantInputs: Signal<LensGrantInputs> = this.initLensGrantInputs();
  /**
   * True when the user can reach both the foundation and project lenses, from any grant source —
   * a board+project role pair, LF staff membership, a root-writer grant, or `writer` grants.
   * Shares {@link lensGrantInputs} with {@link getAllowedLensIds} so the merged switcher entry
   * cannot disagree with which lenses actually render.
   */
  public readonly isHybridPersona: Signal<boolean> = computed(() => isHybridLensUser(this.lensGrantInputs()));
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
    // A deliberate, persona-gated switch supersedes any pending create-flow override.
    this.contextLensOverride.set(null);
    this.applyLensSelection(lens);
    return true;
  }

  /**
   * Aligns `activeContext`'s lens-gated slot and the `/foundation/`/`/project/` route prefix to
   * `lens`, without checking whether the current persona is allowed it (LFXV2-2838).
   *
   * Not a persona-lens switch — scoped strictly to the create picker, which has already proven
   * access to the specific project/committee explicitly (a direct grant or a batch access-check
   * that evaluates inherited access), so gating on `getAllowedLensIds()` here would reject
   * legitimate, already-authorized picks purely because the persona doesn't happen to hold a
   * matching lens. `setLens()` keeps that gate for every other caller (sidebar, lens-switcher,
   * dashboards) — this method exists so the create flow doesn't have to go through it.
   *
   * `applyLensSelection()` alone isn't enough: `activeLens` re-derives its value from
   * `selectedLens` through `getAllowedLensIds()` on every read, so setting `selectedLens` without
   * also recording an override would silently get clamped straight back to `DEFAULT_LENS` for
   * exactly the users this method exists to unblock. `contextLensOverride` makes `activeLens`
   * (and everything downstream of it — `lensRedirectGuard`, `ProjectContextService.activeContext`)
   * bypass that clamp until a normal `setLens()`/`switchLens()` call clears it.
   *
   * The override also self-clears once the navigation this call is for concludes (success,
   * cancel, or error) — without that, a persona whose allowed lenses never include `lens` (e.g. a
   * committee-only writer creating against a project/foundation target) has no normal
   * `setLens()`/`switchLens()` call left to run, since the lens-switcher UI only offers lenses
   * `getAllowedLensIds()` admits. Left unscoped, the override would silently stick past this one
   * navigation and clamp every subsequent route (including lens-agnostic ones like `/profile`) to
   * `lens` for the rest of the session.
   */
  public setContextLens(lens: Lens): void {
    this.contextLensOverride.set(lens);
    this.applyLensSelection(lens);
    this.router.events
      .pipe(
        filter(
          (event) =>
            event instanceof NavigationEnd || event instanceof NavigationCancel || event instanceof NavigationError || event instanceof NavigationSkipped
        ),
        take(1)
      )
      .subscribe(() => this.contextLensOverride.set(null));
  }

  private applyLensSelection(lens: Lens): void {
    if ((lens === 'foundation' || lens === 'project') && lens !== this.navLensSelection()) {
      this.navLensSelection.set(lens);
      this.persistNavLensToCookie(lens);
    }
    if (lens !== this.selectedLens()) {
      this.selectedLens.set(lens);
      this.persistToCookie(lens);
    }
  }

  private initActiveLens(): Signal<Lens> {
    return computed(() => {
      const override = this.contextLensOverride();
      if (override) {
        return override;
      }
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

  /**
   * Lenses the current user may use. Persona roles and `writer` grants each confer access
   * independently (LFXV2-2754) — see `deriveAllowedLenses` for why either suffices.
   *
   * This set is not stable across a session, in two different ways:
   *  - the `writer` half arrives after hydration (see {@link WriterGrantsService}) and only ever
   *    widens as grants land;
   *  - the persona half can *narrow*. It is seeded from a cookie and then replaced by
   *    `PersonaService.refreshFromApi()`, which may drop a role the cookie claimed and clears
   *    `isRootWriter` on its error path.
   *
   * So a caller must treat a `false` from {@link setLens} as provisional rather than final, and
   * must not assume a lens it holds now will still be allowed later.
   * `MainLayoutComponent.syncLensFromRoute` is the one caller that re-asserts.
   */
  private getAllowedLensIds(): readonly Lens[] {
    return deriveAllowedLenses(this.lensGrantInputs());
  }

  private initLensGrantInputs(): Signal<LensGrantInputs> {
    return computed(() => ({
      hasBoardRole: this.personaService.hasBoardRole(),
      hasProjectRole: this.personaService.hasProjectRole(),
      isRootWriter: this.personaService.isRootWriter(),
      hasWriterFoundation: this.writerGrantsService.hasWriterFoundation(),
      hasWriterProject: this.writerGrantsService.hasWriterProject(),
      isOrgLensEnabled: this.isOrgLensEnabled(),
      isLFStaff: this.personaService.isLFStaff(),
    }));
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
