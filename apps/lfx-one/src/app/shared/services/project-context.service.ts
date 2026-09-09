// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Location } from '@angular/common';
import { computed, inject, Injectable, Signal, signal, WritableSignal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { MARKETING_OPS_FGA_ENABLED_FLAG, SELECTED_FOUNDATION_COOKIE_KEY, SELECTED_PROJECT_COOKIE_KEY } from '@lfx-one/shared/constants';
import { ProjectStage } from '@lfx-one/shared/enums';
import { Project, ProjectContext } from '@lfx-one/shared/interfaces';
import { getFormationSubStageLabel, isBoardScopedPersona, isFormationStage, isSameProjectContext } from '@lfx-one/shared/utils';
import { SsrCookieService } from 'ngx-cookie-service-ssr';
import { catchError, combineLatest, filter, map, of, startWith, switchMap, tap } from 'rxjs';

import { hasMeetingWriteAccess } from '../utils/write-access.util';
import { CookieRegistryService } from './cookie-registry.service';
import { FeatureFlagService } from './feature-flag.service';
import { LensService } from './lens.service';
import { PermissionsService } from './permissions.service';
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
  private readonly permissionsService = inject(PermissionsService);
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
  private readonly announcementDateLoading: WritableSignal<boolean> = signal(true);
  private readonly announcementDateHasError: WritableSignal<boolean> = signal(false);

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

  /**
   * Full `Project` for the current active context — shared by `canWrite` and the Formation
   * signals below so all three ride one fetch. Read this (not a fresh `getProject` call) for any
   * other field the currently active project needs — see `FormationCardComponent` (GH-1955).
   */
  public readonly activeProject: Signal<Project | null> = this.initActiveProjectDetails();

  /** Writer permission for the current active context — drives CTA visibility across dashboards. */
  public readonly canWrite: Signal<boolean> = computed(() => this.activeProject()?.writer === true);

  /**
   * Formation sub-stage label for the current active context (e.g. `'Engaged'`), or `null`
   * outside Formation. Single source of truth for the project dashboard's Formation badge and
   * sidebar card (GH-1955) — do not add another independent `getProject`/`getProjectSettings`
   * fetch for Formation-derived state; read this signal and its siblings below
   * (`isActiveProjectInFormation`, `isActiveProjectConfidential`, `activeProjectAnnouncementDate`)
   * instead.
   */
  public readonly activeProjectFormationSubStage: Signal<string | null> = computed(() => getFormationSubStageLabel(this.activeProject()?.stage));

  /** True when the current active context is in Draft or any Formation sub-stage. */
  public readonly isActiveProjectInFormation: Signal<boolean> = computed(() => isFormationStage(this.activeProject()?.stage));

  /**
   * True only for the `FormationConfidential` stage — mutually exclusive with the other Formation
   * sub-stages, never layered on top of one. Read this instead of comparing
   * `activeProjectFormationSubStage()` against the label string `'Confidential'`, which is a
   * display label, not a stage identity, and can drift independently of the stage enum.
   */
  public readonly isActiveProjectConfidential: Signal<boolean> = computed(() => this.activeProject()?.stage === ProjectStage.FormationConfidential);

  /**
   * Announcement-date tri-state for the current active context, shared by `FormationCardComponent`
   * and `ProjectDashboardComponent` (GH-1955) so both ride one `PermissionsService.getProjectSettings`
   * fetch instead of two independent ones. Read {@link activeProjectAnnouncementDateLoading} /
   * {@link activeProjectAnnouncementDateHasError} alongside this for the loading/error state.
   */
  public readonly activeProjectAnnouncementDate: Signal<string | null> = this.initActiveProjectAnnouncementDate();
  public readonly activeProjectAnnouncementDateLoading: Signal<boolean> = this.announcementDateLoading.asReadonly();
  public readonly activeProjectAnnouncementDateHasError: Signal<boolean> = this.announcementDateHasError.asReadonly();

  /**
   * The active context's project `stage` (e.g. `"Formation - Exploratory"`). `ProjectContext`
   * itself never carries `stage` — `projectQueryParamGuard` builds it from a `Project` response but
   * drops that field — so this reads it via a separate `ProjectService.getProject` call keyed off
   * `activeContext`, not a derivation of it. That call is cached per slug for the service's
   * lifetime (shared with `projectQueryParamGuard`'s own read), so the value reflects the project's
   * stage as of its first fetch this session, not a live re-check on every context change. `null`
   * while resolving, absent, or unauthenticated.
   */
  public readonly activeProjectStage: Signal<string | null> = this.initActiveProjectStage();

  /**
   * Meeting-authoring permission for the current active context: writer *or* meeting coordinator.
   * @description Distinct from {@link canWrite}, which is writer-only. A meeting coordinator can create
   * and edit meetings without being a project writer, so gating a meeting action on `canWrite` locks out
   * a legitimate coordinator — including from the meeting they just created. Lives here rather than in
   * one dashboard so every meeting surface asks the same question.
   */
  public readonly canWriteMeetings: Signal<boolean> = this.initCanWriteMeetings();

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
    //
    // `personaService.marketingGrantSlug()` — not `projectSelection()`, which serves unrelated
    // general navigation and can be stale or unrelated to the grant — holds the exact project a
    // *project-scoped* probe (sidebar-nav.service.ts's `marketingPersonaSlug`, or a route guard)
    // most recently verified the grant against, or `null` for a ROOT-scoped grant with no single
    // project to seed. Fall back to TLF only in the `null` case (LFXV2-2235 review findings on
    // project-context.service.ts: a stale `projectSelection` can seed an unrelated/unauthorized
    // foundation, and unconditionally seeding TLF can trigger a re-probe that legitimately
    // overwrites an already-confirmed project-scoped grant with TLF's unrelated `false` result).
    toObservable(this.hasMarketingOnlyGrant)
      .pipe(
        filter((hasGrant) => hasGrant && !this.foundationSelection()),
        switchMap(() => this.projectService.getProject(this.personaService.marketingGrantSlug() || MARKETING_ONLY_DEFAULT_FOUNDATION_SLUG, false)),
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

  private initActiveProjectDetails(): Signal<Project | null> {
    return toSignal(
      combineLatest([toObservable(this.activeContext), toObservable(this.userService.authenticated)]).pipe(
        switchMap(([ctx, authenticated]) => {
          // Anonymous/public routes have no session — /api/projects/:slug would just 401 (LFXV2-3266).
          if (!ctx?.slug || !authenticated) {
            return of(null);
          }
          // getProject already catches its own errors and logs, resolving to null — no outer catchError needed.
          //
          // Deliberately no startWith(null) here, unlike initSelectedFoundationSfid below: canWrite
          // reads this signal, and evictOnWriteAccessLoss() (vote/survey/mailing-list manage pages)
          // takes the *first* true→false transition as a genuine access loss and navigates away. A
          // transient null on every project switch — not just a real loss of access — would evict an
          // organizer mid-edit. Formation's badge/card briefly showing the previous project's stage
          // during a switch is an accepted, pre-existing trade-off (this is the same staleness
          // canWrite itself already had before this ticket).
          return this.projectService.getProject(ctx.slug, false);
        })
      ),
      { initialValue: null }
    );
  }

  private initActiveProjectAnnouncementDate(): Signal<string | null> {
    return toSignal(
      toObservable(this.activeProject).pipe(
        filter((project): project is NonNullable<typeof project> => !!project?.uid),
        tap(() => {
          this.announcementDateLoading.set(true);
          this.announcementDateHasError.set(false);
        }),
        switchMap((project) =>
          this.permissionsService.getProjectSettings(project.uid).pipe(
            map((settings) => settings.announcement_date || null),
            tap(() => this.announcementDateLoading.set(false)),
            catchError((error) => {
              console.error('ProjectContextService: failed to load announcement date', error);
              this.announcementDateLoading.set(false);
              this.announcementDateHasError.set(true);
              return of(null);
            })
          )
        )
      ),
      { initialValue: null }
    );
  }

  private initActiveProjectStage(): Signal<string | null> {
    return toSignal(
      combineLatest([toObservable(this.activeContext), toObservable(this.userService.authenticated)]).pipe(
        switchMap(([ctx, authenticated]) => {
          if (!ctx?.slug || !authenticated) {
            return of(null);
          }
          return this.projectService.getProject(ctx.slug, false).pipe(map((project) => project?.stage ?? null));
        })
      ),
      { initialValue: null }
    );
  }

  private initCanWriteMeetings(): Signal<boolean> {
    return toSignal(
      combineLatest([toObservable(this.activeContext), toObservable(this.userService.authenticated)]).pipe(
        switchMap(([ctx, authenticated]) => {
          // Anonymous/public routes have no session — /api/projects/:slug would just 401 (LFXV2-3266),
          // same as the two siblings above. It also puts the recompute back: gated on the context
          // alone this ran once per navigation and never again, so a session that settled after the
          // context — or was lost mid-visit — left the answer computed against the wrong one. The
          // unauthenticated result is `false` either way, via the `catchError` below; what changes is
          // that it is no longer a wasted round trip, and that it re-evaluates when the session does.
          if (!ctx?.slug || !authenticated) {
            return of(false);
          }
          // Two requests rather than one `?meeting_coordinator=true` fetch, and cheaper than it
          // looks: the plain `getProject(slug, false)` response is already in ProjectService's
          // cache on every navigation — `projectQueryParamGuard` fetches that exact key — while
          // `:mc` is a separate cache entry and so a genuine extra round trip on the SSR critical
          // path of every page. Upstream skips the `meeting_coordinator` FGA check outright for
          // writers (`project.service.ts:344`), so for a writer that second request could only
          // echo back what the first already said. Only a non-writer actually needs it.
          return this.projectService.getProject(ctx.slug, false).pipe(
            switchMap((project) => {
              if (project?.writer === true) {
                return of(true);
              }
              return this.projectService
                .getProject(ctx.slug, false, { meetingCoordinator: true })
                .pipe(map((coordinatorProject) => hasMeetingWriteAccess(coordinatorProject)));
            }),
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
