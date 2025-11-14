// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject, Injectable, signal, WritableSignal } from '@angular/core';
import { Router } from '@angular/router';
import { PersonaType } from '@lfx-one/shared/interfaces';

import { ProjectContextService } from './project-context.service';

@Injectable({
  providedIn: 'root',
})
export class PersonaService {
  private readonly router = inject(Router);
  private readonly projectContextService = inject(ProjectContextService);

  private readonly storageKey = 'lfx-persona';
  public readonly currentPersona: WritableSignal<PersonaType>;

  public constructor() {
    const stored = this.loadStoredPersona();
    this.currentPersona = signal<PersonaType>(stored || 'maintainer');
  }

  /**
   * Set the current persona and persist to storage
   * When switching to board-member, clear child project selection
   */
  public setPersona(persona: PersonaType): void {
    if (persona !== this.currentPersona()) {
      this.currentPersona.set(persona);
      this.persistPersona(persona);

      // When switching to board-member persona, clear any child project selection
      // Board members should only work at the foundation level
      if (persona === 'board-member') {
        this.projectContextService.clearProject();
      }

      this.router.navigate(['/']);
    }
  }

  private persistPersona(persona: PersonaType): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(this.storageKey, persona);
    }
  }

  private loadStoredPersona(): PersonaType | null {
    if (typeof localStorage === 'undefined') {
      return null;
    }
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        return stored as PersonaType;
      }
    } catch {
      // Invalid data in localStorage, ignore
    }
    return null;
  }
}
