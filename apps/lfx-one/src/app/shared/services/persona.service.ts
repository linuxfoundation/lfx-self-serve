// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { afterNextRender, computed, inject, Injectable, makeStateKey, Signal, signal, TransferState, WritableSignal } from '@angular/core';
import { PERSONA_COOKIE_KEY, VALID_PERSONAS } from '@lfx-one/shared/constants';
import {
  Account,
  AuthContext,
  EnrichedPersonaProject,
  PersistedPersonaState,
  PersonaApiResponse,
  PersonaProject,
  PersonaType,
} from '@lfx-one/shared/interfaces';
import { isBoardScopedPersona, isProjectScopedPersona } from '@lfx-one/shared/utils';
import { SsrCookieService } from 'ngx-cookie-service-ssr';
import { catchError, Observable, of, take, tap } from 'rxjs';

import { AccountContextService } from './account-context.service';
import { CookieRegistryService } from './cookie-registry.service';

@Injectable({
  providedIn: 'root',
})
export class PersonaService {
  /** Scope key for an unscoped (no `projectSlug`) grant probe — see {@link latestGrantProbeIdByScope}. */
  private static readonly rootGrantScope = '__root__';

  private readonly http = inject(HttpClient);
  private readonly cookieService = inject(SsrCookieService);
  private readonly cookieRegistry = inject(CookieRegistryService);
  private readonly accountContextService = inject(AccountContextService);
  private readonly transferState = inject(TransferState);

  public readonly currentPersona: WritableSignal<PersonaType>;
  public readonly allPersonas: WritableSignal<PersonaType[]>;
  public readonly personaProjects: WritableSignal<Partial<Record<PersonaType, PersonaProject[]>>>;
  public readonly detectedProjects: WritableSignal<EnrichedPersonaProject[]>;
  private readonly lastKnownOrganizations: WritableSignal<Account[]> = signal<Account[]>([]);
  private readonly userSelected: WritableSignal<boolean>;

  public readonly isBoardScoped: Signal<boolean>;
  public readonly hasBoardRole: Signal<boolean>;
  public readonly hasProjectRole: Signal<boolean>;
  public readonly personaLoaded: WritableSignal<boolean>;
  /** True once enriched persona data has been fetched this session — guards against redundant refetches on re-navigation. */
  public readonly enrichedPersonasLoaded: WritableSignal<boolean> = signal<boolean>(false);
  /** Writer on the tenant root project — bypasses nav persona filtering */
  public readonly isRootWriter: WritableSignal<boolean> = signal<boolean>(false);
  /** Member of the lf-staff team — unlocks executive-tier dashboards without granting the ED persona */
  public readonly isLFStaff: WritableSignal<boolean> = signal<boolean>(false);
  /** Root- or project-scoped `marketing_auditor` FGA grant (project scope applies when the request carries `?project=`) (LFXV2-2235/LFXV2-2236). Always false while `ServerFeatureFlag.MarketingOpsFga` is off. */
  public readonly isMarketingAuditor: WritableSignal<boolean> = signal<boolean>(false);
  /** Root- or project-scoped `campaign_manager` FGA grant. Same flag caveat as {@link isMarketingAuditor}. */
  public readonly isCampaignManager: WritableSignal<boolean> = signal<boolean>(false);
  /**
   * The project slug the most recent *project-scoped* {@link refreshEnrichedPersonas} call verified
   * `isMarketingAuditor`/`isCampaignManager` against — `null` when the grant was confirmed root-scoped
   * (no `projectSlug` argument) or not confirmed at all. Callers that need to know which specific
   * foundation a marketing-only grant applies to (as opposed to `projectSelection`, which tracks
   * unrelated general navigation state) should read this instead (LFXV2-2235 review findings on
   * project-context.service.ts: neither a stale `projectSelection` nor a hardcoded TLF fallback
   * reliably identifies the verified project).
   */
  public readonly marketingGrantSlug: WritableSignal<string | null> = signal<string | null>(null);
  /** True for EDs and LF Staff — the audience for Foundation Health, Marketing Overview, and Social Listening */
  public readonly canViewExecutiveDashboards: Signal<boolean>;
  /**
   * Monotonic counter guarding {@link refreshEnrichedPersonas} against out-of-order responses.
   * Concurrent probes (route guard + sidebar-nav, or a rapid foundation switch) can resolve in a
   * different order than they were issued — only the response from the most recently *issued*
   * call *for the same scope* is allowed to write the marketing grant signals (see
   * {@link latestGrantProbeIdByScope}), so a slow reply for a stale foundation can't overwrite the
   * grant for the foundation currently on screen.
   */
  private latestGrantProbeId = 0;
  /**
   * Per-scope (project slug, or root when unscoped) tail of {@link latestGrantProbeId} —
   * scoping the "latest wins" check this way means an unrelated probe for a *different*
   * foundation (e.g. sidebar-nav pre-checking another link) can never block a same-scope probe's
   * write, which is exactly the race LFXV2-2235 found: a route guard's own response was the
   * correct, current answer for the page it was about to render, but got silently discarded
   * because a differently-scoped probe had been issued a moment later.
   */
  private readonly latestGrantProbeIdByScope = new Map<string, number>();

