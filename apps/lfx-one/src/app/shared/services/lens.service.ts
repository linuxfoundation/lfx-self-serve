// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, inject, Injectable, signal, Signal, WritableSignal } from '@angular/core';
import { NavigationCancel, NavigationCancellationCode, NavigationEnd, NavigationError, NavigationSkipped, NavigationStart, Router } from '@angular/router';
import {
  ALL_LENSES,
  DEFAULT_LENS,
  DEFAULT_NAV_LENS,
  LENS_COOKIE_KEY,
  LENS_DEFAULT_ROUTES,
  MARKETING_OPS_FGA_ENABLED_FLAG,
  NAV_LENS_COOKIE_KEY,
} from '@lfx-one/shared/constants';
import { Lens, LensGrantInputs, LensOption, MenuLensPick, NavLens } from '@lfx-one/shared/interfaces';
import { deriveAllowedLenses, isHybridLensUser } from '@lfx-one/shared/utils';
import { SsrCookieService } from 'ngx-cookie-service-ssr';
import { filter, of, switchMap, take } from 'rxjs';

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

  /** Client-side counterpart to `ServerFeatureFlag.MarketingOpsFga` (LFXV2-2235/LFXV2-2236). */
  private readonly isMarketingOpsFgaEnabled = this.featureFlagService.getBooleanFlag(MARKETING_OPS_FGA_ENABLED_FLAG, false);

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
  public readonly displayActiveLens: Signal<Lens> = computed(() => this.toDisplayLens(this.activeLens()));

  /**
   * The lens the mobile nav drawer's lens tabs are previewing, or `null` when they show the page's own lens. Held apart
   * from {@link activeLens} on purpose: the page underneath, and everything that renders from `activeLens`, must not
   * change while the viewer only looks at another lens's menu (#4208).
   */
  private readonly menuLensPreview: WritableSignal<Lens | null> = signal(null);
  /**
   * Bumped whenever the drawer drops its preview or the viewer picks another lens tab, so a failed pick never re-arms a
   * preview the drawer has since closed or moved away from.
   */
  private menuLensPreviewEpoch = 0;
  /** The menu pick whose navigation is still pending, so a pick that supersedes it inherits what the page had before both. */
  private readonly pendingMenuPickState: WritableSignal<MenuLensPick | null> = signal(null);
  /**
   * True while a pick from the previewed menu is committed but its navigation hasn't landed: the route still describes
   * the page being left, so the menu's links follow the picked lens, as they did while it was previewed.
   */
  public readonly menuPickPending: Signal<boolean> = computed(() => this.pendingMenuPickState() !== null);
  /**
   * The lens the nav menu is built for: the drawer's preview while one stands (and the persona still holds it), otherwise
   * {@link activeLens}. Only the menu stack reads this — the sidebar items, the context selectors and the lens tabs.
   */
  public readonly menuLens: Signal<Lens> = computed(() => {
    const preview = this.menuLensPreview();
    return preview && this.getAllowedLensIds().includes(preview) ? preview : this.activeLens();
  });
  /** True while the menu shows another lens than the page's: a pick from it must commit the lens, and land on that lens's page. */
  public readonly previewingMenuLens: Signal<boolean> = computed(() => this.menuLens() !== this.activeLens());
  /** {@link menuLens} as the lens tabs highlight it, merged like {@link displayActiveLens}. */
  public readonly displayMenuLens: Signal<Lens> = computed(() => this.toDisplayLens(this.menuLens()));

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
    const target = this.switchTarget(lens);
    if (this.setLens(target)) {
      this.router.navigate([LENS_DEFAULT_ROUTES[target]]);
    }
  }

  /**
   * Show a lens's menu in the mobile drawer without switching the page's lens or navigating. Resolves the hybrid
   * 'Projects' entry like {@link switchLens}; choosing the page's own lens ends the preview. A lens the persona may not
   * use is ignored.
   *
   * While a pick is still navigating, `activeLens` is that pick's provisional lens, not the page's, so a tab matching it
   * is kept as an explicit choice: if the pick then fails and the page lens comes back, the drawer still shows the menu
   * the viewer chose last.
   */
  public previewMenuLens(lens: Lens): void {
    const target = this.switchTarget(lens);
    if (!this.getAllowedLensIds().includes(target)) {
      return;
    }
    this.menuLensPreviewEpoch += 1;
    this.menuLensPreview.set(target === this.activeLens() && !this.menuPickPending() ? null : target);
  }

  /**
   * Commit a pick from the previewed menu, which is about to navigate: `lens` (by default the previewed one — a hybrid's
   * foundation row picked in the merged Projects menu commits `foundation`) becomes the active lens. A no-op without a
   * preview.
   *
   * The lens is committed before the navigation starts, because guards read `activeLens`. If that navigation then never
   * leaves the page — cancelled or failed (a `canDeactivate` the viewer declines, a guard that refuses), or skipped as
   * the current address — the page's lens and the drawer's preview are put back, unless something else has moved the
   * lens since, which then owns it. The preview comes back only if the drawer is still showing it, and `onRestore` lets
   * the caller put back anything else the pick changed (a selector pick's context).
   */
  public commitMenuLens(lens: Lens = this.menuLens(), onRestore?: () => void): void {
    if (!this.previewingMenuLens()) {
      this.menuLensPreview.set(null);
      return;
    }
    // A pick made while an earlier one's navigation is still pending (it re-previewed and picked again) supersedes it:
    // neither left the page, so a rollback must return to what the page had before the first, undoing both. Only while
    // the earlier pick still owns the lens: if the route has moved it since, that pick is obsolete and so is its snapshot.
    const earlier = this.pendingMenuPickState();
    const pending = earlier?.committed === this.activeLens() ? earlier : null;
    const pick: MenuLensPick = {
      previous: pending?.previous ?? this.activeLens(),
      previousNavLens: pending?.previousNavLens ?? this.navLensSelection(),
      committed: lens,
      previewed: this.menuLens(),
      epoch: this.menuLensPreviewEpoch,
      onRestore: pending?.onRestore
        ? () => {
            onRestore?.();
            pending.onRestore?.();
          }
        : onRestore,
    };
    this.pendingMenuPickState.set(pick);
    this.setLens(lens);
    pick.committed = this.activeLens();
    this.menuLensPreview.set(null);
    this.restoreLensIfPickFails(pick);
  }

  /** Drop the drawer's preview, leaving the page's lens exactly as it is (the drawer closed without a pick). */
  public clearMenuLensPreview(): void {
    this.menuLensPreviewEpoch += 1;
    this.menuLensPreview.set(null);
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
   * matching lens. `setLens()` keeps that gate for every other caller (sidebar, navbar lens tabs,
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
   * `setLens()`/`switchLens()` call left to run, since the navbar's lens tabs only offer lenses
   * `getAllowedLensIds()` admits. Left unscoped, the override would silently stick past this one
   * navigation and clamp every subsequent route (including lens-agnostic ones like `/badges`) to
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

  /**
   * Drops a {@link setContextLens} override whose flow ended without navigating.
   *
   * The self-clear above waits on a terminal Router event, which the create picker's meeting
   * branch never produces: the composer is an overlay raised over the page the rail was on, so
   * nothing navigates and the override outlives the pick. It would then still be standing on the
   * organizer's NEXT navigation — evaluated by `lensRedirectGuard` before the NavigationEnd that
   * clears it — routing one journey under a lens their persona was never allowed.
   * `MeetingComposerHostComponent` calls this when the composer closes, giving that branch the
   * end-of-flow the others get from navigating. A no-op when no override stands.
   *
   * Only the override is dropped: `selectedLens` stays where the pick put it, and `activeLens`
   * re-derives it through `getAllowedLensIds()` again, so a lens the persona can't hold falls
   * back to `DEFAULT_LENS` on its own.
   */
  public clearContextLens(): void {
    this.contextLensOverride.set(null);
  }

  /**
   * Follows the navigation a {@link commitMenuLens} pick starts — the first one to start or be skipped after it, by id,
   * so a cancellation of an earlier navigation that the pick superseded is not mistaken for the pick's own. A skipped
   * pick (its link is the current address) counts as one that never left: no `NavigationEnd` follows it for the route
   * to re-assert its own lens. A pick redirected by a guard, or superseded by the viewer's next tap, hands over to the
   * navigation that replaces it, which is followed in turn.
   */
  private restoreLensIfPickFails(pick: MenuLensPick): void {
    this.router.events
      .pipe(
        filter((event): event is NavigationStart | NavigationSkipped => event instanceof NavigationStart || event instanceof NavigationSkipped),
        take(1),
        switchMap((first) =>
          first instanceof NavigationSkipped
            ? of(first)
            : this.router.events.pipe(
                filter(
                  (event): event is NavigationEnd | NavigationCancel | NavigationError =>
                    (event instanceof NavigationEnd || event instanceof NavigationCancel || event instanceof NavigationError) && event.id === first.id
                ),
                take(1)
              )
        )
      )
      .subscribe((event) => {
        if (this.isHandedOver(event) && this.activeLens() === pick.committed) {
          this.restoreLensIfPickFails(pick);
          return;
        }
        if (this.pendingMenuPickState() === pick) {
          this.pendingMenuPickState.set(null);
        }
        if (event instanceof NavigationEnd || this.activeLens() !== pick.committed) {
          return;
        }
        this.setLens(pick.previous);
        // The pick may have moved the last viewed nav lens too (a foundation or project lens committed from a Me or Org
        // page), which the merged Projects tab resolves to.
        if (this.navLensSelection() !== pick.previousNavLens) {
          this.navLensSelection.set(pick.previousNavLens);
          this.persistNavLensToCookie(pick.previousNavLens);
        }
        if (pick.epoch === this.menuLensPreviewEpoch) {
          this.menuLensPreview.set(pick.previewed);
        }
        pick.onRestore?.();
      });
  }

  /** A navigation cancelled only to make way for the next one — a guard's redirect, or a newer navigation superseding it. */
  private isHandedOver(event: NavigationEnd | NavigationCancel | NavigationError | NavigationSkipped): boolean {
    return (
      event instanceof NavigationCancel &&
      (event.code === NavigationCancellationCode.Redirect || event.code === NavigationCancellationCode.SupersededByNewNavigation)
    );
  }

  /** The lens a lens-tab click lands on: hybrid personas' merged 'Projects' entry returns to the last viewed nav lens. */
  private switchTarget(lens: Lens): Lens {
    return this.isHybridPersona() && lens === 'project' ? this.lastNavLens() : lens;
  }

  /** Hybrid personas merge foundation + project into the 'project' tab, so a foundation lens highlights 'project'. */
  private toDisplayLens(lens: Lens): Lens {
    return this.isHybridPersona() && lens === 'foundation' ? 'project' : lens;
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
      isLFStaff: this.personaService.isLFStaff(),
      hasMarketingGrant: this.isMarketingOpsFgaEnabled() && (this.personaService.isMarketingAuditor() || this.personaService.isCampaignManager()),
      isRootAuditor: this.personaService.isAuditor(),
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
