// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, Injectable, Signal, signal } from '@angular/core';
import { CombinedProfile } from '@lfx-one/shared/interfaces';

/**
 * Coordinates the Profile & Account edit drawer (LFXV2-2742). The edit affordances live in the
 * presentational ProfilePanelComponent while the drawer is hosted by ProfileLayoutComponent, so a
 * root-provided service decouples the trigger from the drawer: callers pass the current
 * CombinedProfile via {@link open}, and the drawer reads it to seed its form.
 *
 * Open state is derived from the context — a non-null context means the drawer is open — mirroring
 * PersonDetailDrawerService.
 */
@Injectable({ providedIn: 'root' })
export class ProfileEditDrawerService {
  private readonly _context = signal<CombinedProfile | null>(null);

  /** The profile the drawer is currently editing, or null when the drawer is closed. */
  public readonly context: Signal<CombinedProfile | null> = this._context.asReadonly();

  /** True while the drawer is open. */
  public readonly isOpen: Signal<boolean> = computed(() => this._context() !== null);

  /** Open the drawer to edit the given profile. */
  public open(profile: CombinedProfile): void {
    this._context.set(profile);
  }

  /** Close the drawer. */
  public close(): void {
    this._context.set(null);
  }
}
