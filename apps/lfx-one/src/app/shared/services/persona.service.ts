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

  public readonly currentPersona: WritableSignal<PersonaType>;
  public readonly isAutoDetected: WritableSignal<boolean> = signal(false);

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
    } else {
      // No auto-detected persona, allow manual selection
      this.isAutoDetected.set(false);
      // Default to maintainer persona if no auto-detected persona is available
      this.setPersona('maintainer');
    }
  }

  /**
   * Set the current persona
   * When switching to board-member, clear child project selection
   * Cannot change persona if it was auto-detected from committee membership
   */
  public setPersona(persona: PersonaType): void {
    if (persona !== this.currentPersona()) {
      this.currentPersona.set(persona);

      // When switching to board-member persona, clear any child project selection
      // Board members should only work at the foundation level
      if (persona === 'board-member') {
        this.projectContextService.clearProject();
        this.router.navigate(['/']);
      }
    }
  }
}
