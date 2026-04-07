// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, inject, Injectable, Signal, signal, WritableSignal } from '@angular/core';
import { PERSONA_COOKIE_KEY } from '@lfx-one/shared/constants';
import { isBoardScopedPersona, isProjectScopedPersona, PersistedPersonaState, PersonaType, VALID_PERSONAS } from '@lfx-one/shared/interfaces';
import { SsrCookieService } from 'ngx-cookie-service-ssr';

import { CookieRegistryService } from './cookie-registry.service';
import { ProjectContextService } from './project-context.service';

@Injectable({
  providedIn: 'root',
})
export class PersonaService {
  private readonly projectContextService = inject(ProjectContextService);
  private readonly cookieService = inject(SsrCookieService);
  private readonly cookieRegistry = inject(CookieRegistryService);

  public readonly currentPersona: WritableSignal<PersonaType>;
  public readonly allPersonas: WritableSignal<PersonaType[]>;
  public readonly isBoardScoped: Signal<boolean>;

  /** Whether the user holds any board-scoped persona (board-member, executive-director) */
  public readonly hasBoardRole: Signal<boolean>;

  /** Whether the user holds any project-scoped persona (maintainer, core-developer, projects) */
  public readonly hasProjectRole: Signal<boolean>;

  /** Whether the user has access to multiple projects (affects project lens sidebar) */
  public readonly multiProject: WritableSignal<boolean>;

  /** Whether the user has access to multiple foundations (affects foundation lens sidebar) */
  public readonly multiFoundation: WritableSignal<boolean>;

  public constructor() {
    const stored = this.loadFromCookie();
    this.currentPersona = signal<PersonaType>(stored?.primary ?? 'maintainer');
    this.allPersonas = signal<PersonaType[]>(stored?.all ?? ['maintainer']);
    this.multiProject = signal<boolean>(stored?.multiProject ?? false);
    this.multiFoundation = signal<boolean>(stored?.multiFoundation ?? false);
    this.isBoardScoped = computed(() => isBoardScopedPersona(this.currentPersona()));
    this.hasBoardRole = this.initHasBoardRole();
    this.hasProjectRole = this.initHasProjectRole();
  }

  /**
   * Set the current persona (single role)
   */
  public setPersona(persona: PersonaType): void {
    if (persona !== this.currentPersona()) {
      this.currentPersona.set(persona);
      this.allPersonas.set([persona]);
      this.multiProject.set(false);
      this.multiFoundation.set(false);
      this.persistToCookie({ primary: persona, all: [persona], multiProject: false, multiFoundation: false });

      if (this.isBoardScoped()) {
        this.projectContextService.clearProject();
      }
    }
  }

  /**
   * Set multiple personas at once (used by dev toolbar for multi-role testing)
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
