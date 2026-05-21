// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Injectable, signal, WritableSignal } from '@angular/core';

/**
 * Shared hook for opening the cross-tab person profile side panel from
 * any Org Lens People-page tab.
 *
 * The panel UI itself is intentionally not implemented yet — this
 * service exists so sibling stories that introduce person rows
 * (LFXV2-1869 children) have a single, stable API to wire `(click)`
 * handlers into, instead of each tab picking its own hook.
 */
@Injectable({
  providedIn: 'root',
})
export class PersonProfilePanelService {
  /**
   * Name of the currently selected person, or `null` when the panel is
   * closed. Will be replaced with a richer Person record once the
   * panel internals land.
   */
  public readonly activePerson: WritableSignal<string | null> = signal(null);

  public open(name: string): void {
    this.activePerson.set(name);
  }

  public close(): void {
    this.activePerson.set(null);
  }
}
