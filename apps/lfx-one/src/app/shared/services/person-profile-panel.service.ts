// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Injectable, signal } from '@angular/core';

/** Cross-tab hook for the person profile side panel (panel UI is a follow-up story). */
@Injectable({
  providedIn: 'root',
})
export class PersonProfilePanelService {
  private readonly _activePerson = signal<string | null>(null);

  public readonly activePerson = this._activePerson.asReadonly();

  public open(name: string): void {
    this._activePerson.set(name);
  }

  public close(): void {
    this._activePerson.set(null);
  }
}
