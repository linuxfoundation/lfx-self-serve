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
   * Monotonic counter tracking each {@link refreshEnrichedPersonas} call's *issuance* order.
   * Concurrent probes (route guard + sidebar-nav, or a rapid foundation switch) can resolve in a
   * different order than they were issued. This counter alone does not decide who may write the
   * shared grant signals — that guarantee lives on {@link latestAppliedGrantProbeId}, the applied
   * high-water mark: a response may write as long as its probeId is at least as new as the last
   * probe that actually *applied*, which lets an earlier-issued-but-still-in-flight probe write
   * even if a later probe was issued after it, so long as that later probe hasn't applied yet.
   *
   * This is deliberately global, not per-scope: an earlier per-scope version of this guard (see
   * git history) let an unrelated, differently-scoped probe's late-arriving response overwrite
   * `isMarketingAuditor`/`isCampaignManager` *after* a newer probe for the active foundation had
   * already written the correct value (Cursor Bugbot finding, PR #1835) — the per-scope check
   * only ever compared a response against other responses for its *own* scope, so it had no way
   * to detect that a different, more-recently-issued scope had already superseded it. Global
   * ordering fixes that, and is safe for the *signals* specifically because
   * `marketing-impact-access.guard.ts` / `campaign-access.guard.ts` never read these signals for
   * their own admit/deny decision — they decide from each call's own `response`, so a discarded
   * write here never causes a false denial (see those guards' spec files).
   */
  private latestGrantProbeId = 0;
  /**
   * High-water mark of the last probeId that actually **wrote** `isMarketingAuditor`/
   * `isCampaignManager`/`marketingGrantSlug` — distinct from {@link latestGrantProbeId}, which
   * marks probe *issuance*. Gating writes on `probeId >= latestAppliedGrantProbeId` instead of
   * exact equality against the issuance counter means a later-issued probe that never itself
   * writes anything (it errors, or its response is empty) can't permanently lock out an earlier,
   * still-in-flight probe's legitimate write just by having been issued — only a probe that goes
   * on to actually apply moves this mark forward (Cursor Bugbot finding, PR #1835: "Global probe
   * gate drops grant slug").
   */
  private latestAppliedGrantProbeId = 0;
  /**
   * Last probeId that actually **applied** (wrote the signals for) a given scope (`projectSlug`, or
   * `undefined` for root) — used only by {@link confirmActiveGrant} to tell a genuine cross-scope
   * race (safe to override) apart from a same-scope race (not safe to override).
   * `latestGrantProbeId`/`latestAppliedGrantProbeId` are global by design so an unrelated scope's
   * newer probe can never block this scope's write, but that same bypass let a guard force-apply
   * its own response even after a *later-issued probe for its own scope* had already applied a more
   * current, different answer — reintroducing the exact clobber the recency gate exists to prevent,
   * just via a different door (Copilot finding, PR #1835).
   *
   * This tracks *applied* probes, not merely *issued* ones — an earlier version keyed off issuance
   * alone, which meant a later-issued same-scope probe that errored or otherwise never wrote
   * anything could still permanently block an earlier, still-in-flight probe's legitimate
   * force-apply, since its mere issuance already looked like a supersession (Cursor Bugbot + Copilot
   * findings, PR #1835). Only a probe that actually goes on to write moves this forward, matching
   * {@link latestAppliedGrantProbeId}'s same rationale one level down, per scope.
   */
  private readonly latestAppliedGrantProbeIdByScope = new Map<string | undefined, number>();
  /** Correlates a resolved {@link PersonaApiResponse} back to the probeId that produced it, so {@link confirmActiveGrant} can look up same-scope recency without changing `refreshEnrichedPersonas`'s public `Observable<PersonaApiResponse | null>` contract. */
  private readonly grantProbeIdByResponse = new WeakMap<object, number>();

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
    const probeId = ++this.latestGrantProbeId;
    const url = projectSlug ? `/api/user/personas?enriched=true&project=${encodeURIComponent(projectSlug)}` : '/api/user/personas?enriched=true';
    return this.http.get<PersonaApiResponse>(url).pipe(
      take(1),
      catchError(() => of(null)),
      tap((response) => {
        this.applyPersonaResponse(response, probeId, projectSlug);
        if (response && !response.error) {
          this.grantProbeIdByResponse.set(response, probeId);
          this.enrichedPersonasLoaded.set(true);
          // Record which project this specific probe verified the grant against. Gated on the
          // same global probe-recency check as the grant booleans below, so this and
          // `isMarketingAuditor`/`isCampaignManager` always move together off the same
          // most-recently-issued response — a root-scoped call (no `projectSlug`) leaves this
          // untouched, since a ROOT grant isn't tied to one project.
          if (projectSlug && (response.isMarketingAuditor || response.isCampaignManager) && probeId >= this.latestAppliedGrantProbeId) {
            this.marketingGrantSlug.set(projectSlug);
          }
        }
      })
    );
  }

  /**
   * Force-applies a grant that a route guard has already decided admission from, bypassing the
   * probe-recency gate above.
   *
   * `campaign-access.guard.ts`/`marketing-impact-access.guard.ts` intentionally decide admit/deny
   * from each call's own `response` rather than `isMarketingAuditor`/`isCampaignManager` directly
   * — see `latestGrantProbeId`'s doc comment — so a discarded write from a differently-scoped,
   * more-recently-*issued* background probe (e.g. sidebar-nav) never causes a false denial. But
   * components downstream of a successful navigation (`MarketingImpactComponent`,
   * `CampaignsComponent`) read these same signals directly, with no probe of their own, so a
   * guard admitting from its own response while the signal lost the recency race left the very
   * page it just admitted to rendering its own no-access state (Copilot findings, PR #1835). A
   * guard resolving for the route about to be on screen is the most authoritative source for
   * what's true right now, so it must win outright instead of competing with the *global* recency
   * gate — but only when the race it's overriding is cross-scope. If a *later probe for this exact
   * scope has already applied* a different answer (tracked via
   * {@link latestAppliedGrantProbeIdByScope}), this response is genuinely stale, not just a victim
   * of the global/cross-scope gate, and force-applying it would restore exactly the clobber the
   * recency gate exists to prevent (Copilot finding, PR #1835). This deliberately checks the last
   * probe that *applied* for the scope, not merely the last one *issued* — an issuance-only check
   * let a later same-scope probe that errored or otherwise never wrote anything still block this
   * force-apply just by having been issued (Cursor Bugbot + Copilot findings, PR #1835). Callers
   * must only invoke this with an authoritative, non-errored response.
   */
  public confirmActiveGrant(response: Pick<PersonaApiResponse, 'isMarketingAuditor' | 'isCampaignManager'>, projectSlug?: string): void {
    const probeId = this.grantProbeIdByResponse.get(response);
    const latestAppliedForScope = this.latestAppliedGrantProbeIdByScope.get(projectSlug);
    if (probeId !== undefined && latestAppliedForScope !== undefined && probeId < latestAppliedForScope) {
      return;
    }
    this.isMarketingAuditor.set(response.isMarketingAuditor ?? false);
    this.isCampaignManager.set(response.isCampaignManager ?? false);
    if (projectSlug && (response.isMarketingAuditor || response.isCampaignManager)) {
      this.marketingGrantSlug.set(projectSlug);
    }
    if (probeId !== undefined && probeId > (latestAppliedForScope ?? -Infinity)) {
      this.latestAppliedGrantProbeIdByScope.set(projectSlug, probeId);
    }
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

  private applyPersonaResponse(response: PersonaApiResponse | null, probeId?: number, projectSlug?: string): void {
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
    // Only apply grant fields from a probe that is at least as new as the last one that actually
    // wrote these signals — a slower response for a foundation the user has already navigated
    // away from must not clobber the grant a newer, faster-resolving probe already wrote for the
    // current foundation (LFXV2-2235). Gating on the applied high-water mark rather than the
    // issuance counter also means a later-issued probe that itself never writes (error/empty
    // response) can't block this one just by having been issued — see `latestAppliedGrantProbeId`.
    if (probeId === undefined || probeId >= this.latestAppliedGrantProbeId) {
      this.isMarketingAuditor.set(response.isMarketingAuditor ?? false);
      this.isCampaignManager.set(response.isCampaignManager ?? false);
      if (probeId !== undefined) {
        this.latestAppliedGrantProbeId = probeId;
        const latestAppliedForScope = this.latestAppliedGrantProbeIdByScope.get(projectSlug);
        if (probeId > (latestAppliedForScope ?? -Infinity)) {
          this.latestAppliedGrantProbeIdByScope.set(projectSlug, probeId);
        }
      }
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
