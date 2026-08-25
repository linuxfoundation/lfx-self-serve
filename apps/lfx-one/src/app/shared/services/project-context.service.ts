// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Location } from '@angular/common';
import { computed, inject, Injectable, Signal, signal, WritableSignal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { MARKETING_OPS_FGA_ENABLED_FLAG, SELECTED_FOUNDATION_COOKIE_KEY, SELECTED_PROJECT_COOKIE_KEY } from '@lfx-one/shared/constants';
import { ProjectContext } from '@lfx-one/shared/interfaces';
import { isBoardScopedPersona, isSameProjectContext } from '@lfx-one/shared/utils';
import { SsrCookieService } from 'ngx-cookie-service-ssr';
import { catchError, combineLatest, filter, map, of, startWith, switchMap } from 'rxjs';

import { CookieRegistryService } from './cookie-registry.service';
import { FeatureFlagService } from './feature-flag.service';
import { LensService } from './lens.service';
import { PersonaService } from './persona.service';
import { ProjectService } from './project.service';
import { UserService } from './user.service';

/**
 * The Linux Foundation's own project slug — same literal already used as the default foundation
 * fallback in marketing-overview.component.ts and email-ctr-drawer.component.ts. Marketing-only
 * grant holders (no ED/board persona) have no cookie-restored foundation to fall back on, so this
 * seeds one deterministically rather than leaving them on a context-less dashboard.
 */
const MARKETING_ONLY_DEFAULT_FOUNDATION_SLUG = 'tlf';

@Injectable({
  providedIn: 'root',
})
export class ProjectContextService {
  private readonly cookieService = inject(SsrCookieService);
  private readonly cookieRegistry = inject(CookieRegistryService);
  private readonly featureFlagService = inject(FeatureFlagService);
  private readonly lensService = inject(LensService);
  private readonly location = inject(Location);
  private readonly personaService = inject(PersonaService);
  private readonly projectService = inject(ProjectService);
  private readonly router = inject(Router);
  private readonly userService = inject(UserService);

  private readonly isMarketingOpsFgaEnabled = this.featureFlagService.getBooleanFlag(MARKETING_OPS_FGA_ENABLED_FLAG, false);

  /** Same gating expression as dashboard.component.ts's `foundationDashboardType` and lens.service.ts's `initLensGrantInputs()`. */
  private readonly hasMarketingOnlyGrant: Signal<boolean> = computed(
    () => this.isMarketingOpsFgaEnabled() && (this.personaService.isMarketingAuditor() || this.personaService.isCampaignManager())
  );

  private readonly foundationStorageKey = SELECTED_FOUNDATION_COOKIE_KEY;
  private readonly projectStorageKey = SELECTED_PROJECT_COOKIE_KEY;

  private readonly foundationSelection: WritableSignal<ProjectContext | null> = signal<ProjectContext | null>(null);
  private readonly projectSelection: WritableSignal<ProjectContext | null> = signal<ProjectContext | null>(null);

  /**
   * The context kind declared by the current route (`route.data.lens`), when it declares one.
   *
   * Takes precedence over {@link LensService.activeLens} when resolving which slot is active. The
   * route is a stronger statement of intent than the lens, and — unlike the lens — it does not
   * depend on data that arrives after hydration. `activeLens` is clamped to the allowed set, and
   * the writer-derived half of that set resolves post-hydration (LFXV2-2754), so on a deep link or
   * hard refresh onto `/foundation/...` the lens can still read `me` while `projectQueryParamGuard`
   * has already seeded the foundation slot. Resolving by lens there returns the *other* slot, and
   * because create flows build their payload from `activeContextUid()`, the artifact would be
   * created against a different project than the one `writerGuard` authorised. Honouring the route
   * closes that window, and stays correct even if the grants request fails outright.
   *
   * Set by `projectQueryParamGuard` on every navigation it runs for — to the declared kind, or
   * `null` where none is declared, so a stale override cannot outlive the route that set it.
   */
  private readonly routeLensKind: WritableSignal<'foundation' | 'project' | null> = signal<'foundation' | 'project' | null>(null);

  public readonly activeContext: Signal<ProjectContext | null> = this.initActiveContext();
  public readonly isFoundationContext: Signal<boolean> = this.initIsFoundationContext();
  public readonly activeContextUid: Signal<string> = computed(() => this.activeContext()?.uid || '');

  public readonly selectedFoundation: Signal<ProjectContext | null> = computed(() => this.foundationSelection());
  public readonly selectedProject: Signal<ProjectContext | null> = computed(() => this.projectSelection());

  /** The context kind the current route declares (see {@link routeLensKind}), exposed read-only. */
  public readonly activeRouteLensKind: Signal<'foundation' | 'project' | null> = computed(() => this.routeLensKind());

  /** Writer permission for the current active context — drives CTA visibility across dashboards. */
  public readonly canWrite: Signal<boolean> = this.initCanWrite();

  /** Salesforce 18-char ID for the active foundation — resolves PCC deep-link targets. `null` while resolving or unavailable. */
  public readonly selectedFoundationSfid: Signal<string | null> = this.initSelectedFoundationSfid();

  public constructor() {
    // Restore the prior selection so the active context survives a refresh regardless of lens.
    this.foundationSelection.set(this.loadFromCookie(this.foundationStorageKey));
    this.projectSelection.set(this.loadFromCookie(this.projectStorageKey));

    // Marketing-only grant holders (no ED/board persona) have no cookie-restored foundation to
    // fall back on — seed one so they land on a real foundation dashboard instead of a
    // context-less one. Re-checked on every `hasMarketingOnlyGrant` emission (persona/flag data
    // arrives post-hydration) but only acts while no foundation has been set by cookie restore
    // or an explicit selection made since.
    toObservable(this.hasMarketingOnlyGrant)
      .pipe(
        filter((hasGrant) => hasGrant && !this.foundationSelection()),
        switchMap(() => this.projectService.getProject(MARKETING_ONLY_DEFAULT_FOUNDATION_SLUG, false)),
        filter((project): project is NonNullable<typeof project> => !!project && !this.foundationSelection())
      )
      .subscribe((project) => {
        this.setFoundation({ uid: project.uid, name: project.name, slug: project.slug, logoUrl: project.logo_url }, false);
      });
  }

  // The URL sync runs outside the same-context early return: a stale `?project=` left by a prior
  // selection must still be corrected when the incoming selection already matches the current one.
  public setFoundation(foundation: ProjectContext, syncUrl = true): void {
    if (!isSameProjectContext(this.foundationSelection(), foundation)) {
      this.foundationSelection.set(foundation);
      this.persistToCookie(this.foundationStorageKey, foundation);
    }
    if (syncUrl) {
      this.syncProjectQueryParam(foundation.slug);
    }
  }

  public setProject(project: ProjectContext, syncUrl = true): void {
    if (!isSameProjectContext(this.projectSelection(), project)) {
      this.projectSelection.set(project);
      this.persistToCookie(this.projectStorageKey, project);
    }
    if (syncUrl) {
      this.syncProjectQueryParam(project.slug);
    }
  }

  /** Records the kind the current route declares, so context resolution can prefer it over the lens. */
  public setRouteLensKind(kind: 'foundation' | 'project' | null): void {
    this.routeLensKind.set(kind);
  }

  public clearFoundation(): void {
    this.foundationSelection.set(null);
    this.persistToCookie(this.foundationStorageKey, null);
    this.syncProjectQueryParam(null);
  }

  public clearProject(): void {
    this.projectSelection.set(null);
    this.persistToCookie(this.projectStorageKey, null);
    this.syncProjectQueryParam(null);
  }

  /**
   * Updates the ?project= query param in the current URL via Location.replaceState —
   * no Angular navigation is triggered, so guards and resolvers are not re-evaluated.
   * Skipped when a navigation is already in flight: the URL already carries the correct
   * param (deep-link) or the caller's own navigation will set the destination URL.
   */
  private syncProjectQueryParam(slug: string | null): void {
    if (this.router.getCurrentNavigation()) {
      return;
    }
    const urlTree = this.router.parseUrl(this.router.url);
    if (slug === null) {
      delete urlTree.queryParams['project'];
    } else {
      urlTree.queryParams['project'] = slug;
    }
    this.location.replaceState(this.router.serializeUrl(urlTree));
  }

  private persistToCookie(key: string, context: ProjectContext | null): void {
    if (context === null) {
      this.cookieService.delete(key, '/');
      this.cookieRegistry.unregisterCookie(key);
      return;
    }
    this.cookieService.set(key, JSON.stringify(context), {
      expires: 30,
      path: '/',
      sameSite: 'Lax',
      secure: process.env['NODE_ENV'] === 'production',
    });
    this.cookieRegistry.registerCookie(key);
  }

  private loadFromCookie(key: string): ProjectContext | null {
    try {
      const stored = this.cookieService.get(key);
      if (!stored) {
        return null;
      }
      const parsed = JSON.parse(stored) as Partial<ProjectContext>;
      if (typeof parsed?.uid === 'string' && typeof parsed?.slug === 'string' && typeof parsed?.name === 'string') {
        return parsed as ProjectContext;
      }
    } catch {
      /* invalid cookie data */
    }
    return null;
  }

  private initActiveContext(): Signal<ProjectContext | null> {
    return computed(() => {
      // The route wins when it declares a kind — see `routeLensKind`.
      const routeKind = this.routeLensKind();
      if (routeKind) {
        return routeKind === 'foundation' ? this.foundationSelection() : this.projectSelection();
      }

      const lens = this.lensService.activeLens();

      switch (lens) {
        case 'foundation':
          return this.foundationSelection();
        case 'project':
          return this.projectSelection();
        case 'me':
        case 'org':
          return isBoardScopedPersona(this.personaService.currentPersona()) ? this.foundationSelection() : this.projectSelection();
        default:
          return null;
      }
    });
  }

  private initIsFoundationContext(): Signal<boolean> {
    return computed(() => {
      // Kept in lockstep with `initActiveContext` — the two must never disagree about which slot is active.
      const routeKind = this.routeLensKind();
      if (routeKind) {
        return routeKind === 'foundation';
      }

      const lens = this.lensService.activeLens();

      switch (lens) {
        case 'foundation':
          return true;
        case 'project':
          return false;
        case 'me':
        case 'org':
          return isBoardScopedPersona(this.personaService.currentPersona());
        default:
          return false;
      }
    });
  }

  private initCanWrite(): Signal<boolean> {
    return toSignal(
      combineLatest([toObservable(this.activeContext), toObservable(this.userService.authenticated)]).pipe(
        switchMap(([ctx, authenticated]) => {
          // Anonymous/public routes have no session — /api/projects/:slug would just 401 (LFXV2-3266).
          if (!ctx?.slug || !authenticated) {
            return of(false);
          }
          return this.projectService.getProject(ctx.slug, false).pipe(
            map((project) => project?.writer === true),
            catchError(() => of(false))
          );
        })
      ),
      { initialValue: false }
    );
  }

  private initSelectedFoundationSfid(): Signal<string | null> {
    return toSignal(
      combineLatest([toObservable(this.selectedFoundation), toObservable(this.userService.authenticated)]).pipe(
        switchMap(([foundation, authenticated]) => {
          // Anonymous/public routes have no session — /api/projects/:uid/sfid would just 401 (LFXV2-3266).
          if (!foundation?.uid || !authenticated) {
            return of(null);
          }
          return this.projectService.getProjectSfid(foundation.uid).pipe(startWith(null));
        })
      ),
      { initialValue: null }
    );
  }
}