  public constructor() {
    const stored = this.loadFromCookie();
    this.currentPersona = signal<PersonaType>(stored?.primary ?? 'contributor');
    this.allPersonas = signal<PersonaType[]>(stored?.all ?? ['contributor']);
    this.userSelected = signal<boolean>(stored?.userSelected === true);
    const authState = this.transferState.get(makeStateKey<AuthContext>('auth'), { authenticated: false, user: null });
    this.personaProjects = signal<Partial<Record<PersonaType, PersonaProject[]>>>(authState.personaProjects ?? {});
    this.detectedProjects = signal<EnrichedPersonaProject[]>(authState.projects ?? []);
    this.isBoardScoped = computed(() => isBoardScopedPersona(this.currentPersona()));
    this.canViewExecutiveDashboards = computed(() => this.currentPersona() === 'executive-director' || this.isLFStaff());
    this.hasBoardRole = this.initHasBoardRole();
    this.hasProjectRole = this.initHasProjectRole();
    // Cookie can't carry personaProjects/detectedProjects, so always refresh from API after hydration.
    this.personaLoaded = signal(false);

    afterNextRender(() => {
      this.refreshFromApi();
    });
  }

  public setPersona(persona: PersonaType): void {
    this.currentPersona.set(persona);
    this.userSelected.set(true);
    this.persistCurrentState();
  }

  public setPersonas(primary: PersonaType, all: PersonaType[], organizations?: Account[]): void {
    this.currentPersona.set(primary);
    this.allPersonas.set(all);
    if (organizations !== undefined) {
      this.lastKnownOrganizations.set(organizations);
    }
    this.persistCurrentState();
  }

  /**
   * Fetches personas with enriched project metadata (name/logo/parent/description).
   * Overwrites the same signals as the initial refresh so downstream consumers upgrade automatically.
   * No-ops after the first successful fetch unless `force=true` — callers can trigger this on every
   * consumer init without causing redundant network traffic.
   */
  public refreshEnrichedPersonas(force: boolean = false, projectSlug?: string): Observable<PersonaApiResponse | null> {
    // A project-scoped grant call must not be skipped by the "already loaded" cache — a prior
    // fetch (root-scoped or for a different project) doesn't tell us about `projectSlug`.
    if (this.enrichedPersonasLoaded() && !force && !projectSlug) {
      return of(null);
    }
    const scopeKey = projectSlug ?? PersonaService.rootGrantScope;
    const probeId = ++this.latestGrantProbeId;
    this.latestGrantProbeIdByScope.set(scopeKey, probeId);
    const url = projectSlug ? `/api/user/personas?enriched=true&project=${encodeURIComponent(projectSlug)}` : '/api/user/personas?enriched=true';
    return this.http.get<PersonaApiResponse>(url).pipe(
      take(1),
      catchError(() => of(null)),
      tap((response) => {
        this.applyPersonaResponse(response, probeId, scopeKey);
        if (response && !response.error) {
          this.enrichedPersonasLoaded.set(true);
          // Record which project this specific probe verified the grant against.
          // `ProjectContextService` reads this as a single global "most recently verified"
          // foundation (see its constructor comment), not a per-scope value like the grant
          // booleans above — so this write must be gated on GLOBAL probe recency, not the
          // per-scope guard. A per-scope guard would let an older, already-superseded probe for
          // foundation A overwrite the slug after a newer probe for foundation B has already
          // resolved, even though B represents the more current navigation (Copilot finding on
          // PR #1835). A root-scoped call (no projectSlug) leaves this untouched — a ROOT grant
          // isn't tied to one project.
          if (projectSlug && (response.isMarketingAuditor || response.isCampaignManager) && probeId === this.latestGrantProbeId) {
            this.marketingGrantSlug.set(projectSlug);
          }
        }
      })
    );
  }

