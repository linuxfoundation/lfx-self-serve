// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, Injectable, Signal, signal } from '@angular/core';
import { MentorshipMentorProfileDetails } from '@lfx-one/shared/interfaces';

/**
 * Coordinates the mentor profile edit drawer. Callers pass the current
 * {@link MentorshipMentorProfileDetails} via {@link open}, and the drawer reads
 * it to seed its form. Open state is derived from the context — a non-null
 * context means the drawer is open.
 *
 * Provided at {@link MentorProfileComponent} (not root) so the instance is torn
 * down when the mentor profile page is left.
 */
@Injectable()
export class MentorProfileEditDrawerService {
  private readonly _context = signal<MentorshipMentorProfileDetails | null>(null);

  /** The profile the drawer is currently editing, or null when closed. */
  public readonly context: Signal<MentorshipMentorProfileDetails | null> = this._context.asReadonly();

  /** True while the drawer is open. */
  public readonly isOpen: Signal<boolean> = computed(() => this._context() !== null);

  /** Open the drawer to edit the given profile. */
  public open(profile: MentorshipMentorProfileDetails): void {
    this._context.set(profile);
  }

  /** Close the drawer. */
  public close(): void {
    this._context.set(null);
  }
}
