// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, Injectable, Signal, signal } from '@angular/core';
import { MentorshipMenteeProfileDetails } from '@lfx-one/shared/interfaces';

/**
 * Coordinates the mentee profile edit drawer. Callers pass the current
 * {@link MentorshipMenteeProfileDetails} via {@link open}, and the drawer reads
 * it to seed its form. Open state is derived from the context — a non-null
 * context means the drawer is open.
 *
 * Provided at {@link MenteeProfileComponent} so the page-scoped instance is torn
 * down when the mentee profile page is left. `providedIn: 'root'` keeps the
 * class tree-shakeable; the component `providers` entry still wins at runtime.
 */
@Injectable({ providedIn: 'root' })
export class MenteeProfileEditDrawerService {
  private readonly _context = signal<MentorshipMenteeProfileDetails | null>(null);

  /** The profile the drawer is currently editing, or null when closed. */
  public readonly context: Signal<MentorshipMenteeProfileDetails | null> = this._context.asReadonly();

  /** True while the drawer is open. */
  public readonly isOpen: Signal<boolean> = computed(() => this._context() !== null);

  /** Open the drawer to edit the given profile. */
  public open(profile: MentorshipMenteeProfileDetails): void {
    this._context.set(profile);
  }

  /** Close the drawer. */
  public close(): void {
    this._context.set(null);
  }
}
