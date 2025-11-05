// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject, Injectable, signal, WritableSignal } from '@angular/core';
import { Router } from '@angular/router';
import { PersonaType } from '@lfx-one/shared/interfaces';

@Injectable({
  providedIn: 'root',
})
export class PersonaService {
  private readonly router = inject(Router);

  private readonly storageKey = 'lfx-persona';
  public readonly currentPersona: WritableSignal<PersonaType>;

  public constructor() {
    // Initialize with default value
    this.currentPersona = signal<PersonaType>('board-member');
  }

  /**
   * Set the current persona and persist to storage
   */
  public setPersona(persona: PersonaType): void {
    if (persona !== this.currentPersona()) {
      this.currentPersona.set(persona);
      this.persistPersona(persona);

      this.router.navigate(['/']);
    }
  }

  private persistPersona(persona: PersonaType): void {
    localStorage.setItem(this.storageKey, persona);
  }
}
