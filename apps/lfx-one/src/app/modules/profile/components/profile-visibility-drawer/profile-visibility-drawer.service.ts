// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, Injectable, Signal, signal } from '@angular/core';

/**
 * Coordinates the public-profile visibility drawer (LFXV2-2629): callers pass the username via
 * {@link open} for the public-URL row; the drawer fetches its own state lazily on open. Layout-scoped.
 */
@Injectable()
export class ProfileVisibilityDrawerService {
  private readonly _context = signal<string | null>(null);

  /** The username the drawer opened for (drives the public-profile URL), or null when closed. */
  public readonly context: Signal<string | null> = this._context.asReadonly();

  /** True while the drawer is open. */
  public readonly isOpen: Signal<boolean> = computed(() => this._context() !== null);

  /** Open the drawer for the given username (may be empty when the username is unknown). */
  public open(username: string): void {
    this._context.set(username);
  }

  /** Close the drawer. */
  public close(): void {
    this._context.set(null);
  }
}
