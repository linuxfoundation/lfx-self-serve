// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Injectable, Signal, signal } from '@angular/core';
import { UserMetadata } from '@lfx-one/shared/interfaces';

/**
 * Every profile field saved this session, newest value each, kept for the whole app so a page that loads the profile after a
 * save (the Profile page after Personal information, #6082) can lay the saves over a profile GET that may still return the
 * values from before them. `UserService` records each successful save, whichever editor made it, so a later save always wins.
 */
@Injectable({ providedIn: 'root' })
export class ProfileSavedFieldsService {
  private readonly saved = signal<Partial<UserMetadata>>({});

  public readonly fields: Signal<Partial<UserMetadata>> = this.saved.asReadonly();

  /** Records a save. Keys left undefined were not sent, so the stored value stands; a cleared field is '' and is kept. */
  public record(metadata: Partial<UserMetadata>): void {
    const defined = Object.fromEntries(Object.entries(metadata).filter(([, value]) => value !== undefined)) as Partial<UserMetadata>;
    this.saved.update((saved) => ({ ...saved, ...defined }));
  }
}
