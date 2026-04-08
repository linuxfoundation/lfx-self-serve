// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { afterNextRender, computed, inject, Injectable, Signal, signal, WritableSignal } from '@angular/core';
import { PERSONA_COOKIE_KEY } from '@lfx-one/shared/constants';
import {
  isBoardScopedPersona,
  isProjectScopedPersona,
  PersistedPersonaState,
  PersonaApiResponse,
  PersonaProject,
  PersonaType,
  VALID_PERSONAS,
} from '@lfx-one/shared/interfaces';
import { SsrCookieService } from 'ngx-cookie-service-ssr';
import { catchError, of, take } from 'rxjs';

import { CookieRegistryService } from './cookie-registry.service';
import { ProjectContextService } from './project-context.service';

@Injectable({
  providedIn: 'root',
})
export class PersonaService {
  private readonly http = inject(HttpClient);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly cookieService = inject(SsrCookieService);
  private readonly cookieRegistry = inject(CookieRegistryService);

  public readonly currentPersona: WritableSignal<PersonaType>;
  public readonly allPersonas: WritableSignal<PersonaType[]>;

  /** Whether the user has access to multiple projects (affects project lens sidebar) */
  public readonly multiProject: WritableSignal<boolean>;

  /** Whether the user has access to multiple foundations (affects foundation lens sidebar) */
  public readonly multiFoundation: WritableSignal<boolean>;

  /** Persona-to-project mapping from the persona detection service */
  public readonly personaProjects: WritableSignal<Partial<Record<PersonaType, PersonaProject[]>>>;

  public readonly isBoardScoped: Signal<boolean>;

  /** Whether the user holds any board-scoped persona (board-member, executive-director) */
  public readonly hasBoardRole: Signal<boolean>;

  /** Whether the user holds any project-scoped persona (maintainer, contributor) */
  public readonly hasProjectRole: Signal<boolean>;

  public constructor() {
    const stored = this.loadFromCookie();
    this.currentPersona = signal<PersonaType>(stored?.primary ?? 'contributor');
    this.allPersonas = signal<PersonaType[]>(stored?.all ?? ['contributor']);
    this.multiProject = signal<boolean>(stored?.multiProject ?? false);
    this.multiFoundation = signal<boolean>(stored?.multiFoundation ?? false);
    this.personaProjects = signal<Partial<Record<PersonaType, PersonaProject[]>>>({});
    this.isBoardScoped = computed(() => isBoardScopedPersona(this.currentPersona()));
    this.hasBoardRole = this.initHasBoardRole();
    this.hasProjectRole = this.initHasProjectRole();

    // Refresh persona data from API after hydration (browser only)
    // Skip if cookie was loaded AND personaProjects is already populated;
    // cookie only stores primary/all/multi* — personaProjects needs the API
    afterNextRender(() => {
      if (!stored || Object.keys(this.personaProjects()).length === 0) {
        this.refreshFromApi();
      }
    });
  }

  /**
   * Switch the primary persona while preserving current multi-persona state
   */
  public setPersona(persona: PersonaType): void {
    this.setPersonas(persona, this.allPersonas(), this.multiProject(), this.multiFoundation());
  }

  /**
   * Set the active persona and update state
   * Sets the primary persona, the full list of active personas, and access flags
   */
  public setPersonas(primary: PersonaType, all: PersonaType[], multiProject = false, multiFoundation = false): void {
    this.currentPersona.set(primary);
    this.allPersonas.set(all);
    this.multiProject.set(multiProject);
    this.multiFoundation.set(multiFoundation);
    this.persistToCookie({ primary, all, multiProject, multiFoundation });

    if (this.isBoardScoped()) {
      this.projectContextService.clearProject();
    }
  }

  /**
   * Fetch fresh persona data from the API and update state + cookie
   */
  private refreshFromApi(): void {
    this.http
      .get<PersonaApiResponse>('/api/user/personas')
      .pipe(
        take(1),
        catchError(() => of(null))
      )
      .subscribe((response) => {
        if (!response || response.error) {
          console.warn('[PersonaService] Persona API returned error or empty response, using fallback:', {
            error: response?.error,
            currentPersona: this.currentPersona(),
            allPersonas: this.allPersonas(),
          });
          return;
        }

        console.info('[PersonaService] Persona detection response:', response);
        this.personaProjects.set(response.personaProjects);

        // Update persona state if API returned data — reuse setPersonas() for
        // consistent side effects (board-scoped project clearing, cookie persistence)
        if (response.personas.length > 0) {
          this.setPersonas(response.personas[0], response.personas, response.multiProject, response.multiFoundation);
        }
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
      // Invalid cookie data, ignore
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
