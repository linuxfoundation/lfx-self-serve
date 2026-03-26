// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, inject, Injectable, Signal, signal, WritableSignal } from '@angular/core';
import { isBoardScopedPersona, PersonaType } from '@lfx-one/shared/interfaces';

import { ProjectContextService } from './project-context.service';

@Injectable({
  providedIn: 'root',
})
export class PersonaService {
  private readonly projectContextService = inject(ProjectContextService);

  public readonly currentPersona: WritableSignal<PersonaType>;
  public readonly isAutoDetected: WritableSignal<boolean> = signal(false);
  public readonly isBoardScoped: Signal<boolean> = computed(() => isBoardScopedPersona(this.currentPersona()));

  public constructor() {
    // Default persona - will be overridden by initializeFromAuth if backend provides one
    this.currentPersona = signal<PersonaType>('maintainer');
  }

  /**
   * Initialize persona from AuthContext (SSR state transfer)
   * If persona is provided from backend, it was auto-detected and cannot be changed
   */
  public initializeFromAuth(persona: PersonaType | null | undefined): void {
    if (persona) {
      this.currentPersona.set(persona);
      this.isAutoDetected.set(true);

      // When auto-detected as board-scoped persona, clear child project selection
      if (this.isBoardScoped()) {
        this.projectContextService.clearProject();
      }
    } else {
      // No auto-detected persona, allow manual selection
      this.isAutoDetected.set(false);
      this.setPersona('maintainer');
    }
  }

  /**
   * Set the current persona
   * When switching to board-member or executive-director, clear child project selection
   * Cannot change persona if it was auto-detected from committee membership
   */
  public setPersona(persona: PersonaType): void {
    if (this.isAutoDetected()) {
      return;
    }

    if (persona !== this.currentPersona()) {
      this.currentPersona.set(persona);

      // When switching to board-scoped persona, clear any child project selection
      if (this.isBoardScoped()) {
        this.projectContextService.clearProject();
      }
    }
  }
}
