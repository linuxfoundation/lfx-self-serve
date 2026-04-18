// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { afterNextRender, computed, inject, Injectable, makeStateKey, Signal, signal, TransferState, WritableSignal } from '@angular/core';
import { PERSONA_COOKIE_KEY } from '@lfx-one/shared/constants';
import {
  Account,
  AuthContext,
  EnrichedPersonaProject,
  isBoardScopedPersona,
  isProjectScopedPersona,
  PersistedPersonaState,
  PersonaApiResponse,
  PersonaProject,
  PersonaType,
  VALID_PERSONAS,
} from '@lfx-one/shared/interfaces';
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

  public readonly isBoardScoped: Signal<boolean>;
  public readonly hasBoardRole: Signal<boolean>;
  public readonly hasProjectRole: Signal<boolean>;
  public readonly personaLoaded: WritableSignal<boolean>;
  /** True once enriched persona data has been fetched this session — guards against redundant refetches on re-navigation. */
  public readonly enrichedPersonasLoaded: WritableSignal<boolean> = signal<boolean>(false);
  /** Writer on the tenant root project — bypasses nav persona filtering */
  public readonly isRootWriter: WritableSignal<boolean> = signal<boolean>(false);

  public constructor() {
    const stored = this.loadFromCookie();
    this.currentPersona = signal<PersonaType>(stored?.primary ?? 'contributor');
    this.allPersonas = signal<PersonaType[]>(stored?.all ?? ['contributor']);
    const authState = this.transferState.get(makeStateKey<AuthContext>('auth'), { authenticated: false, user: null });
    this.personaProjects = signal<Partial<Record<PersonaType, PersonaProject[]>>>(authState.personaProjects ?? {});
    this.detectedProjects = signal<EnrichedPersonaProject[]>(authState.projects ?? []);
    this.isBoardScoped = computed(() => isBoardScopedPersona(this.currentPersona()));
    this.hasBoardRole = this.initHasBoardRole();
    this.hasProjectRole = this.initHasProjectRole();
    // Cookie can't carry personaProjects/detectedProjects, so always refresh from API after hydration.
    this.personaLoaded = signal(false);

    afterNextRender(() => {
      this.refreshFromApi();
    });
  }

  public setPersona(persona: PersonaType): void {
    this.setPersonas(persona, this.allPersonas());
  }

  public setPersonas(primary: PersonaType, all: PersonaType[], organizations?: Account[]): void {
    this.currentPersona.set(primary);
    this.allPersonas.set(all);
    if (organizations !== undefined) {
      this.lastKnownOrganizations.set(organizations);
    }
    this.persistToCookie({ primary, all, organizations: this.lastKnownOrganizations() });
  }

  /**
   * Fetches personas with enriched project metadata (name/logo/parent/description).
   * Overwrites the same signals as the initial refresh so downstream consumers upgrade automatically.
   * No-ops after the first successful fetch unless `force=true` — callers can trigger this on every
   * consumer init without causing redundant network traffic.
   */
  public refreshEnrichedPersonas(force: boolean = false): Observable<PersonaApiResponse | null> {
    if (this.enrichedPersonasLoaded() && !force) {
      return of(null);
    }
    return this.http.get<PersonaApiResponse>('/api/user/personas?enriched=true').pipe(
      take(1),
      catchError(() => of(null)),
      tap((response) => {
        this.applyPersonaResponse(response);
        if (response && !response.error) {
          this.enrichedPersonasLoaded.set(true);
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
        // If enriched resolved first, preserve its project metadata instead of clobbering with the sparse payload.
        if (this.enrichedPersonasLoaded() && response && !response.error) {
          this.applyPersonaResponse({
            ...response,
            projects: this.detectedProjects(),
            personaProjects: this.personaProjects(),
          });
          return;
        }
        this.applyPersonaResponse(response);
      });
  }

  private applyPersonaResponse(response: PersonaApiResponse | null): void {
    if (!response || response.error) {
      console.warn('[PersonaService] Persona API returned error or empty response, using fallback:', {
        error: response?.error,
        currentPersona: this.currentPersona(),
        allPersonas: this.allPersonas(),
      });
      this.isRootWriter.set(false);
      this.personaLoaded.set(true);
      return;
    }

    console.info('[PersonaService] Persona detection response:', response);
    this.personaProjects.set(response.personaProjects);
    this.detectedProjects.set(response.projects);
    this.isRootWriter.set(response.isRootWriter ?? false);

    if (response.personas.length > 0) {
      this.setPersonas(response.personas[0], response.personas, response.organizations);
    } else if (response.organizations) {
      this.lastKnownOrganizations.set(response.organizations);
      this.persistToCookie({
        primary: this.currentPersona(),
        all: this.allPersonas(),
        organizations: response.organizations,
      });
    }

    if (response.organizations) {
      if (response.organizations.length > 0) {
        console.info('[PersonaService] Detected organizations:', response.organizations);
      }
      this.accountContextService.initializeUserOrganizations(response.organizations);
    }

    this.personaLoaded.set(true);
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