  private refreshFromApi(): void {
    this.http
      .get<PersonaApiResponse>('/api/user/personas')
      .pipe(
        take(1),
        catchError(() => of(null))
      )
      .subscribe((response) => {
        // If enriched resolved first, preserve its project metadata and FGA grants instead of
        // clobbering them with the sparse bootstrap payload (which never carries these fields).
        if (this.enrichedPersonasLoaded() && response && !response.error) {
          this.applyPersonaResponse({
            ...response,
            projects: this.detectedProjects(),
            personaProjects: this.personaProjects(),
            isMarketingAuditor: this.isMarketingAuditor(),
            isCampaignManager: this.isCampaignManager(),
          });
          return;
        }
        this.applyPersonaResponse(response);
      });
  }

  private applyPersonaResponse(response: PersonaApiResponse | null, probeId?: number, scopeKey?: string): void {
    if (!response || response.error) {
      // Preserve last-known-good grants on a failed/errored refetch — a transient network or
      // upstream failure must not silently revoke access that was already confirmed.
      console.warn('[PersonaService] Persona API returned error or empty response, keeping last-known-good state:', {
        error: response?.error,
        currentPersona: this.currentPersona(),
        allPersonas: this.allPersonas(),
      });
      this.personaLoaded.set(true);
      return;
    }

    console.info('[PersonaService] Persona detection response:', response);
    this.personaProjects.set(response.personaProjects);
    this.detectedProjects.set(response.projects);
    this.isRootWriter.set(response.isRootWriter ?? false);
    this.isLFStaff.set(response.isLFStaff ?? false);
    // Only apply grant fields from the most recently *issued* refreshEnrichedPersonas call for
    // this same scope — a slower response for a foundation the user has already navigated away
    // from must not clobber the grant a newer, faster-resolving probe already wrote for the
    // current foundation. Scoping the check (rather than a single global "latest") means an
    // unrelated probe for a *different* foundation can never block this write (LFXV2-2235).
    if (probeId === undefined || scopeKey === undefined || probeId === this.latestGrantProbeIdByScope.get(scopeKey)) {
      this.isMarketingAuditor.set(response.isMarketingAuditor ?? false);
      this.isCampaignManager.set(response.isCampaignManager ?? false);
    }

    if (response.personas.length > 0) {
      const current = this.currentPersona();
      const canPreserveCurrent = this.userSelected() && response.personas.includes(current);

      if (canPreserveCurrent) {
        // User's explicit choice wins — only refresh the allowed list and organizations.
        this.allPersonas.set(response.personas);
        if (response.organizations !== undefined) {
          this.lastKnownOrganizations.set(response.organizations);
        }
        this.persistCurrentState();
      } else {
        // User's choice is stale (role revoked) — drop the pin so detection takes over.
        if (this.userSelected()) {
          this.userSelected.set(false);
        }
        this.setPersonas(response.personas[0], response.personas, response.organizations);
      }
    } else if (response.organizations) {
      this.lastKnownOrganizations.set(response.organizations);
      this.persistCurrentState();
    }

    if (response.organizations) {
      if (response.organizations.length > 0) {
        console.info('[PersonaService] Detected organizations:', response.organizations);
      }
      this.accountContextService.initializeUserOrganizations(response.organizations);
    }

    this.personaLoaded.set(true);
  }

  private persistCurrentState(): void {
    this.persistToCookie({
      primary: this.currentPersona(),
      all: this.allPersonas(),
      organizations: this.lastKnownOrganizations(),
      userSelected: this.userSelected(),
    });
  }

  private persistToCookie(state: PersistedPersonaState): void {
    this.cookieService.set(PERSONA_COOKIE_KEY, JSON.stringify(state), {
      expires: 30,
      path: '/',
      sameSite: 'Lax',
      secure: typeof window !== 'undefined' && window.location.protocol === 'https:',
    });
    this.cookieRegistry.registerCookie(PERSONA_COOKIE_KEY);
  }

  private loadFromCookie(): PersistedPersonaState | null {
    try {
      const stored = this.cookieService.get(PERSONA_COOKIE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as PersistedPersonaState;
        if (parsed.primary && VALID_PERSONAS.has(parsed.primary) && parsed.all?.length > 0 && parsed.all.every((p) => VALID_PERSONAS.has(p))) {
          return parsed;
        }
      }
    } catch {
      /* invalid cookie data */
    }
    return null;
  }

  private initHasBoardRole(): Signal<boolean> {
    return computed(() => this.allPersonas().some((p) => isBoardScopedPersona(p)));
  }

  private initHasProjectRole(): Signal<boolean> {
    return computed(() => this.allPersonas().some((p) => isProjectScopedPersona(p)));
  }
}
